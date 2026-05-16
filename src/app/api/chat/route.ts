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
        let contentBuffer = ''; // 累积 content 用于检测跨 chunk 的 tool_call
        let hasDetectedToolCall = false; // 标记是否已检测到 tool_call 开始

        for await (const chunk of response) {
          const content = chunk.message?.content;
          let toolCalls = (chunk.message as any)?.tool_calls;
          
          console.log('=== 模型响应块 ===');
          console.log('content:', content ? content.substring(0, 100) + (content.length > 100 ? '...' : '') : 'null');
          console.log('tool_calls:', toolCalls);

          if (!toolCalls && content) {
            contentBuffer += content;
            console.log('contentBuffer:', contentBuffer.substring(0, 100));
            
            // 检测 tool_call 开始标记（包括标签、JSON 名值对、函数名前后有任意字符）
            if (!hasDetectedToolCall && (
              /<tool_call|function_caller|modne/.test(contentBuffer) ||
              /"name"\s*:\s*"(search_car_by_budget|get_car_detail|compare_cars|plan_route)"/.test(contentBuffer) ||
              /(search_car_by_budget|get_car_detail|compare_cars|plan_route)/.test(contentBuffer)
            )) {
              hasDetectedToolCall = true;
              console.log('检测到 tool_call 开始标记');
            }
            
            let funcMatch = contentBuffer.match(/function_caller\(\s*(\{[\s\S]*\})\s*\)/);
            if (!funcMatch) {
              const xmlMatch = contentBuffer.match(/<function_caller>\s*(\{[\s\S]*\})\s*<\/function_caller>/);
              if (xmlMatch) {
                funcMatch = xmlMatch;
              }
            }
            if (!funcMatch) {
              const toolCallMatch = contentBuffer.match(/<tool_call>\s*(\{[\s\S]*\})\s*<\/tool_call>/);
              if (toolCallMatch) {
                funcMatch = toolCallMatch;
              }
            }
            // 兼容没有标签的 JSON 格式（模型直接把 JSON 当作 content 输出）
            if (!funcMatch && hasDetectedToolCall) {
              // 尝试从累积内容中提取完整的 JSON 对象
              const jsonStart = contentBuffer.indexOf('{');
              const jsonEnd = contentBuffer.lastIndexOf('}');
              if (jsonStart >= 0 && jsonEnd > jsonStart) {
                const jsonStr = contentBuffer.substring(jsonStart, jsonEnd + 1);
                try {
                  const parsed = JSON.parse(jsonStr);
                  if (parsed.name && parsed.arguments) {
                    toolCalls = [{ function: parsed }];
                    console.log('从累积内容中解析出工具调用:', toolCalls);
                  }
                } catch {
                  // 累积中，等待更多内容
                }
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
                const trimmed = followUpContent.trim();
                // follow-up 只过滤乱码，不过滤短内容（避免车型缩写如 C、R、S 被拦截）
                const isGarbage = /[\u00C0-\u024F]/.test(trimmed) || /[\u0E00-\u0EFF]/.test(trimmed);
                if (!isGarbage) {
                  send({ text: followUpContent });
                } else {
                  console.log('忽略后续响应中的乱码:', trimmed);
                }
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
            
            // 如果已检测到 tool_call 开始，不再发送任何内容（避免发送乱码和 tool_call 片段）
            if (hasDetectedToolCall) {
              console.log('已检测到 tool_call，忽略内容:', content.trim());
              continue;
            }
            
            // 过滤可疑内容
            const trimmed = content.trim();
            const isGarbage = /[\u00C0-\u024F]/.test(trimmed) || /[\u0E00-\u0EFF]/.test(trimmed);
            
            if (!isGarbage) {
              send({ text: content });
            } else {
              console.log('忽略乱码内容:', trimmed);
            }
          }
        }

        // 流结束但模型没有调用工具 — 如果用户消息需要工具，自动兜底调用
        if (!hasToolCalls && shouldUseTool(message)) {
          console.log('模型未调用工具，执行兜底调用');
          
          interface ToolResult { tool: string; result: unknown; }
          const toolResults: ToolResult[] = [];
          let fallbackToolName = '';
          let fallbackArgs: any = {};
          
          // 根据用户消息推断要调用的工具
          if (/预算|多少钱|推荐|选车|价格|买车/.test(message)) {
            fallbackToolName = 'search_car_by_budget';
            const budgetMatch = message.match(/(\d+)/);
            const budget = budgetMatch ? parseInt(budgetMatch[1]) : 20;
            fallbackArgs = {
              min_price: budget,
              max_price: budget,
              scene_tag: []
            };
            if (/通勤|上班|日常/.test(message)) fallbackArgs.scene_tag.push('通勤');
            if (/露营|越野|户外|自驾/.test(message)) fallbackArgs.scene_tag.push('露营');
            if (/家用|家庭|带娃|老人/.test(message)) fallbackArgs.scene_tag.push('家用');
            if (/商务|接待|办公/.test(message)) fallbackArgs.scene_tag.push('商务');
          } else if (/路线|距离|多远|怎么去|导航/.test(message)) {
            fallbackToolName = 'plan_route';
          } else if (/对比|比较/.test(message)) {
            fallbackToolName = 'compare_cars';
          }
          
          if (fallbackToolName) {
            try {
              if (fallbackToolName === 'search_car_by_budget') {
                const result = searchCarByBudget(
                  fallbackArgs.min_price,
                  fallbackArgs.max_price,
                  undefined,
                  undefined,
                  fallbackArgs.scene_tag.length > 0 ? fallbackArgs.scene_tag : undefined
                );
                toolResults.push({ tool: fallbackToolName, result: result.length > 0 ? result : { error: `未找到符合条件的车型` } });
              } else if (fallbackToolName === 'plan_route') {
                toolResults.push({ tool: fallbackToolName, result: { error: '请提供出发地和目的地' } });
              } else if (fallbackToolName === 'compare_cars') {
                toolResults.push({ tool: fallbackToolName, result: { error: '请提供要对比的车型' } });
              }
              
              send({ type: 'tool_done', tools: toolResults });
              
              // 用工具结果再请求一次模型生成回复
              const fallbackMessages: Message[] = [
                ...messages,
                { role: 'assistant', content: '', tool_calls: [{ function: { name: fallbackToolName, arguments: fallbackArgs } }] },
                { role: 'tool', content: JSON.stringify(toolResults[0]?.result || {}) }
              ];
              
              const fallbackResponse = await ollama.chat({
                model: 'qwen2.5:7b',
                messages: fallbackMessages,
                stream: true,
              });
              
              for await (const chunk of fallbackResponse) {
                const text = chunk.message?.content;
                if (text) {
                  const trimmed = text.trim();
                  const isGarbage = /[\u00C0-\u024F]/.test(trimmed) || /[\u0E00-\u0EFF]/.test(trimmed);
                  if (!isGarbage) {
                    send({ text });
                  }
                }
              }
            } catch (err: any) {
              console.error('兜底调用失败:', err);
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
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}