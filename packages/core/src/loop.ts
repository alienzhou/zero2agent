import type { FileMutationHandler } from './file-mutations.js'
/**
 * ReACT 循环实现
 * Reasoning + Acting 的核心逻辑，支持流式输出
 */
import {
  DiagnosticEmitter,
  diagnosticLabel,
  diagnosticNumber,
  type DiagnosticObserver,
  type DiagnosticContext,
} from './diagnostics.js'
import Anthropic from '@anthropic-ai/sdk'
import {
  RuntimeEmitter,
  TurnCancelledError,
  RunBudgetError,
  assertNotCancelled,
  notifyObserver,
  type RuntimeEvent,
  type RequestNotice,
} from './runtime.js'
import { createAnthropicClient, getModelName, type LLMConfig } from './llm/index.js'
import { allTools, toAnthropicTool, type Tool, type ToolContext } from './tools/index.js'
import { Session } from './session.js'
import type { ToolExecutionMetadata } from './tools/types.js'
import type { ContextOptions } from './context-budget.js'
import { createContextSummarizer } from './context-summary.js'
import type { CompactionEvent, CompactionRuntime } from './context-manager.js'
import { RunBudget, type RunLimits } from './run-budget.js'
import { RequestExecutor, IncompleteStreamError } from './request-executor.js'

import {
  PermissionController,
  type PermissionOptions,
  type PermissionDecision,
} from './permissions.js'

function describeToolError(error: unknown): string {
  try {
    return String(error instanceof Error ? error.message : error)
  } catch {
    return 'Unknown tool error (unprintable thrown value)'
  }
}

/**
 * 循环过程中的事件回调
 * TUI/上层通过这些回调控制展示，core 层不直接输出
 * 通知不参与控制：忽略同步异常和异步拒绝，不等待异步回调完成。
 */
