import { NextRequest } from "next/server";
import ollama, { Message } from "ollama";
import { tools } from "@/lib/tools";
import { SearchCarArgsSchema, GetCarDetailArgsSchema, CompareCarsArgsSchema } from "@/lib/schema";
import { compareCars, getCarDetail, searchCarByBudget } from "@/lib/data";
import { planRouteAction } from "../../actions";

const SIMPLE_INTENT_KEYWORDS = [
  "你好", "您好", "hi", "hello", "嗨", "在吗", "你是谁", "介绍一下",
  "谢谢", "感谢", "再见", "拜拜", "好的", "知道了", "没问题",
];

function isSimpleIntent(message: string): boolean {
  const lowerMsg = message.toLowerCase().trim();
  return SIMPLE_INTENT_KEYWORDS.some(keyword => 
    lowerMsg.includes(keyword.toLowerCase())
  );
}

function shouldUseTool(message: string): boolean {
  const toolKeywords = [
    "预算", "多少钱", "推荐", "选车", "对比", "查", "价格",
    "路线", "距离", "多远", "怎么去", "导航",
  ];
  return toolKeywords.some(keyword => message.includes(keyword));
}

function selectModel(message: string): string {
  if (isSimpleIntent(message)) {
    return "qwen2.5:7b";
  }
  // if (shouldUseTool(message)) {
  //   return "qwen2.5:14b";
  // }
  return "qwen2.5:14b";
}

export async function POST(req: NextRequest) {
  const { message } = await req.json();
  console.log('收到消息:', message);
  
  const model = selectModel(message);
  console.log(`选择模型: ${model}`);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        const messages: Message[] = [
          {
            role: "system",
            content: "你是一位专业的汽车选购顾问和出行助手。你可以调用以下工具来获取实时数据：\n\n1. plan_route - 规划驾车路线，查询两地距离和预计时间。当用户提到路线、距离、怎么去、多远时调用。\n2. search_car_by_budget - 根据预算筛选车型。当用户提到预算、价格、买车、推荐车型、选车时调用。\n3. get_car_detail - 获取车型详细参数。当用户询问某款具体车型的详细信息时调用。\n4. compare_cars - 对比多款车型。当用户要求对比不同车型时调用。\n\n请用中文回复。"
          },
          { role: "user", content: message }
        ];

        // const needsTools = shouldUseTool(message);
        // console.log(`是否需要工具调用: ${needsTools}`);

        const response = await ollama.chat({
          model,
          messages,
          // tools: needsTools ? (tools as never) : undefined,
          tools: tools as never,
          stream: true,
        });

        let hasToolCalls = false;

        for await (const chunk of response) {
          const content = chunk.message?.content;
          let toolCalls = (chunk.message as any)?.tool_calls;
          
          console.log('=== 模型响应块 ===');
          console.log('content:', content ? content.substring(0, 100) + (content.length > 100 ? '...' : '') : 'null');
          console.log('tool_calls:', toolCalls);

          if (!toolCalls && content) {
            console.log('!toolCalls && content')
            let funcMatch = content.match(/function_caller\(\s*(\{.*\})\s*\)/);
            if (!funcMatch) {
              const xmlMatch = content.match(/<function_caller>\s*(\{.*\})\s*<\/function_caller>/);
              if (xmlMatch) {
                funcMatch = xmlMatch;
              }
            }
            if (funcMatch) {
              try {
                const parsed = JSON.parse(funcMatch[1]);
                if (parsed.name && parsed.arguments) {
                  toolCalls = [{ function: parsed }];
                  console.log('从内容中解析出工具调用:', toolCalls);
                }
              } catch (err: any) {
                console.error('funcMatch 从内容中解析错误:', err);
              }
            }
          }

          if (toolCalls && toolCalls.length > 0 && !hasToolCalls) {
            console.log('toolCalls && toolCalls.length > 0 && !hasToolCalls')
            hasToolCalls = true;
            console.log('检测到工具调用:', toolCalls);

            interface ToolResult { tool: string; result: unknown; }
            const toolResults: ToolResult[] = [];
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
                  if (!result || result.length === 0) {
                    result = { 
                      error: `未找到预算 ${parsed.min_price}-${parsed.max_price} 万的车型，建议调整预算范围或放宽条件` 
                    };
                  }
                } else if (toolName === 'get_car_detail') {
                  const parsed = GetCarDetailArgsSchema.parse(args);
                  result = getCarDetail(parsed.car_id);
                  if (!result) {
                    result = { error: `未找到车型 "${parsed.car_id}"，请确认车型名称是否正确` };
                  }
                } else if (toolName === 'compare_cars') {
                  const parsed = CompareCarsArgsSchema.parse(args);
                  result = compareCars(parsed.car_ids);
                  if (!result || result.length === 0) {
                    result = { error: `未找到指定的车型进行对比，请确认车型名称是否正确` };
                  }
                } else if (toolName === 'plan_route') {
                  const from = args.from || '未知出发地';
                  const to = args.to || '未知目的地';
                  const routeResult = await planRouteAction(from, to);
                  result = routeResult.success ? routeResult.data : { error: routeResult.error };
                  if (!result || (result as any)?.distance === '未知') {
                    result = { error: `无法规划从 "${from}" 到 "${to}" 的路线，请检查地址是否正确` };
                  }
                } else {
                  result = { error: `未知工具: ${toolName}` };
                }
              } catch (err: any) {
                result = { error: err.message };
              }

              toolResults.push({ tool: toolName, result });
            }

            send({ type: 'tool_done', tools: toolResults });
            console.log('assistant content', content)
            messages.push({
              role: "assistant",
              content: "",
              tool_calls: toolCalls
            });

            for (let i = 0; i < toolCalls.length; i++) {
              messages.push({
                role: "tool",
                content: JSON.stringify(toolResults[i]?.result || {}),
              });
            }

            const followUpResponse = await ollama.chat({
              model: "qwen2.5:7b",
              messages,
              stream: true,
            });

            for await (const followUpChunk of followUpResponse) {
              const followUpContent = followUpChunk.message?.content;
              console.log('=== 后续响应块 ===');
              console.log('followUpContent:', followUpContent ? followUpContent.substring(0, 100) + (followUpContent.length > 100 ? '...' : '') : 'null');
              if (followUpContent) {
                send({ text: followUpContent });
              }
            }

            send({ done: true });
            controller.close();
            return;
          }

          if (content && !hasToolCalls) {
            console.log('content && !hasToolCalls');
            console.log('=== 直接发送内容 ===');
            console.log('content:', content ? content.substring(0, 100) + (content.length > 100 ? '...' : '') : 'null');
            
            // 简单过滤：忽略只有数字、标点、或者太短的奇怪内容
            const trimmed = content.trim();
            const isSuspicious = (
              trimmed.length < 2 || // 太短
              /^[\d\s,.\-\u4e00-\u9fa5]*$/.test(trimmed) && trimmed.length < 5 || // 只有少量中文和数字
              /^\d+([,.]\d+)*$/.test(trimmed) // 只有数字
            );
            
            if (!isSuspicious) {
              send({ text: content });
            } else {
              console.log('忽略可疑初始内容:', trimmed);
            }
          }
        }

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