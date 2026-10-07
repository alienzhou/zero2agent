import type { CompactionEvent, RuntimeEvent } from '@zero2agent/core'

export const MAX_ENTRIES = 100
export const MAX_ENTRY_TEXT = 12_000
export const MAX_HISTORY_TEXT = 120_000
const TRUNCATED = '\n[显示历史已截短；完整会话由 Agent 保存]'

export type ToolState = Extract<RuntimeEvent, { type: 'tool-state' }>
export type TimelineEntry =
  | { kind: 'user' | 'text' | 'notice'; text: string }
  | { kind: 'tool'; call: ToolState }
export interface RuntimeState {
  turnId?: string
  seq: number
  phase: string
  entries: TimelineEntry[]
  discarded: number
  startedAt?: number
  retiredTurnIds: string[]
  finished: boolean
}

export function initialState(): RuntimeState {
  return { seq: 0, phase: 'idle', entries: [], discarded: 0, retiredTurnIds: [], finished: false }
}

function bounded(text: string): string {
  return text.length > MAX_ENTRY_TEXT ? TRUNCATED + '\n' + text.slice(-MAX_ENTRY_TEXT) : text
}

function entrySize(entry: TimelineEntry): number {
  return entry.kind === 'tool'
    ? (entry.call.output?.length ?? 0) + JSON.stringify(entry.call.input ?? {}).length
    : entry.text.length
}

export function appendEntry(state: RuntimeState, entry: TimelineEntry): RuntimeState {
  return trimState({ ...state, entries: [...state.entries, entry] })
}

function trimState(state: RuntimeState): RuntimeState {
  let size = state.entries.reduce((sum, entry) => sum + entrySize(entry), 0)
  while (state.entries.length > MAX_ENTRIES || (size > MAX_HISTORY_TEXT && state.entries.length > 1)) {
    const removed = state.entries.shift()!
    size -= entrySize(removed)
    state.discarded++
  }
  return state
}

export function compactionLabel(event: CompactionEvent): string {
  return {
    pruned: '已缩短工具正文，完整结果保留为可回读文件。',
    background: '正在后台压缩历史，对话继续。',
    waiting: '上下文接近预算，正在等待后台压缩。',
    foreground: '正在压缩上下文，完成后继续。',
    completed: '上下文压缩完成。',
    failed: '压缩未完成，原始记录已保留；发送前仍会检查预算。',
  }[event.phase]
}

/** The renderer is a projection; stale turns and replayed events cannot overwrite new state. */
export function reduceRuntime(previous: RuntimeState, event: RuntimeEvent): RuntimeState {
  if (event.type === 'turn-start') {
    if (previous.turnId === event.turnId || previous.retiredTurnIds.includes(event.turnId)) return previous
    const retiredTurnIds = previous.turnId ? [...previous.retiredTurnIds, previous.turnId].slice(-MAX_ENTRIES) : previous.retiredTurnIds
    return { ...previous, turnId: event.turnId, seq: event.seq, phase: 'preparing', startedAt: Date.now(), retiredTurnIds, finished: false }
  }
  if (event.turnId !== previous.turnId || event.seq <= previous.seq || previous.finished) return previous
  let state = { ...previous, seq: event.seq, entries: [...previous.entries] }
  switch (event.type) {
    case 'phase':
      state.phase = event.phase
      break
    case 'text-delta': {
      const last = state.entries.at(-1)
      if (last?.kind === 'text') state.entries[state.entries.length - 1] = { kind: 'text', text: bounded(last.text.replace(TRUNCATED + '\n', '') + event.text) }
      else state.entries.push({ kind: 'text', text: bounded(event.text) })
      break
    }
    case 'notice':
      state.entries.push({ kind: 'notice', text: bounded(event.text) })
      break
    case 'tool-state': {
      const index = state.entries.findIndex(entry => entry.kind === 'tool' && entry.call.toolCallId === event.toolCallId && entry.call.turnId === event.turnId)
      const old = state.entries[index]
      // Full approval input lives in the controller; the bounded timeline keeps only a preview.
      const call: ToolState = { ...(old?.kind === 'tool' ? old.call : {}), ...event }
      if (call.output) call.output = bounded(call.output)
      if (call.input) {
        const encoded = JSON.stringify(call.input)
        if (encoded.length > MAX_ENTRY_TEXT) call.input = { preview: encoded.slice(0, MAX_ENTRY_TEXT), truncated: true }
      }
      const entry: TimelineEntry = { kind: 'tool', call }
      if (index < 0) state.entries.push(entry)
      else state.entries[index] = entry
      break
    }
    case 'compaction':
      state.entries.push({ kind: 'notice', text: compactionLabel(event.event) })
      break
    case 'turn-end':
      state.phase = event.status
      state.finished = true
      if (event.error) state.entries.push({ kind: 'notice', text: bounded(event.error) })
      break
  }
  return trimState(state)
}