export interface LoopEventHandlers {
  /** Plain hosts and manual compaction receive safe request status without owning a Turn timeline. */
  onRequestNotice?: (notice: RequestNotice) => void
  /** Structured presentation events; observers cannot alter execution. */
  onEvent?: (event: RuntimeEvent) => void
  /** 模型文本片段及 Harness 状态提示 */
  onText?: (text: string) => void
  /** 工具开始执行 */
  onToolStart?: (toolName: string, input: Record<string, unknown>) => void
  /** 工具执行完成 */
  onToolEnd?: (toolName: string, output: string, durationMs: number) => void
  /** 工具执行出错 */
  onToolError?: (toolName: string, error: string) => void
  onPermission?: (toolCallId: string, decision: PermissionDecision) => void
  onCompaction?: (event: CompactionEvent) => void
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
  events?: LoopEventHandlers,
  permissions = new PermissionController(),
  emitter?: RuntimeEmitter,
  diagnostics?: DiagnosticEmitter,
  fileMutations?: FileMutationHandler,
  sessionId?: string,
  budget?: RunBudget
): Promise<Anthropic.ToolResultBlockParam[]> {
  const results: Anthropic.ToolResultBlockParam[] = []
  const calls = structuredClone(content).filter(block => block.type === 'tool_use')
  for (const block of calls) {
    emitter?.emit({
      type: 'tool-state',
      toolCallId: block.id,
      toolName: block.name,
      status: 'pending',
      input: block.input as Record<string, unknown>,
    })
  }
  for (const block of calls) {
    const state = (
      status: Extract<RuntimeEvent, { type: 'tool-state' }>['status'],
      detail: { output?: string; reason?: string; durationMs?: number } = {}
    ): void =>
      emitter?.emit({
        type: 'tool-state',
        toolCallId: block.id,
        toolName: block.name,
        status,
        ...detail,
      })
    let start: number | undefined
    let denied = false
    let consumed = false
    try {
      budget?.consumeTool(block.name, block.input)
      consumed = true
      assertNotCancelled(ctx.signal)
      const tool = tools.find(t => t.name === block.name)
      if (!tool) throw new Error(`Unknown tool: ${block.name}`)
      const input = structuredClone(block.input) as Record<string, unknown>
      const originatingRequestId = diagnostics?.latestModelRequestId
      const metadataObserver: ToolContext['onResultMetadata'] =
        diagnostics?.enabled || ctx.onResultMetadata
          ? (metadata: ToolExecutionMetadata) => {
              diagnostics?.emit('tool', 'metadata', {
                requestId: originatingRequestId,
                toolCallId: diagnosticLabel(block.id),
                toolName: diagnosticLabel(block.name),
                terminalOutcome: metadata.terminalOutcome,
                exitCode: diagnosticNumber(metadata.exitCode),
                pid: diagnosticNumber(metadata.pid),
                signal:
                  metadata.signal === undefined
                    ? undefined
                    : diagnosticLabel(String(metadata.signal)),
              })
              notifyObserver(() => ctx.onResultMetadata?.(structuredClone(metadata)))
            }
          : undefined
      const callCtx: ToolContext = Object.freeze({
        ...ctx,
        ...(metadataObserver && { onResultMetadata: metadataObserver }),
      })
      const initial = permissions.evaluate(tool, input, callCtx)
      diagnostics?.permission('initial', block.id, block.name, initial.action)
      if (initial.action === 'ask') state('approval', { reason: initial.reason })
      assertNotCancelled(ctx.signal)
      const decision = await permissions.authorize(block.id, tool, input, callCtx)
      diagnostics?.permission('resolved', block.id, block.name, decision.action)
      notifyObserver(() => events?.onPermission?.(block.id, { ...decision }))
      assertNotCancelled(ctx.signal)
      if (decision.action !== 'allow') {
        denied = true
        throw new Error(`Permission denied: ${decision.reason}`)
      }
      // Awaiting the host can change the filesystem. Check hard boundaries again.
      const boundary = permissions.checkWorkspace(tool, input, callCtx)
      if (boundary?.action === 'deny') {
        diagnostics?.permission('boundary', block.id, block.name, 'deny')
        denied = true
        throw new Error(`Permission denied: ${boundary.reason}`)
      }
      state('running')
      notifyObserver(() => events?.onToolStart?.(block.name, structuredClone(input)))
      assertNotCancelled(ctx.signal)
      start = Date.now()
      // Never race a tool against cancellation: it may finish a write despite ignoring signal.
      const execute = (): Promise<string> => {
        assertNotCancelled(ctx.signal)
        return tool.execute(input, callCtx)
      }
      const output =
        fileMutations && tool.checkpointPaths
          ? await fileMutations(
              {
                cwd: ctx.cwd,
                paths: tool.checkpointPaths.flatMap(key => {
                  const value = input[key]
                  return typeof value === 'string'
                    ? [value]
                    : Array.isArray(value)
                      ? value.filter((item): item is string => typeof item === 'string')
                      : []
                }),
                toolName: tool.name,
                toolCallId: block.id,
                operationId: diagnostics?.operationId,
                sessionId,
                signal: ctx.signal,
              },
              execute
            )
          : await execute()
      const durationMs = Date.now() - start
      const cancelled =
        block.name === 'terminal' &&
        /^(?:Note: could not load your shell profile; PATH may be incomplete\.\n)?Status: (?:human-controlled )?cancelled(?: by user|\n|$)/.test(
          output
        )
      state(cancelled ? 'cancelled' : output.startsWith('Error:') ? 'error' : 'completed', {
        output,
        durationMs,
        ...(ctx.signal?.aborted && !cancelled
          ? { reason: 'Tool settled after cancellation was requested; its result is retained.' }
          : {}),
      })
      notifyObserver(() => events?.onToolEnd?.(block.name, output, durationMs))
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: output,
        ...((output.startsWith('Error:') || cancelled) && { is_error: true }),
      })
      budget?.settleTool(block.name, block.input, output.startsWith('Error:') || cancelled, false)
    } catch (error) {
      const limited =
        error instanceof RunBudgetError || ctx.signal?.reason instanceof RunBudgetError
      const cancelled = !limited && (ctx.signal?.aborted || error instanceof TurnCancelledError)
      const errorMessage =
        limited && start === undefined
          ? `Error: Run stopped before this tool started; it was not executed (${(ctx.signal?.reason as RunBudgetError | undefined)?.limitReason ?? (error as RunBudgetError).limitReason}).`
          : cancelled
            ? start === undefined
              ? 'Error: Turn cancelled before this tool started; it was not executed.'
              : 'Error: Turn cancelled. This tool did not complete; any side effects were not rolled back.'
            : `Error: ${describeToolError(error)}`
      state(cancelled ? 'cancelled' : denied ? 'denied' : 'error', {
        output: errorMessage,
        reason: errorMessage,
        ...(start === undefined ? {} : { durationMs: Date.now() - start }),
      })
      notifyObserver(() => events?.onToolError?.(block.name, errorMessage))
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: errorMessage,
        is_error: true,
      })
      if (consumed && !limited && !cancelled)
        budget?.settleTool(block.name, block.input, true, denied)
    }
  }
  return results
}

