'use server'

import ollama from 'ollama'
import { readFileSync } from 'fs'
import { join } from 'path'

// ========== 本地数据层 ==========
function loadCars() {
  const path = join(process.cwd(), 'data', 'cars.json')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function searchCarByBudget(minPrice: number, maxPrice: number, energyType?: string, bodyType?: string) {
  const cars = loadCars()
  return cars.filter((car: any) => {
    if (car.price < minPrice || car.price > maxPrice) return false
    if (energyType && car.energy_type !== energyType) return false
    if (bodyType && car.body_type !== bodyType) return false
    return true
  })
}

// ========== 对外接口 ==========
export async function chatWithAI(message: string) {
  try {
    // 1. 定义工具（让模型知道它能干什么）
    const tools = [
      {
        type: 'function',
        function: {
          name: 'search_car_by_budget',
          description: '根据用户预算和偏好筛选车型，返回符合条件的车型列表。当用户提到预算、价格、买车、推荐车型、选车等需求时，必须调用此工具。',
          parameters: {
            type: 'object',
            properties: {
              min_price: { type: 'number', description: '最低预算（万元）' },
              max_price: { type: 'number', description: '最高预算（万元）' },
              energy_type: { type: 'string', enum: ['纯电', '插混', '增程', '燃油'], description: '能源类型（可选）' },
              body_type: { type: 'string', enum: ['轿车', 'SUV', 'MPV'], description: '车身类型（可选）' }
            },
            required: ['min_price', 'max_price']
          }
        }
      }
    ]

    // 2. 第一次调用：让模型判断是否需要工具
    const response = await ollama.chat({
      model: 'qwen2.5:14b',
      messages: [
        { 
          role: 'system', 
          content: '你是一位专业的汽车选购顾问。如果用户有购车需求，请使用 search_car_by_budget 工具查询车型数据库。查询到结果后，用简洁的中文总结推荐，列出车型名称、价格、续航和核心优缺点。' 
        },
        { role: 'user', content: message }
      ],
      tools: tools as any,
    })

    // 3. 检查模型是否要求调用工具
    const toolCalls = (response.message as any).tool_calls
    if (toolCalls && toolCalls.length > 0) {
      const call = toolCalls[0]
      const args = typeof call.function.arguments === 'string' 
        ? JSON.parse(call.function.arguments) 
        : call.function.arguments

      // 执行本地工具
      const results = searchCarByBudget(
        args.min_price ?? 0,
        args.max_price ?? 100,
        args.energy_type,
        args.body_type
      )

      // 4. 第二次调用：把工具结果塞给模型，让它生成自然语言推荐
      const finalResponse = await ollama.chat({
        model: 'qwen2.5:14b', // 如果14B下完了，改成 qwen2.5:14b
        messages: [
          { 
            role: 'system', 
            content: '你是一位专业的汽车选购顾问。根据查询到的车型数据，给用户简洁的推荐，列出车型名称、价格、续航和核心优缺点。' 
          },
          { role: 'user', content: message },
          { 
            role: 'assistant', 
            content: `已查询到以下车型数据：\n${JSON.stringify(results, null, 2)}\n\n请根据以上数据给用户推荐。` 
          }
        ]
      })

      return {
        success: true,
        content: finalResponse.message.content,
        toolUsed: 'search_car_by_budget',
        toolResult: results
      }
    }

    // 没有触发工具，直接返回
    return { success: true, content: response.message.content }
  } catch (error: any) {
    console.error('chatWithAI error:', error)
    return { success: false, error: error.message || '调用失败' }
  }
}