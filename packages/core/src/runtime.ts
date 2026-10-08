import type { CompactionEvent } from './context-manager.js'

/** Every event belongs to one turn; seq strictly increases within that turn. */
export type RuntimeEvent = { turnId: string; seq: number } & (
  | { type: 'turn-start' }
  | { type: 'phase'; phase: 'preparing' | 'requesting' | 'streaming' | 'tools' | 'cancelling' }
  | { type: 'text-delta'; text: string }
  | {
      type: 'request-abandoned'
      purpose: 'model' | 'summary' | 'count'
      requestId: string
      discardedChars: number
    }
  | {
      type: 'request-retry'
      purpose: 'model' | 'summary' | 'count'
      logicalRequestId: string
      requestId: string
      attempt: number
      delayMs: number
      discardedChars: number
      errorKind: string
    }
  | { type: 'notice'; text: string }
  | {
      type: 'tool-state'
      toolCallId: string
      toolName: string
      status: 'pending' | 'approval' | 'running' | 'completed' | 'denied' | 'error' | 'cancelled'
      input?: Record<string, unknown>
      output?: string
      durationMs?: number
      reason?: string
    }
  | { type: 'compaction'; event: CompactionEvent }
  | { type: 'turn-end'; status: 'completed' | 'cancelled' | 'error'; error?: string }
)

export type RequestNotice =
  | Omit<Extract<RuntimeEvent, { type: 'request-retry' }>, 'turnId' | 'seq'>
  | Omit<Extract<RuntimeEvent, { type: 'request-abandoned' }>, 'turnId' | 'seq'>

export class TurnCancelledError extends Error {
  constructor() {
    super('Turn cancelled. Completed tool results are retained; file changes were not rolled back.')
    this.name = 'TurnCancelledError'
  }
}

export type RunLimitReason =
  | 'iterations'
  | 'requests'
  | 'tools'
  | 'duration'
  | 'repeated-tool-failure'
  | 'repeated-denial'
  | 'retry-delay'

export class RunBudgetError extends Error {
  constructor(readonly limitReason: RunLimitReason) {
    super(
      `Run budget stopped: ${limitReason}. Completed results are retained; effects were not rolled back.`
    )
    this.name = 'RunBudgetError'
  }
}

/** Notification failures never become execution failures. */
export function notifyObserver(notify: () => unknown): void {
  try {
    void Promise.resolve(notify()).catch(() => {})
  } catch {
    /* The host owns presentation failures. */
  }
}

type EventData<T = RuntimeEvent> = T extends RuntimeEvent ? Omit<T, 'turnId' | 'seq'> : never

/** A scoped emitter stops accepting late callbacks after turn-end. */
export class RuntimeEmitter {
  private seq = 0
  private ended = false

  constructor(
    readonly turnId: string,
    private observer?: (event: RuntimeEvent) => void
  ) {}

  emit(event: EventData): void {
    if (this.ended) return
    const envelope = { ...event, turnId: this.turnId, seq: ++this.seq } as RuntimeEvent
    if (event.type === 'turn-end') this.ended = true
    notifyObserver(() => this.observer?.(structuredClone(envelope)))
  }
}

export function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    if (signal.reason instanceof RunBudgetError) throw signal.reason
    throw new TurnCancelledError()
  }
}

/** Only interrupt waits whose late completion cannot create an unrecorded side effect. */
export async function waitForAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  let abort: (() => void) | undefined
  try {
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new TurnCancelledError())
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    return await Promise.race([work, cancelled])
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
}
