import type Anthropic from "@anthropic-ai/sdk";

/**
 * 工具接口定义
 */
export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (input: Record<string, unknown>) => Promise<string>;
}

/**
 * 将 Tool 转换为 Anthropic API 的工具定义格式
 */
export function toAnthropicTool(tool: Tool): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  };
}
