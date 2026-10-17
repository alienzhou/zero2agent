import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { ResultStore, validateResultSnapshot } from '../result-store.js'
import { executeToolCalls } from '../loop.js'
import { readToolResultTool } from '../tools/read-tool-result.js'
import { terminalTool, OutputSink } from '../tools/terminal.js'
import { PermissionController } from '../permissions.js'
import { RunBudget } from '../run-budget.js'
import { Session } from '../session.js'
import { readFileTool } from '../tools/read-file.js'
import type { Tool } from '../tools/types.js'

const directories: string[] = []
afterEach(async () => {
  for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})
async function fixture(options: ConstructorParameters<typeof ResultStore>[0] = {}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'z2a-results-')))
  directories.push(dir)
  const root = path.join(dir, 'results')
  const store = new ResultStore({ directory: root, ...options })
  store.setWorkspace(dir)
  const source = { toolName: 'probe', toolCallId: 'one', paths: [dir] }
  const bodyPath = (sha: string) =>
    path.join(
      root,
      createHash('sha256').update(dir).digest('hex'),
      store.snapshot()!.scope,
      `${sha}.body`
    )
  return { dir, root, store, source, bodyPath }
}
const call = (name: string, input: Record<string, unknown>, id = 'one') => ({
  type: 'tool_use' as const,
  name,
  input,
  id,
})

