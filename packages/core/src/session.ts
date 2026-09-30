import type Anthropic from '@anthropic-ai/sdk'

const INTERRUPTED =
  '[Harness] This turn was interrupted. Completed tool results are retained; no file changes were rolled back. Re-check the workspace before continuing.'

/** One in-memory conversation. Resetting history never undoes tool side effects. */
export class Session {
  private messages: Anthropic.MessageParam[] = []
  private running = false

  getHistory(): Anthropic.MessageParam[] {
    return structuredClone(this.messages)
  }

  reset(): void {
    this.assertIdle()
    this.messages = []
  }

  /** @internal The loop appends only complete messages and matched tool results. */
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
      this.messages = messages
      this.running = false
    }
  }

  private assertIdle(): void {
    if (this.running)
      throw new Error('Session is already running. Wait before running or resetting.')
  }
}
