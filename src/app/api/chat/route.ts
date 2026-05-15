import { NextRequest } from 'next/server'
import ollama from 'ollama'

export async function POST(req: NextRequest) {
  const { message } = await req.json()

  // 模型路由：简单聊天 7B，复杂问题 14B
  const isSimple = message.length < 20 && !message.includes('推荐') && !message.includes('对比') && !message.includes('预算')
  const model = isSimple ? 'qwen2.5:7b' : 'qwen2.5:14b'

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await ollama.chat({
          model,
          messages: [
            { 
              role: 'system', 
              content: '你是一位专业的汽车选购顾问。请简洁回答。' 
            },
            { role: 'user', content: message }
          ],
          stream: true,
        })

        for await (const chunk of response) {
          const text = chunk.message?.content || ''
          if (text) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text })}\n\n`))
          }
        }

        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ done: true })}\n\n`))
        controller.close()
      } catch (error) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: '模型调用失败' })}\n\n`))
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}