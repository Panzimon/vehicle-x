'use server'

import ollama from 'ollama'
import { readFileSync } from 'fs'
import { join } from 'path'
import { SearchCarArgsSchema, CarSchema } from '@/lib/schema' // 新增
import { z } from 'zod' // 新增

function loadCars() {
  const path = join(process.cwd(), 'data', 'cars.json')
  const raw = JSON.parse(readFileSync(path, 'utf-8'))
  
  // ========== normalize：加载时校验全部数据 ==========
  const result = z.array(CarSchema).safeParse(raw)
  if (!result.success) {
    console.error('cars.json 数据格式错误:', result.error.issues)
    throw new Error('车型数据校验失败，请检查 data/cars.json')
  }
  return result.data
}

function searchCarByBudget(
  minPrice: number,
  maxPrice: number,
  energyType?: string,
  bodyType?: string,
  sceneTag?: string,
) {
  const cars = loadCars();
  return cars.filter((car: any) => {
    if (car.price < minPrice || car.price > maxPrice) return false;
    if (energyType && car.energy_type !== energyType) return false;
    if (bodyType && car.body_type !== bodyType) return false;

    if (sceneTag) {
      const text = `${car.brand} ${car.model} ${car.tags.join(" ")} ${car.pros.join(" ")} ${car.cons.join(" ")}`;
      if (!text.includes(sceneTag)) return false;
    }

    return true;
  });
}

export async function chatWithAI(message: string) {
  try {
    const tools = [
      {
        type: "function",
        function: {
          name: "search_car_by_budget",
          description:
            "根据用户预算、车型偏好和用车场景筛选车型。当用户提到预算、价格、买车、推荐车型、选车、适合某种场景（如露营、通勤）等需求时，必须调用此工具。",
          parameters: {
            type: "object",
            properties: {
              min_price: { type: "number", description: "最低预算（万元）" },
              max_price: { type: "number", description: "最高预算（万元）" },
              energy_type: {
                type: "string",
                enum: ["纯电", "插混", "增程", "燃油"],
                description: "能源类型（可选）",
              },
              body_type: {
                type: "string",
                enum: ["轿车", "SUV", "MPV"],
                description: "车身类型（可选）",
              },
              scene_tag: {
                type: "string",
                description: '用车场景标签，如"露营"、"通勤"、"家用"等（可选）',
              },
            },
            required: ["min_price", "max_price"],
          },
        },
      },
    ];

    // 第一次：判断是否需要工具
    const response = await ollama.chat({
      model: "qwen2.5:7b", // 7B 做意图识别+工具调用，速度快
      messages: [
        {
          role: "system",
          content:
            "你是一位专业的汽车选购顾问。用户提出购车相关问题时，必须使用 search_car_by_budget 工具查询车型数据库。仔细分析用户的预算范围、能源类型偏好（纯电/插混/增程/燃油）和车身类型（轿车/SUV/MPV）。示例：用户说'20万以内的纯电轿车'，则调用 search_car_by_budget(min_price=0, max_price=20, energy_type='纯电', body_type='轿车')。",
        },
        { role: "user", content: message },
      ],
      tools: tools as any,
    });

    const toolCalls = (response.message as any).tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const call = toolCalls[0];
      const rawArgs =
        typeof call.function.arguments === "string"
          ? JSON.parse(call.function.arguments)
          : call.function.arguments;
      console.table(rawArgs);
      
      // ========== zod 校验工具参数 ==========
      const parseResult = SearchCarArgsSchema.safeParse(rawArgs)
      if (!parseResult.success) {
        console.error('工具参数校验失败:', parseResult.error.issues)
        return { 
          success: false, 
          error: '模型输出的参数格式不对: ' + parseResult.error.issues.map(i => i.message).join(', ') 
        }
      }
      const args = parseResult.data
      const results = searchCarByBudget(
        args.min_price ?? 0,
        args.max_price ?? 100,
        args.energy_type,
        args.body_type,
        args.scene_tag,
      );

      // 第二次：生成回复，强约束禁止幻觉
      const finalResponse = await ollama.chat({
        model: "qwen2.5:7b",
        messages: [
          {
            role: "system",
            content:
              "你是一位专业的汽车选购顾问。你的回答必须严格基于以下查询到的车型数据，禁止编造任何不存在的数据。回答格式：列出车型名称、价格、续航里程、核心优缺点，用简洁的中文。如果查询结果为空，请诚实告知用户没有找到符合条件的车型，并建议调整预算或条件。",
          },
          { role: "user", content: message },
          {
            role: "tool",
            content: `【查询结果】以下是从数据库中查到的真实车型数据（共${results.length}款）：\n${JSON.stringify(results, null, 2)}`,
          },
        ],
      });

      return {
        success: true,
        content: finalResponse.message.content,
        toolUsed: "search_car_by_budget",
        toolResult: results,
      };
    }

    return { success: true, content: response.message.content };
  } catch (error: any) {
    console.error("chatWithAI error:", error);
    return { success: false, error: error.message || "调用失败" };
  }
}