export interface RunLoopOptions {
  limits?: RunLimits
  fileMutations?: FileMutationHandler
  diagnostics?: DiagnosticObserver
  diagnosticContext?: DiagnosticContext
  signal?: AbortSignal
  /** Omit for a one-shot run; reuse explicitly for a multi-turn conversation. */
  session?: Session
  permissions?: PermissionOptions
  permissionController?: PermissionController
  config?: LLMConfig
  context?: ContextOptions
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
  const budget = new RunBudget(options.limits, options.signal)
  options = { ...options, signal: budget.signal }
  const session = options.session ?? new Session()
  const diagnostics = new DiagnosticEmitter(options.diagnostics, options.diagnosticContext)
  const emitter = new RuntimeEmitter(diagnostics.operationId, event => {
    diagnostics.runtime(event)
    notifyObserver(() => options.events?.onEvent?.(event))
    if (
      !options.events?.onEvent &&
      (event.type === 'request-retry' || event.type === 'request-abandoned')
    )
      notifyObserver(() => options.events?.onRequestNotice?.(event))
  })
  const executor = new RequestExecutor(budget, diagnostics, emitter)
  let started = false
  let cancellationNotified = false
  const cancel = (): void => {
    if (cancellationNotified) return
    cancellationNotified = true
    emitter.emit({ type: 'phase', phase: 'cancelling' })
    session.cancelCompaction()
  }
  try {
    const result = await session.runTurn(userMessage, async messages => {
      started = true
      diagnostics.start('turn')
      options.signal?.addEventListener('abort', cancel, { once: true })
      emitter.emit({ type: 'turn-start' })
      if (options.signal?.aborted) cancel()
      assertNotCancelled(options.signal)
      return runTurnLoop(messages, { ...options, session }, emitter, diagnostics, budget, executor)
    })
    emitter.emit({ type: 'turn-end', status: 'completed' })
    diagnostics.end('completed', 'turn')
    return result
  } catch (error) {
    if (options.signal?.reason instanceof RunBudgetError) error = options.signal.reason
    if (started) {
      const cancelled =
        !(error instanceof RunBudgetError) &&
        (options.signal?.aborted || error instanceof TurnCancelledError)
      emitter.emit({
        type: 'turn-end',
        status: cancelled ? 'cancelled' : 'error',
        ...(cancelled ? {} : { error: describeToolError(error) }),
      })
      diagnostics.end(cancelled ? 'cancelled' : 'error', 'turn', error, options.signal)
      if (cancelled) throw new TurnCancelledError()
    }
    throw error
  } finally {
    budget.close()
    options.signal?.removeEventListener('abort', cancel)
    if (!options.session) session.cancelCompaction()
  }
}

export function createCompactionRuntime(
  options: RunLoopOptions,
  session: Session,
  diagnostics?: DiagnosticEmitter,
  executor?: RequestExecutor
): CompactionRuntime {
  const client = createAnthropicClient(options.config ?? {})
  const model = getModelName(options.config ?? {})
  const budget = session.getContextBudget(model, options.context)
  return {
    client,
    budget,
    diagnostics,
    executor,
    request: messages =>
      structuredClone({
        model,
        max_tokens: budget.outputTokens,
        messages,
        tools: (options.tools ?? allTools).map(toAnthropicTool),
        ...(options.systemPrompt && { system: options.systemPrompt }),
      }),
    summarize: createContextSummarizer(client, model, budget, diagnostics, executor),
    onCompaction: options.events?.onCompaction,
  }
}

function isContextOverflow(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /prompt is too long|context[_ ](?:length[_ ]exceeded|overflow|window)|maximum context|too many (?:input )?tokens/i.test(
    error.message
  )
}

