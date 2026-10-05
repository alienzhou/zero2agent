/**
 * Agent 类 - 封装 ReACT 循环的简化入口
 */
import { runLoop, createCompactionRuntime } from './loop.js'
import type { ContextOptions } from './context-budget.js'
import type { LoopEventHandlers } from './loop.js'
import type { Tool } from './tools/index.js'
import type { LLMConfig } from './llm/index.js'
import { resolve } from 'node:path'
import { PermissionController, type PermissionOptions } from './permissions.js'
import { Session } from './session.js'
import type Anthropic from '@anthropic-ai/sdk'

export interface AgentOptions {
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

  constructor(options: AgentOptions = {}) {
    this.permissions = new PermissionController(options.permissions)
    this.options = { ...options, cwd: resolve(options.cwd ?? process.cwd()) }
  }

  /**
   * 运行 Agent 处理用户消息
   */
  async run(message: string): Promise<string> {
    return runLoop(message, {
      config: this.options.config,
      context: this.options.context,
      tools: this.options.tools,
      systemPrompt: this.options.systemPrompt,
      events: this.options.events,
      cwd: this.options.cwd,
      session: this.session,
      permissionController: this.permissions,
    })
  }

  async compact(): Promise<boolean> {
    return this.session.compact(() => createCompactionRuntime(this.options, this.session))
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
    this.session.reset()
  }

  /** Inspect a detached snapshot, never the writable session history. */
  getHistory(): Anthropic.MessageParam[] {
    return this.session.getHistory()
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
