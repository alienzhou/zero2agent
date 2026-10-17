import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Agent } from '@zero2agent/core'
import { SessionStore } from '../../packages/tui/dist/session-store.js'
import { Conversations } from '../../packages/tui/dist/conversations.js'
import { makeTempWorkspace } from './helpers/cli.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
async function setup() {
  const workspace = await makeTempWorkspace()
  cleanups.push(workspace.cleanup)
  const directory = path.join(workspace.dir, '.agents/skills/fix-with-tests')
  await fs.mkdir(directory, { recursive: true })
  const file = path.join(directory, 'SKILL.md')
  const guide = (body: string) =>
    `---\nname: fix-with-tests\ndescription: Repair with tests.\n---\n${body}`
  await fs.writeFile(file, guide('CURRENT_BODY_ONE'))
  const agent = new Agent({ cwd: workspace.dir, permissions: { mode: 'accept-edits' } })
  const store = await SessionStore.open(workspace.dir, path.join(workspace.dir, 'sessions'))
  return { ...workspace, directory, file, guide, agent, store }
}

describe('durable Skills preferences through the actual session store', () => {
  it('publishes version 3 identities without bodies and reloads the current guide on restore', async () => {
    const { dir, file, guide, agent, store } = await setup()
    await agent.activateSkill('fix-with-tests')
    const saved = await store.save(store.fresh(), agent.snapshot())
    expect(saved.version).toBe(3)
    const bytes = await fs.readFile(path.join(store.directory, saved.id, '1.json'), 'utf8')
    expect(bytes).not.toContain('CURRENT_BODY_ONE')
    expect(saved.state.skills?.selected).toHaveLength(1)
    await fs.writeFile(file, guide('CURRENT_BODY_TWO'))
    const restored = new Agent({ cwd: dir, permissions: { mode: 'accept-edits' } })
    restored.restore((await store.load(saved.id)).state)
    await restored.refreshSkills()
    const active = restored.getSkills().entries.find(entry => entry.status === 'loaded')
    expect(active?.text).toContain('CURRENT_BODY_TWO')
    expect(active?.previousVersion).toBeTruthy()
  })

  it('refuses skill data hidden in an older session version and malformed selection before replacing state', async () => {
    const { agent, store } = await setup()
    await agent.activateSkill('fix-with-tests')
    const saved = await store.save(store.fresh(), agent.snapshot())
    const file = path.join(store.directory, saved.id, '1.json')
    for (const version of [1, 2]) {
      await fs.writeFile(file, JSON.stringify({ ...saved, version }))
      await expect(store.load(saved.id)).rejects.toThrow('version 3')
    }
    await fs.writeFile(
      file,
      JSON.stringify({ ...saved, state: { ...saved.state, skills: { version: 99, selected: [] } } })
    )
    await expect(store.load(saved.id)).rejects.toThrow()
    expect(agent.snapshot()).toEqual(saved.state)
  })

  it('continues to round-trip old conversations without introducing skill state', async () => {
    const { store } = await setup()
    const legacy = {
      messages: [
        { role: 'user' as const, content: 'old task' },
        { role: 'assistant' as const, content: 'old answer' },
      ],
      context: { through: 0, summary: '' },
    }
    const saved = await store.save(store.fresh(), legacy)
    expect(saved.version).toBe(1)
    expect((await store.load(saved.id)).state).toEqual(legacy)
  })

  it('saves explicit load and unload controls without model calls or history edits', async () => {
    const { agent, store } = await setup()
    const conversations = new Conversations(agent, store)
    await conversations.skills('load fix-with-tests')
    let saved = await store.load(conversations.id!)
    expect(saved.state.skills?.selected).toHaveLength(1)
    expect(saved.state.messages).toEqual([])
    await conversations.skills('unload fix-with-tests')
    saved = await store.load(conversations.id!)
    expect(saved.state.skills?.selected ?? []).toEqual([])
    expect(saved.state.messages).toEqual([])
  })
})