describe('bounded result bodies', () => {
  it('pages a long UTF-8 line exactly, deduplicates bytes, and keeps snapshots small', async () => {
    const { store, source, bodyPath } = await fixture()
    const body = '𠮷证据 x'.repeat(6000) + 'TAIL-MARKER'
    const entry = await store.save(body, source)
    const other = await store.save(body, { ...source, toolCallId: 'two' })
    expect(other.sha256).toBe(entry.sha256)
    expect(
      (await fs.readdir(path.dirname(bodyPath(entry.sha256)))).filter(n => n.endsWith('.body'))
    ).toHaveLength(1)
    expect((await fs.stat(bodyPath(entry.sha256))).mode & 0o777).toBe(0o600)
    let offset = 0,
      collected = ''
    for (;;) {
      const page = JSON.parse(await store.read(entry.reference, offset, 4096))
      expect(Buffer.byteLength(page.untrusted_text)).toBeLessThanOrEqual(4096)
      collected += page.untrusted_text
      if (page.eof) break
      expect(page.next_offset).toBeGreaterThan(offset)
      offset = page.next_offset
    }
    expect(collected).toBe(body)
    expect(entry.sha256).toBe(createHash('sha256').update(body).digest('hex'))
    expect(JSON.stringify(store.snapshot()).length).toBeLessThan(3000)
    expect(JSON.stringify(store.snapshot())).not.toContain('TAIL-MARKER')
    await expect(store.read(entry.reference, 1)).rejects.toThrow('inside a UTF-8')
    for (const [start, size] of [
      [-1, 10],
      [0.5, 10],
      [0, 0],
      [0, 4097],
      [body.length * 10, 4],
    ]) {
      await expect(store.read(entry.reference, start, size)).rejects.toThrow('INVALID_RESULT_RANGE')
    }
  })
  it('marks a partial trailing identifier and lets the caller recover its remaining bytes', async () => {
    const { store, source } = await fixture()
    const body = 'diagnostic=FAULT_z91f\n'
    const entry = await store.save(body, source)
    const first = JSON.parse(await store.read(entry.reference, 0, 18))
    expect(first.untrusted_text).toBe('diagnostic=FAULT_z')
    expect(first.eof).toBe(false)
    expect(first.continuation_hint).toMatch(/incomplete/)
    const last = JSON.parse(await store.read(entry.reference, first.next_offset, 4096))
    expect(first.untrusted_text + last.untrusted_text).toBe(body)
    expect(last.eof).toBe(true)
    expect(last.continuation_hint).toBeUndefined()
    expect(last.next_offset).toBe(entry.bytes)
  })
  it('reads only the final bounded page without splitting its initial UTF-8 character', async () => {
    const { store, source, dir } = await fixture()
    const body = 'irrelevant line\n'.repeat(900) + '甲😀end\n'
    const entry = await store.save(body, source)
    const results = await executeToolCalls(
      [call('read_tool_result', { reference: entry.reference, tail: true, limit: 7 })],
      [readToolResultTool],
      { cwd: dir, results: store },
      undefined,
      new PermissionController({ mode: 'read-only' })
    )
    expect(results[0].is_error).not.toBe(true)
    const page = JSON.parse(String(results[0].content))
    expect(page.untrusted_text).toBe('end\n')
    expect(page.offset).toBe(entry.bytes - 4)
    expect(page.next_offset).toBe(entry.bytes)
    expect(page.eof).toBe(true)
    expect(page.leading_fragment_hint).toContain('incomplete')
    expect(page.source).toEqual(source)
    expect(page.sha256).toBe(entry.sha256)
    expect(store.snapshot()!.entries).toHaveLength(1)
    for (const input of [
      { tail: true, offset: 0 },
      { tail: 'true' },
      { tail: true, limit: 4097 },
    ]) {
      await expect(
        readToolResultTool.execute(
          { reference: entry.reference, ...input },
          { cwd: dir, results: store }
        )
      ).rejects.toThrow('INVALID_RESULT_RANGE')
    }
  })
  it('distinguishes an empty page at the end of a nonempty result from an empty body', async () => {
    const { store, source, dir, bodyPath } = await fixture()
    const body = 'observed diagnostic: FAULT_z91f\n'
    const entry = await store.save(body, source)
    const results = await executeToolCalls(
      [call('read_tool_result', { reference: entry.reference, offset: entry.bytes })],
      [readToolResultTool],
      { cwd: dir, results: store },
      undefined,
      new PermissionController({ mode: 'read-only' })
    )
    expect(results[0].is_error).not.toBe(true)
    const page = JSON.parse(String(results[0].content))
    expect(page).toMatchObject({
      total_bytes: Buffer.byteLength(body),
      offset: entry.bytes,
      next_offset: entry.bytes,
      eof: true,
      untrusted_text: '',
      sha256: entry.sha256,
    })
    expect(page.empty_page_hint).toContain('body is not empty')
    expect(page.empty_page_hint).toContain('tail:true without offset')
    expect(page.continuation_hint).toBeUndefined()
    const tail = JSON.parse(await store.read(entry.reference, 'tail'))
    expect(tail.untrusted_text).toBe(body)
    expect(tail.empty_page_hint).toBeUndefined()

    const empty = await store.save('', { ...source, toolCallId: 'empty' })
    const emptyPage = JSON.parse(await store.read(empty.reference))
    expect(emptyPage).toMatchObject({ total_bytes: 0, offset: 0, eof: true, untrusted_text: '' })
    expect(emptyPage.empty_page_hint).toBeUndefined()

    // EOF still verifies the saved bytes; it must not become an unchecked metadata path.
    await fs.writeFile(bodyPath(entry.sha256), body.replace('FAULT', 'FORGE'))
    await expect(store.read(entry.reference, entry.bytes)).rejects.toThrow('RESULT_CHANGED')
  })
  it('keeps tail reads subject to original permissions and immutable body checks', async () => {
    const { store, source, dir, bodyPath } = await fixture()
    const entry = await store.save('secret tail\n', { ...source, paths: [path.dirname(dir)] })
    const denied = await executeToolCalls(
      [call('read_tool_result', { reference: entry.reference, tail: true })],
      [readToolResultTool],
      { cwd: dir, results: store },
      undefined,
      new PermissionController({ mode: 'read-only' })
    )
    expect(denied[0].is_error).toBe(true)
    expect(String(denied[0].content)).not.toContain('secret tail')
    const complete = JSON.parse(await store.read(entry.reference, 'tail'))
    expect(complete.offset).toBe(0)
    expect(complete.leading_fragment_hint).toBeUndefined()
    expect(complete.untrusted_text).toBe('secret tail\n')
    await fs.writeFile(bodyPath(entry.sha256), 'forged tail\n')
    await expect(store.read(entry.reference, 'tail')).rejects.toThrow('RESULT_CHANGED')
    await fs.rm(bodyPath(entry.sha256))
    await expect(store.read(entry.reference, 'tail')).rejects.toThrow('RESULT_MISSING')
  })
  it('distinguishes missing, tampered, unknown, and expired bodies without returning content', async () => {
    const { store, source, bodyPath } = await fixture()
    const entry = await store.save('private evidence', source)
    await fs.writeFile(bodyPath(entry.sha256), 'changed evidence')
    await expect(store.read(entry.reference)).rejects.toThrow('RESULT_CHANGED')
    await fs.rm(bodyPath(entry.sha256))
    await expect(store.read(entry.reference)).rejects.toThrow('RESULT_MISSING')
    await expect(store.read('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      'RESULT_UNAVAILABLE'
    )
    const snapshot = store.snapshot()!
    snapshot.entries[0].expiresAt = snapshot.entries[0].createdAt
    store.restore(snapshot)
    await expect(store.read(entry.reference)).rejects.toThrow('RESULT_EXPIRED')
  })
  it('rejects symlink body replacement and catalog path injection', async () => {
    const { store, source, bodyPath, dir } = await fixture()
    const entry = await store.save('abc', source)
    const target = path.join(dir, 'outside.txt')
    await fs.writeFile(target, 'abc')
    await fs.rm(bodyPath(entry.sha256))
    await fs.symlink(target, bodyPath(entry.sha256))
    await expect(store.read(entry.reference)).rejects.toThrow()
    const snapshot = store.snapshot()!
    expect(() => validateResultSnapshot({ ...snapshot, scope: '../escape' })).toThrow()
    expect(() => validateResultSnapshot({ ...snapshot, version: 99 })).toThrow()
    snapshot.entries[0].sha256 = '../secret'
    expect(() => store.restore(snapshot)).toThrow()
    expect(store.snapshot()!.entries[0].sha256).toBe(entry.sha256)
  })
  it('enforces capacity without evicting live evidence and recycles only expired bodies', async () => {
    const { store, source, bodyPath } = await fixture({
      maxResultBytes: 16,
      maxTotalBytes: 20,
      maxResults: 3,
    })
    const first = await store.save('a'.repeat(16), source)
    await expect(store.save('x'.repeat(17), source)).rejects.toThrow('RESULT_CAPACITY')
    await expect(store.save('other body', source)).rejects.toThrow('RESULT_CAPACITY')
    expect(JSON.parse(await store.read(first.reference)).untrusted_text).toBe('a'.repeat(16))
    const snapshot = store.snapshot()!
    snapshot.entries[0].expiresAt = snapshot.entries[0].createdAt
    store.restore(snapshot)
    await fs.utimes(bodyPath(first.sha256), new Date(0), new Date(0))
    await store.cleanupExpired()
    await expect(fs.stat(bodyPath(first.sha256))).rejects.toThrow()
    await store.save('other body', source)
  })
  it('restores references with the same workspace, but cannot read them in another workspace', async () => {
    const { store, source, root, dir } = await fixture()
    const entry = await store.save('restart evidence', source)
    const restored = new ResultStore({ directory: root })
    restored.setWorkspace(dir)
    restored.restore(store.snapshot())
    expect(JSON.parse(await restored.read(entry.reference)).untrusted_text).toBe('restart evidence')
    const other = await fs.mkdtemp(path.join(dir, 'other-'))
    restored.setWorkspace(other)
    await expect(restored.read(entry.reference)).rejects.toThrow('RESULT_WORKSPACE_MISMATCH')
  })
  it('stores generic output once, keeps pairing, and applies read denial plus tool budget on recall', async () => {
    const { store, dir, source } = await fixture()
    let executions = 0
    const probe: Tool = {
      name: 'probe',
      permission: { effect: 'read' },
      description: '',
      input_schema: { type: 'object', properties: {} },
      execute: async () => {
        executions++
        return 'a'.repeat(30000) + 'needle'
      },
    }
    const ctx = { cwd: dir, results: store }
    const [result] = await executeToolCalls([call('probe', {})], [probe], ctx)
    const receipt = JSON.parse(String(result.content))
    expect(receipt.kind).toBe('tool_result_reference')
    expect(result.tool_use_id).toBe('one')
    expect(receipt.source.toolCallId).toBe('one')
    const denied = await executeToolCalls(
      [call('read_tool_result', { reference: receipt.reference }, 'read')],
      [readToolResultTool],
      ctx,
      undefined,
      new PermissionController({ rules: [{ tool: 'read_tool_result', action: 'deny' }] })
    )
    expect(denied[0].is_error).toBe(true)
    expect(denied[0].content).toContain('Permission denied')
    const budget = new RunBudget({ maxToolCalls: 1 })
    try {
      const reads = await executeToolCalls(
        [
          call('read_tool_result', { reference: receipt.reference, offset: 30000 }, 'a'),
          call('read_tool_result', { reference: receipt.reference }, 'b'),
        ],
        [readToolResultTool],
        ctx,
        undefined,
        new PermissionController({ mode: 'read-only' }),
        undefined,
        undefined,
        undefined,
        undefined,
        budget
      )
      expect(JSON.parse(String(reads[0].content)).untrusted_text).toBe('needle')
      expect(reads[1].content).toContain('not executed')
      expect(executions).toBe(1)
      expect(store.snapshot()!.entries).toHaveLength(1)
    } finally {
      budget.close()
    }
    // Reading an externally sourced result still needs current file authorization.
    const outside = await store.save('outside evidence', { ...source, paths: ['/'] })
    const reads = await executeToolCalls(
      [call('read_tool_result', { reference: outside.reference })],
      [readToolResultTool],
      ctx,
      undefined,
      new PermissionController({ mode: 'read-only' })
    )
    expect(reads[0].is_error).toBe(true)
    expect(reads[0].content).toContain('Read-only')
  })
  it('storage failure after a tool side effect reports settled execution without replay', async () => {
    const { store, dir } = await fixture({ maxResultBytes: 10 })
    let effects = 0
    const probe: Tool = {
      name: 'probe',
      permission: { effect: 'read' },
      description: '',
      input_schema: { type: 'object', properties: {} },
      execute: async () => {
        effects++
        return 'x'.repeat(22000)
      },
    }
    const [result] = await executeToolCalls([call('probe', {})], [probe], {
      cwd: dir,
      results: store,
    })
    expect(effects).toBe(1)
    expect(result.is_error).toBe(true)
    expect(result.content).toContain('execution settled')
    expect(result.content).toContain('RESULT_CAPACITY')
    expect(result.content).toContain('Do not re-run')
  })
  it('seals the real terminal spool and reads its tail without duplicating the body', async () => {
    const { store, dir, bodyPath } = await fixture()
    const [result] = await executeToolCalls(
      [
        call('terminal', {
          command:
            "printf 'start\\n'; head -c 40000 /dev/zero | tr '\\0' x; printf '\\nTAIL-42\\n'",
        }),
      ],
      [terminalTool],
      { cwd: dir, results: store },
      undefined,
      new PermissionController({ mode: 'bypass' })
    )
    expect(result.is_error).toBeUndefined()
    expect(result.content).toContain('tool_result_reference')
    const [entry] = store.snapshot()!.entries
    expect(JSON.parse(await store.read(entry.reference, entry.bytes - 8)).untrusted_text).toBe(
      'TAIL-42\n'
    )
    expect(
      (await fs.readdir(path.dirname(bodyPath(entry.sha256)))).filter(n => n.endsWith('.pending'))
    ).toEqual([])
    expect(await fs.readFile(bodyPath(entry.sha256), 'utf8')).toContain('start\n')
  })
  it('bounds streaming output and drains the process while reporting incomplete storage', async () => {
    const { store, dir } = await fixture({ maxResultBytes: 25000 })
    const [result] = await executeToolCalls(
      [call('terminal', { command: 'head -c 80000 /dev/zero' })],
      [terminalTool],
      { cwd: dir, results: store },
      undefined,
      new PermissionController({ mode: 'bypass' })
    )
    expect(result.content).toContain('RESULT_CAPACITY')
    expect(result.content).toContain('exit code: 0')
    expect(store.snapshot()).toBeUndefined()
    const sink = new OutputSink({ path: path.join(dir, 'missing', 'out') })
    sink.append(Buffer.alloc(30000))
    await sink.closeStream()
    expect(sink.storageError).toContain('RESULT_STORAGE_FAILED')
  })
  it('session restore validation is atomic and reset detaches references without deleting saved bodies', async () => {
    const { root, dir } = await fixture()
    const session = new Session({ directory: root })
    const store = session.getResultStore(dir)
    const entry = await store.save('saved evidence', {
      toolName: 'probe',
      toolCallId: 'one',
      paths: [dir],
    })
    const snapshot = session.snapshot()
    expect(() =>
      session.restore({ ...snapshot, results: { ...snapshot.results, version: 99 } })
    ).toThrow()
    expect(session.snapshot()).toEqual(snapshot)
    session.reset()
    await expect(store.read(entry.reference)).rejects.toThrow('RESULT_UNAVAILABLE')
    session.restore(snapshot)
    expect(JSON.parse(await store.read(entry.reference)).untrusted_text).toBe('saved evidence')
  })
  it('rechecks current approval for a canonical outside source after its workspace symlink is removed', async () => {
    const { store, dir } = await fixture()
    const outside = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'z2a-outside-')))
    directories.push(outside)
    const file = path.join(outside, 'source')
    await fs.writeFile(file, 's'.repeat(24000))
    await fs.symlink(file, path.join(dir, 'alias'))
    let approvals = 0
    const approve = new PermissionController({
      requestApproval: async r => {
        approvals++
        return { requestId: r.id, decision: 'allow' }
      },
    })
    const [result] = await executeToolCalls(
      [call('read_file', { path: 'alias' })],
      [readFileTool],
      { cwd: dir, results: store },
      undefined,
      approve
    )
    const { reference } = JSON.parse(String(result.content))
    await fs.unlink(path.join(dir, 'alias'))
    const [denied] = await executeToolCalls(
      [call('read_tool_result', { reference })],
      [readToolResultTool],
      { cwd: dir, results: store },
      undefined,
      new PermissionController({ mode: 'read-only' })
    )
    expect(denied.is_error).toBe(true)
    expect(denied.content).toContain('Read-only')
    const [read] = await executeToolCalls(
      [call('read_tool_result', { reference })],
      [readToolResultTool],
      { cwd: dir, results: store },
      undefined,
      approve
    )
    expect(read.is_error).toBeUndefined()
    expect(approvals).toBe(2)
  })
  it('an older catalog cannot collect a body renewed by another restored owner', async () => {
    const { store, source, root, dir } = await fixture()
    const first = await store.save('shared evidence', source)
    const old = store.snapshot()!
    old.entries[0].expiresAt = old.entries[0].createdAt
    const older = new ResultStore({ directory: root })
    older.setWorkspace(dir)
    older.restore(old)
    await store.save('shared evidence', { ...source, toolCallId: 'two' })
    await older.cleanupExpired()
    expect(JSON.parse(await store.read(first.reference)).untrusted_text).toBe('shared evidence')
  })
  it('bounds thrown tool errors while preserving the failed result and refuses reads after cancellation', async () => {
    const { store, dir } = await fixture()
    const probe: Tool = {
      name: 'probe',
      permission: { effect: 'read' },
      description: '',
      input_schema: { type: 'object', properties: {} },
      execute: async () => {
        throw new Error('failure'.repeat(5000))
      },
    }
    const [result] = await executeToolCalls([call('probe', {})], [probe], {
      cwd: dir,
      results: store,
    })
    expect(result.is_error).toBe(true)
    const receipt = JSON.parse(String(result.content))
    expect(receipt.kind).toBe('tool_result_reference')
    const controller = new AbortController()
    controller.abort(new Error('cancelled before page'))
    await expect(store.read(receipt.reference, 0, 4096, controller.signal)).rejects.toThrow(
      'cancelled before page'
    )
  })
  it('accepts a configured parent alias even when its private children do not exist yet', async () => {
    const { dir } = await fixture()
    const alias = path.join(dir, 'parent-alias')
    await fs.symlink(dir, alias)
    const store = new ResultStore({ directory: path.join(alias, 'new', 'nested', 'results') })
    store.setWorkspace(dir)
    const entry = await store.save('nested-root', {
      toolName: 'probe',
      toolCallId: 'one',
      paths: [dir],
    })
    expect(JSON.parse(await store.read(entry.reference)).untrusted_text).toBe('nested-root')
  })
  it('preserves malformed UTF-8 bytes without confusing them with valid character boundaries', async () => {
    const { store, source } = await fixture()
    const bytes = Buffer.from([0x80, 0xff, 0xc0, 0x81, 0x41, 0xf0, 0xa0, 0xae, 0xb7, 0x42])
    const spool = await store.spoolPath()
    await fs.writeFile(spool, bytes, { mode: 0o600 })
    const entry = await store.seal(spool, source)
    const first = JSON.parse(await store.read(entry.reference, 0, 7))
    expect(Buffer.from(first.raw_base64, 'base64')).toEqual(bytes.subarray(0, 5))
    expect(first.next_offset).toBe(5)
    const second = JSON.parse(await store.read(entry.reference, first.next_offset, 4))
    expect(second.untrusted_text).toBe('𠮷')
    expect(second.next_offset).toBe(9)
  })
  it('counts active spools and closed background files against capacity, and releases small-command reservations', async () => {
    const { store, source } = await fixture({ maxResultBytes: 16, maxTotalBytes: 20 })
    const active = await store.spoolPath()
    await expect(store.spoolPath()).rejects.toThrow('RESULT_CAPACITY')
    await fs.writeFile(active, 'background')
    await store.releaseSpool(active, true)
    await expect(store.spoolPath()).rejects.toThrow('RESULT_CAPACITY')
    await fs.rm(active)
    const entry = await store.save('a'.repeat(16), source)
    // A duplicate reference needs no second body or capacity reservation.
    await store.save('a'.repeat(16), source)
    expect(JSON.parse(await store.read(entry.reference)).untrusted_text).toBe('a'.repeat(16))
    const fresh = await fixture({ maxResultBytes: 25000, maxTotalBytes: 25000 })
    const [short] = await executeToolCalls(
      [call('terminal', { command: 'printf short' })],
      [terminalTool],
      { cwd: fresh.dir, results: fresh.store },
      undefined,
      new PermissionController({ mode: 'bypass' })
    )
    expect(short.content).toContain('short')
    const pending = await fresh.store.spoolPath()
    await fresh.store.releaseSpool(pending)
  })
  it('refuses direct terminal storage without source identity before running the command', async () => {
    const { store, dir } = await fixture()
    const result = await terminalTool.execute(
      { command: 'touch should-not-exist' },
      { cwd: dir, results: store }
    )
    expect(result).toContain('source identity; command was not executed')
    await expect(fs.stat(path.join(dir, 'should-not-exist'))).rejects.toThrow()
  })
})
