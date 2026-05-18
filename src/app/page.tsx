'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { complexQuery, getCarDetailAction, planRouteAction } from './actions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Car } from '@/lib/schema'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type Mode = 'chat' | 'search' | 'detail'
type Step = 'input' | 'select_car' | 'show_detail' | 'plan_route'
type MessageStatus = 'sending' | 'receiving' | 'completed'

interface ChatMessage {
  id: string
  content: string
  role: 'user' | 'assistant'
  status: MessageStatus
  toolCalls?: Array<{ tool: string; args: unknown }>
}

export default function Home() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('chat')
  const [step, setStep] = useState<Step>('input')

  const [carList, setCarList] = useState<Car[]>([])
  const [selectedCar, setSelectedCar] = useState<Car | null>(null)
  const [routeInfo, setRouteInfo] = useState<any>(null)
  const isPlanningRouteRef = useRef(false)
  const [abortCtrl, setAbortCtrl] = useState<AbortController | null>(null)
  const isFirstChunkRef = useRef(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 按模式隔离聊天记录，切换模式时保存/恢复
  const savedMessagesRef = useRef<{ chat: ChatMessage[], search: ChatMessage[] }>({
    chat: [],
    search: [],
  })

  const generateId = () => {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`
  }

  const addMessage = useCallback((content: string, role: 'user' | 'assistant', status: MessageStatus = 'completed') => {
    const newMessage: ChatMessage = {
      id: generateId(),
      content,
      role,
      status
    }
    setMessages(prev => [...prev, newMessage])
    return newMessage.id
  }, [])

  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(msg => 
      msg.id === id ? { ...msg, ...updates } : msg
    ))
  }, [])
  
  // ===== 文本清理函数 =====
  
  // 流式接收阶段使用：只过滤乱码和控制字符，保留原始格式
  const cleanStreamText = (text: string): string => {
    let cleaned = text;
    cleaned = cleaned.replace(/\.UltraCoder/g, '');
    // 过滤泰文
    cleaned = cleaned.replace(/[\u0E00-\u0EFF]/g, '');
    // 过滤扩展拉丁字符（土耳其语、法语等乱码）
    cleaned = cleaned.replace(/[\u00C0-\u024F]/g, '');
    // 过滤零宽字符和不可见控制字符（保留 \n=0x0A 和 \r=0x0D 换行符！）
    cleaned = cleaned.replace(/[\u200B-\u200F\uFEFF\u0000-\u0009\u000B-\u000C\u000E-\u001F\u007F]/g, '');
    return cleaned;
  }

  // 最终渲染前使用：完整清理 + 修复跨 chunk 导致的非标准 Markdown 格式
  const cleanFinalText = (text: string): string => {
    let cleaned = cleanStreamText(text);
    // 修复模型输出的非标准 Markdown 列表格式（标记后缺空格）
    // 此时是完整文本，能正确识别跨 chunk 的模式如 "-车身尺寸"
    cleaned = cleaned.replace(/^(\d+)\.(?=[^\s])/gm, '$1. ');
    // - 后无空格，但排除连续的 -（分隔线 ---）
    cleaned = cleaned.replace(/^-(?=[^\s\-])/gm, '- ');
    cleaned = cleaned.replace(/^\s+/, '');
    return cleaned;
  }

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const appendToMessage = useCallback((id: string, text: string) => {
    setMessages(prev => {
      if (isFirstChunkRef.current) {
        isFirstChunkRef.current = false;
      }
      // 流式阶段只做基础清理，不修 Markdown 格式（避免跨 chunk 识别失败）
      const cleanedText = cleanStreamText(text);
      return prev.map(msg =>
        msg.id === id ? { ...msg, content: msg.content + cleanedText } : msg
      );
    });
  }, [])

  async function handleSend() {
    if (!input.trim()) return
    setLoading(true)
    setInput('')

    const userMsgId = addMessage(input.trim(), 'user')

    if (mode === 'chat') {
      abortCtrl?.abort()
      const ctrl = new AbortController()
      setAbortCtrl(ctrl)
      isFirstChunkRef.current = true

      const assistantMsgId = addMessage('', 'assistant', 'receiving')
        let receivedContent = false
        let hasToolDone = false
        let hasReceivedValidText = false

        try {
          // 收集当前聊天模式下的历史消息（不含 receiving 状态的）
          const history = messages
            .filter(m => m.status === 'completed')
            .map(m => ({ role: m.role, content: m.content }))
          
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: input.trim(), history }),
            signal: ctrl.signal,
          })

          if (!res.ok) {
            updateMessage(assistantMsgId, { content: `服务端错误 (${res.status})，请稍后重试`, status: 'completed' })
            setLoading(false)
            return
          }

          if (!res.body) {
            updateMessage(assistantMsgId, { content: '无法建立流式连接', status: 'completed' })
            setLoading(false)
            return
          }

          const reader = res.body.getReader()
          const decoder = new TextDecoder('utf-8')
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed || !trimmed.startsWith('data:')) continue

              const dataStr = trimmed.slice(5).trim()
              if (dataStr === '[DONE]') continue

              try {
                const data = JSON.parse(dataStr)
                console.log('data:', data)
                if (data.error) {
                  updateMessage(assistantMsgId, { content: '服务端错误：' + data.error, status: 'completed' })
                  receivedContent = true
                } else if (data.type === 'tool_done') {
                  hasToolDone = true
                } else if (data.text) {
                  // 有tool_done → 等tool_done后才收；无tool_done → 收到有效文本后开始收
                  if (hasToolDone || hasReceivedValidText) {
                    receivedContent = true
                    updateMessage(assistantMsgId, { status: 'completed' })
                    // tool_done 之后的第一条文本才补换行，后续不再补
                    // 但先检查当前消息末尾是否已有换行，有则不加
                    let prefix = ''
                    if (hasToolDone && !hasReceivedValidText) {
                      const currentContent = messages.find(m => m.id === assistantMsgId)?.content || ''
                      const endsWithNewline = /[\n\r]$/.test(currentContent)
                      prefix = endsWithNewline ? '' : '\n'
                    }
                    hasReceivedValidText = true
                    appendToMessage(assistantMsgId, prefix + data.text)
                  } else if (!hasToolDone && data.text.trim()) {
                    // tool_done未到但收到非空文本 → 第一个有效文本，追加并开始后续接收
                    hasReceivedValidText = true
                    receivedContent = true
                    updateMessage(assistantMsgId, { status: 'completed' })
                    appendToMessage(assistantMsgId, data.text)
                  }
                }
                if (data.done) {
                  updateMessage(assistantMsgId, { status: 'completed' })
                }
              } catch {
                // 忽略解析失败的行
              }
            }
          }

          if (!receivedContent) {
            updateMessage(assistantMsgId, { content: '暂无有效回复，请换个问题试试', status: 'completed' })
          }
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            const errorMsg = err.message || '网络请求失败'
            updateMessage(assistantMsgId, { 
              content: errorMsg.includes('Failed to fetch') 
                ? '网络连接失败，请检查网络状态' 
                : '请求出错：' + errorMsg, 
              status: 'completed' 
            })
          }
        } finally {
          setLoading(false)
          setAbortCtrl(null)
        }
    } else {
      const assistantMsgId = addMessage('', 'assistant', 'receiving')
      isFirstChunkRef.current = true

      const res = await complexQuery(input.trim()) as any

      if (res.success) {
        if (res.toolUsed === 'compare_cars') {
          appendToMessage(assistantMsgId, res.content || '对比完成')
          setCarList([])
          setStep('input')
        } else if (res.toolResult?.[0]?.data && res.toolResult[0].data.length > 0) {
          setCarList(res.toolResult[0].data)
          setStep('select_car')
          appendToMessage(assistantMsgId, `找到 ${res.toolResult[0].data.length} 款符合预算的车型，请点击查看详情：`)
        } else {
          appendToMessage(assistantMsgId, '没有找到符合条件的车型，请调整预算或条件')
          setStep('input')
        }
      } else {
        appendToMessage(assistantMsgId, res.error || '查询失败')
        setStep('input')
      }
      updateMessage(assistantMsgId, { status: 'completed' })

      setLoading(false)
    }
  }

  async function handleViewDetail(car: Car) {
    if (loading) return
    setLoading(true)
    setSelectedCar(car)

    const res = await getCarDetailAction(car.id) as any

    if (res.success && res.data) {
      setSelectedCar(res.data)
      setStep('show_detail')
      const msgId = addMessage('', 'assistant', 'receiving')
      isFirstChunkRef.current = true
      appendToMessage(msgId, `${res.data.brand} ${res.data.model} 详细参数：`)
      updateMessage(msgId, { status: 'completed' })
    } else {
      const msgId = addMessage('', 'assistant', 'receiving')
      isFirstChunkRef.current = true
      appendToMessage(msgId, res.error || `无法获取 "${car.brand} ${car.model}" 的详细信息，请稍后重试`)
      updateMessage(msgId, { status: 'completed' })
      setSelectedCar(null)
    }

    setLoading(false)
  }

  async function handlePlanRoute(from: string, to: string) {
    if (loading) return
    setLoading(true)
    isPlanningRouteRef.current = true

    const res = await planRouteAction(from, to) as any

    // 如果已经被取消（用户点击了重新选车），不再更新状态
    if (!isPlanningRouteRef.current) return

    if (res.success) {
      setRouteInfo(res.data)
      const msgId = addMessage('', 'assistant', 'receiving')
      isFirstChunkRef.current = true
      appendToMessage(msgId, `从 ${from} 到 ${to} 的路线规划：`)
      updateMessage(msgId, { status: 'completed' })
    } else {
      const msgId = addMessage('', 'assistant', 'receiving')
      isFirstChunkRef.current = true
      appendToMessage(msgId, res.error || '路线规划失败')
      updateMessage(msgId, { status: 'completed' })
    }

    isPlanningRouteRef.current = false
    setLoading(false)
  }

  function handleReset() {
    abortCtrl?.abort()
    setStep('input')
    setCarList([])
    setSelectedCar(null)
    setRouteInfo(null)
    isPlanningRouteRef.current = false
    // 清空当前模式的消息（包括 state 和 ref 中的备份）
    const switchableMode = mode as 'chat' | 'search'
    savedMessagesRef.current[switchableMode] = []
    setMessages([])
    setInput('')
  }

  function handleBackToCarList() {
    // 如果正在规划路线，中断它
    isPlanningRouteRef.current = false
    setStep('select_car')
    setSelectedCar(null)
    setRouteInfo(null)
    setLoading(false)
  }

  function handleModeSwitch(newMode: Mode) {
    if (newMode === mode) return

    // 保存当前模式的消息到 ref（只处理 chat/search 切换）
    const switchableMode = mode as 'chat' | 'search'
    const switchableNewMode = newMode as 'chat' | 'search'
    savedMessagesRef.current[switchableMode] = messages

    // 恢复目标模式的消息
    const restored = savedMessagesRef.current[switchableNewMode]
    setMessages(restored)

    // 只重置功能状态，保留聊天历史
    abortCtrl?.abort()
    setStep('input')
    setCarList([])
    setSelectedCar(null)
    setRouteInfo(null)
    isPlanningRouteRef.current = false
    setInput('')

    setMode(newMode)
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-white text-xl">🚗</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Vehicle-X AI 助手</h1>
              <p className="text-sm text-slate-500">智能选车 · 路线规划 · 汽车咨询</p>
            </div>
          </div>
        </div>

        <div className="inline-flex p-1 bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
          <button
            onClick={() => handleModeSwitch('chat')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === 'chat'
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            💬 聊天
          </button>
          <button
            onClick={() => handleModeSwitch('search')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === 'search'
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            🔍 智能选车
          </button>
        </div>

        <Card className="flex flex-col h-[700px] bg-white border-slate-200 rounded-2xl shadow-lg overflow-hidden">
          {/* 聊天区域 - 滚动 */}
          <div className="flex-1 min-h-0">
            <ScrollArea className="h-full p-4" ref={scrollRef}>
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-blue-500 to-purple-600'
                        : 'bg-slate-200'
                    }`}>
                      <span className={`text-xs font-bold ${msg.role === 'user' ? 'text-white' : 'text-slate-600'}`}>
                        {msg.role === 'user' ? 'U' : 'AI'}
                      </span>
                    </div>
                    <div className={`max-w-[70%] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                      <div className={`inline-block px-4 py-2 rounded-2xl break-all max-w-full text-left ${
                        msg.role === 'user'
                          ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-br-md'
                          : 'bg-slate-100 text-slate-700 rounded-bl-md'
                      }`}>
                        {msg.status === 'receiving' && (
                          <span className="flex items-center gap-1">
                            <span className="inline-block w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></span>
                            <span className="inline-block w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></span>
                            <span className="inline-block w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></span>
                          </span>
                        )}
                        {msg.status !== 'receiving' && (
                          <div className="text-sm leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                              h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-3">{children}</h1>,
                              h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-2">{children}</h3>,
                              ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
                              li: ({ children }) => <li className="mb-0.5">{children}</li>,
                              strong: ({ children }) => <strong className="font-semibold text-slate-800">{children}</strong>,
                              em: ({ children }) => <em>{children}</em>,
                              blockquote: ({ children }) => <blockquote className="border-l-4 border-blue-300 pl-3 py-1 my-2 bg-blue-50/50 rounded-r text-slate-600 italic">{children}</blockquote>,
                              code: ({ inline, children }: { inline?: boolean; children?: React.ReactNode }) =>
                                inline
                                  ? <code className="bg-slate-200 px-1.5 py-0.5 rounded text-xs font-mono text-red-600">{children}</code>
                                  : <code className="block bg-slate-900 text-green-400 px-3 py-2 rounded-lg text-xs font-mono overflow-x-auto my-2">{children}</code>,
                              pre: ({ children }) => <pre className="bg-slate-900 rounded-lg overflow-x-auto my-2">{children}</pre>,
                              a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline hover:text-blue-700">{children}</a>,
                              hr: () => <hr className="my-3 border-slate-200" />,
                              table: ({ children }) => <div className="overflow-x-auto my-2"><table className="min-w-full border-collapse border border-slate-200 text-sm">{children}</table></div>,
                              th: ({ children }) => <th className="border border-slate-200 bg-slate-100 px-3 py-1.5 text-left font-semibold">{children}</th>,
                              td: ({ children }) => <td className="border border-slate-200 px-3 py-1.5">{children}</td>,
                            }}>
                              {cleanFinalText(msg.content)}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                      {msg.status !== 'completed' && msg.status !== 'receiving' && (
                        <span className="text-xs text-slate-400 mt-1 block">发送中...</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* 卡片显示区域 - 可选，固定高度 */}
          {(step === 'select_car' || step === 'show_detail' || routeInfo) && (
            <div className="p-4 border-t border-slate-200 max-h-[250px] overflow-y-auto bg-slate-50 shrink-0">
              {step === 'select_car' && carList.length > 0 && (
                <div className="space-y-3">
                  {carList.map((car) => (
                    <Card
                      key={car.id}
                      className="p-4 bg-white border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer disabled:opacity-50"
                      onClick={() => !loading && handleViewDetail(car)}
                    >
                      <div className="flex justify-between items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-slate-900 truncate">{car.brand} {car.model}</h3>
                          <p className="text-xs text-slate-500 mt-1">
                            {car.price}万 · {car.energy_type} · {car.body_type} · 续航{car.range}km
                          </p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {car.tags.map(tag => (
                              <span key={tag} className="text-[11px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md font-medium">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          disabled={loading}
                          className="shrink-0 text-blue-600 hover:bg-blue-50 h-8"
                        >
                          {loading ? '加载中...' : '详情 →'}
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {step === 'show_detail' && selectedCar && (
                <div className="space-y-4">
                  <Card className="p-5 bg-white border-slate-200 rounded-xl shadow-sm">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl">
                        🚗
                      </div>
                      <div>
                        <h3 className="font-bold text-lg text-slate-900">{selectedCar.brand} {selectedCar.model}</h3>
                        <p className="text-xs text-slate-500">{selectedCar.price}万 · {selectedCar.energy_type}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
                      {[
                        { label: '价格', value: `${selectedCar.price}万` },
                        { label: '能源', value: selectedCar.energy_type },
                        { label: '车身', value: selectedCar.body_type },
                        { label: '续航', value: `${selectedCar.range}km` },
                        { label: '零百加速', value: `${selectedCar.acceleration}s` },
                        { label: '后备箱', value: `${selectedCar.trunk_volume}L` },
                      ].map((item) => (
                        <div key={item.label} className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-3">
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{item.label}</p>
                          <p className="text-sm font-semibold text-slate-900">{item.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-bold bg-green-100 text-green-700 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                          优点
                        </span>
                        <p className="text-sm text-slate-700 leading-relaxed">{selectedCar.pros.join('、')}</p>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                          缺点
                        </span>
                        <p className="text-sm text-slate-700 leading-relaxed">{selectedCar.cons.join('、')}</p>
                      </div>
                    </div>
                  </Card>

                  <Card className="p-4 bg-white border-slate-200 rounded-xl shadow-sm">
                    <div className="flex flex-col md:flex-row gap-2">
                      <input
                        placeholder="出发地，如：北京市朝阳区"
                        id="from-input"
                        className="flex h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 flex-1 transition-all"
                      />
                      <input
                        placeholder="目的地，如：天津之眼"
                        id="to-input"
                        className="flex h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 flex-1 transition-all"
                      />
                      <Button
                        disabled={loading}
                        onClick={() => {
                          const from = (document.getElementById('from-input') as HTMLInputElement)?.value
                          const to = (document.getElementById('to-input') as HTMLInputElement)?.value
                          if (from && to) handlePlanRoute(from, to)
                        }}
                        className="bg-gradient-to-r from-blue-500 to-purple-600 hover:opacity-90 text-white rounded-xl h-10 disabled:opacity-50"
                      >
                        {loading ? (
                          <span className="flex items-center gap-2">
                            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                            规划中
                          </span>
                        ) : (
                          '规划路线'
                        )}
                      </Button>
                      <Button variant="outline" onClick={handleBackToCarList} className="rounded-xl border-slate-200 h-10 hover:bg-slate-50">
                        重新选车
                      </Button>
                    </div>
                  </Card>
                </div>
              )}

              {routeInfo && (
                <Card className="p-5 bg-white border-slate-200 rounded-xl shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                      <span className="text-green-700 text-xs">🗺</span>
                    </div>
                    <h3 className="font-semibold text-slate-900">路线规划结果</h3>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-3">
                      <p className="text-[11px] text-green-600 mb-1">距离</p>
                      <p className="text-sm font-semibold text-green-800">{routeInfo.distance}</p>
                    </div>
                    <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-3">
                      <p className="text-[11px] text-blue-600 mb-1">预计时间</p>
                      <p className="text-sm font-semibold text-blue-800">{routeInfo.duration}</p>
                    </div>
                    <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-3">
                      <p className="text-[11px] text-purple-600 mb-1">过路费</p>
                      <p className="text-sm font-semibold text-purple-800">{routeInfo.tolls}</p>
                    </div>
                  </div>

                  {routeInfo.steps?.length > 0 && (
                    <div className="bg-slate-50 rounded-xl p-4">
                      <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wider">关键路段</p>
                      <div className="space-y-2">
                        {routeInfo.steps.map((step: string, i: number) => (
                          <div key={i} className="flex items-start gap-3">
                            <span className="text-xs font-mono bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded shrink-0">{i + 1}</span>
                            <p className="text-sm text-slate-700 leading-relaxed">{step}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              )}
            </div>
          )}

          {/* 输入框 - 始终在最下面 */}
          <div className="p-4 border-t border-slate-200 bg-white shrink-0">
            <div className="flex gap-3">
              <Textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={mode === 'chat' ? '随便聊聊...' : '我预算25万，每天通勤60公里，周末露营'}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                className="flex-1 min-h-[56px] max-h-[160px] py-3 text-sm resize-none rounded-xl border-slate-200 focus-visible:ring-blue-400 bg-white"
              />
              <Button
                onClick={handleSend}
                disabled={loading}
                className="h-auto px-6 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 hover:opacity-90 text-white disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    思考中
                  </span>
                ) : (
                  '发送'
                )}
              </Button>
            </div>
          </div>
        </Card>

        {step !== 'input' && (
          <button
            onClick={handleReset}
            className="mt-4 text-sm text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1.5 group"
          >
            <span className="group-hover:-translate-x-0.5 transition-transform">←</span>
            重新开始
          </button>
        )}
      </div>
    </main>
  )
}
