import { readFileTool } from './tools/read-file.js'
import { Hooks, type HookOptions, type HookView } from './hooks.js'
import { McpController, type McpOptions, type McpServerView } from './mcp/client.js'
import {
  ProjectInstructions,
  type ProjectInstructionOptions,
  type ProjectInstructionView,
} from './project-instructions.js'
import { Skills, hasSkillHistory, type SkillsOptions, type SkillView } from './skills.js'
import {
  RecoveryRequiredError,
  type ExecutionPersistence,
  type ExecutionRecovery,
} from './execution-recovery.js'
import type { ArtifactContract } from './artifact-contract.js'
import type { ResultStoreOptions } from './result-store.js'
import type { FileMutationHandler } from './file-mutations.js'
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
import { TurnCancelledError, RunBudgetError, RuntimeEmitter, notifyObserver } from './runtime.js'
import { RunBudget, validateRunLimits, type RunLimits } from './run-budget.js'
import { RequestExecutor } from './request-executor.js'
import { validateSessionSnapshot, type SessionSnapshot } from './session-snapshot.js'

export interface AgentOptions {
  hooks?: HookOptions | false
  mcp?: McpOptions | false
  skills?: SkillsOptions | false
  projectInstructions?: ProjectInstructionOptions | false
  executionPersistence?: ExecutionPersistence
  results?: ResultStoreOptions
  limits?: RunLimits
  fileMutations?: FileMutationHandler
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
  private session: Session
  private permissions: PermissionController
  private active?: AbortController
  private instructions: ProjectInstructions
  private skills: Skills
  private mcp: McpController
  private hooks: Hooks

  constructor(options: AgentOptions = {}) {
    this.hooks = new Hooks(resolve(options.cwd ?? process.cwd()), options.hooks)
    this.mcp = new McpController(options.cwd ?? process.cwd(), options.mcp)
    this.session = new Session(options.results)
    this.permissions = new PermissionController(options.permissions)
    this.instructions = new ProjectInstructions(
      options.cwd ?? process.cwd(),
      options.projectInstructions
    )
    this.skills = new Skills(options.cwd ?? process.cwd(), options.skills)
    this.options = {
      ...options,
      limits: validateRunLimits(options.limits),
      cwd: resolve(options.cwd ?? process.cwd()),
    }
  }

  /**
   * 运行 Agent 处理用户消息
   */
  async run(message: string, diagnosticContext?: DiagnosticContext): Promise<string> {
    if (this.session.recovery) throw new RecoveryRequiredError()
    return this.runInternal(message, undefined, diagnosticContext)
  }

  /** Explicit caller contract for this turn; not inherited by later turns or snapshots. */
  async runWithContract(
    message: string,
    contract: ArtifactContract,
    diagnosticContext?: DiagnosticContext
  ): Promise<string> {
    if (this.session.recovery) throw new RecoveryRequiredError()
    return this.runInternal(message, contract, diagnosticContext)
  }

  /** Explicit user continuation starts a new turn/budget, while retaining unfinished checks. */
  async continueInterrupted(
    message: string,
    diagnosticContext?: DiagnosticContext
  ): Promise<string> {
    const recovery = this.session.recovery
    if (!recovery) throw new Error('No interrupted task is awaiting recovery.')
    return this.runInternal(message, recovery.artifactContract, diagnosticContext, recovery)
  }

  setExecutionPersistence(persist?: ExecutionPersistence): void {
    if (this.active) throw new Error('Cannot change persistence while running.')
    this.options.executionPersistence = persist
  }

