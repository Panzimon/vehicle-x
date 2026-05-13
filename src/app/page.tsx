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

  async function handleSend() {
    if (!input.trim()) return
    setLoading(true)
    // setReply('思考中...（本地 14B 模型首次加载可能需要 5-10 秒）')
    setReply('思考中...（本地 7B 模型首次加载可能需要 5-10 秒）')
    
    const res = await chatWithAI(input)
    
    if (res.success) {
      setReply(res.content || '')
    } else {
      setReply(res.error || '出错了')
    }
    
    setLoading(false)
  }

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">🚗 Vehicle-X AI 助手（本地模型）</h1>
      
      <Card className="p-4 mb-4 min-h-[200px] bg-gray-50">
        <p className="whitespace-pre-wrap">{reply}</p>
      </Card>
      
      <div className="flex gap-2">
        <Input 
          value={input} 
          onChange={e => setInput(e.target.value)}
          placeholder="输入你想问的话..."
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          autoFocus
        />
        <Button onClick={handleSend} disabled={loading}>
          {loading ? '发送中...' : '发送'}
        </Button>
      </div>
    </main>
  )
}