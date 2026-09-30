/**
 * ReACT 循环实现
 * Reasoning + Acting 的核心逻辑，支持流式输出
 */
import type Anthropic from '@anthropic-ai/sdk'
import { createAnthropicClient, getModelName, type LLMConfig } from './llm/index.js'
import { allTools, toAnthropicTool, type Tool, type ToolContext } from './tools/index.js'
import { Session } from './session.js'

const MAX_ITERATIONS = 20

/** Display observers cannot change execution results or leave unmatched tool calls. */
function notifyObserver(notify: () => unknown): void {
  try {
    // TypeScript also permits async functions for void callbacks. Observe rejection without waiting.
    void Promise.resolve(notify()).catch(() => {})
  } catch {
    /* The host owns presentation failures. */
  }
}

/**
 * 循环过程中的事件回调
 * TUI/上层通过这些回调控制展示，core 层不直接输出
 */
export interface LoopEventHandlers {
  /** 流式文本片段 */
  onText?: (text: string) => void
  /** 工具开始执行 */
  onToolStart?: (toolName: string, input: Record<string, unknown>) => void
  /** 工具执行完成 */
  onToolEnd?: (toolName: string, output: string, durationMs: number) => void
  /** 工具执行出错 */
  onToolError?: (toolName: string, error: string) => void
}

/**
 * 从 response.content 中提取文本内容
 */
export function extractTextContent(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/**
 * 执行工具调用并返回结果
 */
export async function executeToolCalls(
  content: Anthropic.ContentBlock[],
  tools: Tool[],
  ctx: ToolContext,
  events?: LoopEventHandlers
): Promise<Anthropic.ToolResultBlockParam[]> {
  const results: Anthropic.ToolResultBlockParam[] = []

  for (const block of content) {
    if (block.type === 'tool_use') {
      const tool = tools.find(t => t.name === block.name)

      if (!tool) {
        const errorMsg = `Error: Unknown tool: ${block.name}`
        notifyObserver(() => events?.onToolError?.(block.name, errorMsg))
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: errorMsg,
          is_error: true,
        })
        continue
      }

      try {
        notifyObserver(() =>
          events?.onToolStart?.(block.name, structuredClone(block.input) as Record<string, unknown>)
        )
        const start = Date.now()
        const output = await tool.execute(
          structuredClone(block.input) as Record<string, unknown>,
          ctx
        )
        notifyObserver(() => events?.onToolEnd?.(block.name, output, Date.now() - start))
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: output,
        })
      } catch (error) {
        const errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`
        notifyObserver(() => events?.onToolError?.(block.name, errorMessage))
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: errorMessage,
          is_error: true,
        })
      }
    }
  }

  return results
}

export interface RunLoopOptions {
  /** Omit for a one-shot run; reuse explicitly for a multi-turn conversation. */
  session?: Session
  config?: LLMConfig
  tools?: Tool[]
  systemPrompt?: string
  events?: LoopEventHandlers
  /** Agent 工作目录，所有工具的相对路径基于此解析。默认 process.cwd() */
  cwd?: string
}

/**
 * 运行 ReACT 循环（流式）
 * @param userMessage 用户输入的消息
 * @param options 配置选项
 * @returns 最终的文本响应
 */
export async function runLoop(userMessage: string, options: RunLoopOptions = {}): Promise<string> {
  const session = options.session ?? new Session()
  return session.runTurn(userMessage, messages => runTurnLoop(messages, options))
}

async function runTurnLoop(
  messages: Anthropic.MessageParam[],
  options: RunLoopOptions
): Promise<string> {
  const { config = {}, tools = allTools, systemPrompt, events, cwd } = options

  // 构造工具执行上下文
  const ctx: ToolContext = { cwd: cwd ?? process.cwd() }

  const client = createAnthropicClient(config)
  const model = getModelName(config)
  const toolDefinitions = tools.map(toAnthropicTool)

  let iterations = 0

  while (iterations < MAX_ITERATIONS) {
    iterations++

    // 流式调用 LLM
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      tools: toolDefinitions,
      messages: structuredClone(messages),
      ...(systemPrompt && { system: systemPrompt }),
    })

    stream.on('text', text => {
      notifyObserver(() => events?.onText?.(text))
    })

    const response = await stream.finalMessage()

    if (response.stop_reason === 'tool_use') {
      if (!response.content.some(block => block.type === 'tool_use')) {
        throw new Error('Model stopped for tool_use without any tool calls.')
      }
      messages.push({ role: 'assistant', content: structuredClone(response.content) })
      const toolResults = await executeToolCalls(response.content, tools, ctx, events)
      messages.push({ role: 'user', content: toolResults })
      continue
    }

    if (
      !['end_turn', 'max_tokens', 'stop_sequence', 'refusal'].includes(response.stop_reason ?? '')
    ) {
      throw new Error(`Unsupported model stop reason: ${response.stop_reason}`)
    }

    const text = extractTextContent(response.content)
    const calls = response.content.filter(block => block.type === 'tool_use')
    const notice =
      response.stop_reason === 'max_tokens'
        ? '[Harness] Model output was truncated by max_tokens. Any tool calls in this response were not executed.'
        : calls.length > 0
          ? '[Harness] Tool calls were not executed because the response did not stop for tool_use.'
          : ''
    messages.push({
      role: 'assistant',
      content: response.content.length
        ? structuredClone(response.content)
        : '[Harness] Model returned no content.',
    })
    if (calls.length) {
      messages.push({
        role: 'user',
        content: calls.map(call => ({
          type: 'tool_result' as const,
          tool_use_id: call.id,
          is_error: true,
          content: notice,
        })),
      })
    }
    if (notice) messages.push({ role: 'assistant', content: notice })
    return text || notice
  }

  const limit = 'Error: Maximum iterations reached. The task may be too complex.'
  messages.push({ role: 'assistant', content: `[Harness] ${limit}` })
  return limit
}
