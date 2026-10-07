import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type Anthropic from '@anthropic-ai/sdk'
import type { ContextRequest } from './context-budget.js'
import type { RuntimeEvent } from './runtime.js'
import { notifyObserver } from './runtime.js'

export interface DiagnosticContext {
  sessionId?: string
}
export type RequestPurpose = 'model' | 'summary' | 'count'
export type DiagnosticError =
  | 'cancelled'
  | 'timeout'
  | 'auth'
  | 'rate-limit'
  | 'context'
  | 'http'
  | 'network'
  | 'other'

/** Explicit metadata only. No prompts, tool arguments/results, headers or exception text. */
export interface DiagnosticEvent {
  operationId: string
  seq: number
  at: string
  kind: 'operation' | 'request' | 'tool' | 'permission' | 'phase' | 'compaction' | 'notice'
  event: string
  sessionId?: string
  operation?: 'turn' | 'compact'
  requestId?: string
  purpose?: RequestPurpose
  model?: string
  messageCount?: number
  toolCount?: number
  maxOutputTokens?: number
  durationMs?: number
  firstTextMs?: number
  textChars?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  stopReason?: string
  providerRequestId?: string
  errorKind?: DiagnosticError
  httpStatus?: number
  toolCallId?: string
  toolName?: string
  terminalOutcome?:
    | 'completed'
    | 'cancelled'
    | 'declined'
    | 'skipped'
    | 'drain-timeout'
    | 'background-completed'
  exitCode?: number
  pid?: number
  signal?: string
  inputFields?: number
  outputChars?: number
  action?: 'allow' | 'ask' | 'deny'
  trigger?: 'auto' | 'manual' | 'overflow'
  before?: number
  after?: number
}
export type DiagnosticObserver = (event: DiagnosticEvent) => void
type Details = Omit<
  Partial<DiagnosticEvent>,
  'operationId' | 'seq' | 'at' | 'kind' | 'event' | 'sessionId'
>

export function diagnosticLabel(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\w.:-]{1,128}$/.test(value) ? value : undefined
}
export function diagnosticNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(value))
    : undefined
}
export function diagnosticError(
  error: unknown,
  signal?: AbortSignal
): Pick<DiagnosticEvent, 'errorKind' | 'httpStatus'> {
  let status: number | undefined
  let name = ''
  let message = ''
  try {
    if (error && typeof error === 'object') {
      const candidate = error as { status?: unknown; name?: unknown; message?: unknown }
      status =
        typeof candidate.status === 'number' && candidate.status >= 100 && candidate.status <= 599
          ? candidate.status
          : undefined
      name = typeof candidate.name === 'string' ? candidate.name : ''
      message = typeof candidate.message === 'string' ? candidate.message.slice(0, 16384) : ''
    }
  } catch {
    /* An exception object is untrusted data, not part of logging control. */
  }
  const errorKind: DiagnosticError =
    signal?.aborted && signal.reason?.name !== 'TimeoutError'
      ? 'cancelled'
      : /timeout/i.test(name) || signal?.reason?.name === 'TimeoutError'
        ? 'timeout'
        : /abort|cancel/i.test(name)
          ? 'cancelled'
          : status === 401 || status === 403
            ? 'auth'
            : status === 429
              ? 'rate-limit'
              : /prompt is too long|context[_ ](?:length|overflow|window)|too many (?:input )?tokens/i.test(
                    message
                  )
                ? 'context'
                : status
                  ? 'http'
                  : /connection|network/i.test(name)
                    ? 'network'
                    : 'other'
  return { errorKind, ...(status === undefined ? {} : { httpStatus: status }) }
}