async function runTurnLoop(
  messages: Anthropic.MessageParam[],
  options: RunLoopOptions,
  emitter: RuntimeEmitter,
  diagnostics: DiagnosticEmitter,
  budget: RunBudget,
  executor: RequestExecutor
): Promise<string> {
  const { tools = allTools, events, cwd } = options
  const session = options.session!
  const runtime = createCompactionRuntime(
    {
      ...options,
      events: {
        ...events,
        onCompaction: event => {
          emitter.emit({ type: 'compaction', event })
          notifyObserver(() => events?.onCompaction?.(structuredClone(event)))
        },
      },
    },
    session,
    diagnostics,
    executor
  )
  const permissions = options.permissionController ?? new PermissionController(options.permissions)
  const ctx: ToolContext = {
    cwd: cwd ?? process.cwd(),
    ...(options.signal && { signal: options.signal }),
  }
  while (true) {
    assertNotCancelled(options.signal)
    budget.consumeIteration()
    let response: Anthropic.Message
    for (let recovery = 0; ; recovery++) {
      emitter.emit({ type: 'phase', phase: 'preparing' })
      assertNotCancelled(options.signal)
      const request = await session.prepareRequest(messages, runtime)
      assertNotCancelled(options.signal)
      try {
        emitter.emit({ type: 'phase', phase: 'requesting' })
        assertNotCancelled(options.signal)
        response = await executor.run(
          'model',
          request,
          async attempt => {
            let acceptingText = true
            let stopped = false
            let streaming = false
            const stream = runtime.client.messages.stream(request, {
              signal: attempt.signal,
              timeout: attempt.timeoutMs,
              maxRetries: 0,
            })
            stream.on('streamEvent', event => {
              if (event.type === 'message_stop') stopped = true
            })
            stream.on('text', text => {
              if (!acceptingText || attempt.signal.aborted) return
              attempt.span?.text(text)
              if (!streaming) {
                streaming = true
                emitter.emit({ type: 'phase', phase: 'streaming' })
              }
              emitter.emit({ type: 'text-delta', text })
              notifyObserver(() => events?.onText?.(text))
            })
            try {
              const complete = await stream.finalMessage()
              if (!stopped) throw new IncompleteStreamError()
              return complete
            } catch (error) {
              if (
                !stopped &&
                error instanceof Anthropic.AnthropicError &&
                /^(?:stream ended without producing a Message with role=assistant|request ended without sending any chunks)$/.test(
                  error.message
                )
              )
                throw new IncompleteStreamError()
              throw error
            } finally {
              acceptingText = false
            }
          },
          options.signal
        )
        assertNotCancelled(options.signal)
        break
      } catch (error) {
        assertNotCancelled(options.signal)
        if (!isContextOverflow(error) || recovery >= 2) throw error
        if (!(await session.recoverContext(messages, runtime))) throw error
      }
    }

    if (response.stop_reason === 'tool_use') {
      if (!response.content.some(block => block.type === 'tool_use')) {
        throw new Error('Model stopped for tool_use without any tool calls.')
      }
      messages.push({ role: 'assistant', content: structuredClone(response.content) })
      emitter.emit({ type: 'phase', phase: 'tools' })
      const toolResults = await executeToolCalls(
        response.content,
        tools,
        ctx,
        events,
        permissions,
        emitter,
        diagnostics,
        options.fileMutations,
        options.diagnosticContext?.sessionId,
        budget
      )
      messages.push({ role: 'user', content: toolResults })
      budget.check()
      assertNotCancelled(options.signal)
      continue
    }

    if (
      !['end_turn', 'max_tokens', 'stop_sequence', 'refusal'].includes(response.stop_reason ?? '')
    ) {
      throw new Error(`Unsupported model stop reason: ${response.stop_reason}`)
    }

    const text = extractTextContent(response.content)
    const emptyNotice = response.content.length ? '' : '[Harness] Model returned no content.'
    const calls = response.content.filter(block => block.type === 'tool_use')
    const notice =
      response.stop_reason === 'max_tokens'
        ? '[Harness] Model output was truncated by max_tokens. Any tool calls in this response were not executed.'
        : calls.length > 0
          ? '[Harness] Tool calls were not executed because the response did not stop for tool_use.'
          : ''
    messages.push({
      role: 'assistant',
      content: response.content.length ? structuredClone(response.content) : emptyNotice,
    })
    if (calls.length) {
      for (const call of calls) {
        emitter.emit({
          type: 'tool-state',
          toolCallId: call.id,
          toolName: call.name,
          status: 'error',
          input: call.input as Record<string, unknown>,
          output: notice,
          reason: notice,
        })
      }
      // Even skipped calls need a matching result before a later user turn can be sent.
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
    if (notice) {
      messages.push({ role: 'assistant', content: notice })
      emitter.emit({ type: 'notice', text: notice })
      notifyObserver(() => events?.onText?.(`\n${notice}\n`))
    } else if (emptyNotice) {
      emitter.emit({ type: 'notice', text: emptyNotice })
      notifyObserver(() => events?.onText?.(`\n${emptyNotice}\n`))
    }
    assertNotCancelled(options.signal)
    return text || notice || emptyNotice
  }
}
