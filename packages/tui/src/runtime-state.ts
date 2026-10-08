import type { CompactionEvent, RuntimeEvent, RequestNotice } from '@zero2agent/core'

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
    ? (entry.call.output?.length ?? 0) +
        (entry.call.reason?.length ?? 0) +
        entry.call.toolName.length +
        entry.call.toolCallId.length +
        JSON.stringify(entry.call.input ?? {}).length
    : entry.text.length
}

export function appendEntry(state: RuntimeState, entry: TimelineEntry): RuntimeState {
  return trimState({ ...state, entries: [...state.entries, entry] })
}

function trimState(state: RuntimeState): RuntimeState {
  let size = state.entries.reduce((sum, entry) => sum + entrySize(entry), 0)
  while (
    state.entries.length > MAX_ENTRIES ||
    (size > MAX_HISTORY_TEXT && state.entries.length > 1)
  ) {
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

export function requestNoticeLabel(event: RequestNotice): string {
  if (event.type === 'request-abandoned')
    return '未完成草稿已结束，未写入正式会话；后续尝试将重新生成。'
  const purpose = { model: '模型', summary: '摘要', count: '计数' }[event.purpose]
  return `${purpose}请求失败 (${event.errorKind})，${event.delayMs}ms 后进行第 ${event.attempt} 次尝试；Ctrl-C 可取消等待。`
}

export function applyRequestNotice(state: RuntimeState, event: RequestNotice): RuntimeState {
  const entries = [...state.entries]
  if (event.type === 'request-abandoned' && event.discardedChars > 0) {
    const last = entries.at(-1)
    if (last?.kind === 'text')
      entries[entries.length - 1] = {
        kind: 'notice',
        text: bounded(`[未完成草稿 · 未写入会话]\n${last.text}`),
      }
  }
  return appendEntry({ ...state, entries }, { kind: 'notice', text: requestNoticeLabel(event) })
}

/** The renderer is a projection; stale turns and replayed events cannot overwrite new state. */
export function reduceRuntime(previous: RuntimeState, event: RuntimeEvent): RuntimeState {
  if (event.type === 'turn-start') {
    if (previous.turnId === event.turnId || previous.retiredTurnIds.includes(event.turnId))
      return previous
    const retiredTurnIds = previous.turnId
      ? [...previous.retiredTurnIds, previous.turnId].slice(-MAX_ENTRIES)
      : previous.retiredTurnIds
    return {
      ...previous,
      turnId: event.turnId,
      seq: event.seq,
      phase: 'preparing',
      startedAt: Date.now(),
      retiredTurnIds,
      finished: false,
    }
  }
  if (event.turnId !== previous.turnId || event.seq <= previous.seq || previous.finished)
    return previous
  const state = { ...previous, seq: event.seq, entries: [...previous.entries] }
  switch (event.type) {
    case 'phase':
      state.phase = event.phase
      break
    case 'text-delta': {
      const last = state.entries.at(-1)
      if (last?.kind === 'text')
        state.entries[state.entries.length - 1] = {
          kind: 'text',
          text: bounded(last.text.replace(TRUNCATED + '\n', '') + event.text),
        }
      else state.entries.push({ kind: 'text', text: bounded(event.text) })
      break
    }
    case 'notice':
      state.entries.push({ kind: 'notice', text: bounded(event.text) })
      break
    case 'request-retry':
    case 'request-abandoned':
      return applyRequestNotice(state, event)
    case 'tool-state': {
      const index = state.entries.findIndex(
        entry =>
          entry.kind === 'tool' &&
          entry.call.toolCallId === event.toolCallId &&
          entry.call.turnId === event.turnId
      )
      const old = state.entries[index]
      // Full approval input lives in the controller; the bounded timeline keeps only a preview.
      const call: ToolState = { ...(old?.kind === 'tool' ? old.call : {}), ...event }
      if (old?.kind === 'tool' && old.call.status !== event.status && event.reason === undefined)
        delete call.reason
      if (call.output) call.output = bounded(call.output)
      if (call.reason) call.reason = bounded(call.reason)
      if (call.input) {
        const encoded = JSON.stringify(call.input)
        if (encoded.length > MAX_ENTRY_TEXT)
          call.input = { preview: encoded.slice(0, MAX_ENTRY_TEXT), truncated: true }
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

/** Rebuild a bounded view from data. This does not emit events or execute historical calls. */
export function restoreTimeline(
  snapshot: import('@zero2agent/core').SessionSnapshot
): RuntimeState {
  let state = initialState()
  for (let i = 0; i < snapshot.messages.length; i++) {
    const message = snapshot.messages[i]
    if (typeof message.content === 'string') {
      state = appendEntry(state, {
        kind: message.role === 'user' ? 'user' : 'text',
        text: bounded(message.content),
      })
      continue
    }
    for (const block of message.content) {
      if (block.type === 'text')
        state = appendEntry(state, {
          kind: message.role === 'user' ? 'user' : 'text',
          text: bounded(block.text),
        })
      if (block.type !== 'tool_use') continue
      const next = snapshot.messages[i + 1]?.content
      const result = Array.isArray(next)
        ? next.find(b => b.type === 'tool_result' && b.tool_use_id === block.id)
        : undefined
      const encoded = JSON.stringify(block.input)
      const output =
        result?.type === 'tool_result'
          ? typeof result.content === 'string'
            ? result.content
            : JSON.stringify(result.content)
          : ''
      state = appendEntry(state, {
        kind: 'tool',
        call: {
          type: 'tool-state',
          turnId: `restored:${i}`,
          seq: 0,
          toolCallId: block.id,
          toolName: block.name,
          status: result?.type === 'tool_result' && result.is_error ? 'error' : 'completed',
          reason: '历史记录 · 未重新执行',
          input:
            encoded.length > MAX_ENTRY_TEXT
              ? { preview: encoded.slice(0, MAX_ENTRY_TEXT), truncated: true }
              : (block.input as Record<string, unknown>),
          output: bounded(output),
        },
      })
    }
  }
  return state
}