/** Captures identity once, so a late background summary keeps its original session/operation. */
export class DiagnosticEmitter {
  readonly operationId = randomUUID()
  private seq = 0
  private startedAt = performance.now()
  private ended = false
  private modelRequestId?: string
  get enabled(): boolean {
    return !!this.observer
  }
  get latestModelRequestId(): string | undefined {
    return this.modelRequestId
  }
  private readonly sessionId?: string
  constructor(
    private observer?: DiagnosticObserver,
    context: DiagnosticContext = {}
  ) {
    this.sessionId = diagnosticLabel(context.sessionId)
  }
  emit(kind: DiagnosticEvent['kind'], event: string, details: Details = {}): void {
    if (!this.observer) return
    const record: DiagnosticEvent = {
      ...details,
      kind,
      event,
      operationId: this.operationId,
      seq: ++this.seq,
      at: new Date().toISOString(),
      ...(this.sessionId && { sessionId: this.sessionId }),
    }
    notifyObserver(() => this.observer?.(structuredClone(record)))
  }
  start(operation: 'turn' | 'compact'): void {
    this.emit('operation', 'start', { operation })
  }
  end(
    event: 'completed' | 'cancelled' | 'error',
    operation: 'turn' | 'compact',
    error?: unknown,
    signal?: AbortSignal
  ): void {
    if (this.ended) return
    this.ended = true
    this.emit('operation', event, {
      operation,
      durationMs: Math.round(performance.now() - this.startedAt),
      ...(event === 'completed' ? {} : diagnosticError(error, signal)),
    })
  }
  permission(
    stage: string,
    toolCallId: string,
    toolName: string,
    action: 'allow' | 'ask' | 'deny'
  ): void {
    this.emit('permission', stage, {
      toolCallId: diagnosticLabel(toolCallId),
      toolName: diagnosticLabel(toolName),
      requestId: this.modelRequestId,
      action,
    })
  }
  runtime(event: RuntimeEvent): void {
    if (event.type === 'phase') this.emit('phase', event.phase)
    else if (event.type === 'tool-state')
      this.emit('tool', event.status, {
        toolCallId: diagnosticLabel(event.toolCallId),
        toolName: diagnosticLabel(event.toolName),
        requestId: this.modelRequestId,
        inputFields: event.input ? Object.keys(event.input).length : undefined,
        outputChars: event.output?.length,
        durationMs: diagnosticNumber(event.durationMs),
      })
    else if (event.type === 'compaction') this.compaction(event.event)
    else if (event.type === 'notice') this.emit('notice', 'shown')
  }
  compaction(event: {
    phase: string
    trigger: DiagnosticEvent['trigger']
    before?: number
    after?: number
  }): void {
    this.emit('compaction', event.phase, {
      trigger: event.trigger,
      before: diagnosticNumber(event.before),
      after: diagnosticNumber(event.after),
    })
  }
  request(purpose: RequestPurpose, request: ContextRequest): RequestSpan {
    const requestId = randomUUID()
    if (purpose === 'model') this.modelRequestId = requestId
    return new RequestSpan(this, requestId, purpose, request)
  }
}

export class RequestSpan {
  private startedAt = performance.now()
  private finished = false
  private textChars = 0
  private firstTextMs?: number
  constructor(
    private emitter: DiagnosticEmitter,
    readonly requestId: string,
    private purpose: RequestPurpose,
    request: ContextRequest
  ) {
    emitter.emit('request', 'start', {
      requestId,
      purpose,
      model: diagnosticLabel(request.model),
      messageCount: request.messages.length,
      toolCount: request.tools?.length ?? 0,
      maxOutputTokens: request.max_tokens,
    })
  }
  text(text: string): void {
    if (this.finished) return
    this.firstTextMs ??= Math.round(performance.now() - this.startedAt)
    this.textChars += text.length
  }
  complete(response: Anthropic.Message | { input_tokens: number }): void {
    if (this.finished) return
    this.finished = true
    const message = response as Anthropic.Message & { _request_id?: string }
    this.emitter.emit('request', 'completed', {
      requestId: this.requestId,
      purpose: this.purpose,
      durationMs: Math.round(performance.now() - this.startedAt),
      firstTextMs: this.firstTextMs,
      textChars: this.textChars,
      inputTokens: diagnosticNumber(
        message.usage?.input_tokens ?? (response as { input_tokens?: number }).input_tokens
      ),
      outputTokens: diagnosticNumber(message.usage?.output_tokens),
      cacheReadTokens: diagnosticNumber(message.usage?.cache_read_input_tokens),
      cacheWriteTokens: diagnosticNumber(message.usage?.cache_creation_input_tokens),
      stopReason: diagnosticLabel(message.stop_reason),
      providerRequestId: diagnosticLabel(message._request_id),
    })
  }
  fail(error: unknown, signal?: AbortSignal): void {
    if (this.finished) return
    this.finished = true
    const details = diagnosticError(error, signal)
    this.emitter.emit('request', details.errorKind === 'cancelled' ? 'cancelled' : 'error', {
      requestId: this.requestId,
      purpose: this.purpose,
      durationMs: Math.round(performance.now() - this.startedAt),
      firstTextMs: this.firstTextMs,
      textChars: this.textChars,
      ...details,
    })
  }
}
