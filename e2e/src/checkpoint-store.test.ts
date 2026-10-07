import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { CheckpointStore, contentChunks } from '../../packages/tui/dist/checkpoint-store.js'
import { formatCheckpointDiff } from '../../packages/tui/dist/checkpoint-view.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
async function fixture(options: Parameters<typeof CheckpointStore.open>[1] = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-checkpoint-'))
  roots.push(root)
  const cwd = path.join(root, 'work')
  await fs.mkdir(cwd)
  const directory = path.join(root, 'data')
  const store = await CheckpointStore.open(cwd, { directory, ...options })
  const capture = (paths: string[], action: () => Promise<unknown>) =>
    store.capture({ cwd, paths, toolName: 'test-write', toolCallId: 'test-call' }, async () => {
      await action()
      return 'done'
    })
  return { root, cwd, directory, store, capture, file: (p: string) => path.join(cwd, p) }
}
async function undo(store: CheckpointStore, id: string, recovery = false) {
  const plan = await store.preview(id, recovery)
  return store.restore(id, plan.token, recovery)
}
describe('bounded content-addressed file checkpoints', () => {
  it('captures create/replace/delete, binary bytes and modes, restores and undoes the restore', async () => {
    const p = await fixture()
    const binary = Buffer.from([0, 255, 128, 13, 10, 10])
    await fs.writeFile(p.file('a'), 'before\n', { mode: 0o751 })
    await fs.writeFile(p.file('binary'), binary)
    await p.capture(['a', 'new', 'binary'], async () => {
      await fs.writeFile(p.file('a'), 'after\n')
      await fs.writeFile(p.file('new'), 'created')
      await fs.unlink(p.file('binary'))
    })
    const [record] = await p.store.list()
    expect(record.state).toBe('ready')
    expect(record.changes).toHaveLength(3)
    expect(await formatCheckpointDiff(p.store, record.id)).toContain('-before')
    const inverse = await undo(p.store, record.id)
    expect(await fs.readFile(p.file('a'), 'utf8')).toBe('before\n')
    expect((await fs.stat(p.file('a'))).mode & 0o777).toBe(0o751)
    expect(await fs.readFile(p.file('binary'))).toEqual(binary)
    await expect(fs.stat(p.file('new'))).rejects.toThrow()
    await undo(p.store, inverse.id)
    expect(await fs.readFile(p.file('a'), 'utf8')).toBe('after\n')
    expect(await fs.readFile(p.file('new'), 'utf8')).toBe('created')
    await expect(fs.stat(p.file('binary'))).rejects.toThrow()
    expect((await fs.stat(p.store.directory)).mode & 0o777).toBe(0o700)
    for (const name of await fs.readdir(path.join(p.store.directory, 'objects')))
      expect((await fs.stat(path.join(p.store.directory, 'objects', name))).mode & 0o777).toBe(
        0o600
      )
  })
  it('never scans unrelated trees, deduplicates across files and resynchronizes after insertion', async () => {
    const p = await fixture()
    const data = randomBytes(4 * 1024 * 1024)
    await fs.mkdir(p.file('unrelated'))
    await fs.symlink('/unreadable', p.file('unrelated/link'))
    await fs.writeFile(p.file('a'), data)
    await p.capture(['a'], () =>
      fs.writeFile(p.file('a'), Buffer.concat([Buffer.from('inserted prefix'), data]))
    )
    const [record] = await p.store.list(),
      c = record.changes[0]
    const common = c.before!.chunks.filter(h => c.after!.chunks.includes(h))
    expect(common.length).toBeGreaterThan(c.before!.chunks.length * 0.8)
    const first = await p.store.usage()
    await p.capture(['b'], () => fs.copyFile(p.file('a'), p.file('b')))
    expect((await p.store.usage()).objects).toBe(first.objects)
    expect(first.storedBytes).toBeLessThan(first.logicalBytes * 0.65)
    expect([...contentChunks(data)].every(b => b.length <= 256 * 1024)).toBe(true)
  })
  it('detects later edits, deleted/new conflicts and stale confirmation before touching any file', async () => {
    const p = await fixture()
    await fs.writeFile(p.file('a'), 'a0')
    await fs.writeFile(p.file('b'), 'b0')
    await p.capture(['a', 'b'], async () => {
      await fs.writeFile(p.file('a'), 'a1')
      await fs.writeFile(p.file('b'), 'b1')
    })
    const [record] = await p.store.list(),
      plan = await p.store.preview(record.id)
    await fs.writeFile(p.file('b'), 'human')
    await expect(p.store.restore(record.id, plan.token)).rejects.toThrow('changed after preview')
    const conflict = await p.store.preview(record.id)
    expect(conflict.changes.find(c => c.path === 'b')?.conflict).toBe(true)
    await expect(p.store.restore(record.id, conflict.token)).rejects.toThrow('conflict')
    expect(await fs.readFile(p.file('a'), 'utf8')).toBe('a1')
    expect(await fs.readFile(p.file('b'), 'utf8')).toBe('human')
  })
  it('retains changed files after throwing tools and removes no-op records', async () => {
    const p = await fixture()
    await p.capture(['none'], async () => {})
    expect(await p.store.list()).toEqual([])
    await expect(
      p.capture(['a'], async () => {
        await fs.writeFile(p.file('a'), 'effect')
        throw new Error('tool failed')
      })
    ).rejects.toThrow('tool failed')
    const [record] = await p.store.list()
    expect(record.state).toBe('ready')
    await undo(p.store, record.id)
    await expect(fs.stat(p.file('a'))).rejects.toThrow()
  })
  it('blocks effects if baseline is too large or storage is full, supports explicit pruning', async () => {
    const p = await fixture({ limits: { fileBytes: 32 } })
    await fs.writeFile(p.file('big'), 'x'.repeat(33))
    let ran = false
    await expect(
      p.capture(['big'], async () => {
        ran = true
      })
    ).rejects.toThrow('oversized')
    expect(ran).toBe(false)
    const q = await fixture({ limits: { storeBytes: 2 * 1024 * 1024 + 4096 } })
    await fs.writeFile(q.file('a'), randomBytes(64 * 1024))
    await expect(
      q.capture(['a'], async () => {
        ran = true
      })
    ).rejects.toThrow('capacity')
    expect(ran).toBe(false)
    const r = await fixture({ limits: { records: 2 } })
    for (let i = 0; i < 5; i++) await r.capture(['a'], () => fs.writeFile(r.file('a'), String(i)))
    expect(await r.store.list()).toHaveLength(2)
    const usage = await r.store.prune()
    expect(usage.objects).toBe(3)
  })
  it('refuses symlinks, hard links, metadata, secrets and traversal; leaves targets untouched', async () => {
    const p = await fixture()
    await fs.writeFile(path.join(p.root, 'outside'), 'safe')
    await fs.symlink(path.join(p.root, 'outside'), p.file('link'))
    await fs.writeFile(p.file('original'), 'same')
    await fs.link(p.file('original'), p.file('hard'))
    for (const name of [
      '../outside',
      'link',
      'hard',
      '.git/config',
      '.env.local',
      'node_modules/x',
      'x\u001b',
    ]) {
      let ran = false
      await expect(
        p.capture([name], async () => {
          ran = true
        })
      ).rejects.toThrow()
      expect(ran).toBe(false)
    }
    expect(await fs.readFile(path.join(p.root, 'outside'), 'utf8')).toBe('safe')
    await expect(CheckpointStore.open(p.cwd, { directory: p.file('inside') })).rejects.toThrow(
      'outside'
    )
  })
  it('keeps a pending before-image on post-effect failure and requires explicit recovery', async () => {
    let fail = true
    const p = await fixture({
      fault: point => {
        if (point === 'effect' && fail) throw new Error('disk failure')
      },
    })
    await fs.writeFile(p.file('a'), 'old')
    await expect(p.capture(['a'], () => fs.writeFile(p.file('a'), 'effect'))).rejects.toThrow(
      'may have completed'
    )
    fail = false
    const [pending] = await p.store.list()
    expect(pending.state).toBe('pending')
    await expect(p.store.preview(pending.id)).rejects.toThrow('no settled outcome')
    await expect(p.capture(['b'], () => fs.writeFile(p.file('b'), 'bad'))).rejects.toThrow(
      'Unsettled'
    )
    await undo(p.store, pending.id, true)
    expect(await fs.readFile(p.file('a'), 'utf8')).toBe('old')
    expect((await p.store.list()).every(r => r.state === 'ready')).toBe(true)
  })
  it('resumes a multi-file interrupted restore without overwriting a new conflict', async () => {
    let fail = false
    const p = await fixture({
      fault: point => {
        if (point === 'restored-file' && fail) {
          fail = false
          throw new Error('crash')
        }
      },
    })
    await fs.writeFile(p.file('a'), 'a0')
    await fs.writeFile(p.file('b'), 'b0')
    await p.capture(['a', 'b'], async () => {
      await fs.writeFile(p.file('a'), 'a1')
      await fs.writeFile(p.file('b'), 'b1')
    })
    const [source] = await p.store.list()
    fail = true
    await expect(undo(p.store, source.id)).rejects.toThrow('crash')
    const pending = (await p.store.list()).find(r => r.state === 'pending')!
    expect(pending.kind).toBe('restore')
    expect(await fs.readFile(p.file('a'), 'utf8')).toBe('a0')
    await fs.writeFile(p.file('b'), 'human')
    expect((await p.store.preview(pending.id, true)).changes.some(c => c.conflict)).toBe(true)
    await expect(undo(p.store, pending.id, true)).rejects.toThrow('conflict')
    await fs.writeFile(p.file('b'), 'b1')
    const record = await undo(p.store, pending.id, true)
    expect(await fs.readFile(p.file('b'), 'utf8')).toBe('b0')
    await undo(p.store, record.id)
    expect(await fs.readFile(p.file('a'), 'utf8')).toBe('a1')
    expect(await fs.readFile(p.file('b'), 'utf8')).toBe('b1')
  })
  it('validates manifest and all restore content before writing, including corrupt objects', async () => {
    const p = await fixture()
    await fs.writeFile(p.file('a'), 'old')
    await p.capture(['a'], () => fs.writeFile(p.file('a'), 'new'))
    const [record] = await p.store.list(),
      file = path.join(p.store.directory, 'records', record.id + '.json')
    const raw = await fs.readFile(file, 'utf8')
    await fs.writeFile(file, JSON.stringify({ ...record, version: 100 }))
    await expect(p.store.read(record.id)).rejects.toThrow('Invalid')
    await fs.writeFile(file, raw)
    await fs.writeFile(
      path.join(p.store.directory, 'objects', record.changes[0].before!.chunks[0]),
      'corrupt'
    )
    await expect(p.store.preview(record.id)).rejects.toThrow()
    expect(await fs.readFile(p.file('a'), 'utf8')).toBe('new')
  })
  it('serializes writers, supports readers on an absent store without creating it', async () => {
    const p = await fixture()
    expect(await p.store.list()).toEqual([])
    await expect(fs.stat(p.store.directory)).rejects.toThrow()
    let release!: () => void, entered!: () => void
    const ready = new Promise<void>(r => (entered = r)),
      gate = new Promise<void>(r => (release = r))
    const first = p.capture(['a'], async () => {
      entered()
      await gate
      await fs.writeFile(p.file('a'), 'first')
    })
    await ready
    const other = await CheckpointStore.open(p.cwd, { directory: p.directory })
    await expect(
      other.capture(
        { cwd: p.cwd, paths: ['a'], toolName: 'other', toolCallId: '2' },
        async () => 'bad'
      )
    ).rejects.toThrow('another operation')
    release()
    await first
    expect(await fs.readFile(p.file('a'), 'utf8')).toBe('first')
  })
  it('recovers a real killed writer across processes without replaying its tool', async () => {
    const p = await fixture()
    await fs.writeFile(p.file('a'), 'old')
    const module = new URL('../../packages/tui/dist/checkpoint-store.js', import.meta.url).href
    const script = `import {CheckpointStore} from ${JSON.stringify(module)};import fs from 'node:fs/promises';const s=await CheckpointStore.open(process.argv[1],{directory:process.argv[2]});await s.capture({cwd:process.argv[1],paths:['a'],toolName:'crash',toolCallId:'1'},async()=>{await fs.writeFile(process.argv[1]+'/a','effect');process.stdout.write('written');setInterval(()=>{},1000);await new Promise(()=>{});return 'never'});`
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', script, p.cwd, p.directory],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const exit = new Promise<void>(resolve => child.once('exit', () => resolve()))
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve())
      child.once('error', reject)
      child.stderr.once('data', data => reject(new Error(String(data))))
    })
    child.kill('SIGKILL')
    await exit
    const [pending] = await p.store.list()
    expect(pending.state).toBe('pending')
    await undo(p.store, pending.id, true)
    expect(await fs.readFile(p.file('a'), 'utf8')).toBe('old')
  })
})
