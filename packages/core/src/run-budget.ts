import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { RunBudgetError, assertNotCancelled, type RunLimitReason } from './runtime.js'

export interface RunLimits {
  maxIterations?: number
  maxRequests?: number
  maxToolCalls?: number
  maxRepeatedFailures?: number
  maxDurationMs?: number
  requestTimeoutMs?: number
  maxRetries?: number
  retryBaseMs?: number
  maxRetryDelayMs?: number
}

export const DEFAULT_RUN_LIMITS: Required<RunLimits> = {
  maxIterations: 20,
  maxRequests: 100,
  maxToolCalls: 64,
  maxRepeatedFailures: 3,
  maxDurationMs: 600_000,
  requestTimeoutMs: 120_000,
  maxRetries: 2,
  retryBaseMs: 500,
  maxRetryDelayMs: 30_000,
}

export function validateRunLimits(options: RunLimits = {}): Required<RunLimits> {
  const result = { ...DEFAULT_RUN_LIMITS }
  for (const key of Object.keys(result) as Array<keyof RunLimits>) {
    const value = options[key] ?? result[key]
    const minimum = key === 'maxRetries' || key === 'retryBaseMs' ? 0 : 1
    const maximum = key.endsWith('Ms') ? 2_147_483_647 : key === 'maxRetries' ? 10 : 10_000
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`)
    result[key] = value
  }
  return result
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)])
    )
  return value
}

/** One operation owns a bounded set of counters; hashes never enter diagnostics or snapshots. */
export class RunBudget {
  readonly limits: Required<RunLimits>
  readonly signal: AbortSignal
  private controller = new AbortController()
  private expires: number
  private timer: ReturnType<typeof setTimeout>
  private requests = 0
  private iterations = 0
  private tools = 0
  private failures = new Map<string, number>()
  private denied = new Set<string>()

  constructor(options: RunLimits = {}, signal?: AbortSignal) {
    this.limits = validateRunLimits(options)
    this.signal = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal
    this.expires = performance.now() + this.limits.maxDurationMs
    this.timer = setTimeout(() => this.stop('duration'), this.limits.maxDurationMs)
    this.timer.unref()
  }

  stop(reason: RunLimitReason): RunBudgetError {
    if (!this.controller.signal.aborted) this.controller.abort(new RunBudgetError(reason))
    return this.controller.signal.reason as RunBudgetError
  }
  check(): void {
    if (performance.now() >= this.expires) this.stop('duration')
    assertNotCancelled(this.signal)
  }
  get remainingMs(): number {
    this.check()
    return Math.max(1, Math.ceil(this.expires - performance.now()))
  }
  consumeIteration(): void {
    this.check()
    if (this.iterations >= this.limits.maxIterations) throw this.stop('iterations')
    this.iterations++
  }
  consumeRequest(): void {
    this.check()
    if (this.requests >= this.limits.maxRequests) throw this.stop('requests')
    this.requests++
  }
  private signature(name: string, input: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify([name, canonical(input)]))
      .digest('hex')
  }
  consumeTool(name: string, input: unknown): void {
    this.check()
    if (this.tools >= this.limits.maxToolCalls) throw this.stop('tools')
    if (this.denied.has(this.signature(name, input))) throw this.stop('repeated-denial')
    this.tools++
  }
  settleTool(name: string, input: unknown, failed: boolean, denied: boolean): void {
    const key = this.signature(name, input)
    if (denied) this.denied.add(key)
    else if (failed) {
      const count = (this.failures.get(key) ?? 0) + 1
      this.failures.set(key, count)
      if (count >= this.limits.maxRepeatedFailures) this.stop('repeated-tool-failure')
    } else this.failures.delete(key)
  }
  close(): void {
    clearTimeout(this.timer)
  }
}
