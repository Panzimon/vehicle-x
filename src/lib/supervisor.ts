import ollama from 'ollama'

export interface Task {
  tool: string
  params: Record<string, any>
  description: string
}

/**
 * 任务调度器：分析用户购车需求，分解为具体的工具调用任务
 *
 * 支持的任务类型：
 * - search_car_by_budget：按预算筛选车型
 * - compare_cars：对比多款车型
 * - get_car_detail：查询单款车型详情
 * - plan_route：规划驾车路线
 *
 * @param userQuery - 用户的自然语言购车需求
 * @returns 任务列表，每个任务包含工具名称、参数和描述
 */
export async function decomposeTasks(userQuery: string): Promise<Task[]> {
  const response = await ollama.chat({
    model: 'qwen2.5:7b',
    messages: [
      {
        role: 'system',
        content: `你是一个任务调度员。分析用户的购车需求，输出合适的工具调用任务。

可用工具：
1. search_car_by_budget - 根据预算筛选车型
   - 参数：min_price（最低预算万元）、max_price（最高预算万元）、energy_type（纯电/插混/增程/燃油，可选）、body_type（轿车/SUV/MPV，可选）、scene_tag（露营/通勤/家用，可选）
   - 适用场景：用户提到预算、价格范围、推荐车型时

2. compare_cars - 对比多款车型
   - 参数：car_ids（车型ID数组，格式为"品牌-车型-年份"，如"byd-han-ev-2024"）
   - 适用场景：用户明确提到具体车型名称并要求对比时

3. get_car_detail - 获取车型详细信息
   - 参数：car_id（车型ID，格式为"品牌-车型-年份"，如"byd-han-ev-2024"）
   - 适用场景：用户询问某款具体车型的详细信息时

4. plan_route - 规划驾车路线
   - 参数：from（起点）、to（终点）
   - 适用场景：用户提到路线、距离、怎么去时

输出格式：JSON 数组，可包含多个任务。
示例1（搜索）：
[{"tool": "search_car_by_budget", "params": {"min_price": 20, "max_price": 30}, "description": "筛选20-30万车型"}]

示例2（对比）：
[{"tool": "compare_cars", "params": {"car_ids": ["byd-han-ev-2024", "li-l6-2024"]}, "description": "对比比亚迪汉和理想L6"}]

示例3（查详情）：
[{"tool": "get_car_detail", "params": {"car_id": "byd-han-ev-2024"}, "description": "查询比亚迪汉详情"}]

只输出 JSON 数组，不要任何解释。`
      },
      { role: 'user', content: userQuery }
    ]
  })

  const content = response.message.content
  // 提取 JSON 数组部分
  const jsonMatch = content.match(/\[[\s\S]*?\]/)

  if (!jsonMatch) {
    throw new Error('Supervisor 未能生成有效任务列表')
  }

  try {
    const tasks = JSON.parse(jsonMatch[0])
    // 标准化任务格式，确保每个任务都有必要的字段
    return tasks.map((t: any) => ({
      tool: t.tool,
      params: t.params || {},
      description: t.description || '执行任务'
    }))
  } catch (error: unknown) {
    console.error(error)
    throw new Error('任务列表 JSON 解析失败')
  }
}