'use server'

import ollama from 'ollama'

export async function chatWithAI(message: string) {
  try {
    const response = await ollama.chat({
      model: 'qwen2.5:7b',
      messages: [{ role: 'user', content: message }],
    })
    
    return { success: true, content: response.message.content }
  } catch {
    return { 
      success: false, 
      error: '模型调用失败，请确认 Ollama 是否在后台运行（PowerShell 执行 ollama list 检查）' 
    }
  }
}