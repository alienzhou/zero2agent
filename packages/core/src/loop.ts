/**
 * ReACT 循环实现
 * Reasoning + Acting 的核心逻辑
 */
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient, getModelName, type LLMConfig } from "./llm/index.js";
import { allTools, toAnthropicTool, type Tool } from "./tools/index.js";

const MAX_ITERATIONS = 20; // 防止无限循环

/**
 * 从 response.content 中提取文本内容
 */
function extractTextContent(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * 执行工具调用并返回结果
 */
async function executeToolCalls(
  content: Anthropic.ContentBlock[],
  tools: Tool[]
): Promise<Anthropic.ToolResultBlockParam[]> {
  const results: Anthropic.ToolResultBlockParam[] = [];

  for (const block of content) {
    if (block.type === "tool_use") {
      const tool = tools.find((t) => t.name === block.name);

      if (!tool) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: Unknown tool: ${block.name}`,
        });
        continue;
      }

      try {
        console.log(`[Tool] Executing: ${block.name}`);
        console.log(`[Tool] Input:`, JSON.stringify(block.input, null, 2));
        const output = await tool.execute(block.input as Record<string, unknown>);
        console.log(`[Tool] Output (${output.length} chars)`);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
        });
      } catch (error) {
        const errorMessage = `Error: ${(error as Error).message}`;
        console.log(`[Tool] Error:`, errorMessage);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: errorMessage,
        });
      }
    }
  }

  return results;
}

export interface RunLoopOptions {
  config?: LLMConfig;
  tools?: Tool[];
  systemPrompt?: string;
}

/**
 * 运行 ReACT 循环
 * @param userMessage 用户输入的消息
 * @param options 配置选项
 * @returns 最终的文本响应
 */
export async function runLoop(
  userMessage: string,
  options: RunLoopOptions = {}
): Promise<string> {
  const { config = {}, tools = allTools, systemPrompt } = options;

  const client = createAnthropicClient(config);
  const model = getModelName(config);
  const toolDefinitions = tools.map(toAnthropicTool);

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  console.log(`\n[Loop] Starting with model: ${model}`);
  console.log(`[Loop] User message: ${userMessage}`);
  console.log(`[Loop] Tools available: ${tools.map((t) => t.name).join(", ")}`);

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    console.log(`\n[Loop] Iteration ${iterations}`);

    // 1. 调用 LLM
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      tools: toolDefinitions,
      messages,
      ...(systemPrompt && { system: systemPrompt }),
    });

    console.log(`[Loop] Stop reason: ${response.stop_reason}`);

    // 2. 检查结束条件
    if (response.stop_reason === "end_turn") {
      const textContent = extractTextContent(response.content);
      console.log(`[Loop] Final response received`);
      return textContent;
    }

    // 3. 达到 token 上限
    if (response.stop_reason === "max_tokens") {
      console.log(`[Loop] Max tokens reached`);
      return extractTextContent(response.content);
    }

    // 4. 处理工具调用
    if (response.stop_reason === "tool_use") {
      // 添加助手消息
      messages.push({ role: "assistant", content: response.content });

      // 执行工具并收集结果
      const toolResults = await executeToolCalls(response.content, tools);

      // 添加工具结果（作为 user 消息）
      messages.push({ role: "user", content: toolResults });
    }
  }

  console.log(`[Loop] Max iterations (${MAX_ITERATIONS}) reached`);
  return "Error: Maximum iterations reached. The task may be too complex.";
}
