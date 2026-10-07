import type { CompactionEvent } from './context-manager.js'

/** Every event belongs to one turn; seq strictly increases within that turn. */
export type RuntimeEvent = { turnId: string; seq: number } & (
  | { type: 'turn-start' }
  | { type: 'phase'; phase: 'preparing' | 'requesting' | 'streaming' | 'tools' | 'cancelling' }
  | { type: 'text-delta'; text: string }
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

export class TurnCancelledError extends Error {
  constructor() {
    super('Turn cancelled. Completed tool results are retained; file changes were not rolled back.')
    this.name = 'TurnCancelledError'
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
  if (signal?.aborted) throw new TurnCancelledError()
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
