'use client'

import { useState } from 'react'
import { chatWithAI } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

export default function Home() {
  const [input, setInput] = useState('')
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(false)
  const [toolInfo, setToolInfo] = useState<any>(null)
  const [isChatMode, setIsChatMode] = useState(true) // true=聊天(SSE), false=工具(Server Action)

  async function handleSend() {
    if (!input.trim()) return
    setLoading(true)
    setReply('')
    setToolInfo(null)

    if (isChatMode) {
      // ========== SSE 流式聊天 ==========
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input })
      })

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        setReply('连接失败')
        setLoading(false)
        return
      }

      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(line => line.startsWith('data: '))

        for (const line of lines) {
          const data = line.slice(6)
          try {
            const parsed = JSON.parse(data)
            if (parsed.text) {
              fullText += parsed.text
              setReply(fullText)
            }
            if (parsed.done) {
              setLoading(false)
            }
            if (parsed.error) {
              setReply(parsed.error)
              setLoading(false)
            }
          } catch {
            // 忽略解析失败
          }
        }
      }
    } else {
      // ========== 工具调用（昨天的 Server Action）==========
      const res = await chatWithAI(input)
      
      if (res.success) {
        setReply(res.content)
        if (res.toolUsed) {
          setToolInfo({ 
            name: res.toolUsed, 
            result: res.toolResult 
          })
        }
      } else {
        setReply(res.error || '出错了')
      }
      
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">🚗 Vehicle-X AI 助手（本地模型 + 工具调用）</h1>
      
      {/* 模式切换 */}
      <div className="flex gap-2 mb-4">
        <Button 
          variant={isChatMode ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setIsChatMode(true)}
        >
          💬 聊天模式
        </Button>
        <Button 
          variant={!isChatMode ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setIsChatMode(false)}
        >
          🛠️ 工具模式
        </Button>
      </div>

      <p className="text-xs text-gray-500 mb-4">
        {isChatMode ? 'SSE 流式输出，适合闲聊和简单问答' : '自动调用工具查询车型数据库，适合购车决策'}
      </p>
      
      {/* AI 回复区 */}
      <Card className="p-4 mb-4 min-h-[150px] bg-gray-50">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply}</p>
      </Card>

      {/* 工具调用展示区（只有工具模式显示） */}
      {toolInfo && !isChatMode && (
        <Card className="p-4 mb-4 bg-blue-50 border-blue-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold px-2 py-1 bg-blue-600 text-white rounded">🛠️ 工具调用</span>
            <span className="text-xs text-blue-800">{toolInfo.name}</span>
          </div>
          
          <div className="space-y-3">
            {toolInfo.result.map((item: any, idx: number) => (
              <div key={idx} className="text-xs text-blue-900">
                <p className="font-semibold border-b border-blue-200 pb-1 mb-1">
                  {item.tool}（{Array.isArray(item.data) ? item.data.length : 1} 条结果）：
                </p>
                
                {Array.isArray(item.data) && item.data.map((car: any) => (
                  <div key={car?.id || idx} className="flex gap-3 border-b border-blue-100 py-1">
                    <span className="font-bold">{car?.brand} {car?.model}</span>
                    <span>{car?.price}万</span>
                    <span>{car?.energy_type}</span>
                    <span>{car?.body_type}</span>
                    <span>续航{car?.range}km</span>
                  </div>
                ))}
                
                {!Array.isArray(item.data) && item.data && (
                  <div className="py-1">
                    <span className="font-bold">{item.data.brand} {item.data.model}</span>
                    <span className="ml-2">{item.data.price}万 / {item.data.energy_type} / 续航{item.data.range}km</span>
                  </div>
                )}
                
                {(!item.data || (Array.isArray(item.data) && item.data.length === 0)) && (
                  <p className="text-blue-600 italic">无结果</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      
      {/* 输入区 */}
      <div className="flex gap-2">
        <Input 
          value={input} 
          onChange={e => setInput(e.target.value)}
          placeholder={isChatMode ? '随便聊聊...' : '20万预算纯电轿车 / 对比Model Y和理想L6'}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          autoFocus
        />
        <Button onClick={handleSend} disabled={loading}>
          {loading ? '调用中...' : '发送'}
        </Button>
      </div>
    </main>
  )
}