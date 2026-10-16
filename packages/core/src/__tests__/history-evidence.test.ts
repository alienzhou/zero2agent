import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  HistoryEvidence,
  historyIndex,
  historyReference,
  historyText,
  validateHistorySnapshot,
  validateHistoryPaths,
} from '../history-evidence.js'
import { readHistoryTool } from '../tools/read-history.js'
import { executeToolCalls } from '../loop.js'
import { PermissionController } from '../permissions.js'
import { Session } from '../session.js'
import { ContextManager, type CompactionRuntime } from '../context-manager.js'
import { ContextBudget } from '../context-budget.js'

type Message = Anthropic.MessageParam
const user = (content: string): Message => ({ role: 'user', content })
const assistant = (content: string): Message => ({ role: 'assistant', content })
const result = (content: string, is_error = false): Message => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: 'read-1', content, is_error }],
})

describe('source-backed history evidence', () => {
  it('keeps the current task next to recalled evidence without changing history or repeating effects', async () => {
    const manager = new ContextManager()
    manager.restore({ through: 2, summary: 'Old task waiting.', format: 'evidence-v1' })
    const task =
      'Write audit.json with exactly facts and sources; retry_count is numeric. Never deploy.'
    const messages: Message[] = [
      user('An earlier request.'),
      assistant('Earlier response.'),
      user(task),
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'read-1', name: 'read_history', input: {} }],
      },
      result('No original permission provenance', true),
    ]
    const original = structuredClone(messages)
    const budget = new ContextBudget('fixture', { contextWindow: 12000, maxOutputTokens: 512 })
    const request = await manager.prepare(messages, {
      budget,
      client: {} as Anthropic,
      request: view => ({ model: 'fixture', max_tokens: 512, messages: view }),
      summarize: async () => {
        throw new Error('Unexpected compaction')
      },
    })
    const content = request.messages.at(-1)!.content as Anthropic.ContentBlockParam[]
    expect(content[0]).toEqual((messages.at(-1)!.content as Anthropic.ContentBlockParam[])[0])
    expect(content.at(-1)).toMatchObject({ type: 'text', text: expect.stringContaining(task) })
    expect(JSON.stringify(content.at(-1))).toContain('Do not repeat completed or denied actions')
    expect(request.messages.at(-2)).toEqual(messages.at(-2))
    expect(budget.estimate(request)).toBeLessThanOrEqual(budget.inputLimit)
    expect(messages).toEqual(original)
    const second = manager.getContext(messages)
    expect(second).toEqual(request.messages)
    expect(manager.snapshot()).toMatchObject({ through: 2, summary: 'Old task waiting.' })
  })

  it('bounds task reminders and only adds them after complete recall-only batches in long contexts', () => {
    const manager = new ContextManager()
    const make = (task: Message, name = 'read_tool_result'): Message[] => [
      user('Original constraints'),
      assistant('inert '.repeat(4000)),
      task,
      { role: 'assistant', content: [{ type: 'tool_use', id: 'read-1', name, input: {} }] },
      result('Saved observation'),
    ]
    const textTask: Message = {
      role: 'user',
      content: [
        { type: 'text', text: 'Use exact fields.' },
        { type: 'text', text: 'No deployment.' },
      ],
    }
    const view = manager.getContext(make(textTask))
    const added = (view.at(-1)!.content as Anthropic.ContentBlockParam[]).at(-1)!
    expect(added).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Use exact fields.\nNo deployment.'),
    })
    expect(Buffer.byteLength(JSON.stringify(added))).toBeLessThanOrEqual(4096)
    const tooLarge = make(user('\u7532'.repeat(1500)))
    expect(manager.getContext(tooLarge).at(-1)).toEqual(tooLarge.at(-1))
    const effect = make(user('Write once'), 'write_file')
    expect(manager.getContext(effect).at(-1)).toEqual(effect.at(-1))
    const incomplete = make(user('Finish'))
    ;(incomplete.at(-2)!.content as Anthropic.ContentBlockParam[]).push({
      type: 'tool_use',
      id: 'read-2',
      name: 'read_history',
      input: {},
    })
    expect(manager.getContext(incomplete).at(-1)).toEqual(incomplete.at(-1))
    const short = make(user('Small task')).slice(2)
    expect(manager.getContext(short)).toEqual(short)
  })

  it('distinguishes an unavailable legacy reread from already visible evidence and saved-result references', () => {
    const messages = [result('O1: observed checksum failure')]
    const reader = new HistoryEvidence().access(() => messages, process.cwd())
    const reference = historyReference(messages[0], 0)
    expect(() => reader.paths({ reference })).toThrow(
      /visible observations remain historical evidence/
    )
    expect(() => reader.paths({ reference })).toThrow(/separate saved-result receipt reference/)
    expect(() => reader.read({ reference })).toThrow(/original permission provenance/)
  })

  it('separates the active request from historical waiting after restore without rewriting it or tool pairs', () => {
    const manager = new ContextManager()
    const originalRequest: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'Create audit.json now; exact key: retry_count.' }],
    }
    const messages: Message[] = [
      user('Wait until I request the audit; do not deploy.'),
      assistant('Waiting for the final request.'),
      originalRequest,
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'read-1', name: 'read_file', input: {} }],
      },
      result('Observed failure'),
    ]
    const before = structuredClone(messages)
    manager.restore({
      through: 2,
      summary: 'Pending: wait for the final audit request.',
      format: 'evidence-v1',
    })
    const view = manager.getContext(messages)
    expect(view[1].role).toBe('user')
    expect(view[1].content).toEqual([
      {
        type: 'text',
        text: '[Current request: follow its exact fields, values and actions. Historical waiting does not override it.]',
      },
      ...(originalRequest.content as Anthropic.TextBlockParam[]),
    ])
    expect(view.slice(-2)).toEqual(messages.slice(-2))
    expect(messages).toEqual(before)
    expect(manager.snapshot().summary).toContain('wait for the final audit')
    // Returning a view must not expose mutable aliases into the original request.
    ;(view[1].content as Anthropic.TextBlockParam[])[1].text = 'changed view'
    expect(messages).toEqual(before)
  })
  it('adds a bounded reminder next to the current task in a long raw view without adopting or mutating history', () => {
    const messages = [
      user('D1 port 8123'),
      user('D2 correction: port 9237'),
      assistant('old notes '.repeat(2000)),
      user('Write the current facts now'),
    ]
    const before = structuredClone(messages)
    const manager = new ContextManager()
    const view = manager.getContext(messages)
    expect(view.slice(0, -2)).toEqual(messages.slice(0, -1))
    expect(view.at(-1)).toEqual(
      user(
        `[Current request: follow its exact fields, values and actions. Historical waiting does not override it.]\n${messages.at(-1)!.content}`
      )
    )
    expect(view.at(-2)?.content).toContain('9237')
    expect(Buffer.byteLength(String(view.at(-2)?.content))).toBeLessThan(5000)
    expect(manager.snapshot()).toEqual({ through: 0, summary: '' })
    expect(messages).toEqual(before)
    expect(manager.getContext([user('short task')])).toEqual([user('short task')])
  })
  it('keeps chronological corrections and observed error flags while excluding assistant guesses and reasoning', () => {
    const messages: Message[] = [
      user('D1 port 8123'),
      assistant('Deployment completed!'),
      user('D2 port 9237; no deployment'),
      result('Test failed', true),
    ]
    const index = JSON.parse(historyIndex(messages, messages.length))
    expect(index.records.map((r: { message: number }) => r.message)).toEqual([0, 2, 3])
    expect(index.records[2]).toMatchObject({
      origin: 'tool_observation',
      results: [{ call: 'read-1', error: true }],
    })
    expect(JSON.stringify(index)).not.toContain('Deployment completed!')
    const text = historyText({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'private reasoning', signature: 'opaque' },
        { type: 'text', text: 'visible statement' },
      ],
    })
    expect(text).toContain('visible statement')
    expect(text).not.toContain('private reasoning')
  })

  it('bounds the index and marks omitted or partial sources instead of pretending all facts were retained', () => {
    const messages = Array.from({ length: 100 }, (_, i) => user(`record-${i}: ` + '中'.repeat(200)))
    const encoded = historyIndex(messages, messages.length)
    const index = JSON.parse(encoded)
    expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(4096)
    expect(index.omitted).toBeGreaterThan(0)
    expect(index.records.at(-1).message).toBe(99)
    expect(index.records.every((r: { partial: boolean }) => r.partial)).toBe(true)
  })

  it('recovers an older user correction by bounded search even after it falls outside the index', () => {
    const messages = [
      user('D1 keep public API fetchLedgerV2'),
      ...Array.from({ length: 90 }, () => user('Later unrelated discussion. '.repeat(30))),
    ]
    const reader = new HistoryEvidence().access(() => messages, process.cwd())
    const found = JSON.parse(reader.read({ query: 'fetchLedgerV2' }))
    expect(found.records).toHaveLength(1)
    expect(found.next_cursor).toBe(64)
    expect(found.eof).toBe(false)
    const exact = JSON.parse(reader.read({ reference: found.records[0].reference }))
    expect(exact.origin).toBe('user_statement')
    expect(exact.untrusted_text).toBe('D1 keep public API fetchLedgerV2')
  })

  it('does not advertise a continuation after EOF that leads into the reader own results', () => {
    const messages: Message[] = [user('Keep API ledgerV3 unchanged.'), assistant('Noted.')]
    const reader = new HistoryEvidence().access(() => messages, process.cwd())
    const first = JSON.parse(reader.read({ cursor: 0 }))
    expect(first.eof).toBe(true)
    expect(first.next_cursor).toBeNull()
    expect(first.note).toContain('Stop paging')
    // Reader calls can grow live history, but a completed listing must not invite another page.
    messages.push(
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'read-1', name: 'read_history', input: {} }],
      },
      result(JSON.stringify(first))
    )
    const empty = JSON.parse(reader.read({ cursor: messages.length }))
    expect(empty.records).toEqual([])
    expect(empty.next_cursor).toBeNull()
    const query = JSON.parse(reader.read({ query: 'ledgerV3' }))
    expect(query.records).toHaveLength(1)
    expect(query.next_cursor).toBeNull()
  })

  it('pages UTF-8 without splitting characters and rejects invalid ranges, stale or foreign references', () => {
    const text = '甲😀乙\n'.repeat(300)
    const messages = [user(text)]
    const reader = new HistoryEvidence().access(() => messages, process.cwd())
    const reference = historyReference(messages[0], 0)
    let offset = 0,
      rebuilt = ''
    do {
      const page = JSON.parse(reader.read({ reference, offset, limit: 17 }))
      expect(Buffer.byteLength(page.untrusted_text)).toBeLessThanOrEqual(17)
      rebuilt += page.untrusted_text
      offset = page.next_offset
      if (page.eof) break
    } while (offset < Buffer.byteLength(text))
    expect(rebuilt).toBe(text)
    for (const input of [{ offset: 1 }, { offset: -1 }, { limit: 4097 }, { limit: 3 }])
      expect(() => reader.read({ reference, ...input })).toThrow()
    messages[0] = user('different source')
    expect(() => reader.read({ reference })).toThrow(/changed|another history/)
    expect(() => reader.read({ reference: 'h99:0000000000000000' })).toThrow(/unknown/)
  })

  it('checks original tool permissions and refuses a legacy tool body without provenance', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'history-permissions-'))
    try {
      const cwd = path.join(root, 'workspace')
      const outside = path.join(root, 'outside.txt')
      const messages = [result('external evidence')]
      const evidence = new HistoryEvidence()
      const reference = historyReference(messages[0], 0)
      const reader = evidence.access(() => messages, cwd)
      expect(() => reader.paths({ reference })).toThrow(/provenance/)
      evidence.record(messages, 0, [outside])
      expect(reader.paths({ reference })).toContain(outside)
      const calls = [
        { type: 'tool_use', id: 'recall', name: 'read_history', input: { reference } },
      ] as Anthropic.ContentBlock[]
      const denied = await executeToolCalls(
        calls,
        [readHistoryTool],
        { cwd, history: reader },
        undefined,
        new PermissionController({ mode: 'read-only' })
      )
      expect(denied[0].is_error).toBe(true)
      expect(String(denied[0].content)).not.toContain('external evidence')
      expect(() => reader.read({ reference })).not.toThrow()
      // The direct host API is not the approval gate; executeToolCalls is the only model path.
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not let a model-supplied path override original permission provenance', async () => {
    const messages = [result('protected original')]
    const evidence = new HistoryEvidence()
    evidence.record(messages, 0, ['/outside-original'])
    const reader = evidence.access(() => messages, '/workspace')
    const calls = [
      {
        type: 'tool_use',
        id: 'recall',
        name: 'read_history',
        input: {
          reference: historyReference(messages[0], 0),
          __result_paths: ['/workspace'],
        },
      },
    ] as Anthropic.ContentBlock[]
    const recalled = await executeToolCalls(
      calls,
      [readHistoryTool],
      { cwd: '/workspace', history: reader },
      undefined,
      new PermissionController({ mode: 'read-only' })
    )
    expect(recalled[0].is_error).toBe(true)
    expect(String(recalled[0].content)).not.toContain('protected original')
  })

  it('validates source bindings before replacement and supports legacy snapshots', () => {
    const session = new Session()
    const messages: Message[] = [
      user('task'),
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'read-1', name: 'read_file', input: { path: 'a' } }],
      },
      result('original'),
    ]
    const evidence = new HistoryEvidence()
    evidence.record(messages, 2, ['/source'])
    const snapshot = {
      messages,
      context: { through: 3, summary: 'completed read', format: 'evidence-v1' },
      history: evidence.snapshot(),
    }
    session.restore(snapshot)
    expect(session.snapshot().history).toEqual(snapshot.history)
    const corrupt = structuredClone(snapshot)
    corrupt.messages[2] = result('tampered')
    expect(() => session.restore(corrupt)).toThrow(/does not match/)
    expect(session.getHistory()).toEqual(messages)
    expect(() =>
      session.restore({ ...snapshot, context: { ...snapshot.context, format: 'future' } })
    ).toThrow()
    session.restore({ messages, context: { through: 3, summary: 'legacy handoff' } })
    expect(session.snapshot().history).toBeUndefined()
    session.reset()
    expect(session.getHistory()).toEqual([])
  })

  it('bounds query scanning, record size and source catalogs, and honors cancellation', () => {
    const messages = [user('x'.repeat(2 * 1024 * 1024 + 1))]
    const reader = new HistoryEvidence().access(() => messages, '/workspace')
    expect(() => reader.read({ reference: historyReference(messages[0], 0) })).toThrow(/2 MiB/)
    expect(() => reader.read({ query: 'q'.repeat(257) })).toThrow(/query/)
    expect(() => reader.read({ cursor: -1 })).toThrow(/cursor/)
    expect(() => reader.read({ cursor: 2 })).toThrow(/cursor/)
    expect(() => reader.read({}, AbortSignal.abort(new Error('cancelled')))).toThrow('cancelled')
    expect(() => validateHistorySnapshot({ version: 2, sources: [] }, [])).toThrow(/version/)
    expect(() =>
      validateHistorySnapshot({ version: 1, sources: Array(2049).fill({}) }, [])
    ).toThrow(/size/)
  })

  it('lists bounded tool identities without disclosing bodies, preserving call/result identity', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'read-1', name: 'read_file', input: { path: '/outside' } },
        ],
      },
      result('protected text', true),
    ]
    const evidence = new HistoryEvidence()
    const reader = evidence.access(() => messages, '/workspace')
    const listed = JSON.parse(reader.read({}))
    expect(listed.records[0]).toMatchObject({
      origin: 'tool_observation',
      results: [{ call: 'read-1', tool: 'read_file', error: true }],
    })
    expect(JSON.stringify(listed)).not.toContain('protected text')
    expect(JSON.parse(reader.read({ query: 'protected' })).records).toHaveLength(0)
    expect(() => reader.read({ reference: historyReference(messages[0], 0) })).toThrow(/paired/)
    evidence.record(messages, 1, ['/outside'])
    const recalled = JSON.parse(reader.read({ reference: listed.records[0].reference }))
    expect(recalled.results).toEqual(listed.records[0].results)
    expect(recalled.untrusted_text).toContain('protected text')
    const many: Message = {
      role: 'user',
      content: Array.from({ length: 100 }, (_, i) => ({
        type: 'tool_result',
        tool_use_id: `long-${i}-` + 'x'.repeat(1000),
        content: 'body',
      })),
    }
    messages.push(many)
    const metadata = JSON.parse(reader.read({ cursor: 2 })).records[0]
    expect(metadata.results).toHaveLength(8)
    expect(metadata.results_omitted).toBe(92)
    expect(Buffer.byteLength(JSON.stringify(metadata))).toBeLessThan(2000)
  })

  it('rejects provenance overflow before starting a tool effect', async () => {
    const effect = { count: 0 }
    const tool = {
      name: 'effect',
      description: '',
      input_schema: { type: 'object' as const },
      permission: { effect: 'write' as const },
      execute: async () => {
        effect.count++
        return 'changed'
      },
    }
    const results = await executeToolCalls(
      [{ type: 'tool_use', id: 'effect', name: 'effect', input: {} }],
      [tool],
      {
        cwd: '/workspace',
        recordHistoryPaths: paths => {
          validateHistoryPaths([...Array.from({ length: 128 }, (_, i) => `/source-${i}`), ...paths])
        },
      },
      undefined,
      new PermissionController({ mode: 'bypass' })
    )
    expect(effect.count).toBe(0)
    expect(results[0].is_error).toBe(true)
    expect(String(results[0].content)).toContain('capacity')
    expect(() => validateHistoryPaths(['relative'])).toThrow(/format/)
  })

  it('reintroduces original corrections across multiple summaries and rejects fabricated host citations', async () => {
    const manager = new ContextManager()
    const budget = new ContextBudget('test', {
      contextWindow: 20000,
      maxOutputTokens: 512,
      summaryTokens: 128,
    })
    const inputs: Message[][] = []
    let output = 'Port was 8123; success is unverified.'
    const failures: string[] = []
    const runtime: CompactionRuntime = {
      budget,
      client: {} as Anthropic,
      request: messages => ({ model: 'test', max_tokens: 512, messages }),
      onCompaction: event => {
        if (event.failureReason) failures.push(event.failureReason)
      },
      summarize: async messages => {
        inputs.push(messages)
        return output
      },
    }
    const messages = [
      user('D1 port 8123'),
      assistant('x'.repeat(2000)),
      user('D2 port 9237; deployment forbidden'),
      assistant('y'.repeat(12000)),
      user('Continue'),
    ]
    try {
      expect(await manager.compact(messages, runtime)).toBe(true)
      expect(JSON.stringify(manager.getContext(messages))).toContain('9237')
      messages.push(assistant('z'.repeat(12000)), user('Proceed'))
      expect(await manager.compact(messages, runtime)).toBe(true)
      expect(JSON.stringify(inputs[1])).toContain('9237')
      const adopted = manager.snapshot()
      messages.push(assistant('z'.repeat(12000)), user('Continue'))
      output = 'Observed success: h0:0000000000000000'
      await expect(manager.compact(messages, runtime)).rejects.toThrow(/compression failed/)
      expect(manager.snapshot()).toEqual(adopted)
      expect(failures).toEqual(['invalid-history-reference'])
    } finally {
      manager.cancel()
    }
  })
})
