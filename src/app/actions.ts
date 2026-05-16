"use server";

import ollama from "ollama";
import { SearchCarArgsSchema, GetCarDetailArgsSchema, CompareCarsArgsSchema } from "@/lib/schema";
import { tools } from "@/lib/tools";
import { decomposeTasks, topologicalSort, Task } from "@/lib/supervisor";
import { searchCarByBudget, getCarDetail, compareCars } from "@/lib/data";
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// ========== 高德 MCP 相关 ==========

// 高德 MCP Client 实例（懒加载）
let amapClient: Client | null = null

/**
 * 获取高德 MCP Client 实例
 * 使用 Stdio 模式连接本地 MCP Server
 */
async function getAmapClient() {
  if (!amapClient) {
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@amap/amap-maps-mcp-server'],
      env: { AMAP_MAPS_API_KEY: process.env.AMAP_KEY || '' }
    })
    amapClient = new Client({ name: 'vehicle-x', version: '1.0.0' }, { capabilities: {} })
    await amapClient.connect(transport)
  }
  return amapClient
}

/**
 * 将地址转换为经纬度坐标
 * @param address - 地址字符串，如"北京市朝阳区阜通东大街6号"
 * @returns 经纬度字符串，格式为"经度,纬度"，如"116.397,39.909"
 */
async function getGeo(address: string): Promise<string> {
  try {
    const client = await getAmapClient();
    const result = await client.callTool({
      name: "maps_geo",
      arguments: { address }
    }) as any;
    const geoData = (result?.content?.[0]?.text
        ? JSON.parse(result?.content[0].text)
        : result)
    console.log('maps_geo 返回:', geoData)
    return geoData?.return?.[0]?.location || '';
  } catch (error) {
    console.error('调用 maps_geo 失败:', error);
    return '';
  }
}

/**
 * 工具执行器：根据任务类型执行相应的工具
 * @param task - 任务对象，包含工具名称和参数
 */
async function executeTool(task: Task) {
  if (!task) {
    throw new Error('任务不能为空')
  }

  const tool = task?.tool || ''
  const params = task?.params || {}

  console.table({ tool, params })

  if (!tool || typeof tool !== 'string') {
    throw new Error('工具名称无效')
  }

  if (tool === 'search_car_by_budget') {
    const args = SearchCarArgsSchema.parse(params)
    return {
      tool,
      data: searchCarByBudget(
        args.min_price,
        args.max_price,
        args.energy_type,
        args.body_type,
        args.scene_tag,
      ),
    }
  }
  else if (tool === 'get_car_detail') {
    const args = GetCarDetailArgsSchema.parse(params)
    return { tool, data: getCarDetail(args.car_id) }
  }
  else if (tool === 'compare_cars') {
    const args = CompareCarsArgsSchema.parse(params)
    return { tool, data: compareCars(args.car_ids) }
  }
  else if (tool === 'plan_route') {
    const from = params.from || '未知出发地'
    const to = params.to || '未知目的地'

    const result = await planRouteAction(from, to)

    if (!result.success) {
      throw new Error(result.error || '路线规划失败')
    }

    return { tool, data: result.data }
  }
  else {
    throw new Error(`未知工具: ${tool}`)
  }
}

/**
 * 复杂查询入口函数
 * 由 Supervisor 分解任务后执行，支持 DAG 依赖并行调度
 *
 * 执行流程：
 * 1. Supervisor 分解任务
 * 2. 拓扑排序分层（无依赖的任务同一层）
 * 3. 逐层执行：同层任务并行执行
 * 4. 前置任务结果注入后续任务的上下文
 *
 * @param message - 用户的自然语言需求
 * @returns 包含执行结果的对象，根据任务类型返回不同格式
 */
