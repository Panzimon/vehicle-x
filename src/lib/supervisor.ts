import ollama from 'ollama'

export interface Task {
  tool: string
  params: Record<string, any>
  description: string
  depends_on?: string[]  // 依赖的任务索引，如 ["0"] 表示依赖第0个任务
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
 * 依赖关系示例：
 * - 用户："推荐25万SUV，然后告诉我比亚迪汉的详情"
 * - 任务0: search_car_by_budget(25万, SUV)  // 无依赖
 * - 任务1: get_car_detail("比亚迪汉")       // 依赖任务0的结果
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
   - 重要：预算范围要有合理的上下浮动！例如用户说"25万"，应该设为 min_price=20, max_price=30；用户说"30万左右"，设为 min_price=25, max_price=35

2. compare_cars - 对比多款车型
   - 参数：car_ids（车型ID数组，格式为"品牌-车型-年份"，如"byd-han-ev-2024"）
   - 适用场景：用户明确提到具体车型名称并要求对比时

3. get_car_detail - 获取车型详细信息
   - 参数：car_id（车型ID，格式为"品牌-车型-年份"，如"byd-han-ev-2024"）
   - 适用场景：用户询问某款具体车型的详细信息时

4. plan_route - 规划驾车路线
   - 参数：from（起点）、to（终点）
   - 适用场景：用户提到路线、距离、怎么去时

依赖关系规则：
- 如果后一个任务需要使用前一个任务的结果，后一个任务应添加 depends_on 字段
- 例如：查详情感知搜索结果中的车型 -> depends_on: ["0"]
- 如果两个任务相互独立，不需要依赖关系

输出格式：JSON 数组，可包含多个任务。
示例1（独立任务 - 搜索）：
[{"tool": "search_car_by_budget", "params": {"min_price": 20, "max_price": 30}, "description": "筛选20-30万车型"}]

示例2（独立任务 - 对比）：
[{"tool": "compare_cars", "params": {"car_ids": ["byd-han-ev-2024", "li-l6-2024"]}, "description": "对比比亚迪汉和理想L6"}]

示例3（依赖任务 - 先搜再查详情）：
[{"tool": "search_car_by_budget", "params": {"min_price": 20, "max_price": 30}, "description": "筛选20-30万车型"},
 {"tool": "get_car_detail", "params": {"car_id": "byd-han-ev-2024"}, "description": "查询比亚迪汉详情", "depends_on": ["0"]}]

只输出 JSON 数组，不要任何解释。`
      },
      { role: 'user', content: userQuery }
    ]
  })

  const content = response.message.content
  console.log('Supervisor LLM 返回:', content)

  // 提取 JSON 数组部分
  const jsonMatch = content.match(/\[[\s\S]*?\]/)

  if (!jsonMatch) {
    throw new Error('Supervisor 未能生成有效任务列表')
  }

  let jsonStr = jsonMatch[0]
  console.log('提取的 JSON:', jsonStr)

  try {
    return JSON.parse(jsonStr).map((t: any, index: number) => ({
      tool: t.tool,
      params: t.params || {},
      description: t.description || '执行任务',
      depends_on: t.depends_on || []
    }))
  } catch (error: unknown) {
    // JSON 解析失败，尝试修复常见的不完整 JSON
    console.warn('JSON 解析失败，尝试修复:', error)

    try {
      let fixed = jsonStr

      // 统计括号数量，补全缺失的 }
      const openBraces = (fixed.match(/\{/g) || []).length
      const closeBraces = (fixed.match(/\}/g) || []).length
      if (openBraces > closeBraces) {
        fixed += '}'.repeat(openBraces - closeBraces)
      }

      // 统计方括号数量，补全缺失的 ]
      const openBrackets = (fixed.match(/\[/g) || []).length
      const closeBrackets = (fixed.match(/\]/g) || []).length
      if (openBrackets > closeBrackets) {
        fixed += ']'.repeat(openBrackets - closeBrackets)
      }

      console.log('修复后的 JSON:', fixed)
      return JSON.parse(fixed).map((t: any, index: number) => ({
        tool: t.tool,
        params: t.params || {},
        description: t.description || '执行任务',
        depends_on: t.depends_on || []
      }))
    } catch (fixError) {
      console.error('JSON 修复也失败:', fixError)
      throw new Error('任务列表 JSON 解析失败')
    }
  }
}

/**
 * 拓扑排序 + 并行调度
 * 将任务列表按照依赖关系排序，同一层级的任务可以并行执行
 *
 * @param tasks - 任务列表
 * @returns 二维数组，每一层的任务可以并行执行
 */
export function topologicalSort(tasks: Task[]): Task[][] {
  if (tasks.length === 0) return []
  if (tasks.length === 1) return [tasks]

  // 构建入度表和邻接表
  const inDegree: number[] = tasks.map(() => 0)
  const adjList: number[][] = tasks.map(() => [])

  tasks.forEach((task, index) => {
    if (task.depends_on && task.depends_on.length > 0) {
      task.depends_on.forEach((depIndexStr: string) => {
        const depIndex = parseInt(depIndexStr, 10)
        if (depIndex >= 0 && depIndex < tasks.length) {
          adjList[depIndex].push(index)
          inDegree[index]++
        }
      })
    }
  })

  // BFS 拓扑排序，每层可以并行执行
  const levels: Task[][] = []
  const queue: number[] = []

  // 找出入度为0的节点（无依赖的任务）
  for (let i = 0; i < tasks.length; i++) {
    if (inDegree[i] === 0) {
      queue.push(i)
    }
  }

  while (queue.length > 0) {
    const levelSize = queue.length
    const currentLevel: Task[] = []

    // 同一批出队的任务可以并行执行
    for (let i = 0; i < levelSize; i++) {
      const taskIndex = queue.shift()!
      currentLevel.push(tasks[taskIndex])

      // 将后续依赖此任务的节点的入度减1
      for (const nextIndex of adjList[taskIndex]) {
        inDegree[nextIndex]--
        if (inDegree[nextIndex] === 0) {
          queue.push(nextIndex)
        }
      }
    }

    levels.push(currentLevel)
  }

  // 检查是否有环
  if (levels.flat().length !== tasks.length) {
    console.warn('检测到任务依赖存在环，跳过拓扑排序')
    return [tasks]
  }

  console.log('任务分层（可并行执行同层任务）:', levels.map((l, i) => `层${i}: ${l.map(t => t.tool).join(', ')}`))
  return levels
}