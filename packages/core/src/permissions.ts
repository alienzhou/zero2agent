import { randomUUID } from 'node:crypto'
import type { Tool, ToolContext } from './tools/types.js'
import { resolvePhysicalPath, isInsidePath } from './tools/path-guard.js'

export type PermissionAction = 'allow' | 'deny' | 'ask'
export type PermissionMode = 'default' | 'read-only' | 'accept-edits' | 'bypass'
export interface PermissionRule {
  tool: string
  action: PermissionAction
  /** Exact top-level scalar values, never shell prefixes or regexes. */
  input?: Record<string, string | number | boolean | null>
}
export interface PermissionDecision {
  action: PermissionAction
  reason: string
}
export interface ApprovalRequest {
  id: string
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  cwd: string
  reason: string
  signal: AbortSignal
}
export interface ApprovalResponse {
  requestId: string
  decision: 'allow' | 'deny'
  reason?: string
}
export interface PermissionOptions {
  mode?: PermissionMode
  rules?: PermissionRule[]
  requestApproval?: (request: ApprovalRequest) => Promise<ApprovalResponse>
  approvalTimeoutMs?: number
}
const modes: PermissionMode[] = ['default', 'read-only', 'accept-edits', 'bypass']
const actions: PermissionAction[] = ['allow', 'deny', 'ask']

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item)
    Object.freeze(value)
  }
  return value
}

/** A host-owned execution gate. No global state or persisted approvals. */
export class PermissionController {
  private mode: PermissionMode
  private rules: PermissionRule[]
  private handler?: PermissionOptions['requestApproval']
  private timeout: number
  private pending = new Set<AbortController>()

  constructor(options: PermissionOptions = {}) {
    this.mode = options.mode ?? 'default'
    if (!modes.includes(this.mode)) throw new Error('Invalid permission mode')
    this.timeout = options.approvalTimeoutMs ?? 120_000
    if (!Number.isFinite(this.timeout) || this.timeout <= 0 || this.timeout > 2_147_483_647) {
      throw new Error('approvalTimeoutMs must be a positive timer duration')
    }
    const rules = options.rules ?? []
    if (!Array.isArray(rules)) throw new Error('Permission rules must be an array')
    for (const rule of rules) {
      if (!rule || typeof rule.tool !== 'string' || !rule.tool || !actions.includes(rule.action)) {
        throw new Error('Invalid permission rule')
      }
      if (
        rule.input !== undefined &&
        (!rule.input ||
          Array.isArray(rule.input) ||
          typeof rule.input !== 'object' ||
          Object.values(rule.input).some(
            value => value !== null && !['string', 'number', 'boolean'].includes(typeof value)
          ) ||
          Object.values(rule.input).some(
            value => typeof value === 'number' && !Number.isFinite(value)
          ))
      )
        throw new Error('Rule input must contain finite top-level scalar values')
    }
    this.rules = freeze(structuredClone(rules))
    this.handler = options.requestApproval
    if (this.handler !== undefined && typeof this.handler !== 'function') {
      throw new Error('requestApproval must be a function')
    }
  }

  cancelPending(): void {
    for (const controller of this.pending) controller.abort('Approval cancelled')
  }

  /** Hard workspace restrictions cannot be overridden by approval or allow rules. */
  checkWorkspace(
    tool: Tool,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): PermissionDecision | null {
    const effect = tool.permission?.effect
    if (!tool.permission?.paths?.length) return null
    try {
      const root = resolvePhysicalPath(ctx.cwd)
      for (const key of tool.permission.paths) {
        const raw = input[key] ?? (effect === 'read' ? '.' : undefined)
        const paths = Array.isArray(raw) ? raw : [raw]
        for (const value of paths) {
          if (typeof value !== 'string' || !value)
            return { action: 'deny', reason: 'Invalid tool path' }
          const target = resolvePhysicalPath(value, ctx.cwd)
          if (!isInsidePath(root, target, effect === 'read')) {
            return effect === 'write'
              ? { action: 'deny', reason: 'Write target is outside the workspace or is its root' }
              : { action: 'ask', reason: 'Read target is outside the workspace' }
          }
        }
      }
      return null
    } catch {
      return { action: 'deny', reason: 'Cannot verify tool workspace path' }
    }
  }

  evaluate(tool: Tool, input: Record<string, unknown>, ctx: ToolContext): PermissionDecision {
    const boundary = this.checkWorkspace(tool, input, ctx)
    if (boundary?.action === 'deny') return boundary
    const effect = tool.permission?.effect
    if (this.mode === 'read-only' && (effect !== 'read' || boundary)) {
      return { action: 'deny', reason: 'Read-only mode permits only workspace reads' }
    }
    const matches = this.rules.filter(
      rule =>
        (rule.tool === '*' || rule.tool === tool.name) &&
        Object.entries(rule.input ?? {}).every(
          ([key, value]) => Object.hasOwn(input, key) && input[key] === value
        )
    )
    for (const action of ['deny', 'ask', 'allow'] as const) {
      if (matches.some(rule => rule.action === action))
        return { action, reason: `Explicit ${action} rule` }
    }
    if (this.mode === 'bypass') return { action: 'allow', reason: 'Host selected bypass mode' }
    if (boundary) return boundary
    if (effect === 'read' || (effect === 'write' && this.mode === 'accept-edits')) {
      return { action: 'allow', reason: 'Allowed by permission mode' }
    }
    return { action: 'ask', reason: `Approval required for ${effect ?? 'unknown'} tool` }
  }

  async authorize(
    toolCallId: string,
    tool: Tool,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<PermissionDecision> {
    const decision = this.evaluate(tool, input, ctx)
    if (decision.action !== 'ask') return decision
    if (!this.handler) return { action: 'deny', reason: 'Approval unavailable: no host handler' }
    const controller = new AbortController()
    this.pending.add(controller)
    const id = randomUUID()
    const request: ApprovalRequest = Object.freeze({
      id,
      toolCallId,
      toolName: tool.name,
      input: freeze(structuredClone(input)),
      cwd: ctx.cwd,
      reason: decision.reason,
      signal: controller.signal,
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: () => void = () => {}
    try {
      const aborted = new Promise<PermissionDecision>(resolve => {
        onAbort = () => resolve({ action: 'deny', reason: String(controller.signal.reason) })
        controller.signal.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(() => controller.abort('Approval timed out'), this.timeout)
      })
      const answer = Promise.resolve()
        .then(() => this.handler!(request))
        .then(
          response => {
            if (
              !response ||
              response.requestId !== id ||
              !['allow', 'deny'].includes(response.decision) ||
              (response.reason !== undefined && typeof response.reason !== 'string')
            ) {
              return { action: 'deny' as const, reason: 'Invalid or mismatched approval response' }
            }
            if (controller.signal.aborted)
              return { action: 'deny' as const, reason: 'Approval expired' }
            return {
              action: response.decision,
              reason: response.reason ?? `User ${response.decision}ed this call`,
            }
          },
          () => ({ action: 'deny' as const, reason: 'Approval host failed' })
        )
      return await Promise.race([aborted, answer])
    } finally {
      if (timer) clearTimeout(timer)
      controller.signal.removeEventListener('abort', onAbort)
      this.pending.delete(controller)
      controller.abort('Approval settled')
    }
  }
}