export async function complexQuery(message: string) {
  const startTime = Date.now()

  try {
    // Step 1: Supervisor 分解任务
    const tasks = await decomposeTasks(message)

    if (tasks.length === 0) {
      throw new Error('未生成有效任务')
    }

    // Step 2: 拓扑排序，分层并行调度
    const levels = topologicalSort(tasks)
    const allResults: any[] = []

    // 逐层执行：同层任务并行，不同层串行
    for (const levelTasks of levels) {
      // 同一层的任务并行执行
      const levelPromises = levelTasks.map(async (task, levelTaskIndex) => {
        // 如果任务有依赖，从 allResults 中提取前置任务结果
        if (task.depends_on && task.depends_on.length > 0) {
          // 将依赖任务的结果注入 params
          const resolvedParams = { ...task.params }
          for (const depIndexStr of task.depends_on) {
            const depIndex = parseInt(depIndexStr, 10)
            const depResult = allResults[depIndex]
            if (depResult) {
              // 如果前置任务是搜索，将搜索结果的车型ID注入
              if (depResult.tool === 'search_car_by_budget' && depResult.data) {
                const cars = Array.isArray(depResult.data) ? depResult.data : []
                // 尝试从车型名称匹配
                if (task.tool === 'get_car_detail' && resolvedParams.car_id) {
                  const matchedCar = cars.find((c: any) =>
                    c.model.includes(resolvedParams.car_id) ||
                    c.brand.includes(resolvedParams.car_id)
                  )
                  if (matchedCar) {
                    resolvedParams.car_id = matchedCar.id
                  }
                }
                // 如果需要 car_ids 数组，从搜索结果中提取
                if (task.tool === 'compare_cars' && resolvedParams.car_ids) {
                  const matchedCars = cars.filter((c: any) =>
                    resolvedParams.car_ids.some((name: string) =>
                      c.model.includes(name) || c.brand.includes(name)
                    )
                  )
                  if (matchedCars.length > 0) {
                    resolvedParams.car_ids = matchedCars.map((c: any) => c.id)
                  }
                }
              }
            }
          }
          task = { ...task, params: resolvedParams }
        }

        return executeTool(task)
      })

      const levelResults = await Promise.all(levelPromises)
      allResults.push(...levelResults)
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2)

    // 获取第一个任务的结果用于判断返回格式
    const firstTask = tasks[0]
    const firstResult = allResults[0]

    // 根据任务类型返回不同的结果格式
    if (firstTask.tool === 'search_car_by_budget') {
      return {
        success: true,
        content: '',
        toolUsed: 'search_car_by_budget',
        toolResult: allResults,
        meta: {
          tasks: tasks.length,
          parallel: levels.length > 1 || (levels[0]?.length || 0) > 1,
          totalDuration: `${totalDuration}s`,
          query: message,
        },
      }
    } else if (firstTask.tool === 'compare_cars') {
      const compareData = firstResult.data as any[]
      if (!compareData || compareData.length === 0) {
        return {
          success: true,
          content: '未找到指定的车型进行对比',
          toolUsed: 'compare_cars',
          toolResult: allResults,
        }
      }

      const finalResponse = await ollama.chat({
        model: "qwen2.5:7b",
        messages: [
          {
            role: "system",
            content: "你是一位专业的汽车对比顾问。请基于以下数据，用清晰的表格和自然语言对比这些车型的核心参数，并给出购买建议。使用 Markdown 格式输出。",
          },
          { role: "user", content: message },
          {
            role: "assistant",
            content: `【对比数据】${JSON.stringify(compareData)}`,
          },
        ],
      })

      return {
        success: true,
        content: finalResponse.message.content,
        toolUsed: 'compare_cars',
        toolResult: allResults,
      }
    } else if (firstTask.tool === 'get_car_detail') {
      return {
        success: true,
        content: '',
        toolUsed: 'get_car_detail',
        toolResult: allResults,
      }
    } else if (firstTask.tool === 'plan_route') {
      return {
        success: true,
        content: '',
        toolUsed: 'plan_route',
        toolResult: allResults,
        meta: {
          tasks: tasks.length,
          totalDuration: `${totalDuration}s`,
          query: message,
        },
      }
    } else {
      return {
        success: false,
        error: `未知工具类型: ${firstTask.tool}`,
        toolUsed: firstTask.tool,
      }
    }
  } catch (error: any) {
    console.error('complexQuery error:', error)
    return chatWithAI(message)
  }
}

/**
 * 获取车型详情（供前端直接调用）
 * @param carId - 车型ID
 */
export async function getCarDetailAction(carId: string) {
  const car = getCarDetail(carId)
  return {
    success: true,
    data: car,
    toolUsed: 'get_car_detail',
  }
}

/**
 * 规划驾车路线
 * 调用高德 MCP 获取驾车路线规划
 *
 * @param from - 出发地地址
 * @param to - 目的地地址
 */
export async function planRouteAction(from: string, to: string) {
  console.log('planRouteAction', from, to)
  try {
    // 连接高德 MCP 获取路线
    const client = await getAmapClient()
    const result = await client.callTool({
      name: 'maps_direction_driving',
      arguments: {
        origin: await getGeo(from),
        destination: await getGeo(to),
        strategy: 0  // 最快捷路线
      }
    }) as any

    console.log('高德 MCP 返回:', result)
    // 解析高德返回的数据
    const routeData = result?.isError === false ? (result?.content?.[0]?.text
      ? JSON.parse(result?.content[0].text)
      : result)
    : typeof result?.content?.[0]?.text === 'string'
      ? result?.content[0].text
      : result

    return {
      success: true,
      data: {
        from,
        to,
        // 距离：米转公里
        distance: routeData.route?.paths?.[0]?.distance
          ? `${(routeData.route.paths[0].distance / 1000).toFixed(1)}公里`
          : '未知',
        // 时间：秒转分钟
        duration: routeData.route?.paths?.[0]?.duration
          ? `${Math.ceil(routeData.route.paths[0].duration / 60)}分钟`
          : '未知',
        tolls: routeData.route?.paths?.[0]?.tolls || '未知',
        // 提取前10个关键步骤
        steps: routeData.route?.paths?.[0]?.steps?.map((s: any) => s.instruction).slice(0, 10) || [],
      },
      toolUsed: 'plan_route',
    }
  } catch (error: any) {
    console.error('planRoute error:', error)
    // 降级：返回错误信息
    return {
      success: false,
      error: '路线规划失败：' + error.message,
      data: { from, to, distance: '未知', duration: '未知' }
    }
  }
}

