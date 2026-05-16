'use client'

import { useState } from 'react'
import { chatWithAI, complexQuery, getCarDetailAction, planRouteAction } from './actions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { Car } from '@/lib/schema'

// 交互模式：chat=聊天模式（流式输出），search=智能选车模式（任务型）
type Mode = 'chat' | 'search' | 'detail'
// 流程步骤：input=输入阶段，select_car=选择车型，show_detail=查看详情，plan_route=路线规划
type Step = 'input' | 'select_car' | 'show_detail' | 'plan_route'

export default function Home() {
  const [input, setInput] = useState('')
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('chat')
  const [step, setStep] = useState<Step>('input');

  // 车型列表（搜索结果）
  const [carList, setCarList] = useState<Car[]>([]);
  // 选中车型（查看详情时）
  const [selectedCar, setSelectedCar] = useState<Car | null>(null);
  // 路线信息
  const [routeInfo, setRouteInfo] = useState<any>(null)
  // SSE Abort 控制器
  const [abortCtrl, setAbortCtrl] = useState<AbortController | null>(null)

  /**
   * 处理发送消息
   * - 聊天模式：流式输出 SSE 响应
   * - 选车模式：调用 complexQuery 执行任务型查询
   */
  async function handleSend() {
    if (!input.trim()) return
    setLoading(true)
    setReply('')

    // 聊天模式：使用 SSE 流式输出
    if (mode === 'chat') {
      abortCtrl?.abort()
      const ctrl = new AbortController()
      setAbortCtrl(ctrl)

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: input }),
          signal: ctrl.signal,
        })

        if (!res.body) {
          setReply('无法建立流式连接')
          setLoading(false)
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        // 逐块读取 SSE 流
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
              if (data.text) {
                setReply(prev => prev + data.text)
              }
            } catch {
              // 忽略解析失败的行
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setReply('请求出错：' + err.message)
        }
      } finally {
        setLoading(false)
        setAbortCtrl(null)
      }
    } else {
      // 选车模式：任务型查询
      const res = await complexQuery(input) as any

      if (res.success) {
        // 对比模式：直接显示 AI 生成的对比报告
        if (res.toolUsed === 'compare_cars') {
          setReply(res.content || '对比完成')
          setCarList([])
          setStep('input')
        }
        // 搜索模式：显示车型列表
        else if (res.toolResult?.[0]?.data) {
          setCarList(res.toolResult[0].data)
          setStep('select_car')
          setReply(`找到 ${res.toolResult[0].data.length} 款符合预算的车型，请点击查看详情：`)
        } else {
          setReply('没有找到符合条件的车型，请调整预算或条件')
        }
      } else {
        setReply(res.error || '查询失败')
      }

      setLoading(false)
    }
  }

  /**
   * 查看车型详情
   * @param car - 要查看详情的车型对象
   */
  async function handleViewDetail(car: Car) {
    setLoading(true)
    setSelectedCar(car)

    const res = await getCarDetailAction(car.id) as any

    if (res.success) {
      setSelectedCar(res.data)
      setStep('show_detail')
      setReply(`${res.data.brand} ${res.data.model} 详细参数：`)
    }

    setLoading(false)
  }

  /**
   * 规划驾车路线
   * @param from - 出发地
   * @param to - 目的地
   */
  async function handlePlanRoute(from: string, to: string) {
    setLoading(true)

    const res = await planRouteAction(from, to) as any

    if (res.success) {
      setRouteInfo(res.data)
      setReply(`从 ${from} 到 ${to} 的路线规划：`)
    } else {
      setReply(res.error || '路线规划失败')
    }

    setLoading(false)
  }

  /**
   * 重置所有状态，重新开始
   */
  function handleReset() {
    abortCtrl?.abort()
    setStep('input')
    setCarList([])
    setSelectedCar(null)
    setRouteInfo(null)
    setReply('')
    setInput('')
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">🚗 Vehicle-X AI 助手</h1>
          <p className="text-sm text-slate-500 mt-1">智能选车 · 路线规划 · 汽车咨询</p>
        </div>

        {/* 模式切换 - Pill 样式 */}
        <div className="inline-flex p-1 bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
          <button
            onClick={() => { setMode('chat'); handleReset() }}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === 'chat'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            💬 聊天
          </button>
          <button
            onClick={() => { setMode('search'); handleReset() }}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === 'search'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            🔍 智能选车
          </button>
        </div>

        {/* 输入区 - 严格对齐 */}
        {step === 'input' && (
          <div className="flex gap-3 mb-6 items-stretch">
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
              className="flex-1 min-h-[56px] max-h-[160px] py-3 text-sm resize-none rounded-xl border-slate-200 focus-visible:ring-slate-400 bg-white"
            />
            <Button
              onClick={handleSend}
              disabled={loading}
              className="h-auto px-6 rounded-xl bg-slate-900 hover:bg-slate-800 text-white"
            >
              {loading ? '...' : '发送'}
            </Button>
          </div>
        )}

        {/* AI 回复区 */}
        {reply && (
          <Card className="p-5 mb-6 bg-white border-slate-200 rounded-xl shadow-sm">
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-slate-900 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-white text-[10px] font-bold">AI</span>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap flex-1">{reply}</p>
            </div>
          </Card>
        )}

        {/* Step 2: 车型列表 */}
        {step === 'select_car' && carList.length > 0 && (
          <div className="space-y-3 mb-6">
            {carList.map((car) => (
              <Card
                key={car.id}
                className="p-4 bg-white border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer"
                onClick={() => handleViewDetail(car)}
              >
                <div className="flex justify-between items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 truncate">{car.brand} {car.model}</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      {car.price}万 · {car.energy_type} · {car.body_type} · 续航{car.range}km
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {car.tags.map(tag => (
                        <span key={tag} className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md font-medium">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="shrink-0 text-slate-900 hover:bg-slate-100 h-8">
                    详情 →
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Step 3: 车型详情 */}
        {step === 'show_detail' && selectedCar && (
          <div className="space-y-4 mb-6">
            <Card className="p-5 bg-white border-slate-200 rounded-xl shadow-sm">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-lg">
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
                  <div key={item.label} className="bg-slate-50 rounded-lg p-3">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">{item.label}</p>
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

            {/* 路线规划输入区 */}
            <Card className="p-4 bg-white border-slate-200 rounded-xl shadow-sm">
              <div className="flex flex-col md:flex-row gap-2">
                <input
                  placeholder="出发地，如：北京市朝阳区"
                  id="from-input"
                  className="flex h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 flex-1 transition-all"
                />
                <input
                  placeholder="目的地，如：天津之眼"
                  id="to-input"
                  className="flex h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 flex-1 transition-all"
                />
                <Button
                  onClick={() => {
                    const from = (document.getElementById('from-input') as HTMLInputElement)?.value
                    const to = (document.getElementById('to-input') as HTMLInputElement)?.value
                    if (from && to) handlePlanRoute(from, to)
                  }}
                  className="bg-slate-900 hover:bg-slate-800 text-white rounded-lg h-10"
                >
                  规划路线
                </Button>
                <Button variant="outline" onClick={handleReset} className="rounded-lg border-slate-200 h-10 hover:bg-slate-50">
                  重新选车
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Step 4: 路线结果 */}
        {routeInfo && (
          <Card className="p-5 bg-white border-slate-200 rounded-xl shadow-sm mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <span className="text-green-700 text-xs">🗺</span>
              </div>
              <h3 className="font-semibold text-slate-900">路线规划结果</h3>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[11px] text-slate-500 mb-1">距离</p>
                <p className="text-sm font-semibold text-slate-900">{routeInfo.distance}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[11px] text-slate-500 mb-1">预计时间</p>
                <p className="text-sm font-semibold text-slate-900">{routeInfo.duration}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-[11px] text-slate-500 mb-1">过路费</p>
                <p className="text-sm font-semibold text-slate-900">{routeInfo.tolls}</p>
              </div>
            </div>

            {/* 关键路段步骤 */}
            {routeInfo.steps?.length > 0 && (
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wider">关键路段</p>
                <div className="space-y-2">
                  {routeInfo.steps.map((step: string, i: number) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-xs font-mono text-slate-400 shrink-0 w-4">{i + 1}</span>
                      <p className="text-sm text-slate-700 leading-relaxed">{step}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* 返回按钮 */}
        {step !== 'input' && (
          <button
            onClick={handleReset}
            className="text-sm text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-1.5 group"
          >
            <span className="group-hover:-translate-x-0.5 transition-transform">←</span>
            重新开始
          </button>
        )}
      </div>
    </main>
  )
}