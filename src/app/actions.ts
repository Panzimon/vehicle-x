"use server";

import ollama from "ollama";
import { readFileSync } from "fs";
import { join } from "path";
import {
  SearchCarArgsSchema,
  CarSchema,
  Car,
  GetCarDetailArgsSchema,
  CompareCarsArgsSchema,
} from "@/lib/schema";
import { z } from "zod";
import { tools } from "@/lib/tools";

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
  return cars.filter((car: Car) => {
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

export async function chatWithAI(message: string) {
  try {
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
      tools: tools as never,
    });

    const toolCalls = response.message.tool_calls as
      | Array<{
          function: {
            name: string;
            arguments: unknown;
          };
        }>
      | undefined;
    if (toolCalls && toolCalls.length > 0) {
      // 支持并行调用：遍历所有 tool_calls，不是只取第一个
      const results: unknown[] = [];
      const toolsUsed: string[] = [];

      for (const call of toolCalls) {
        const toolName = call.function.name;
        const rawArgs =
          typeof call.function.arguments === "string"
            ? JSON.parse(call.function.arguments)
            : call.function.arguments;

        let singleResult: unknown = null;

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
  } catch (error: unknown) {
    console.error("chatWithAI error:", error);
    const errorMessage = error instanceof Error ? error.message : "调用失败";
    return { success: false, error: errorMessage };
  }
}
