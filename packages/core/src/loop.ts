/**
 * ReACT 循环实现
 * Reasoning + Acting 的核心逻辑，支持流式输出
 */
import type Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient, getModelName, type LLMConfig } from "./llm/index.js";
import { allTools, toAnthropicTool, type Tool } from "./tools/index.js";

const MAX_ITERATIONS = 20;

/**
 * 循环过程中的事件回调
 * TUI/上层通过这些回调控制展示，core 层不直接输出
 */
export interface LoopEventHandlers {
  /** 流式文本片段 */
  onText?: (text: string) => void;
  /** 工具开始执行 */
  onToolStart?: (toolName: string, input: Record<string, unknown>) => void;
  /** 工具执行完成 */
  onToolEnd?: (toolName: string, output: string, durationMs: number) => void;
  /** 工具执行出错 */
  onToolError?: (toolName: string, error: string) => void;
}

/**
 * 从 response.content 中提取文本内容
 */
export function extractTextContent(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/**
 * 执行工具调用并返回结果
 */
export async function executeToolCalls(
  content: Anthropic.ContentBlock[],
  tools: Tool[],
  events?: LoopEventHandlers
): Promise<Anthropic.ToolResultBlockParam[]> {
  const results: Anthropic.ToolResultBlockParam[] = [];

  for (const block of content) {
    if (block.type === "tool_use") {
      const tool = tools.find((t) => t.name === block.name);

      if (!tool) {
        const errorMsg = `Error: Unknown tool: ${block.name}`;
        events?.onToolError?.(block.name, errorMsg);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: errorMsg,
        });
        continue;
      }

      try {
        events?.onToolStart?.(block.name, block.input as Record<string, unknown>);
        const start = Date.now();
        const output = await tool.execute(block.input as Record<string, unknown>);
        events?.onToolEnd?.(block.name, output, Date.now() - start);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
        });
      } catch (error) {
        const errorMessage = `Error: ${(error as Error).message}`;
        events?.onToolError?.(block.name, errorMessage);
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
  events?: LoopEventHandlers;
}

/**
 * 运行 ReACT 循环（流式）
 * @param userMessage 用户输入的消息
 * @param options 配置选项
 * @returns 最终的文本响应
 */
export async function runLoop(
  userMessage: string,
  options: RunLoopOptions = {}
): Promise<string> {
  const { config = {}, tools = allTools, systemPrompt, events } = options;

  const client = createAnthropicClient(config);
  const model = getModelName(config);
  const toolDefinitions = tools.map(toAnthropicTool);

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // 流式调用 LLM
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      tools: toolDefinitions,
      messages,
      ...(systemPrompt && { system: systemPrompt }),
    });

    stream.on("text", (text) => {
      events?.onText?.(text);
    });

    const response = await stream.finalMessage();

    if (response.stop_reason === "end_turn") {
      return extractTextContent(response.content);
    }

    if (response.stop_reason === "max_tokens") {
      return extractTextContent(response.content);
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const toolResults = await executeToolCalls(response.content, tools, events);
      messages.push({ role: "user", content: toolResults });
    }
  }

  return "Error: Maximum iterations reached. The task may be too complex.";
}
