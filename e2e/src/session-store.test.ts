import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { hostname } from 'node:os'
import { Agent } from '@zero2agent/core'
import { SessionStore } from '../../packages/tui/src/session-store.js'
import { Conversations, RECOVERY_NOTICE } from '../../packages/tui/src/conversations.js'
import { makeTempWorkspace } from './helpers/cli.js'

const state = {
  messages: [
    { role: 'user' as const, content: 'saved task' },
    { role: 'assistant' as const, content: 'saved answer' },
  ],
  context: { through: 0, summary: '' },
}
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
async function setup() {
  const workspace = await makeTempWorkspace()
  cleanups.push(workspace.cleanup)
  const store = await SessionStore.open(workspace.dir, path.join(workspace.dir, 'sessions'))
  return { ...workspace, store }
}
describe('local session store and operation boundaries', () => {
  it('round trips, ignores unpublished temp files, and creates private files', async () => {
    const { store } = await setup()
    const saved = await store.save(store.fresh(), state)
    const dir = path.join(store.directory, saved.id)
    await fs.writeFile(path.join(dir, '.pending-crash'), '{bad')
    expect((await store.load(saved.id)).state).toEqual(state)
    expect((await store.list())[0].title).toBe('saved task')
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700)
    expect((await fs.stat(path.join(dir, '1.json'))).mode & 0o777).toBe(0o600)
  })
  it('publishes exactly one concurrent writer and never overwrites its bytes', async () => {
    const { store } = await setup()
    const initial = await store.save(store.fresh(), state)
    const results = await Promise.allSettled([
      store.save(initial, state),
      store.save(initial, state),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
    expect((await store.load(initial.id)).revision).toBe(2)
    await expect(store.save(initial, state)).rejects.toThrow('conflict')
  })
  it('reports a damaged latest generation instead of silently restoring an older one', async () => {
    const { store } = await setup()
    const initial = await store.save(store.fresh(), state)
    await fs.writeFile(path.join(store.directory, initial.id, '2.json'), '{broken')
    await expect(store.load(initial.id)).rejects.toThrow()
    expect((await store.list())[0].error).toBeTruthy()
    expect(await fs.readFile(path.join(store.directory, initial.id, '1.json'), 'utf8')).toContain(
      'saved answer'
    )
  })
  it('rejects unknown versions, wrong cwd and symlink files; workspace IDs do not cross directories', async () => {
    const { store, dir } = await setup()
    const saved = await store.save(store.fresh(), state)
    const file = path.join(store.directory, saved.id, '1.json')
    for (const data of [
      { ...saved, version: 9 },
      { ...saved, cwd: '/elsewhere' },
    ]) {
      await fs.writeFile(file, JSON.stringify(data))
      await expect(store.load(saved.id)).rejects.toThrow()
    }
    await fs.unlink(file)
    await fs.writeFile(path.join(dir, 'outside'), JSON.stringify(saved))
    await fs.symlink(path.join(dir, 'outside'), file)
    await expect(store.load(saved.id)).rejects.toThrow()
    await fs.mkdir(path.join(dir, 'other'))
    const other = await SessionStore.open(path.join(dir, 'other'), path.join(dir, 'sessions'))
    expect(await other.list()).toEqual([])
    await expect(other.load(saved.id)).rejects.toThrow()
    await expect(store.load('../outside')).rejects.toThrow('UUID')
  })
  it('refuses a live pending process and recovers a dead one with an explicit warning', async () => {
    const { store } = await setup()
    const pending = await store.save(store.fresh(), state, {
      kind: 'turn',
      pid: process.pid,
      host: hostname(),
    })
    const agent = new Agent()
    const conversations = new Conversations(agent, store)
    await expect(conversations.resume(pending.id)).rejects.toThrow('仍在运行')
    expect(agent.getHistory()).toEqual([])
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })
    expect(await conversations.resume(pending.id)).toContain('上次运行中断')
    expect(agent.getHistory().at(-1)?.content).toBe(RECOVERY_NOTICE)
    expect(conversations.status).toContain('尚未保存')
    await conversations.save()
    expect((await store.load(pending.id)).pending).toBeUndefined()
  })
  it('fails before execution if pending cannot be stored and keeps unsaved memory when settlement fails', async () => {
    const { store } = await setup()
    const agent = new Agent()
    const conversations = new Conversations(agent, store)
    const run = vi.spyOn(agent, 'run').mockImplementation(async () => {
      agent.restore(state)
      return 'saved answer'
    })
    const save = vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('disk full'))
    await expect(conversations.run('test')).rejects.toThrow('尚未保存')
    expect(run).not.toHaveBeenCalled()
    save.mockRestore()
    await conversations.save()
    const original = store.save.bind(store)
    vi.spyOn(store, 'save').mockImplementation(async (current, snapshot, pending) => {
      if (!pending) throw new Error('disk full')
      return original(current, snapshot, pending)
    })
    await expect(conversations.run('test')).rejects.toThrow('尚未保存')
    expect(run).toHaveBeenCalledTimes(1)
    expect(agent.getHistory()).toEqual(state.messages)
    await expect(conversations.newSession()).rejects.toThrow('尚未保存')
    expect(agent.getHistory()).toEqual(state.messages)
    vi.restoreAllMocks()
    await conversations.save()
    expect((await store.load(conversations.id!)).state).toEqual(state)
  })
  it('preserves current state when the requested resume is invalid and --no-save stays in memory', async () => {
    const agent = new Agent()
    agent.restore(state)
    const { store } = await setup()
    const saved = new Conversations(agent, store)
    await expect(saved.resume('../bad')).rejects.toThrow()
    expect(agent.getHistory()).toEqual(state.messages)
    const ephemeral = new Conversations(agent)
    await ephemeral.save()
    expect(ephemeral.id).toBeUndefined()
    await expect(ephemeral.list()).rejects.toThrow('--no-save')
  })
})
