"use server";

import ollama from "ollama";
import { readFileSync } from "fs";
import { join } from "path";
import { SearchCarArgsSchema, CarSchema } from "@/lib/schema";
import { z } from "zod";
import { tools } from "@/lib/tools";

// ========== 数据层 ==========
function loadCars() {
  const path = join(process.cwd(), "data", "cars.json");
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  // ========== normalize：加载时校验全部数据 ==========
  const result = z.array(CarSchema).safeParse(raw);
  if (!result.success) {
    console.error("cars.json 数据格式错误:", result.error.issues);
    throw new Error("车型数据校验失败，请检查 data/cars.json");
  }
  return result.data;
}

function searchCarByBudget(
  minPrice: number,
  maxPrice: number,
  energyType?: string,
  bodyType?: string,
  sceneTag?: string,
) {
  const cars = loadCars();
  return cars.filter((car) => {
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

// ========== 对外接口 ==========
export async function chatWithAI(message: string) {
  try {
    // 第一次：判断是否需要工具
    const response = await ollama.chat({
      model: "qwen2.5:7b",
      messages: [
        {
          role: "system",
          content: `你是一位专业的汽车选购顾问。请根据用户需求选择正确的工具：

1. **search_car_by_budget**：用户提到预算范围、价格区间、推荐车型、选车、适合某种场景（如露营、通勤）时调用。
   示例："20万预算推荐纯电轿车"、"适合露营的SUV有哪些"

2. **get_car_detail**：用户问某一款具体车型的详细参数、优缺点、怎么样时调用。
   示例："特斯拉Model Y怎么样"、"比亚迪汉EV的续航多少"

3. **compare_cars**：用户明确提到"对比"、"比较"、"哪个好"、"A和B怎么选"时调用。
   示例："对比Model Y和理想L6"、"比亚迪汉和小米SU7哪个好"

必须根据用户意图选择最匹配的工具，不要混用。`,
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
