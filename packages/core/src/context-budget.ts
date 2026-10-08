import type { DiagnosticEmitter } from './diagnostics.js'
import type Anthropic from '@anthropic-ai/sdk'
import type { RequestExecutor } from './request-executor.js'

export type ContextOptions = {
  contextWindow?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  safetyTokens?: number
  backgroundRatio?: number
  foregroundRatio?: number
  targetRatio?: number
  summaryTokens?: number
  timeoutMs?: number
  counting?: 'conservative' | 'provider'
}

export type ContextRequest = {
  model: string
  max_tokens: number
  messages: Anthropic.MessageParam[]
  tools?: Anthropic.Tool[]
  system?: string
}

export class ContextBudgetError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ContextBudgetError'
  }
}

function integer(name: string, value: number, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new ContextBudgetError(`${name} must be a finite integer >= ${minimum}`)
  }
  return value
}

function checkContent(content: Anthropic.MessageParam['content']): void {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (block.type === 'image' || block.type === 'document') {
      throw new ContextBudgetError(
        `Conservative counting does not support ${block.type} content; text-only summarization also excludes it`
      )
    }
    if (block.type === 'tool_result' && block.content) checkContent(block.content)
  }
}

/** One byte per token deliberately overestimates text instead of assuming English prose. */
export class ContextBudget {
  private limit: number
  private readonly backgroundRatio: number
  private readonly foregroundRatio: number
  private readonly targetRatio: number
  private readonly counting: 'conservative' | 'provider'
  public readonly outputTokens: number
  public readonly summaryTokens: number
  public readonly timeoutMs: number

  constructor(model: string, options: ContextOptions = {}) {
    const knownWindow = model === 'claude-sonnet-4-20250514' ? 200_000 : undefined
    if (options.contextWindow === undefined && knownWindow === undefined) {
      throw new ContextBudgetError(`Unknown model ${model}: provide contextWindow explicitly`)
    }
    const window = integer('contextWindow', options.contextWindow ?? knownWindow!)
    this.outputTokens = integer(
      'maxOutputTokens',
      options.maxOutputTokens ?? Math.min(4096, Math.floor(window / 8))
    )
    this.summaryTokens = integer(
      'summaryTokens',
      options.summaryTokens ?? Math.min(2048, Math.floor(window / 16)),
      128
    )
    const safety = integer(
      'safetyTokens',
      options.safetyTokens ?? Math.min(1024, Math.floor(window / 32)),
      0
    )
    const available = window - Math.max(this.outputTokens, this.summaryTokens) - safety
    this.limit = integer('maxInputTokens', options.maxInputTokens ?? available, 1024)
    if (this.limit > available) {
      throw new ContextBudgetError('Input, output and safety budgets exceed contextWindow')
    }
    this.targetRatio = options.targetRatio ?? 0.45
    this.backgroundRatio = options.backgroundRatio ?? 0.65
    this.foregroundRatio = options.foregroundRatio ?? 0.85
    if (
      ![this.targetRatio, this.backgroundRatio, this.foregroundRatio].every(Number.isFinite) ||
      !(
        0 < this.targetRatio &&
        this.targetRatio < this.backgroundRatio &&
        this.backgroundRatio < this.foregroundRatio &&
        this.foregroundRatio < 1
      )
    ) {
      throw new ContextBudgetError('Ratios must satisfy 0 < target < background < foreground < 1')
    }
    this.timeoutMs = integer('timeoutMs', options.timeoutMs ?? 30_000)
    if (this.timeoutMs > 2_147_483_647)
      throw new ContextBudgetError('timeoutMs exceeds the timer range')
    this.counting = options.counting ?? 'conservative'
    if (this.counting !== 'conservative' && this.counting !== 'provider') {
      throw new ContextBudgetError('counting must be conservative or provider')
    }
    this.checkCapacity(this.limit)
  }

  get inputLimit(): number {
    return this.limit
  }
  get backgroundLimit(): number {
    return Math.floor(this.limit * this.backgroundRatio)
  }
  get foregroundLimit(): number {
    return Math.floor(this.limit * this.foregroundRatio)
  }
  get targetLimit(): number {
    return Math.floor(this.limit * this.targetRatio)
  }

  private checkCapacity(limit: number): void {
    if (
      limit < 1024 ||
      Math.floor(limit * this.targetRatio) <= this.summaryTokens ||
      Math.floor(limit * this.targetRatio) >= Math.floor(limit * this.backgroundRatio) ||
      Math.floor(limit * this.backgroundRatio) >= Math.floor(limit * this.foregroundRatio)
    ) {
      throw new ContextBudgetError(
        'Context budget is too small for a useful summary and ordered thresholds'
      )
    }
  }

  estimate(request: ContextRequest): number {
    for (const message of request.messages) checkContent(message.content)
    // Include schemas, tool results, system text, escaping and envelope fields, not just text blocks.
    const serialized = JSON.stringify(request)
    const overhead = 256 + request.messages.length * 32 + (request.tools?.length ?? 0) * 64
    return integer('estimated input tokens', Buffer.byteLength(serialized, 'utf8') + overhead)
  }

  async count(
    request: ContextRequest,
    client: Anthropic,
    signal?: AbortSignal,
    diagnostics?: DiagnosticEmitter,
    executor?: RequestExecutor
  ): Promise<number> {
    signal?.throwIfAborted()
    if (this.counting === 'conservative') return this.estimate(request)
    const timed = AbortSignal.timeout(this.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timed]) : timed
    const { max_tokens: _output, ...input } = request
    const span = executor ? undefined : diagnostics?.request('count', request)
    try {
      const send = (signal: AbortSignal) =>
        client.messages.countTokens(input, {
          maxRetries: 0,
          timeout: this.timeoutMs,
          signal,
        })
      const result = executor
        ? await executor.run(
            'count',
            request,
            attempt => send(attempt.signal),
            combined,
            this.timeoutMs
          )
        : await send(combined)
      span?.complete(result)
      timed.throwIfAborted()
      combined.throwIfAborted()
      return integer('provider input_tokens', result.input_tokens, 0)
    } catch (error) {
      span?.fail(error, combined)
      timed.throwIfAborted()
      combined.throwIfAborted()
      throw new ContextBudgetError('Provider token counting failed; refusing an unsafe fallback', {
        cause: error,
      })
    }
  }

  tighten(): void {
    const next = Math.floor(this.limit * 0.8)
    // Validate before mutation: exhaustion is an error, never an invitation to disable checks.
    this.checkCapacity(next)
    this.limit = next
  }
}
