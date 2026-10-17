import {
  ProjectInstructions,
  ProjectInstructionError,
  PROJECT_INSTRUCTION_LIMITS,
  type ProjectInstructionOptions,
  type ProjectInstructionEntry,
} from './project-instructions.js'
import {
  ExecutionPersistenceError,
  RecoveryRequiredError,
  interruptedResult,
  type ExecutionPersistence,
  type ExecutionRecovery,
  type ExecutionBoundary,
} from './execution-recovery.js'
import {
  formatArtifactTask,
  validateArtifactContract,
  type ArtifactContract,
} from './artifact-contract.js'
import { checkArtifacts, ArtifactCompletionError } from './artifact-completion.js'
import { INLINE_RESULT_BYTES, type ResultSource, type ResultStoreOptions } from './result-store.js'
import { resolvePhysicalPath } from './tools/path-guard.js'
import { readToolResultTool, ResultReadInputError } from './tools/read-tool-result.js'
import { ResultReadRecovery, EvidenceReadIncompleteError } from './result-read-recovery.js'
import { readHistoryTool } from './tools/read-history.js'
import { validateHistoryPaths } from './history-evidence.js'
import type { SessionSnapshot } from './session-snapshot.js'
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

function resultAwareTools(tools: Tool[] = allTools): Tool[] {
  const result = [...tools]
  for (const builtin of [readToolResultTool, readHistoryTool]) {
    const existing = result.find(tool => tool.name === builtin.name)
    if (existing && existing !== builtin) throw new Error(`${builtin.name} is a reserved host tool`)
    if (!existing) result.push(builtin)
  }
  return result
}

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
  budget?: RunBudget,
  completionSafety?: { safe: boolean },
  readRecovery?: ResultReadRecovery,
  execution?: {
    start(id: string): Promise<void>
    settled(result: Anthropic.ToolResultBlockParam): Promise<void>
    failure?: ExecutionPersistenceError
  },
  instructionGuard?: { check(): Promise<void>; failure?: Error }
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
    if (execution?.failure) {
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        is_error: true,
        content: interruptedResult('not-started'),
      })
      continue
    }
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
    let nativeFailed = false
    let nativeDenied = false
    let nativeStopped = false
    let metadataSettled = false
    let resultSource: ResultSource | undefined
    const tool = tools.find(t => t.name === block.name)
    try {
      budget?.consumeTool(block.name, block.input)
      consumed = true
      assertNotCancelled(ctx.signal)
      if (instructionGuard?.failure) throw instructionGuard.failure
      if (!tool) throw new Error(`Unknown tool: ${block.name}`)
      const input = structuredClone(block.input) as Record<string, unknown>
      const originatingRequestId = diagnostics?.latestModelRequestId
      const metadataObserver: ToolContext['onResultMetadata'] =
        diagnostics?.enabled || ctx.onResultMetadata || budget
          ? (metadata: ToolExecutionMetadata) => {
              if (!metadataSettled) {
                nativeDenied ||= metadata.terminalOutcome === 'declined'
                nativeStopped ||= ['cancelled', 'skipped', 'drain-timeout'].includes(
                  metadata.terminalOutcome
                )
                nativeFailed ||=
                  (metadata.exitCode !== undefined && metadata.exitCode !== 0) ||
                  metadata.signal !== undefined ||
                  ['cancelled', 'declined', 'skipped', 'drain-timeout'].includes(
                    metadata.terminalOutcome ?? ''
                  )
              }
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
      resultSource = {
        toolName: tool.name,
        toolCallId: block.id,
        paths: [
          ctx.cwd,
          ...(tool.permission?.effect === 'read'
            ? (tool.permission.paths ?? []).flatMap(key => {
                const value = input[key] ?? '.'
                return (Array.isArray(value) ? value : [value])
                  .filter((p): p is string => typeof p === 'string')
                  .map(p => resolvePhysicalPath(p, ctx.cwd))
              })
            : []),
        ].map(p => resolvePhysicalPath(p)),
      }
      const callCtx: ToolContext = Object.freeze({
        resultSource,
        ...ctx,
        ...(metadataObserver && { onResultMetadata: metadataObserver }),
      })
      const permissionInput = tool.readPaths
        ? { ...input, __result_paths: await tool.readPaths(input, callCtx) }
        : input
      const permissionTool = tool.readPaths
        ? { ...tool, permission: { effect: 'read' as const, paths: ['__result_paths'] } }
        : tool
      ctx.recordHistoryPaths?.([
        ...resultSource.paths,
        ...(tool.readPaths ? (permissionInput.__result_paths as string[]) : []),
      ])
      const initial = permissions.evaluate(permissionTool, permissionInput, callCtx)
      diagnostics?.permission('initial', block.id, block.name, initial.action)
      if (initial.action === 'ask') state('approval', { reason: initial.reason })
      assertNotCancelled(ctx.signal)
      const decision = await permissions.authorize(
        block.id,
        permissionTool,
        permissionInput,
        callCtx
      )
      diagnostics?.permission('resolved', block.id, block.name, decision.action)
      notifyObserver(() => events?.onPermission?.(block.id, { ...decision }))
      assertNotCancelled(ctx.signal)
      if (decision.action !== 'allow') {
        denied = true
        throw new Error(`Permission denied: ${decision.reason}`)
      }
      // Awaiting the host can change the filesystem. Check hard boundaries again.
      const boundary = permissions.checkWorkspace(permissionTool, permissionInput, callCtx)
      if (boundary?.action === 'deny') {
        diagnostics?.permission('boundary', block.id, block.name, 'deny')
        denied = true
        throw new Error(`Permission denied: ${boundary.reason}`)
      }
      if (instructionGuard?.failure) throw instructionGuard.failure
      state('running')
      notifyObserver(() => events?.onToolStart?.(block.name, structuredClone(input)))
      assertNotCancelled(ctx.signal)
      await execution?.start(block.id)
      assertNotCancelled(ctx.signal)
      start = Date.now()
      // Never race a tool against cancellation: it may finish a write despite ignoring signal.
      const execute = async (): Promise<string> => {
        assertNotCancelled(ctx.signal)
        if (instructionGuard) {
          try {
            if (instructionGuard.failure) throw instructionGuard.failure
            await instructionGuard.check()
          } catch (error) {
            instructionGuard.failure = new ProjectInstructionError(
              `This tool was not executed: ${describeToolError(error)}`
            )
            throw instructionGuard.failure
          }
        }
        assertNotCancelled(ctx.signal)
        return tool.execute(input, callCtx)
      }
      let output =
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
      metadataSettled = true
      const cancelled =
        block.name === 'terminal' &&
        /^(?:Note: could not load your shell profile; PATH may be incomplete\.\n)?Status: (?:human-controlled )?cancelled(?: by user|\n|$)/.test(
          output
        )
      let failed = output.startsWith('Error:') || cancelled || nativeFailed
      if (!failed && tool === readToolResultTool) {
        const pending = readRecovery?.unresolved
        readRecovery?.succeeded(input, output)
        if (pending && !readRecovery?.unresolved)
          emitter?.emit({ type: 'evidence-read', status: 'resolved' })
      }
      if (
        ctx.results &&
        tool !== readToolResultTool &&
        Buffer.byteLength(output) > INLINE_RESULT_BYTES
      ) {
        try {
          output = ctx.results.receipt(await ctx.results.save(output, resultSource))
        } catch (error) {
          // The tool already settled. Preserve that fact and never suggest replaying side effects.
          output = `Error: Tool execution settled (original result ${failed ? 'failed' : 'completed'}), but output storage failed: ${describeToolError(error)}. Do not re-run the tool automatically.`
          failed = true
        }
      }
      state(cancelled ? 'cancelled' : nativeDenied ? 'denied' : failed ? 'error' : 'completed', {
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
        ...(failed && { is_error: true }),
      })
      if (
        completionSafety &&
        (nativeDenied || nativeStopped || (failed && tool.permission?.effect !== 'read'))
      )
        completionSafety.safe = false
      budget?.settleTool(block.name, block.input, failed, nativeDenied)
    } catch (error) {
      if (error instanceof ExecutionPersistenceError && execution) execution.failure = error
      metadataSettled = true
      if (tool === readToolResultTool && error instanceof ResultReadInputError) {
        readRecovery?.failed(block.input)
        emitter?.emit({ type: 'evidence-read', status: 'invalid-input' })
      }
      if (
        completionSafety &&
        (denied ||
          nativeDenied ||
          nativeStopped ||
          error instanceof TurnCancelledError ||
          tool?.permission?.effect !== 'read')
      )
        completionSafety.safe = false
      const limited =
        error instanceof RunBudgetError || ctx.signal?.reason instanceof RunBudgetError
      const cancelled = !limited && (ctx.signal?.aborted || error instanceof TurnCancelledError)
      let errorMessage =
        limited && start === undefined
          ? `Error: Run stopped before this tool started; it was not executed (${(ctx.signal?.reason as RunBudgetError | undefined)?.limitReason ?? (error as RunBudgetError).limitReason}).`
          : cancelled
            ? start === undefined
              ? 'Error: Turn cancelled before this tool started; it was not executed.'
              : 'Error: Turn cancelled. This tool did not complete; any side effects were not rolled back.'
            : `Error: ${describeToolError(error)}`
      if (ctx.results && Buffer.byteLength(errorMessage) > INLINE_RESULT_BYTES) {
        try {
          errorMessage = ctx.results.receipt(
            await ctx.results.save(
              errorMessage,
              resultSource ?? {
                toolName: block.name,
                toolCallId: block.id,
                paths: [ctx.cwd],
              }
            )
          )
        } catch (storageError) {
          errorMessage = `Error: Tool failed; its full error could not be stored: ${describeToolError(storageError)}. Any side effects were not rolled back; do not re-run automatically.`
        }
      }
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
    if (execution && !execution.failure) {
      try {
        await execution.settled(results[results.length - 1])
      } catch {
        execution.failure = new ExecutionPersistenceError()
      }
    }
  }
  return results
}