/**
 * 聊天模式入口函数（降级方案）
 * 当 Supervisor 无法分解任务时，直接使用 LLM 的 Function Calling 能力
 *
 * @param message - 用户消息
 */
export async function chatWithAI(message: string) {
  try {
    // 第一次：让 LLM 判断是否需要调用工具
    const response = await ollama.chat({
      model: "qwen2.5:7b",
      messages: [
        {
          role: "system",
          content: `你是一位专业的汽车选购顾问。你的唯一输出方式是调用工具函数。

规则：
1. 当用户有购车需求时，你必须调用 search_car_by_budget 工具
2. 当用户问具体车型时，你必须调用 get_car_detail 工具
3. 当用户说对比时，你必须调用 compare_cars 工具
4. 不要直接回答，不要输出 JSON 文本，必须调用工具`,
        },
        { role: "user", content: message },
      ],
      tools: tools as never,
    });

    // 处理工具调用
    const toolCalls = (response.message as any).tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const results: unknown[] = [];
      const toolsUsed: string[] = [];

      // 遍历所有触发的工具调用
      for (const call of toolCalls) {
        const toolName = call.function.name;
        const rawArgs =
          typeof call.function.arguments === "string"
            ? JSON.parse(call.function.arguments)
            : call.function.arguments;

        let singleResult: unknown = null;
        console.table(rawArgs);
        if (toolName === "search_car_by_budget") {
          const parseResult = SearchCarArgsSchema.safeParse(rawArgs);
          if (!parseResult.success) {
            return {
              success: false,
              error: `search_car_by_budget 参数错误: ${parseResult.error.issues.map((i) => i.message).join(", ")}`,
            };
          }
          const args = parseResult.data;
          singleResult = searchCarByBudget(
            args.min_price,
            args.max_price,
            args.energy_type,
            args.body_type,
            args.scene_tag,
          );
        } else if (toolName === "get_car_detail") {
          const parseResult = GetCarDetailArgsSchema.safeParse(rawArgs);
          if (!parseResult.success) {
            return {
              success: false,
              error: `get_car_detail 参数错误: ${parseResult.error.issues.map((i) => i.message).join(", ")}`,
            };
          }
          const args = parseResult.data;
          singleResult = getCarDetail(args.car_id);
        } else if (toolName === "compare_cars") {
          const parseResult = CompareCarsArgsSchema.safeParse(rawArgs);
          if (!parseResult.success) {
            return {
              success: false,
              error: `compare_cars 参数错误: ${parseResult.error.issues.map((i) => i.message).join(", ")}`,
            };
          }
          const args = parseResult.data;
          singleResult = compareCars(args.car_ids);
        } else {
          return { success: false, error: `未知工具: ${toolName}` };
        }

        results.push({ tool: toolName, data: singleResult });
        toolsUsed.push(toolName);
      }

      // 第二次：基于查询结果生成回复
      const finalResponse = await ollama.chat({
        model: "qwen2.5:7b",
        messages: [
          {
            role: "system",
            content:
              "你是一位专业的汽车选购顾问。你的回答必须严格基于以下查询到的车型数据，禁止编造任何不存在的数据。如果查询结果为空，请诚实告知用户没有找到符合条件的车型，并建议调整预算或条件。",
          },
          { role: "user", content: message },
          {
            role: "assistant",
            content: `【查询结果】共执行 ${results.length} 个工具查询：\n${JSON.stringify(results, null, 2)}\n\n请严格基于以上数据回答。禁止编造。`,
          },
        ],
      });

      return {
        success: true,
        content: finalResponse.message.content,
        toolUsed: toolsUsed.join(", "),
        toolResult: results,
      };
    }

    // 没有触发工具，直接返回 LLM 的回复
    return { success: true, content: response.message.content };
  } catch (error: any) {
    console.error("chatWithAI error:", error);
    return { success: false, error: error.message || "调用失败" };
  }
}