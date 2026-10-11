import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { ContextRequest } from './context-budget.js'
import {
  diagnosticError,
  type DiagnosticEmitter,
  type RequestPurpose,
  type RequestSpan,
} from './diagnostics.js'
import { RunBudget } from './run-budget.js'
import { notifyObserver, type RuntimeEmitter, type RequestNotice } from './runtime.js'

export class RequestTimeoutError extends Error {
  constructor() {
    super('Request exceeded its response time budget.')
    this.name = 'RequestTimeoutError'
  }
}
export class IncompleteStreamError extends Error {
  constructor() {
    super('Model stream ended before message_stop; no response was committed.')
    this.name = 'IncompleteStreamError'
  }
}

/** Do not infer retryability from arbitrary provider text or elevate auth errors via a header. */
export function retryable(error: unknown): boolean {
  if (error instanceof RequestTimeoutError || error instanceof IncompleteStreamError) return true
  if (error instanceof Anthropic.APIUserAbortError) return false
  if (error instanceof Anthropic.APIError) {
    if (error.headers?.get('x-should-retry') === 'false') return false
    if (error.status !== undefined)
      return error.status === 408 || error.status === 429 || error.status >= 500
    const body = error.error as { type?: string; error?: { type?: string } } | undefined
    const type = body?.error?.type ?? body?.type
    if (type) return ['overloaded_error', 'api_error', 'rate_limit_error'].includes(type)
  }
  if (error instanceof Anthropic.APIConnectionError) return true
  let cause = error
  for (let depth = 0; depth < 5 && cause && typeof cause === 'object'; depth++) {
    const candidate = cause as { code?: string; cause?: unknown }
    if (
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EPIPE',
        'EAI_AGAIN',
        'UND_ERR_SOCKET',
        'UND_ERR_CONNECT_TIMEOUT',
      ].includes(candidate.code ?? '')
    )
      return true
    cause = candidate.cause
  }
  return false
}

export function retryAfterMs(error: unknown, now = Date.now()): number | undefined {
  if (!(error instanceof Anthropic.APIError)) return undefined
  const milliseconds = error.headers?.get('retry-after-ms')
  if (milliseconds && /^\d+(?:\.\d+)?$/.test(milliseconds)) return Number(milliseconds)
  const header = error.headers?.get('retry-after')
  if (!header) return undefined
  if (/^\d+(?:\.\d+)?$/.test(header)) return Number(header) * 1000
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}

export interface RequestAttempt {
  signal: AbortSignal
  timeoutMs: number
  span?: RequestSpan
}

/** A request may be reissued; a tool is never passed to this executor. */
export class RequestExecutor {
  constructor(
    readonly budget: RunBudget,
    private diagnostics?: DiagnosticEmitter,
    private emitter?: RuntimeEmitter,
    private onNotice?: (notice: RequestNotice) => void
  ) {}
  private notice(event: RequestNotice): void {
    if (this.emitter) this.emitter.emit(event)
    else notifyObserver(() => this.onNotice?.(event))
  }

  async run<T extends Anthropic.Message | { input_tokens: number }>(
    purpose: RequestPurpose,
    request: ContextRequest,
    send: (attempt: RequestAttempt) => Promise<T>,
    signal?: AbortSignal,
    timeoutMs = this.budget.limits.requestTimeoutMs
  ): Promise<T> {
    const logicalRequestId = randomUUID()
    for (let attempt = 1; ; attempt++) {
      this.budget.consumeRequest()
      const timeout = new AbortController()
      const ms = Math.min(timeoutMs, this.budget.limits.requestTimeoutMs, this.budget.remainingMs)
      const timer = setTimeout(() => timeout.abort(new RequestTimeoutError()), ms)
      const combined = AbortSignal.any([
        this.budget.signal,
        timeout.signal,
        ...(signal ? [signal] : []),
      ])
      const span = this.diagnostics?.request(purpose, request, { logicalRequestId, attempt })
      let aborted: (() => void) | undefined
      try {
        combined.throwIfAborted()
        if (purpose === 'model') this.emitter?.emit({ type: 'phase', phase: 'requesting' })
        const cancellation = new Promise<never>((_, reject) => {
          aborted = () => reject(combined.reason)
          combined.addEventListener('abort', aborted, { once: true })
          if (combined.aborted) aborted()
        })
        // Safe only for SDK transport work. Its signal also closes the actual connection.
        const response = await Promise.race([
          send({ signal: combined, timeoutMs: ms, span }),
          cancellation,
        ])
        combined.throwIfAborted()
        this.budget.check()
        span?.complete(response)
        return response
      } catch (caught) {
        const error = combined.aborted ? combined.reason : caught
        span?.fail(error, combined)
        if (purpose === 'model' && (span?.displayChars ?? 0) > 0)
          this.notice({
            type: 'request-abandoned',
            purpose,
            requestId: span?.requestId ?? logicalRequestId,
            discardedChars: span!.displayChars,
          })
        this.budget.check()
        signal?.throwIfAborted()
        if (!retryable(error) || attempt > this.budget.limits.maxRetries) throw error
        const serverDelay = retryAfterMs(error)
        const backoff = Math.min(
          this.budget.limits.maxRetryDelayMs,
          this.budget.limits.retryBaseMs * 2 ** (attempt - 1)
        )
        const delayMs = Math.ceil(serverDelay ?? backoff * (0.75 + Math.random() * 0.25))
        if (
          !Number.isFinite(delayMs) ||
          delayMs > this.budget.limits.maxRetryDelayMs ||
          delayMs >= this.budget.remainingMs
        )
          throw this.budget.stop('retry-delay')
        const details = diagnosticError(error, combined)
        span?.retry(delayMs, details.errorKind)
        this.notice({
          type: 'request-retry',
          purpose,
          logicalRequestId,
          requestId: span?.requestId ?? randomUUID(),
          attempt: attempt + 1,
          delayMs,
          discardedChars: span?.displayChars ?? 0,
          errorKind: details.errorKind!,
        })
        // End the expired attempt before waiting; later callbacks belong to that abandoned attempt.
        clearTimeout(timer)
        if (aborted) combined.removeEventListener('abort', aborted)
        const waiting = AbortSignal.any([this.budget.signal, ...(signal ? [signal] : [])])
        try {
          await delay(delayMs, undefined, { signal: waiting })
        } catch {
          waiting.throwIfAborted()
          throw error
        }
      } finally {
        clearTimeout(timer)
        if (aborted) combined.removeEventListener('abort', aborted)
      }
    }
  }
}
