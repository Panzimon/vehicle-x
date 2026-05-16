import { NextRequest } from "next/server";
import ollama, { Message } from "ollama";
import { tools } from "@/lib/tools";
import { SearchCarArgsSchema, GetCarDetailArgsSchema, CompareCarsArgsSchema } from "@/lib/schema";
import { compareCars, getCarDetail, searchCarByBudget } from "@/lib/data";

/**
 * 聊天 API - 支持 SSE 流式输出和 Function Calling
 *
 * 流式过程中如果检测到工具调用，会：
 * 1. 中断当前文本流
 * 2. 执行工具调用
 * 3. 将结果注入上下文
 * 4. 恢复流式输出
 */
export async function POST(req: NextRequest) {
  const { message } = await req.json();
  console.log('收到消息:', message);
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        // 构建消息历史
        const messages: Message[] = [
          {
            role: "system",
            content: "你是一位专业的汽车选购顾问。请简洁回答。"
          },
          { role: "user", content: message }
        ];

        // 第一次流式请求，启用 tools
        const response = await ollama.chat({
          model: "qwen2.5:14b",
          messages,
          tools: tools as never,
          stream: true,
        });

        let hasToolCalls = false;
        // let toolCallsResult: any = null;

        // 遍历流式响应
        for await (const chunk of response) {
          const content = chunk.message?.content;
          const toolCalls = (chunk.message as any)?.tool_calls;

          // 检测到工具调用
          if (toolCalls && toolCalls.length > 0 && !hasToolCalls) {
            hasToolCalls = true;
            console.log('检测到工具调用:', toolCalls);

            // 执行工具调用
            const toolResults: unknown[] = [];
            for (const call of toolCalls) {
              const toolName = call.function.name;
              const args = typeof call.function.arguments === 'string'
                ? JSON.parse(call.function.arguments)
                : call.function.arguments;

              console.log(`执行工具: ${toolName}`, args);
              let result = null;

              try {
                if (toolName === 'search_car_by_budget') {
                  const parsed = SearchCarArgsSchema.parse(args);
                  result = searchCarByBudget(
                    parsed.min_price,
                    parsed.max_price,
                    parsed.energy_type,
                    parsed.body_type,
                    parsed.scene_tag
                  );
                } else if (toolName === 'get_car_detail') {
                  const parsed = GetCarDetailArgsSchema.parse(args);
                  result = getCarDetail(parsed.car_id);
                } else if (toolName === 'compare_cars') {
                  const parsed = CompareCarsArgsSchema.parse(args);
                  result = compareCars(parsed.car_ids);
                } else {
                  result = { error: `未知工具: ${toolName}` };
                }
              } catch (err: any) {
                result = { error: err.message };
              }

              toolResults.push({ tool: toolName, result });
            }

            // toolCallsResult = toolResults;

            // 发送工具执行完成信号
            send({ type: 'tool_done', tools: toolResults });

            // 将工具结果注入消息历史
            // 添加 LLM 的 tool_calls 消息
            messages.push({
              role: "assistant",
              content: content || "",
              tool_calls: toolCalls
            });

            // 添加 tool 消息（每个工具的结果）
            for (let i = 0; i < toolCalls.length; i++) {
              messages.push({
                role: "tool",
                content: JSON.stringify(toolResults[i]?.result || {}),
              });
            }

            // 继续流式输出，让 LLM 基于工具结果生成回答
            const followUpResponse = await ollama.chat({
              model: "qwen2.5:14b",
              messages,
              stream: true,
            });

            // 继续流式输出后续响应
            for await (const followUpChunk of followUpResponse) {
              const followUpContent = followUpChunk.message?.content;
              if (followUpContent) {
                send({ text: followUpContent });
              }
            }

            // 完成
            send({ done: true });
            controller.close();
            return;
          }

          // 正常文本输出
          if (content) {
            send({ text: content });
          }
        }

        // 没有工具调用，正常完成
        send({ done: true });
        controller.close();

      } catch (error: any) {
        console.error('SSE 流式处理错误:', error);
        send({ error: error.message || "模型调用失败" });
        send({ done: true });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
