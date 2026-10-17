import { validateHookSnapshot, type HookSnapshot } from './hooks.js'
import type Anthropic from '@anthropic-ai/sdk'
import { validateArtifactContract, type ArtifactContract } from './artifact-contract.js'
import { validateReadRecovery, type ReadRecoveryState } from './result-read-recovery.js'
import { validateRunLimits, type RunLimits } from './run-budget.js'
import type { SessionSnapshot } from './session-snapshot.js'

export type ExecutionBoundary =
  | 'turn-start'
  | 'response'
  | 'tool-start'
  | 'tool-settled'
  | 'turn-stopped'
  | 'hook-start'
  | 'hook-settled'
export interface RecoveryTool {
  messageIndex: number
  toolCallId: string
  toolName: string
  state: 'not-started' | 'unknown' | 'settled'
}
export interface ExecutionRecovery {
  version: 1 | 2
  hooks?: HookSnapshot
  operationId: string
  reason: 'interrupted' | 'storage-error' | 'stopped'
  tools: RecoveryTool[]
  read: ReadRecoveryState
  artifactContract?: ArtifactContract
  artifactAttempts: number
  artifactFeedback?: string
  safe: boolean
  budget: { iterations: number; requests: number; tools: number; stopReason?: string }
  limits: RunLimits
}
/** Awaited, fail-closed control. A host must publish the complete snapshot before resolving. */
export type ExecutionPersistence = (
  snapshot: SessionSnapshot,
  boundary: ExecutionBoundary
) => Promise<void>

export class ExecutionPersistenceError extends Error {
  constructor() {
    super(
      'Execution progress could not be saved. No further work was started; effects may already exist. Inspect recovery before continuing.'
    )
    this.name = 'ExecutionPersistenceError'
  }
}
export class RecoveryRequiredError extends Error {
  constructor() {
    super(
      'Interrupted task requires review. Use /recovery, then /recovery continue <instruction>, or --resume-task <instruction>. This starts a new budget; old calls are never replayed.'
    )
    this.name = 'RecoveryRequiredError'
  }
}
export function interruptedResult(state: 'not-started' | 'unknown'): string {
  return state === 'not-started'
    ? '[Harness recovery] This call was not executed. This is an interruption record, not a tool receipt.'
    : '[Harness recovery] Execution may have started; the outcome is unknown. Inspect effects before continuing. Do not replay this call. This is not a tool receipt.'
}

export function validateExecutionRecovery(
  value: unknown,
  messages: Anthropic.MessageParam[]
): ExecutionRecovery {
  const r = value as ExecutionRecovery
  const fail = (): never => {
    throw new Error('Invalid execution recovery state.')
  }
  if (
    !r ||
    ![1, 2].includes(r.version) ||
    (r.hooks !== undefined && r.version !== 2) ||
    (r.version === 2 && r.hooks === undefined) ||
    typeof r.operationId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(r.operationId) ||
    !['interrupted', 'storage-error', 'stopped'].includes(r.reason) ||
    !Array.isArray(r.tools) ||
    r.tools.length > 10000 ||
    typeof r.safe !== 'boolean' ||
    !Number.isInteger(r.artifactAttempts) ||
    r.artifactAttempts < 0 ||
    r.artifactAttempts > 2 ||
    (r.artifactFeedback !== undefined &&
      (typeof r.artifactFeedback !== 'string' || Buffer.byteLength(r.artifactFeedback) > 4096)) ||
    !r.budget ||
    !r.limits ||
    typeof r.limits !== 'object'
  )
    fail()
  const seen = new Set<string>()
  const tools = r.tools.map(t => {
    if (
      !t ||
      !Number.isSafeInteger(t.messageIndex) ||
      t.messageIndex < 0 ||
      typeof t.toolCallId !== 'string' ||
      typeof t.toolName !== 'string' ||
      !['not-started', 'unknown', 'settled'].includes(t.state)
    )
      fail()
    const key = `${t.messageIndex}:${t.toolCallId}`
    if (seen.has(key)) fail()
    seen.add(key)
    const message = messages[t.messageIndex]
    const result = messages[t.messageIndex + 1]
    if (
      message?.role !== 'assistant' ||
      !Array.isArray(message.content) ||
      !message.content.some(
        b => b.type === 'tool_use' && b.id === t.toolCallId && b.name === t.toolName
      ) ||
      result?.role !== 'user' ||
      !Array.isArray(result.content)
    )
      fail()
    const receipt = (result.content as Anthropic.ToolResultBlockParam[]).find(
      b => b.type === 'tool_result' && b.tool_use_id === t.toolCallId
    )
    if (
      !receipt ||
      (t.state !== 'settled' &&
        (!receipt.is_error || receipt.content !== interruptedResult(t.state)))
    )
      fail()
    return {
      messageIndex: t.messageIndex,
      toolCallId: t.toolCallId,
      toolName: t.toolName,
      state: t.state,
    }
  })
  for (const key of ['iterations', 'requests', 'tools'] as const)
    if (!Number.isSafeInteger(r.budget[key]) || r.budget[key] < 0 || r.budget[key] > 10000) fail()
  if (
    r.budget.stopReason !== undefined &&
    ![
      'duration',
      'iterations',
      'requests',
      'tools',
      'repeated-denial',
      'repeated-tool-failure',
    ].includes(r.budget.stopReason)
  )
    fail()
  return {
    version: r.version,
    ...(r.hooks === undefined ? {} : { hooks: validateHookSnapshot(r.hooks) }),
    operationId: r.operationId,
    reason: r.reason,
    tools,
    read: validateReadRecovery(r.read),
    safe: r.safe,
    artifactAttempts: r.artifactAttempts,
    ...(r.artifactContract === undefined
      ? {}
      : { artifactContract: validateArtifactContract(r.artifactContract) }),
    ...(r.artifactFeedback === undefined ? {} : { artifactFeedback: r.artifactFeedback }),
    budget: {
      iterations: r.budget.iterations,
      requests: r.budget.requests,
      tools: r.budget.tools,
      ...(r.budget.stopReason === undefined ? {} : { stopReason: r.budget.stopReason }),
    },
    limits: validateRunLimits(r.limits),
  }
}
