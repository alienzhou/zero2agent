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
