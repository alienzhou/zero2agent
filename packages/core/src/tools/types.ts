import type Anthropic from "@anthropic-ai/sdk";

/**
 * 工具执行上下文
 * 框架注入给每次工具调用，包含 Agent 级别的配置
 */
export interface ToolContext {
  /** Agent 工作目录的绝对路径，所有相对路径基于此解析 */
  cwd: string;
}

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
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
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