  private async runInternal(
    message: string,
    artifactContract: ArtifactContract | undefined,
    diagnosticContext?: DiagnosticContext,
    recovery?: ExecutionRecovery
  ): Promise<string> {
    const controller = this.beginOperation()
    try {
      return await runLoop(message, {
        hookController: this.hooks,
        mcpController: this.mcp,
        skillController: this.skills,
        instructionController: this.instructions,
        artifactContract,
        recovery,
        executionPersistence: this.options.executionPersistence,
        limits: this.options.limits,
        signal: controller.signal,
        fileMutations: this.options.fileMutations,
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
    if (this.session.recovery) throw new RecoveryRequiredError()
    const controller = this.beginOperation()
    const diagnostics = new DiagnosticEmitter(this.options.diagnostics, diagnosticContext)
    const budget = new RunBudget(this.options.limits, controller.signal)
    const executor = new RequestExecutor(
      budget,
      diagnostics,
      undefined,
      this.options.events?.onRequestNotice
    )
    diagnostics.start('compact')
    try {
      await this.instructions.refresh(this.permissions, budget.signal)
      await this.skills.refresh(this.permissions, budget.signal)
      const result = await this.session.compact(() =>
        createCompactionRuntime(
          {
            ...this.options,
            instructionController: this.instructions,
            skillController: this.skills,
            permissionController: this.permissions,
            events: {
              ...this.options.events,
              onCompaction: event => {
                diagnostics.compaction(event)
                this.options.events?.onCompaction?.(event)
              },
            },
          },
          this.session,
          diagnostics,
          executor
        )
      )
      if (controller.signal.aborted) throw new TurnCancelledError()
      diagnostics.end('completed', 'compact')
      return result
    } catch (caught) {
      const error = budget.signal.reason instanceof RunBudgetError ? budget.signal.reason : caught
      diagnostics.end(
        controller.signal.aborted ? 'cancelled' : 'error',
        'compact',
        error,
        budget.signal
      )
      if (controller.signal.aborted) throw new TurnCancelledError()
      throw error
    } finally {
      budget.close()
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

  get needsRecovery(): boolean {
    return !this.active && !!this.session.recovery
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
    this.instructions.reset('empty')
    this.skills.reset('empty')
  }

  /** Inspect a detached snapshot, never the writable session history. */
  getHistory(): Anthropic.MessageParam[] {
    return this.session.getHistory()
  }

  snapshot(): SessionSnapshot {
    if (this.active) throw new Error('Wait for the running operation before saving.')
    this.session.skills = this.skills.snapshotSelection()
    return this.session.snapshot()
  }

  restore(snapshot: unknown): void {
    if (this.active) throw new Error('Wait for the running operation before restoring.')
    const candidate = validateSessionSnapshot(snapshot)
    this.session.restore(candidate)
    this.instructions.reset('restored')
    this.skills.restoreSelection(candidate.skills, hasSkillHistory(candidate.messages))
    // Approval state is process-local and never inherited from a saved conversation.
    this.permissions.cancelPending()
    this.permissions = new PermissionController(this.options.permissions)
  }

  /** Metadata/body view of the most recent load; no I/O, model calls or approvals. */
  getProjectInstructions(): ProjectInstructionView {
    return this.instructions.view()
  }

  async refreshProjectInstructions(): Promise<ProjectInstructionView> {
    const controller = this.beginOperation()
    try {
      await this.instructions.refresh(this.permissions, controller.signal)
      return this.instructions.view()
    } finally {
      this.active = undefined
    }
  }

  setProjectInstructionsEnabled(enabled: boolean): void {
    if (this.active) throw new Error('Cannot change project instructions while running.')
    this.instructions.setEnabled(enabled)
  }

  /** Detached current catalogue and activation metadata; no disk or model work. */
  getSkills(): SkillView {
    return this.skills.view()
  }

  async refreshSkills(): Promise<SkillView> {
    const controller = this.beginOperation()
    try {
      await this.skills.refresh(this.permissions, controller.signal)
      return this.skills.view()
    } finally {
      this.session.skills = this.skills.snapshotSelection()
      this.active = undefined
    }
  }

  async activateSkill(selector: string): Promise<SkillView> {
    const controller = this.beginOperation()
    try {
      await this.skills.activate(selector, this.permissions, controller.signal)
      return this.skills.view()
    } finally {
      this.session.skills = this.skills.snapshotSelection()
      this.active = undefined
    }
  }

  deactivateSkill(selector: string): SkillView {
    if (this.active) throw new Error('Cannot change skills while running.')
    this.skills.deactivate(selector)
    this.session.skills = this.skills.snapshotSelection()
    return this.skills.view()
  }

  setSkillsEnabled(enabled: boolean): void {
    if (this.active) throw new Error('Cannot change skills while running.')
    this.skills.setEnabled(enabled)
    this.session.skills = this.skills.snapshotSelection()
  }

  async inspectHooks(): Promise<HookView[]> {
    const controller = this.beginOperation()
    try {
      controller.signal.throwIfAborted()
      return await this.hooks.inspect()
    } finally {
      this.active = undefined
    }
  }
  /** Explicit user review authorizes new checks; restoration/continuation never replays them. */
  async recheckHooks(note: string, diagnosticContext?: DiagnosticContext): Promise<void> {
    if (!note.trim() || note.length > 4096)
      throw new Error('Recheck requires an explicit review note of 1..4096 characters')
    const recovery = this.session.recovery
    if (!recovery?.hooks) throw new Error('No Hook recovery is pending')
    const controller = this.beginOperation()
    const budget = new RunBudget(this.options.limits, controller.signal)
    const diagnostics = new DiagnosticEmitter(this.options.diagnostics, diagnosticContext)
    const emitter = new RuntimeEmitter(diagnostics.operationId, event => {
      diagnostics.runtime(event)
      notifyObserver(() => this.options.events?.onEvent?.(event))
    })
    diagnostics.start('turn')
    emitter.emit({ type: 'turn-start' })
    try {
      await this.hooks.begin(recovery.hooks, true, file => {
        if (
          this.permissions.evaluate(readFileTool, { path: file }, { cwd: this.options.cwd! })
            .action !== 'allow'
        )
          throw new Error('Hook audit read not allowed')
      })
      const persist = async (
        boundary: import('./execution-recovery.js').ExecutionBoundary
      ): Promise<void> => {
        recovery.hooks = this.hooks.snapshot()!
        await this.options.executionPersistence?.(this.session.snapshot(), boundary)
      }
      this.session.recordControlNote(
        `User explicitly reviewed Hook effects and requested new checks: ${note}`
      )
      await this.hooks.recheck(
        persist,
        note,
        budget.signal,
        (check, status) =>
          emitter.emit({
            type: 'hook-check',
            hookId: check.hookId,
            checkId: check.checkId,
            stage: check.stage,
            status,
          }),
        recovery.artifactContract?.artifacts.map(a => a.path) ?? []
      )
      emitter.emit({ type: 'turn-end', status: 'completed' })
      diagnostics.end('completed', 'turn')
    } catch (error) {
      emitter.emit({
        type: 'turn-end',
        status: 'error',
        error: error instanceof Error ? error.message : 'Hook recheck failed',
      })
      diagnostics.end('error', 'turn', error, budget.signal)
      throw error
    } finally {
      recovery.hooks = this.hooks.snapshot() ?? recovery.hooks
      budget.close()
      this.active = undefined
    }
  }

  async inspectMcp(): Promise<McpServerView[]> {
    const controller = this.beginOperation()
    try {
      await this.mcp.open(controller.signal)
      return this.mcp.view()
    } finally {
      try {
        await this.mcp.close()
      } finally {
        this.active = undefined
      }
    }
  }

  getMcpServers(): McpServerView[] {
    return this.mcp.view()
  }

  /** Wait for native process cleanup; no serialized process or reconnect on restore. */
  async close(): Promise<void> {
    if (this.active) throw new Error('Wait for the running operation before closing.')
    await this.mcp.close()
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
      await agent.close()
    }
  }
}
