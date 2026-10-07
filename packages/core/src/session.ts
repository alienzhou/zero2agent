import type Anthropic from '@anthropic-ai/sdk'
import { ContextManager, type CompactionRuntime } from './context-manager.js'
import { ContextBudget, type ContextOptions, type ContextRequest } from './context-budget.js'
import { validateSessionSnapshot, type SessionSnapshot } from './session-snapshot.js'

const INTERRUPTED =
  '[Harness] This turn was interrupted. Completed tool results are retained; no file changes were rolled back. Re-check the workspace before continuing.'

/** One in-memory conversation. Resetting history never undoes tool side effects. */
export class Session {
  private messages: Anthropic.MessageParam[] = []
  private running = false
  private context = new ContextManager()
  private budget?: ContextBudget
  private budgetKey = ''

  getContextBudget(model: string, options: ContextOptions = {}): ContextBudget {
    const key = JSON.stringify([model, options])
    if (!this.budget || this.budgetKey !== key) {
      this.context.cancel()
      this.budget = new ContextBudget(model, options)
      this.budgetKey = key
    }
    return this.budget
  }

  getContext(): Anthropic.MessageParam[] {
    return this.context.getContext(this.messages)
  }

  prepareRequest(
    messages: Anthropic.MessageParam[],
    runtime: CompactionRuntime
  ): Promise<ContextRequest> {
    return this.context.prepare(messages, runtime)
  }

  async compact(createRuntime: () => CompactionRuntime): Promise<boolean> {
    this.assertIdle()
    this.running = true
    try {
      return await this.context.compact(this.messages, createRuntime())
    } finally {
      this.running = false
    }
  }

  recoverContext(messages: Anthropic.MessageParam[], runtime: CompactionRuntime): Promise<boolean> {
    runtime.budget.tighten()
    return this.context.compact(messages, runtime, 'overflow')
  }

  cancelCompaction(): void {
    this.context.cancel()
  }

  /** Last committed snapshot; the running turn is not visible until it finishes. */
  getHistory(): Anthropic.MessageParam[] {
    return structuredClone(this.messages)
  }

  snapshot(): SessionSnapshot {
    this.assertIdle()
    return { messages: this.getHistory(), context: this.context.snapshot() }
  }

  restore(value: unknown): void {
    this.assertIdle()
    const snapshot = validateSessionSnapshot(value)
    this.context.restore(snapshot.context)
    this.messages = snapshot.messages
    this.budget = undefined
    this.budgetKey = ''
  }

  /** Reject while running: reset is neither cancellation nor rollback. */
  reset(): void {
    this.assertIdle()
    this.context.reset()
    this.budget = undefined
    this.messages = []
  }

  /**
   * @internal The executor, not Session, must maintain message/tool pairing.
   * Failures still commit recorded evidence plus a Harness notice, then rethrow.
   */
  async runTurn(
    message: string,
    execute: (messages: Anthropic.MessageParam[]) => Promise<string>
  ): Promise<string> {
    this.assertIdle()
    if (!message.trim()) throw new Error('User message must not be empty.')
    const messages = this.getHistory()
    messages.push({ role: 'user', content: message })
    this.running = true
    try {
      return await execute(messages)
    } catch (error) {
      // Keep completed tool evidence, but never inject raw transport errors into context.
      messages.push({ role: 'assistant', content: INTERRUPTED })
      throw error
    } finally {
      try {
        // Detach even from the loop's working copy before handing ownership back to the session.
        this.messages = structuredClone(messages)
      } finally {
        this.running = false
      }
    }
  }

  private assertIdle(): void {
    if (this.running)
      throw new Error('Session is already running. Wait before running or resetting.')
  }
}
