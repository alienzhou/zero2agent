import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DiagnosticEmitter } from '@zero2agent/core'
import { LogStore, LOG_LIMITS } from '../../packages/tui/dist/run-log.js'
import { makeTempWorkspace } from './helpers/cli.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn()
})
async function setup(options: { queueBytes?: number; fileBytes?: number } = {}) {
  const workspace = await makeTempWorkspace()
  cleanups.push(workspace.cleanup)
  const store = await LogStore.open(workspace.dir, {
    root: path.join(workspace.dir, 'logs'),
    ...options,
  })
  const journal = await store.start()
  cleanups.push(() => journal.close())
  const diagnostics = new DiagnosticEmitter(e => journal.diagnostic(e), { sessionId: randomUUID() })
  return { ...workspace, store, journal, diagnostics }
}
describe('versioned local run logs', () => {
  it('publishes private ordered metadata and verifies a settled operation', async () => {
    const { store, journal, diagnostics } = await setup()
    diagnostics.start('turn')
    diagnostics.emit('phase', 'requesting')
    diagnostics.end('completed', 'turn')
    await journal.close()
    const report = await store.read(journal.id)
    expect(report.warnings).toEqual([])
    expect(report.records.map(r => r.seq)).toEqual([1, 2, 3, 4, 5])
    expect(report.records[1].operationId).toBe(diagnostics.operationId)
    expect((await fs.stat(journal.file)).mode & 0o777).toBe(0o600)
    expect((await fs.stat(store.directory)).mode & 0o777).toBe(0o700)
    expect((await store.list())[0].id).toBe(journal.id)
  })
  it('assigns exclusive files and isolates real workspaces while aliases share one root', async () => {
    const { store, dir, journal } = await setup()
    const second = await store.start()
    await second.close()
    expect(second.file).not.toBe(journal.file)
    await fs.symlink(dir, path.join(dir, 'alias'))
    const aliased = await LogStore.open(path.join(dir, 'alias'), { root: path.join(dir, 'logs') })
    expect(aliased.directory).toBe(store.directory)
    await fs.mkdir(path.join(dir, 'other'))
    const other = await LogStore.open(path.join(dir, 'other'), { root: path.join(dir, 'logs') })
    expect(await other.list()).toEqual([])
    await expect(other.read(journal.id)).rejects.toThrow('不存在')
  })
  it('retains accepted writes when a burst reaches its queue budget', async () => {
    const { store, journal, diagnostics } = await setup({ queueBytes: 700 })
    await journal.flush()
    diagnostics.start('turn')
    for (let i = 0; i < 20; i++) diagnostics.emit('phase', 'requesting')
    expect(journal.failure).toBe('queue-limit')
    await journal.close()
    const report = await store.read(journal.id)
    expect(report.count).toBeGreaterThan(1)
    expect(report.warnings.join(' ')).toContain('未见进程退出')
    expect(journal.status).toContain('任务继续')
  })
  it('degrades at the file budget instead of overwriting or claiming completion', async () => {
    const { store, journal, diagnostics } = await setup({ fileBytes: 600 })
    await journal.flush()
    diagnostics.start('turn')
    await journal.flush()
    diagnostics.emit('phase', 'requesting')
    await journal.flush()
    diagnostics.end('completed', 'turn')
    await journal.close()
    expect(journal.failure).toBe('file-limit')
    expect((await store.read(journal.id)).warnings.length).toBeGreaterThan(0)
  })
  it('reports open and asynchronous write failures without throwing from observers', async () => {
    const { dir, journal, diagnostics } = await setup()
    await fs.writeFile(path.join(dir, 'blocked'), 'x')
    const blocked = await LogStore.open(dir, {
      root: path.join(dir, 'blocked'),
      onFailure: async () => {
        throw new Error('async notification failed')
      },
    })
    const failed = await blocked.start()
    expect(failed.failure).toBe('open')
    await failed.close()
    await journal.flush()
    const internal = journal as unknown as { handle: { close(): Promise<void> } }
    await internal.handle.close()
    expect(() => diagnostics.start('turn')).not.toThrow()
    await journal.flush()
    expect(journal.failure).toBe('write')
  })
  it('accepts only a complete prefix and rejects corrupt middle records or new versions', async () => {
    const { store, journal } = await setup()
    await journal.close()
    const original = await fs.readFile(journal.file, 'utf8')
    await fs.appendFile(journal.file, '{"partial":')
    expect((await store.read(journal.id)).warnings.join(' ')).toContain('末尾一行')
    await fs.writeFile(journal.file, original.split('\n')[0] + '\n{bad}\n')
    await expect(store.read(journal.id)).rejects.toThrow('第 2 行')
    const header = JSON.parse(original.split('\n')[0])
    await fs.writeFile(journal.file, JSON.stringify({ ...header, version: 2 }) + '\n')
    await expect(store.read(journal.id)).rejects.toThrow('版本')
    expect((await store.list())[0].error).toBeTruthy()
    await fs.writeFile(journal.file, JSON.stringify({ ...header, prompt: 'secret' }) + '\n')
    await expect(store.read(journal.id)).rejects.toThrow('损坏')
  })
  it('rejects path traversal, symlink log files and inappropriate operation filters', async () => {
    const { store, journal, dir } = await setup()
    await journal.close()
    await expect(store.read('../escape')).rejects.toThrow('UUID')
    await expect(store.read(journal.id, 'not-an-operation')).rejects.toThrow('UUID')
    await fs.rename(journal.file, path.join(dir, 'outside'))
    await fs.symlink(path.join(dir, 'outside'), journal.file)
    await expect(store.read(journal.id)).rejects.toThrow('安全读取')
    expect((await store.list())[0].error).toBeTruthy()
  })
  it('bounds projection size, supports operation filters and keeps missing requests visible', async () => {
    const { store, journal, diagnostics } = await setup()
    diagnostics.start('turn')
    for (let i = 0; i < 240; i++) diagnostics.emit('phase', 'preparing')
    diagnostics.request('model', { model: 'fixture', max_tokens: 1, messages: [] })
    diagnostics.end('completed', 'turn')
    await journal.close()
    const report = await store.read(journal.id, diagnostics.operationId)
    expect(report.records).toHaveLength(LOG_LIMITS.display)
    expect(report.omitted).toBe(43)
    expect(report.warnings.join(' ')).toContain('请求 1')
    expect(report.records.every(r => r.operationId === diagnostics.operationId)).toBe(true)
  })
})
