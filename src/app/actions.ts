'use server'

import ollama from 'ollama'

export async function chatWithAI(message: string) {
  try {
    const response = await ollama.chat({
      model: 'qwen2.5:14b', // 14B 深度推理模型
      messages: [
        { 
          role: 'system', 
          content: '你是一位专业的汽车选购顾问，精通中国市场的车型参数、用车成本和购车决策。请用中文回答，尽量简洁实用。如果用户问题与汽车无关，礼貌地引导回汽车话题。' 
        },
        { role: 'user', content: message }
      ],
    })
    
    return { success: true, content: response.message.content }
  } catch (error) {
    return { success: false, error: '模型调用失败，请确认 Ollama 是否在后台运行' }
  }
}