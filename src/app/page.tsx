'use client'

import { useState } from 'react'
import { chatWithAI } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Car } from '@/lib/schema'

export default function Home() {
  const [input, setInput] = useState('')
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(false)
  const [toolInfo, setToolInfo] = useState<{ name: string; result: Car[] } | null>(null)

  async function handleSend() {
    if (!input.trim()) return
    setLoading(true)
    setReply('思考中...（本地模型推理 + 工具调用）')
    setToolInfo(null)
    
    const res = await chatWithAI(input)
    console.table(res)
    if (res.success) {
      setReply(res.content ?? '')
      if (res.toolUsed) {
        setToolInfo({ name: res.toolUsed, result: res.toolResult as Car[] })
      }
    } else {
      setReply(res.error || '出错了')
    }
    
    setLoading(false)
  }

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">🚗 Vehicle-X AI 助手（本地模型 + 工具调用）</h1>
      
      {/* AI 回复区 */}
      <Card className="p-4 mb-4 min-h-[150px] bg-gray-50">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply}</p>
      </Card>

      {/* 工具调用展示区 */}
      {toolInfo && (
        <Card className="p-4 mb-4 bg-blue-50 border-blue-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold px-2 py-1 bg-blue-600 text-white rounded">🛠️ 工具调用</span>
            <span className="text-xs text-blue-800">{toolInfo.name}</span>
          </div>
          <div className="text-xs text-blue-900 space-y-1">
            <p className="font-semibold">查询结果（{toolInfo.result.length} 款车）：</p>
            {toolInfo.result.map((car: Car) => (
              <div key={car.id} className="flex gap-3 border-b border-blue-200 pb-1">
                <span className="font-bold">{car.brand} {car.model}</span>
                <span>{car.price}万</span>
                <span>{car.energy_type}</span>
                <span>{car.body_type}</span>
                <span>续航{car.range}km</span>
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
          placeholder="试试：20万预算推荐纯电轿车 / 25万SUV适合露营的有哪些"
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