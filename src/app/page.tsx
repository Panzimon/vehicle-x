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

  async function handleSend() {
    if (!input.trim()) return
    setLoading(true)
    setReply('本地 7B 模型推理中...（首次加载约 30 秒，请稍候）')
    setToolInfo(null)
    
    const res = await chatWithAI(input)
    
    if (res.success) {
      setReply(res.content)
      if (res.toolUsed) {
        setToolInfo({ 
          name: res.toolUsed, 
          result: res.toolResult // 现在是一个数组：[{tool: 'xxx', data: [...]}, ...]
        })
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
          
          {/* 遍历多个工具调用结果 */}
          <div className="space-y-3">
            {toolInfo.result.map((item: any, idx: number) => (
              <div key={idx} className="text-xs text-blue-900">
                <p className="font-semibold border-b border-blue-200 pb-1 mb-1">
                  {item.tool}（{Array.isArray(item.data) ? item.data.length : 1} 条结果）：
                </p>
                
                {/* 数组结果：车型列表 */}
                {Array.isArray(item.data) && item.data.map((car: any) => (
                  <div key={car?.id || idx} className="flex gap-3 border-b border-blue-100 py-1">
                    <span className="font-bold">{car?.brand} {car?.model}</span>
                    <span>{car?.price}万</span>
                    <span>{car?.energy_type}</span>
                    <span>{car?.body_type}</span>
                    <span>续航{car?.range}km</span>
                  </div>
                ))}
                
                {/* 单条结果：车型详情 */}
                {!Array.isArray(item.data) && item.data && (
                  <div className="py-1">
                    <span className="font-bold">{item.data.brand} {item.data.model}</span>
                    <span className="ml-2">{item.data.price}万 / {item.data.energy_type} / 续航{item.data.range}km</span>
                  </div>
                )}
                
                {/* 空结果 */}
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
          placeholder="试试：20万预算推荐纯电轿车 / 对比Model Y和理想L6 / 25万SUV露营"
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          autoFocus
        />
        <Button onClick={handleSend} disabled={loading}>
          {loading ? '调用中...' : '发送'}
        </Button>
      </div>

      <p className="text-xs text-gray-400 mt-4">
        提示：模型会自动识别意图并调用工具。支持：查车型、查详情、对比多款车。
      </p>
    </main>
  )
}