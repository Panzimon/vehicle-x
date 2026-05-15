import ollama from 'ollama'

export interface Task {
  tool: string
  params: Record<string, any>
  description: string
}

export async function decomposeTasks(userQuery: string): Promise<Task[]> {
  const response = await ollama.chat({
    model: 'qwen2.5:7b',
    messages: [
      {
        role: 'system',
        content: `你是一个任务调度员。分析用户的购车需求，只输出一个 search_car_by_budget 任务。

关键规则：
1. 预算必须是一个范围：min_price 比用户说的低 3-5万，max_price 比用户说的高 3-5万
   示例：用户说"25万" → min: 20, max: 30
2. energy_type 根据用户描述推断：纯电/插混/增程/燃油，不确定就不填
3. body_type 不确定就不填
4. scene_tag 只能用一个词：露营/通勤/家用/代步，从用户描述中提取
5. 绝对不要输出 get_car_detail 或 compare_cars 或 plan_route

输出格式：JSON 数组，只有一个元素。
示例：
[
  {"tool": "search_car_by_budget", "params": {"min_price": 20, "max_price": 30, "scene_tag": "露营"}, "description": "筛选20-30万适合露营的车型"}
]

只输出 JSON 数组，不要任何解释。`
      },
      { role: 'user', content: userQuery }
    ]
  })

  const content = response.message.content
  const jsonMatch = content.match(/\[[\s\S]*?\]/)
  
  if (!jsonMatch) {
    throw new Error('Supervisor 未能生成有效任务列表')
  }

  try {
    const tasks = JSON.parse(jsonMatch[0])
    // 强制过滤，只保留 search_car_by_budget
    return tasks
      .filter((t: any) => t.tool === 'search_car_by_budget')
      .map((t: any) => ({
        tool: t.tool,
        params: t.params,
        description: t.description || '筛选车型'
      }))
  } catch (error: unknown) {
    console.error(error)
    throw new Error('任务列表 JSON 解析失败')
  }
}