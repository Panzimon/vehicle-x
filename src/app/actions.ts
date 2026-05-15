"use server";

import ollama from "ollama";
import { readFileSync } from "fs";
import { join } from "path";
import { SearchCarArgsSchema, CarSchema, Car } from "@/lib/schema";
import { z } from "zod";
import { tools } from "@/lib/tools";
import { decomposeTasks, Task } from "@/lib/supervisor";import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { text } from "stream/consumers";

let tempCars: Car[] = []
// ========== 数据层 ==========
function loadCars() {
  if (tempCars.length > 0) return tempCars;
  const path = join(process.cwd(), "data", "cars.json");
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  // ========== normalize：加载时校验全部数据 ==========
  const result = z.array(CarSchema).safeParse(raw);
  if (!result.success) {
    console.error("cars.json 数据格式错误:", result.error.issues);
    throw new Error("车型数据校验失败，请检查 data/cars.json");
  }
  tempCars = result.data
  return tempCars
}


// 初始化高德 MCP Client（懒加载）
let amapClient: Client | null = null

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

// 用 maps_geo 把地址转成经纬度
async function getGeo(address: string): Promise<string> {
  try {
    const client = await getAmapClient();
    const result = await client.callTool({
      name: "maps_geo",
      arguments: {
        address // 直接传你的地址，比如 "广州市白云区**路**号"
      }
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

function searchCarByBudget(
  minPrice: number,
  maxPrice: number,
  energyType?: string,
  bodyType?: string,
  sceneTag?: string,
) {
  const cars = loadCars()
  return cars.filter((car) => {
    if (car.price < minPrice || car.price > maxPrice) return false
    if (energyType && car.energy_type !== energyType) return false
    if (bodyType && car.body_type !== bodyType) return false

    if (sceneTag) {
      // 放宽匹配：tags、pros、cons 里任意一个包含 sceneTag 的关键词即可
      const keywords = sceneTag.split(/[,，、]/).map(k => k.trim()).filter(Boolean)
      const carText = `${car.tags.join(' ')} ${car.pros.join(' ')} ${car.cons.join(' ')} ${car.model}`
      
      // 只要有一个关键词匹配就返回
      const matched = keywords.some(kw => carText.includes(kw))
      if (!matched) return false
    }

    return true
  })
}

function getCarDetail(carId: string) {
  const cars = loadCars();
  return cars.find((c) => c.id === carId) || null;
}

function compareCars(carIds: string[]) {
  const cars = loadCars();
  return carIds.map((id) => cars.find((c) => c.id === id)).filter(Boolean);
}

// ========== zod Schema 定义 ==========
const GetCarDetailArgsSchema = z.object({
  car_id: z.string().min(1, "车型 ID 不能为空"),
});

const CompareCarsArgsSchema = z.object({
  car_ids: z.array(z.string().min(1)).min(2, "至少需要 2 款车对比"),
});

// ========== 工具执行器 ==========
async function executeTool(task: Task) {
  const { tool, params } = task

  console.table({ tool, params })

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
        // args.brand_keyword
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
    
    // 直接复用已有的 planRouteAction，它内部已经接好了高德 MCP
    const result = await planRouteAction(from, to)
    
    if (!result.success) {
      throw new Error(result.error || '路线规划失败')
    }
    
    // 统一返回 { tool, data }，和前面几个工具保持一致
    return { tool, data: result.data }
  }
  else {
    throw new Error(`未知工具: ${tool}`)
  }
}

// ========== 复杂查询：Step 1 只搜索车型 ==========
export async function complexQuery(message: string) {
  const startTime = Date.now()

  try {
    // Step 1: Supervisor 拆解（只返回 search 任务）
    const tasks = await decomposeTasks(message)
    
    // Step 2: 执行搜索
    const searchTask = tasks[0]
    const searchResult = await executeTool(searchTask)

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2)

    return {
      success: true,
      content: '', // 不生成回复，前端自己展示列表
      toolUsed: 'search_car_by_budget',
      toolResult: [searchResult], // 车型列表
      meta: {
        tasks: 1,
        parallel: false,
        totalDuration: `${totalDuration}s`,
        query: message,
      },
    }
  } catch (error: any) {
    console.error('complexQuery error:', error)
    return chatWithAI(message)
  }
}

// ========== Step 2: 用户选车后，查详情 ==========
export async function getCarDetailAction(carId: string) {
  const car = getCarDetail(carId)
  return {
    success: true,
    data: car,
    toolUsed: 'get_car_detail',
  }
}

// ========== Step 3: 规划路线（接高德 MCP）==========
export async function planRouteAction(from: string, to: string) {
  console.log('planRouteAction', from, to)
  try {
    // 先尝试接高德 MCP
    const client = await getAmapClient()
    // const tools = await client.listTools();
    // console.log(tools); // 输出所有可用工具的列表，找到路径规划对应的正确名称
    // 驾车路线规划（地址版，直接传地址）
    const result = await client.callTool({
      name: 'maps_direction_driving', // ✅ 地址版工具名
      arguments: {
        origin: await getGeo(from), // 起点地址，如 "北京市朝阳区阜通东大街6号"
        destination: await getGeo(to),
        strategy: 0
      }
    }) as any
    
    console.log('高德 MCP 返回:', result)
    // 解析高德返回
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
        distance: routeData.route?.paths?.[0]?.distance 
          ? `${(routeData.route.paths[0].distance / 1000).toFixed(1)}公里` 
          : '未知',
        duration: routeData.route?.paths?.[0]?.duration 
          ? `${Math.ceil(routeData.route.paths[0].duration / 60)}分钟` 
          : '未知',
        tolls: routeData.route?.paths?.[0]?.tolls || '未知',
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

// ========== 单工具查询（保留，用于降级）==========
// ========== 对外接口 ==========
export async function chatWithAI(message: string) {
  try {
    // 第一次：判断是否需要工具
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

      // 第二次：生成回复
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

    // 没有触发工具
    return { success: true, content: response.message.content };
  } catch (error: any) {
    console.error("chatWithAI error:", error);
    return { success: false, error: error.message || "调用失败" };
  }
}
