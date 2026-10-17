import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  Hooks,
  validateHookConfig,
  validateHookSnapshot,
  type HookConfig,
  type HookStage,
} from '../hooks.js'
const fixture = path.resolve(import.meta.dirname, '../../../../researches/hooks/check.mjs')
let root: string
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'z2a-hooks-')))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})
async function setup(mode = 'pass', stage: HookStage = 'beforeTool') {
  const config: HookConfig = {
    version: 1,
    hooks: [
      {
        id: 'gate',
        stage,
        command: process.execPath,
        args: [fixture, mode],
        sources: [fixture],
        env: { HOOK_AUDIT: path.join(root, 'audit') },
      },
    ],
  }
  const view = await new Hooks(root, { config }).inspect()
  const options = { config, trust: view.map(v => `${v.id}:${v.identity}`) }
  const hooks = new Hooks(root, options)
  await hooks.begin()
  const data =
    stage === 'beforeComplete'
      ? {}
      : {
          tool: { id: 'call', name: 'write_file', paths: [path.join(root, 'out')] },
          ...(stage === 'afterTool' && { receipt: { isError: false, sha256: 'a'.repeat(64) } }),
        }
  return {
    hooks,
    options,
    config,
    run: (persist = async () => {}, signal?: AbortSignal) =>
      hooks.run(stage, data, persist, signal),
  }
}
async function audit() {
  return (await fs.readFile(path.join(root, 'audit'), 'utf8'))
    .trim()
    .split('\n')
    .map(l => JSON.parse(l))
}
describe('native command Hooks and version trust', () => {
  it('constructs/discovers without running; untrusted hooks remain inert', async () => {
    const { options } = await setup()
    await expect(fs.stat(path.join(root, 'audit'))).rejects.toThrow()
    const h = new Hooks(root, { config: options.config })
    await h.begin()
    expect(h.enabled).toBe(false)
    await h.run('beforeTool', { tool: { id: 'x', name: 'write_file', paths: [] } }, async () => {})
    await expect(fs.stat(path.join(root, 'audit'))).rejects.toThrow()
  })
  it('passes metadata only, with explicit environment, paired intent/settlement and actual PID cleanup', async () => {
    process.env.HOOK_PRIVATE_SENTINEL = 'secret'
    try {
      const { hooks, run } = await setup()
      const boundaries: string[] = []
      await run(async b => {
        boundaries.push(b)
      })
      expect(boundaries).toEqual(['hook-start', 'hook-settled'])
      expect(hooks.snapshot()?.checks[0].state).toBe('passed')
      const events = await audit()
      expect(events[0].envKeys).toContain('HOOK_AUDIT')
      for (const key of ['HOOK_PRIVATE_SENTINEL', 'ANTHROPIC_API_KEY', 'HOME'])
        expect(events[0].envKeys).not.toContain(key)
      expect(events[0].input).not.toHaveProperty('messages')
      expect(() => process.kill(events[0].pid, 0)).toThrow()
      expect(validateHookSnapshot(hooks.snapshot())).toEqual(hooks.snapshot())
    } finally {
      delete process.env.HOOK_PRIVATE_SENTINEL
    }
  })
  it.each(['block', 'invalid', 'extra', 'nonzero', 'oversize', 'stderr', 'utf8', 'hang'])(
    'fails closed for %s and cleans actual command',
    async mode => {
      const p = await setup(mode)
      p.options.config.hooks[0].timeoutMs = 400
      const view = await new Hooks(root, { config: p.options.config }).inspect()
      const h = new Hooks(root, {
        config: p.options.config,
        trust: view.map(v => `${v.id}:${v.identity}`),
      })
      await h.begin()
      await expect(
        h.run('beforeTool', { tool: { id: 'x', name: 'write_file', paths: [] } }, async () => {})
      ).rejects.toThrow('Hook beforeTool')
      expect(h.pending()).toHaveLength(1)
      const events = await audit()
      expect(() => process.kill(events[0].pid, 0)).toThrow()
    }
  )
  it('does not spawn if intent publication fails', async () => {
    const { hooks, run } = await setup()
    await expect(
      run(async () => {
        throw new Error('fixed storage failure')
      })
    ).rejects.toThrow('storage')
    await expect(fs.stat(path.join(root, 'audit'))).rejects.toThrow()
    expect(hooks.snapshot()?.checks[0].state).toBe('not-started')
  })
  it('awaits cancellation cleanup and retains an unknown check', async () => {
    const { hooks, run } = await setup('hang')
    const c = new AbortController()
    const task = expect(run(async () => {}, c.signal)).rejects.toThrow('Hook')
    for (let i = 0; i < 100; i++) {
      try {
        await audit()
        break
      } catch {}
      await new Promise(r => setTimeout(r, 10))
    }
    c.abort()
    await task
    expect(hooks.pending()[0].state).toBe('unknown')
    const pid = (await audit())[0].pid
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it('preserves failed checks; only explicit recheck makes a new check, never erases old facts', async () => {
    const { hooks, run, options } = await setup('toggle', 'afterTool')
    await expect(run()).rejects.toThrow()
    const saved = hooks.snapshot()!
    const count = (await audit()).length
    const restored = new Hooks(root, options)
    await restored.begin(saved)
    expect((await audit()).length).toBe(count)
    expect(() => restored.assertComplete()).toThrow('explicit-recheck')
    await expect(restored.recheck(async () => {}, '')).rejects.toThrow('explicit review')
    await fs.writeFile(path.join(root, 'allow-check'), 'yes')
    await restored.recheck(async () => {}, 'Checked effects; run a new validation')
    expect(restored.snapshot()?.checks[0]).toEqual(saved.checks[0])
    expect(restored.snapshot()?.checks[1].resolves).toBe(saved.checks[0].checkId)
    expect(() => restored.assertComplete()).not.toThrow()
    await expect(new Hooks(root, false).begin(saved)).rejects.toThrow('current-trust-required')
  })
  it('revokes trust for script content, file/parent identity and config changes', async () => {
    const scripts = path.join(root, 'scripts')
    await fs.mkdir(scripts)
    const source = path.join(scripts, 'check.mjs')
    await fs.copyFile(fixture, source)
    const config: HookConfig = {
      version: 1,
      hooks: [
        {
          id: 'a',
          stage: 'beforeTool',
          command: process.execPath,
          args: [source],
          sources: [source],
        },
      ],
    }
    const first = await new Hooks(root, { config }).inspect()
    const options = { config, trust: [`a:${first[0].identity}`] }
    const h = new Hooks(root, options)
    await h.begin()
    await fs.rename(scripts, scripts + '-old')
    await fs.mkdir(scripts)
    await fs.copyFile(path.join(scripts + '-old', 'check.mjs'), source)
    await expect(h.assertCurrent()).rejects.toThrow()
    await expect(new Hooks(root, options).begin()).rejects.toThrow('stale')
    const second = await new Hooks(root, { config }).inspect()
    expect(second[0].identity).not.toBe(first[0].identity)
  })
  it('fails completion if the checker changes an audited file', async () => {
    await fs.writeFile(path.join(root, 'watched.txt'), 'before')
    const p = await setup('mutate', 'beforeComplete')
    p.config.watch = ['watched.txt']
    const views = await new Hooks(root, { config: p.config }).inspect()
    const h = new Hooks(root, { config: p.config, trust: views.map(v => `${v.id}:${v.identity}`) })
    await h.begin()
    await expect(h.run('beforeComplete', {}, async () => {})).rejects.toThrow('files-changed')
    expect(await fs.readFile(path.join(root, 'watched.txt'), 'utf8')).toBe('changed by checker')
    expect(h.pending()).toHaveLength(1)
  })
  it('rejects malformed/downgraded recovery and retains ordinary versions', async () => {
    const { hooks, run } = await setup()
    await run()
    const s = hooks.snapshot()!
    for (const mutation of [
      (v: typeof s) => {
        v.checks[0].identity = 'bad'
      },
      (v: typeof s) => {
        v.version = 2 as 1
      },
      (v: typeof s) => {
        v.checks.push(v.checks[0])
      },
      (v: typeof s) => {
        v.checks[0].resolves = 'bad'
      },
    ]) {
      const bad = structuredClone(s)
      mutation(bad)
      expect(() => validateHookSnapshot(bad)).toThrow()
    }
  })
})
describe('Hook config bounds', () => {
  const base = () => ({
    version: 1 as const,
    hooks: [
      {
        id: 'x',
        stage: 'beforeTool' as const,
        command: process.execPath,
        args: [],
        sources: ['a'],
      },
    ],
  })
  it.each([7, 8, 9])('checks hook count %i', n => {
    const c = {
      version: 1,
      hooks: Array.from({ length: n }, (_, i) => ({ ...base().hooks[0], id: 'h' + i })),
    }
    if (n <= 8) expect(validateHookConfig(c).hooks).toHaveLength(n)
    else expect(() => validateHookConfig(c)).toThrow()
  })
  it.each([31, 32, 33])('checks ID/watch %i', n => {
    const c = { ...base(), watch: Array(n).fill('x') }
    if (n <= 32) expect(validateHookConfig(c).watch).toHaveLength(n)
    else expect(() => validateHookConfig(c)).toThrow()
    c.hooks[0].id = 'x'.repeat(n)
    if (n <= 32) expect(validateHookConfig({ ...c, watch: [] })).toBeTruthy()
    else expect(() => validateHookConfig({ ...c, watch: [] })).toThrow()
  })
  it.each([63, 64, 65])('checks argv %i', n => {
    const c = base()
    c.hooks[0].args = Array(n).fill('x') as never[]
    if (n <= 64) expect(validateHookConfig(c)).toBeTruthy()
    else expect(() => validateHookConfig(c)).toThrow()
  })
  it.each([9999, 10000, 10001])('checks timeout %i', n => {
    const c = { ...base(), hooks: [{ ...base().hooks[0], timeoutMs: n }] }
    if (n <= 10000) expect(validateHookConfig(c)).toBeTruthy()
    else expect(() => validateHookConfig(c)).toThrow()
  })
  it('rejects self-trust, shell, relative command, bad environment and control fields', () => {
    for (const extra of [
      { enabled: true },
      { shell: true },
      { command: 'node' },
      { env: { X: 1 } },
      { stage: 'permission' },
      { sources: [] },
    ])
      expect(() =>
        validateHookConfig({ version: 1, hooks: [{ ...base().hooks[0], ...extra }] })
      ).toThrow()
  })
})