export interface RunLoopOptions {
  projectInstructions?: ProjectInstructionOptions | false
  /** @internal Shared volatile state owned by Agent. */
  instructionController?: ProjectInstructions
  executionPersistence?: ExecutionPersistence
  recovery?: ExecutionRecovery
  artifactContract?: ArtifactContract
  results?: ResultStoreOptions
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
  if (options.session?.recovery && !options.recovery) throw new RecoveryRequiredError()
  if (options.artifactContract !== undefined) {
    const artifactContract = validateArtifactContract(options.artifactContract)
    options = { ...options, artifactContract }
    userMessage = formatArtifactTask(userMessage, artifactContract)
  }
  const budget = new RunBudget(options.limits, options.signal)
  const detachedHistory = !options.instructionController && !!options.session?.getHistory().length
  options = {
    ...options,
    signal: budget.signal,
    instructionController:
      options.instructionController ??
      new ProjectInstructions(options.cwd ?? process.cwd(), options.projectInstructions),
  }
  options.instructionController!.reset(detachedHistory ? 'restored' : 'current')
  const session = options.session ?? new Session(options.results)
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
      try {
        return await runTurnLoop(
          messages,
          { ...options, session },
          emitter,
          diagnostics,
          budget,
          executor
        )
      } catch (error) {
        // Context preparation can wrap a budget stop. Restore it before Session saves history.
        if (budget.signal.reason instanceof RunBudgetError) throw budget.signal.reason
        throw error
      }
    })
    emitter.emit({ type: 'turn-end', status: 'completed' })
    diagnostics.end('completed', 'turn')
    return result
  } catch (caught) {
    const error = options.signal?.reason instanceof RunBudgetError ? options.signal.reason : caught
    if (!options.recovery && !(error instanceof ExecutionPersistenceError))
      session.recovery = undefined
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
    results: session.getResultStore(options.cwd ?? process.cwd()),
    tools: resultAwareTools(options.tools),
    cwd: options.cwd ?? process.cwd(),
    client,
    budget,
    diagnostics,
    executor,
    request: messages => {
      const request = structuredClone({
        model,
        max_tokens: budget.outputTokens,
        messages,
        tools: resultAwareTools(options.tools).map(toAnthropicTool),
        ...(options.systemPrompt && { system: options.systemPrompt }),
      })
      return options.instructionController?.overlay(request) ?? request
    },
    summarize: createContextSummarizer(client, model, budget, diagnostics, executor),
    onCompaction: options.events?.onCompaction,
  }
}

