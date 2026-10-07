import type Anthropic from '@anthropic-ai/sdk'

/**
 * 工具执行上下文
 * 框架注入给每次工具调用，包含 Agent 级别的配置
 */
export interface ToolExecutionMetadata {
  terminalOutcome: 'completed' | 'cancelled' | 'declined' | 'skipped' | 'drain-timeout'
  exitCode?: number
  pid?: number
  signal?: string | number
}
export interface ToolContext {
  /** Native result metadata only; no command or terminal bytes. Notification, never control. */
  onResultMetadata?: (metadata: ToolExecutionMetadata) => void
  /** Cooperatively stop active work when the host cancels the turn. */
  signal?: AbortSignal
  /** Agent 工作目录的绝对路径，所有相对路径基于此解析 */
  cwd: string
}

/**
 * 工具接口定义
 */
export interface Tool {
  /** Trusted host metadata; omitted tools require approval by default. */
  permission?: { effect: 'read' | 'write' | 'execute'; paths?: string[] }
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>
}

/**
 * 将 Tool 转换为 Anthropic API 的工具定义格式
 */
export function toAnthropicTool(tool: Tool): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }
}
