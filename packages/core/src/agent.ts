/**
 * Agent 类 - 封装 ReACT 循环的简化入口
 */
import {
  DiagnosticEmitter,
  type DiagnosticObserver,
  type DiagnosticContext,
} from './diagnostics.js'
import { runLoop, createCompactionRuntime } from './loop.js'
import type { ContextOptions } from './context-budget.js'
import type { LoopEventHandlers } from './loop.js'
import type { Tool } from './tools/index.js'
import type { LLMConfig } from './llm/index.js'
import { resolve } from 'node:path'
import { PermissionController, type PermissionOptions } from './permissions.js'
import { Session } from './session.js'
import type Anthropic from '@anthropic-ai/sdk'
import { TurnCancelledError } from './runtime.js'
import type { SessionSnapshot } from './session-snapshot.js'

export interface AgentOptions {
  diagnostics?: DiagnosticObserver
  config?: LLMConfig
  context?: ContextOptions
  permissions?: PermissionOptions
  tools?: Tool[]
  systemPrompt?: string
  events?: LoopEventHandlers
  /** Agent 工作目录，所有工具的相对路径基于此解析。默认 process.cwd() */
  cwd?: string
}

/**
 * 每个 Agent 持有一个 Session；每次 run 是一个 Turn，内部可循环调用模型和工具。
 */
export class Agent {
  private options: AgentOptions
  private session = new Session()
  private permissions: PermissionController
  private active?: AbortController

  constructor(options: AgentOptions = {}) {
    this.permissions = new PermissionController(options.permissions)
    this.options = { ...options, cwd: resolve(options.cwd ?? process.cwd()) }
  }

  /**
   * 运行 Agent 处理用户消息
   */
  async run(message: string, diagnosticContext?: DiagnosticContext): Promise<string> {
    const controller = this.beginOperation()
    try {
      return await runLoop(message, {
        signal: controller.signal,
        diagnostics: this.options.diagnostics,
        diagnosticContext,
        config: this.options.config,
        context: this.options.context,
        tools: this.options.tools,
        systemPrompt: this.options.systemPrompt,
        events: this.options.events,
        cwd: this.options.cwd,
        session: this.session,
        permissionController: this.permissions,
      })
    } finally {
      this.active = undefined
    }
  }

  async compact(diagnosticContext?: DiagnosticContext): Promise<boolean> {
    const controller = this.beginOperation()
    const diagnostics = new DiagnosticEmitter(this.options.diagnostics, diagnosticContext)
    diagnostics.start('compact')
    try {
      const result = await this.session.compact(() =>
        createCompactionRuntime(
          {
            ...this.options,
            events: {
              ...this.options.events,
              onCompaction: event => {
                diagnostics.compaction(event)
                this.options.events?.onCompaction?.(event)
              },
            },
          },
          this.session,
          diagnostics
        )
      )
      if (controller.signal.aborted) throw new TurnCancelledError()
      diagnostics.end('completed', 'compact')
      return result
    } catch (error) {
      diagnostics.end(
        controller.signal.aborted ? 'cancelled' : 'error',
        'compact',
        error,
        controller.signal
      )
      if (controller.signal.aborted) throw new TurnCancelledError()
      throw error
    } finally {
      this.active = undefined
    }
  }

  /** Stop the current operation; tools that ignore signal must settle before it releases. */
  cancelTurn(): boolean {
    if (!this.active) return false
    this.active.abort(new TurnCancelledError())
    this.permissions.cancelPending()
    this.session.cancelCompaction()
    return true
  }

  private beginOperation(): AbortController {
    if (this.active)
      throw new Error('Session is already running. Wait before running or resetting.')
    const controller = new AbortController()
    this.active = controller
    return controller
  }

  getContext(): Anthropic.MessageParam[] {
    return this.session.getContext()
  }

  cancelPendingApprovals(): void {
    this.permissions.cancelPending()
  }

  cancelCompaction(): void {
    this.session.cancelCompaction()
  }

  /** Start a new conversation without undoing files or stopping background processes. */
  reset(): void {
    if (this.active)
      throw new Error('Session is already running. Wait before running or resetting.')
    this.session.reset()
  }

  /** Inspect a detached snapshot, never the writable session history. */
  getHistory(): Anthropic.MessageParam[] {
    return this.session.getHistory()
  }

  snapshot(): SessionSnapshot {
    if (this.active) throw new Error('Wait for the running operation before saving.')
    return this.session.snapshot()
  }

  restore(snapshot: unknown): void {
    if (this.active) throw new Error('Wait for the running operation before restoring.')
    this.session.restore(snapshot)
    // Approval state is process-local and never inherited from a saved conversation.
    this.permissions.cancelPending()
    this.permissions = new PermissionController(this.options.permissions)
  }

  /**
   * 静态方法：每次创建独立 Session，快速运行一次。
   */
  static async run(message: string, options?: AgentOptions): Promise<string> {
    const agent = new Agent(options)
    try {
      return await agent.run(message)
    } finally {
      agent.cancelCompaction()
    }
  }
}
