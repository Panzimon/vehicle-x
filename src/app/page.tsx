'use client'

import { useState } from 'react'
import { chatWithAI, complexQuery, getCarDetailAction, planRouteAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Car } from '@/lib/schema'

type Mode = 'chat' | 'search' | 'detail'
type Step = 'input' | 'select_car' | 'show_detail' | 'plan_route'

export default function Home() {
  const [input, setInput] = useState('')
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('chat')
  const [step, setStep] = useState<Step>('input');
  
  // 搜索结果
  const [carList, setCarList] = useState<Car[]>([]);
  const [selectedCar, setSelectedCar] = useState<Car | null>(null);
  const [routeInfo, setRouteInfo] = useState<any>(null)

  async function handleSend() {
    if (!input.trim()) return
    setLoading(true)
    setReply('')

    if (mode === 'chat') {
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
          } catch (error) {
            // 忽略解析失败
            console.warn('解析失败:', data, error)
          }
        }
      }
    } else {
      // 智能决策：Step 1 搜索车型
      const res = await complexQuery(input) as any
      
      if (res.success && res.toolResult?.[0]?.data) {
        setCarList(res.toolResult[0].data)
        setStep('select_car')
        setReply(`找到 ${res.toolResult[0].data.length} 款符合预算的车型，请点击查看详情：`)
      } else {
        setReply('没有找到符合条件的车型，请调整预算或条件')
      }
      
      setLoading(false)
    }
  }

  // Step 2: 查看车型详情
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

  // Step 3: 规划路线
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

  function handleReset() {
    setStep('input')
    setCarList([])
    setSelectedCar(null)
    setRouteInfo(null)
    setReply('')
    setInput('')
  }

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">🚗 Vehicle-X AI 助手</h1>

      {/* 模式选择 */}
      <div className="flex gap-2 mb-4">
        <Button variant={mode === 'chat' ? 'default' : 'outline'} onClick={() => { setMode('chat'); handleReset() }}>
          💬 聊天
        </Button>
        <Button variant={mode === 'search' ? 'default' : 'outline'} onClick={() => { setMode('search'); handleReset() }}>
          🔍 智能选车
        </Button>
      </div>

      {/* 输入区（只在 input 步骤显示） */}
      {step === 'input' && (
        <div className="flex gap-2 mb-4">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={mode === 'chat' ? '随便聊聊...' : '我预算25万，每天通勤60公里，周末露营'}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
          />
          <Button onClick={handleSend} disabled={loading}>
            {loading ? '搜索中...' : '发送'}
          </Button>
        </div>
      )}

      {/* AI 回复区 */}
      {reply && (
        <Card className="p-4 mb-4 bg-gray-50">
          <p className="whitespace-pre-wrap text-sm">{reply}</p>
        </Card>
      )}

      {/* Step 2: 车型列表（选择卡片） */}
      {step === 'select_car' && carList.length > 0 && (
        <div className="grid grid-cols-1 gap-3 mb-4">
          {carList.map((car) => (
            <Card key={car.id} className="p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => handleViewDetail(car)}>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-lg">{car.brand} {car.model}</h3>
                  <p className="text-sm text-gray-600">{car.price}万 | {car.energy_type} | {car.body_type} | 续航{car.range}km</p>
                  <div className="flex gap-2 mt-2">
                    {car.tags.map(tag => (
                      <span key={tag} className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">{tag}</span>
                    ))}
                  </div>
                </div>
                <Button size="sm" variant="outline">查看详情 →</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Step 3: 车型详情 + 操作按钮 */}
      {step === 'show_detail' && selectedCar && (
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="font-bold text-xl mb-2">{selectedCar.brand} {selectedCar.model}</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>💰 价格：{selectedCar.price}万</div>
              <div>🔋 能源：{selectedCar.energy_type}</div>
              <div>🚗 车身：{selectedCar.body_type}</div>
              <div>📏 续航：{selectedCar.range}km</div>
              <div>⚡ 零百：{selectedCar.acceleration}s</div>
              <div>📦 后备箱：{selectedCar.trunk_volume}L</div>
            </div>
            <div className="mt-4">
              <p className="text-sm font-semibold text-green-700">✅ 优点：{selectedCar.pros.join('、')}</p>
              <p className="text-sm font-semibold text-red-700 mt-1">❌ 缺点：{selectedCar.cons.join('、')}</p>
            </div>
          </Card>

          <div className="flex gap-2">
            <Input placeholder="出发地，如：北京市朝阳区" id="from-input" />
            <Input placeholder="目的地，如：天津之眼" id="to-input" />
            <Button onClick={() => {
              const from = (document.getElementById('from-input') as HTMLInputElement)?.value
              const to = (document.getElementById('to-input') as HTMLInputElement)?.value
              if (from && to) handlePlanRoute(from, to)
            }}>
              规划路线
            </Button>
            <Button variant="outline" onClick={handleReset}>重新选车</Button>
          </div>
        </div>
      )}

      {/* Step 4: 路线结果 */}
      {routeInfo && (
        <Card className="p-4 bg-green-50 border-green-200">
          <h3 className="font-bold mb-2">🗺️ 路线规划</h3>
          <p className="text-sm">距离：{routeInfo.distance}</p>
          <p className="text-sm">预计时间：{routeInfo.duration}</p>
          <p className="text-sm">过路费：{routeInfo.tolls}</p>
          {routeInfo.steps?.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-semibold">关键路段：</p>
              {routeInfo.steps.map((step: string, i: number) => (
                <p key={i} className="text-xs text-gray-600">• {step}</p>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* 返回按钮（非 input 步骤显示） */}
      {step !== 'input' && (
        <Button variant="ghost" size="sm" onClick={handleReset} className="mt-4">
          ← 重新开始
        </Button>
      )}
    </main>
  )
}