import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@zero2agent/core'
import { graphemes, safeText, textWidth, wrapText } from '../../packages/tui/dist/display-text.js'
import {
  appendEntry,
  initialState,
  MAX_ENTRIES,
  MAX_ENTRY_TEXT,
  reduceRuntime,
} from '../../packages/tui/dist/runtime-state.js'

describe('E03-S003: terminal projection and safe text cells', () => {
  it('updates a stable tool card by turn and call id, retaining its input and duration', () => {
    let state = reduceRuntime(initialState(), { type: 'turn-start', turnId: 'a', seq: 1 })
    state = reduceRuntime(state, {
      type: 'tool-state',
      turnId: 'a',
      seq: 2,
      toolCallId: 't',
      toolName: 'read_file',
      status: 'pending',
      input: { path: '测试.ts' },
      reason: 'Approval required',
    })
    state = reduceRuntime(state, {
      type: 'tool-state',
      turnId: 'a',
      seq: 3,
      toolCallId: 't',
      toolName: 'read_file',
      status: 'completed',
      durationMs: 20,
      output: 'hello',
    })
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({
      kind: 'tool',
      call: { status: 'completed', input: { path: '测试.ts' }, durationMs: 20 },
    })
    expect(state.phase).toBe('preparing')
    expect(state.entries[0].kind === 'tool' && state.entries[0].call.reason).toBeUndefined()
  })

  it('ignores old-turn and duplicate sequence events without corrupting the next turn', () => {
    let state = reduceRuntime(initialState(), { type: 'turn-start', turnId: 'a', seq: 1 })
    state = reduceRuntime(state, { type: 'turn-start', turnId: 'b', seq: 1 })
    const old: RuntimeEvent = { type: 'turn-end', turnId: 'a', seq: 5, status: 'error' }
    expect(reduceRuntime(state, old)).toBe(state)
    expect(reduceRuntime(state, { type: 'turn-start', turnId: 'a', seq: 1 })).toBe(state)
    state = reduceRuntime(state, { type: 'text-delta', turnId: 'b', seq: 2, text: 'fresh' })
    expect(
      reduceRuntime(state, { type: 'text-delta', turnId: 'b', seq: 2, text: 'duplicate' })
    ).toBe(state)
    state = reduceRuntime(state, { type: 'turn-end', turnId: 'b', seq: 3, status: 'completed' })
    expect(reduceRuntime(state, { type: 'text-delta', turnId: 'b', seq: 4, text: 'late' })).toBe(
      state
    )
  })

  it('caps retained history and shows that records have been removed', () => {
    let state = initialState()
    for (let i = 0; i < 150; i++)
      state = appendEntry(state, { kind: 'notice', text: `notice ${i}` })
    expect(state.entries.length).toBeLessThanOrEqual(MAX_ENTRIES)
    expect(state.discarded).toBeGreaterThan(0)
    state = reduceRuntime(state, { type: 'turn-start', turnId: 'a', seq: 1 })
    state = reduceRuntime(state, {
      type: 'text-delta',
      turnId: 'a',
      seq: 2,
      text: 'x'.repeat(1_000_000),
    })
    const last = state.entries.at(-1)
    expect(last?.kind).toBe('text')
    if (last?.kind === 'text') {
      expect(last.text.length).toBeLessThan(MAX_ENTRY_TEXT + 100)
      expect(last.text).toContain('显示历史已截短')
    }
  })

  it('renders escape, OSC, C1 and bidi controls as visible inert text', () => {
    const dirty = '\x1b[2J\x1b]52;c;secrets\x07\u009b31m\u202e.exe\r\b'
    const clean = safeText(dirty)
    expect(clean).not.toMatch(/[\x00-\x1f\x7f-\x9f\u202e]/)
    expect(clean).toContain('\\u001b[2J')
    expect(clean).toContain('\\u009b')
  })

  it('wraps Chinese, combining text, flags and joined emoji without splitting clusters', () => {
    expect(graphemes('中e\u0301👨‍👩‍👧‍👦🇨🇳')).toHaveLength(4)
    expect(textWidth('中e\u0301👨‍👩‍👧‍👦🇨🇳')).toBe(7)
    const lines = wrapText('中文e\u0301👨‍👩‍👧‍👦🇨🇳尾', 5)
    expect(lines.every(line => textWidth(line) <= 5)).toBe(true)
    expect(lines.join('')).toBe('中文e\u0301👨‍👩‍👧‍👦🇨🇳尾')
    expect(wrapText('中🙂', 1)).toEqual(['?', '?'])
  })
})