function isContextOverflow(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const status = (error as { status?: number }).status
  if (status !== undefined && status !== 400 && status !== 413) return false
  if (status === undefined && error instanceof Anthropic.APIError) {
    const body = error.error as { type?: string; error?: { type?: string } } | undefined
    const type = body?.error?.type ?? body?.type
    if (type && !['invalid_request_error', 'request_too_large'].includes(type)) return false
  }
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
  const { events, cwd } = options
  const tools = resultAwareTools(options.tools)
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
  let completionFeedback: string | undefined = options.recovery?.artifactFeedback
  // Rechecking is read-only; a consumed repair opportunity is never replenished.
  let completionAttempt = Math.min(options.recovery?.artifactAttempts ?? 0, 1)
  // Explicit continuation is a new turn: past effects remain evidence, new calls are reauthorized.
  const completionSafety = { safe: true }
  const readRecovery = new ResultReadRecovery(options.recovery?.read)
  const originalRequest = runtime.request
  // Feedback is an ephemeral request overlay, included in context accounting but not user history.
  runtime.request = view => {
    const request = originalRequest(view)
    const feedback = [completionFeedback, readRecovery.feedback].filter(Boolean).join('\n')
    if (feedback) {
      const last = request.messages.at(-1)
      if (last?.role === 'user') {
        last.content = [
          ...(typeof last.content === 'string'
            ? [{ type: 'text' as const, text: last.content }]
            : last.content),
          { type: 'text', text: feedback },
        ]
      } else request.messages.push({ role: 'user', content: feedback })
    }
    return request
  }
  const permissions = options.permissionController ?? new PermissionController(options.permissions)
  const instructions = options.instructionController!
  let replans = 0
  let sentSources: ProjectInstructionEntry[] = []
  const ctx: ToolContext = {
    history: session.historyReader(() => messages, cwd ?? process.cwd()),
    recordHistoryPaths: paths => {
      session.assertHistoryCapacity()
      const combined = [...new Set([...batchHistoryPaths, ...paths])]
      validateHistoryPaths(combined)
      for (const p of combined) batchHistoryPaths.add(p)
    },
    results: session.getResultStore(cwd ?? process.cwd()),
    cwd: cwd ?? process.cwd(),
    ...(options.signal && { signal: options.signal }),
  }
  const batchHistoryPaths = new Set<string>()
  const tracked: ExecutionRecovery['tools'] = []
  const settled = new Map<string, Anthropic.ToolResultBlockParam>()
  let batchIndex = -1
  let persistenceBroken = false
  const enabled = !!options.executionPersistence || !!options.recovery
  const paired = (): Anthropic.MessageParam[] => {
    const copy = structuredClone(messages)
    const last = copy.at(-1)
    if (last?.role === 'assistant' && Array.isArray(last.content)) {
      const calls = last.content.filter(b => b.type === 'tool_use')
      if (calls.length)
        copy.push({
          role: 'user',
          content: calls.map(
            call =>
              settled.get(call.id) ?? {
                type: 'tool_result',
                tool_use_id: call.id,
                is_error: true,
                content: interruptedResult(
                  tracked.find(t => t.messageIndex === batchIndex && t.toolCallId === call.id)
                    ?.state === 'unknown'
                    ? 'unknown'
                    : 'not-started'
                ),
              }
          ),
        })
    }
    return copy
  }
  const capture = (reason: ExecutionRecovery['reason'] = 'interrupted'): SessionSnapshot => {
    const copy = paired()
    if (batchIndex >= 0 && copy[batchIndex + 1])
      session.recordHistorySource(copy, batchIndex + 1, [...batchHistoryPaths])
    const recovery: ExecutionRecovery = {
      version: 1,
      operationId: diagnostics.operationId,
      reason,
      tools: structuredClone(tracked),
      read: readRecovery.snapshot(),
      artifactAttempts: completionAttempt,
      ...(options.artifactContract && { artifactContract: options.artifactContract }),
      ...(completionFeedback && { artifactFeedback: completionFeedback }),
      safe: completionSafety.safe,
      budget: budget.evidence(),
      limits: budget.limits,
    }
    session.recovery = recovery
    return session.executionSnapshot(copy)
  }
  const persist = async (boundary: ExecutionBoundary): Promise<void> => {
    if (!enabled) return
    try {
      const snapshot = capture()
      await options.executionPersistence?.(snapshot, boundary)
    } catch {
      persistenceBroken = true
      throw new ExecutionPersistenceError()
    }
  }
  const execution = {
    failure: undefined as ExecutionPersistenceError | undefined,
    start: async (id: string): Promise<void> => {
      tracked.find(t => t.messageIndex === batchIndex && t.toolCallId === id)!.state = 'unknown'
      await persist('tool-start')
    },
    settled: async (result: Anthropic.ToolResultBlockParam): Promise<void> => {
      settled.set(result.tool_use_id, structuredClone(result))
      tracked.find(
        t => t.messageIndex === batchIndex && t.toolCallId === result.tool_use_id
      )!.state = 'settled'
      await persist('tool-settled')
    },
  }
  try {
    await persist('turn-start')
    while (true) {
      assertNotCancelled(options.signal)
      budget.consumeIteration()
      let response: Anthropic.Message
      for (let recovery = 0; ; recovery++) {
        emitter.emit({ type: 'phase', phase: 'preparing' })
        assertNotCancelled(options.signal)
        await instructions.refresh(permissions, options.signal)
        const request = await session.prepareRequest(messages, runtime)
        sentSources = instructions.view().entries
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
              instructions.markRequested()
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
                emitter.emit({ type: 'text-delta', text, requestId: attempt.span?.requestId })
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
        batchIndex = messages.length - 1
        batchHistoryPaths.clear()
        settled.clear()
        tracked.push(
          ...response.content
            .filter(b => b.type === 'tool_use')
            .map(b => ({
              messageIndex: batchIndex,
              toolCallId: b.id,
              toolName: b.name,
              state: 'not-started' as const,
            }))
        )
        await persist('response')
        emitter.emit({ type: 'phase', phase: 'tools' })
        let instructionFailure: Error | undefined
        let replan = false
        try {
          await instructions.prepareBatch(response.content, tools, permissions, options.signal)
          replan = instructions.requiresReplan(sentSources)
          if (replan && replans++ >= PROJECT_INSTRUCTION_LIMITS.replans)
            throw new ProjectInstructionError(
              'replanning limit reached (3); this batch was not executed'
            )
        } catch (error) {
          instructionFailure =
            error instanceof Error ? error : new ProjectInstructionError('batch preflight failed')
        }
        const checkedInstructions = instructions.fingerprint
        const guard = {
          failure: undefined as Error | undefined,
          check: async (): Promise<void> => {
            await instructions.prepareBatch(response.content, tools, permissions, options.signal)
            if (checkedInstructions !== instructions.fingerprint)
              throw new ProjectInstructionError(
                'rules changed before execution; remaining tools were not executed. Review completed effects before continuing.'
              )
          },
        }
        let toolResults: Anthropic.ToolResultBlockParam[]
        if (replan || instructionFailure) {
          const reason = instructionFailure
            ? `Error: ${instructionFailure.message}. This batch was not executed.`
            : 'Project instructions changed or a new scope was discovered. This entire batch was not executed. Re-plan using the current project context before submitting new calls.'
          toolResults = []
          for (const call of response.content.filter(b => b.type === 'tool_use')) {
            try {
              budget.consumeTool(call.name, call.input)
            } catch (error) {
              instructionFailure ??= error as Error
            }
            const result: Anthropic.ToolResultBlockParam = {
              type: 'tool_result',
              tool_use_id: call.id,
              is_error: true,
              content: reason,
            }
            toolResults.push(result)
            emitter.emit({
              type: 'tool-state',
              toolCallId: call.id,
              toolName: call.name,
              status: 'error',
              reason,
              output: reason,
            })
            notifyObserver(() => events?.onToolError?.(call.name, reason))
            if (enabled && !execution.failure) {
              try {
                await execution.settled(result)
              } catch {
                execution.failure = new ExecutionPersistenceError()
              }
            }
          }
        } else {
          toolResults = await executeToolCalls(
            response.content,
            tools,
            ctx,
            events,
            permissions,
            emitter,
            diagnostics,
            options.fileMutations,
            options.diagnosticContext?.sessionId,
            budget,
            completionSafety,
            readRecovery,
            enabled ? execution : undefined,
            guard
          )
          instructionFailure = guard.failure
        }
        if (execution.failure) {
          for (const result of toolResults) {
            const item = tracked.find(
              t => t.messageIndex === batchIndex && t.toolCallId === result.tool_use_id
            )!
            if (result.content !== interruptedResult('not-started')) item.state = 'settled'
          }
        }
        messages.push({ role: 'user', content: toolResults })
        session.recordHistorySource(messages, messages.length - 1, [...batchHistoryPaths])
        if (execution.failure) throw execution.failure
        if (instructionFailure) throw instructionFailure
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
      if (readRecovery.unresolved) {
        try {
          if (response.stop_reason !== 'end_turn' || calls.length || !completionSafety.safe)
            throw new EvidenceReadIncompleteError()
          readRecovery.requestCorrection()
        } catch (error) {
          emitter.emit({ type: 'evidence-read', status: 'blocked' })
          throw error
        }
        await persist('response')
        emitter.emit({ type: 'evidence-read', status: 'correcting' })
        emitter.emit({
          type: 'notice',
          text: '[Harness] Correcting an unresolved saved-evidence read within the current budget.',
        })
        continue
      }
      if (options.artifactContract) {
        const contract = options.artifactContract
        const attempt = ++completionAttempt
        try {
          if (response.stop_reason !== 'end_turn' || calls.length)
            throw new ArtifactCompletionError('incomplete-response')
          if (!completionSafety.safe) throw new ArtifactCompletionError('unsafe-effects')
          emitter.emit({
            type: 'artifact-check',
            status: 'started',
            attempt,
            fileCount: contract.artifacts.length,
          })
          const issues = await checkArtifacts(
            contract,
            ctx,
            permissions,
            budget,
            diagnostics,
            attempt
          )
          budget.check()
          emitter.emit({
            type: 'artifact-check',
            status: issues.count ? 'failed' : 'passed',
            attempt,
            fileCount: contract.artifacts.length,
            issueCount: issues.count,
          })
          if (issues.count) {
            if (attempt >= 2) throw new ArtifactCompletionError('invalid-artifact')
            completionFeedback = issues.feedback()
            await persist('response')
            emitter.emit({
              type: 'artifact-check',
              status: 'repair',
              attempt,
              fileCount: contract.artifacts.length,
              issueCount: issues.count,
            })
            continue
          }
        } catch (error) {
          emitter.emit({
            type: 'artifact-check',
            status: 'blocked',
            attempt,
            fileCount: contract.artifacts.length,
            ...(error instanceof ArtifactCompletionError ? { artifactFailure: error.reason } : {}),
          })
          throw error
        }
      }
      session.recovery = undefined
      return text || notice || emptyNotice
    }
  } catch (error) {
    if (enabled) {
      const snapshot = capture(persistenceBroken ? 'storage-error' : 'stopped')
      messages.splice(0, messages.length, ...snapshot.messages)
      if (!persistenceBroken) {
        try {
          await options.executionPersistence?.(snapshot, 'turn-stopped')
        } catch {
          throw new ExecutionPersistenceError()
        }
      }
    }
    throw error
  }
}
