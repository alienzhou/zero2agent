import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { homedir, hostname } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { deflateRaw, inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'
import type { FileMutationHandler } from '@zero2agent/core'

const compress = promisify(deflateRaw)
const decompress = promisify(inflateRaw)
const MiB = 1024 * 1024
const RECORD_BYTES = 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HASH = /^[0-9a-f]{64}$/
export const CHECKPOINT_LIMITS = {
  fileBytes: 32 * MiB,
  operationBytes: 64 * MiB,
  storeBytes: 256 * MiB,
  records: 50,
  days: 30,
  paths: 128,
  objects: 16_384,
}
export const CHECKPOINT_SCOPE =
  '仅保护 write_file / replace_in_file / delete；shell、人工终端与外部服务不自动回退。'
export interface FileVersion {
  hash: string
  size: number
  mode: number
  chunks: string[]
}
export interface FileChange {
  path: string
  before: FileVersion | null
  after?: FileVersion | null
}
export interface Checkpoint {
  version: 1
  sequence: number
  id: string
  workspace: string
  createdAt: string
  kind: 'tool' | 'restore'
  state: 'pending' | 'ready'
  toolName: string
  toolCallId?: string
  operationId?: string
  sessionId?: string
  sourceId?: string
  owner: { pid: number; host: string }
  changes: FileChange[]
}
export interface RestorePlan {
  id: string
  token: string
  recovery: boolean
  resume: boolean
  changes: Array<{
    path: string
    from: FileVersion | null
    to: FileVersion | null
    conflict: boolean
  }>
  text: string
}
export interface CheckpointUsage {
  records: number
  pending: number
  objects: number
  logicalBytes: number
  storedBytes: number
  allocatedBytes: number
}
export interface CheckpointOptions {
  directory?: string
  limits?: Partial<typeof CHECKPOINT_LIMITS>
  onStatus?: (message: string) => void
  /** Fault injection for durability tests; not a production configuration. */
  fault?: (
    point: 'prepared' | 'effect' | 'restore-intent' | 'restored-file'
  ) => void | Promise<void>
}
const hash = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')
const equal = (a: FileVersion | null | undefined, b: FileVersion | null | undefined): boolean =>
  a === null || b === null || a === undefined || b === undefined
    ? a === b
    : a.hash === b.hash && a.size === b.size && a.mode === b.mode
const errorCode = (e: unknown): string | undefined => (e as NodeJS.ErrnoException).code
async function physicalDirectory(value: string): Promise<string> {
  let current = path.resolve(value)
  const tail: string[] = []
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...tail)
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
      try {
        if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Dangling storage symlink')
      } catch (e) {
        if (errorCode(e) !== 'ENOENT') throw e
      }
      tail.unshift(path.basename(current))
      const parent = path.dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}
const allocated = (s: { size: number; blocks?: number }): number =>
  Math.max(s.size, (s.blocks ?? 0) * 512)

// Deterministic Gear hash. Boundaries depend on nearby content, so insertions can resynchronize.
const gear = Uint32Array.from({ length: 256 }, (_, i) =>
  createHash('sha256').update(`zero2agent-chunk-v1:${i}`).digest().readUInt32LE(0)
)
export function* contentChunks(data: Buffer): Generator<Buffer> {
  let start = 0
  let rolling = 0
  for (let i = 0; i < data.length; i++) {
    rolling = ((rolling << 1) + gear[data[i]]) >>> 0
    const length = i + 1 - start
    if (length >= 256 * 1024 || (length >= 16 * 1024 && (rolling & 0xffff) === 0)) {
      yield data.subarray(start, i + 1)
      start = i + 1
      rolling = 0
    }
  }
  if (start < data.length) yield data.subarray(start)
}

/** Local recovery store. No Git, recursive workspace walk, model calls, or tool replay. */
export class CheckpointStore {
  readonly limits: typeof CHECKPOINT_LIMITS
  private sequence = 0
  private used = 0
  private objectCount = 0
  private inFlight = false
  private failure = ''
  private constructor(
    readonly cwd: string,
    readonly directory: string,
    readonly workspace: string,
    private options: CheckpointOptions
  ) {
    this.limits = { ...CHECKPOINT_LIMITS, ...options.limits }
    for (const value of Object.values(this.limits))
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid checkpoint limits')
    if (
      this.limits.fileBytes > CHECKPOINT_LIMITS.fileBytes ||
      this.limits.paths > 128 ||
      this.limits.records > 500
    )
      throw new Error('Checkpoint limits exceed reader safety bounds')
  }
  static async open(cwd: string, options: CheckpointOptions = {}): Promise<CheckpointStore> {
    const root = await fs.realpath(cwd)
    const workspace = hash(root)
    const base = await physicalDirectory(
      options.directory ??
        process.env.ZERO2AGENT_CHECKPOINT_DIR ??
        path.join(homedir(), '.zero2agent', 'checkpoints')
    )
    const directory = path.join(base, workspace)
    // Opening a reader creates no state and does not run GC.
    return new CheckpointStore(root, directory, workspace, options)
  }
  get status(): string {
    return this.failure ? `文件保护失败: ${this.failure}` : '文件保护开启 · /checkpoints'
  }
  private notify(message: string): void {
    try {
      this.options.onStatus?.(message)
    } catch {
      /* Presentation cannot alter durability. */
    }
  }
  private async initialize(): Promise<void> {
    if (this.directory === this.cwd || this.directory.startsWith(this.cwd + path.sep))
      throw new Error(
        'Checkpoint storage must be outside the workspace; set ZERO2AGENT_CHECKPOINT_DIR'
      )
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    if ((await fs.lstat(this.directory)).isSymbolicLink())
      throw new Error('Symlink checkpoint directory refused')
    await fs.chmod(this.directory, 0o700)
    for (const name of ['objects', 'records']) {
      const dir = path.join(this.directory, name)
      await fs.mkdir(dir, { mode: 0o700 }).catch(e => {
        if (errorCode(e) !== 'EEXIST') throw e
      })
      const stat = await fs.lstat(dir)
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Unsafe checkpoint directory')
      await fs.chmod(dir, 0o700)
    }
  }
  private async syncDirectory(directory: string): Promise<void> {
    const handle = await fs.open(directory, constants.O_RDONLY)
    try {
      await handle.sync()
    } catch (e) {
      if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes(errorCode(e) ?? '')) throw e
    } finally {
      await handle.close()
    }
  }
  private async atomic(file: string, data: Buffer | string): Promise<void> {
    const temp = file + '.' + randomUUID() + '.tmp'
    const handle = await fs.open(temp, 'wx', 0o600)
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await fs.rename(temp, file)
      await this.syncDirectory(path.dirname(file))
    } finally {
      await fs.unlink(temp).catch(() => {})
    }
  }
  private async readSafe(file: string, limit: number): Promise<Buffer> {
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit)
        throw new Error('Unsafe or oversized checkpoint data')
      const data = Buffer.alloc(stat.size)
      let offset = 0
      while (offset < data.length) {
        const { bytesRead } = await handle.read(data, offset, data.length - offset, offset)
        if (!bytesRead) throw new Error('Truncated checkpoint data')
        offset += bytesRead
      }
      const end = await handle.stat()
      if (stat.size !== end.size || stat.mtimeMs !== end.mtimeMs || stat.ctimeMs !== end.ctimeMs)
        throw new Error('Checkpoint data changed during read')
      return data
    } finally {
      await handle.close()
    }
  }
  private async assertStore(): Promise<boolean> {
    try {
      for (const dir of [
        this.directory,
        path.join(this.directory, 'objects'),
        path.join(this.directory, 'records'),
      ]) {
        const s = await fs.lstat(dir)
        if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('Unsafe checkpoint directory')
      }
      return true
    } catch (e) {
      if (errorCode(e) === 'ENOENT') return false
      throw e
    }
  }
  private async lock<T>(action: () => Promise<T>): Promise<T> {
    if (this.inFlight) throw new Error('Checkpoint store is busy')
    this.inFlight = true
    const lock = path.join(this.directory, 'lock')
    const ownerPath = path.join(lock, 'owner.json')
    const owner = { pid: process.pid, host: hostname(), nonce: randomUUID() }
    let held = false
    try {
      await this.initialize()
      try {
        await fs.mkdir(lock, { mode: 0o700 })
        held = true
      } catch (e) {
        if (errorCode(e) !== 'EEXIST') throw e
        if (!(await fs.lstat(lock)).isDirectory() || (await fs.lstat(lock)).isSymbolicLink())
          throw new Error('Unsafe checkpoint lock')
        const previous = JSON.parse((await this.readSafe(ownerPath, 4096)).toString())
        if (
          previous.host !== hostname() ||
          !Number.isSafeInteger(previous.pid) ||
          previous.pid <= 0
        )
          throw new Error('Cannot verify checkpoint owner; inspect lock manually')
        try {
          process.kill(previous.pid, 0)
          throw new Error('Checkpoint store is used by another operation')
        } catch (e) {
          if (errorCode(e) !== 'ESRCH') throw e
        }
        // Claim inside the existing directory: never unlink a lock a successor may own.
        const claim = await fs.open(path.join(lock, 'claim'), 'wx', 0o600)
        await claim.close()
        try {
          const current = JSON.parse((await this.readSafe(ownerPath, 4096)).toString())
          if (current.nonce !== previous.nonce) throw new Error('Checkpoint lock changed; retry')
          await this.atomic(ownerPath, JSON.stringify(owner))
          held = true
        } finally {
          await fs.unlink(path.join(lock, 'claim'))
        }
      }
      await this.atomic(ownerPath, JSON.stringify(owner))
      return await action()
    } finally {
      try {
        if (held) {
          await fs.unlink(ownerPath)
          await fs.rmdir(lock)
        }
      } finally {
        this.inFlight = false
      }
    }
  }
  private relative(value: string): string {
    const relative = path
      .relative(this.cwd, path.resolve(this.cwd, value))
      .split(path.sep)
      .join('/')
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith('../') ||
      path.isAbsolute(relative) ||
      relative.includes('\\') ||
      relative.length > 1024 ||
      [...relative].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new Error('Checkpoint path must be a regular workspace file')
    if (
      relative
        .split('/')
        .some(
          part =>
            ['.git', '.hg', '.svn', 'node_modules', '.ssh'].includes(part) ||
            part === '.env' ||
            part.startsWith('.env.') ||
            /\.(pem|key)$/i.test(part)
        )
    )
      throw new Error(
        'Checkpoint excludes repository metadata, dependencies and common credential files; choose --no-checkpoints explicitly if needed'
      )
    return relative
  }
  private async absolute(relative: string): Promise<string> {
    if (this.relative(relative) !== relative) throw new Error('Noncanonical checkpoint path')
    if ((await fs.realpath(this.cwd)) !== this.cwd) throw new Error('Workspace root changed')
    let current = this.cwd
    const parts = relative.split('/')
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i])
      try {
        const stat = await fs.lstat(current)
        if (
          stat.isSymbolicLink() ||
          (i < parts.length - 1 && !stat.isDirectory()) ||
          (i === parts.length - 1 && (!stat.isFile() || stat.nlink !== 1))
        )
          throw new Error(`Checkpoint refuses links or non-regular paths: ${relative}`)
      } catch (e) {
        if (errorCode(e) !== 'ENOENT') throw e
      }
    }
    return current
  }
  private async snapshot(relative: string, save: boolean): Promise<FileVersion | null> {
    const file = await this.absolute(relative)
    let data: Buffer
    let mode: number
    try {
      const stat = await fs.lstat(file)
      data = await this.readSafe(file, this.limits.fileBytes)
      const end = await fs.lstat(file)
      if (
        stat.ino !== end.ino ||
        stat.dev !== end.dev ||
        stat.size !== end.size ||
        stat.mtimeMs !== end.mtimeMs ||
        stat.ctimeMs !== end.ctimeMs
      )
        throw new Error(`File changed while capturing: ${relative}`)
      mode = stat.mode & 0o777
    } catch (e) {
      if (errorCode(e) === 'ENOENT') return null
      throw e
    }
    const chunks: string[] = []
    for (const chunk of contentChunks(data)) {
      const digest = hash(chunk)
      chunks.push(digest)
      if (save) {
        const object = path.join(this.directory, 'objects', digest)
        try {
          const existing = await this.readObject(digest)
          if (!existing.equals(chunk)) throw new Error('Checkpoint hash collision')
        } catch (e) {
          if (errorCode(e) !== 'ENOENT') throw e
          const compressed = await compress(chunk, { level: 3 })
          const charge = Math.ceil(compressed.length / 4096) * 4096
          if (
            this.used + charge + 2 * RECORD_BYTES > this.limits.storeBytes ||
            this.objectCount >= this.limits.objects
          )
            throw new Error(
              'Checkpoint capacity exceeded; prune old checkpoints or explicitly use --no-checkpoints'
            )
          await this.atomic(object, compressed)
          this.used += allocated(await fs.stat(object))
          this.objectCount++
        }
      }
    }
    return { hash: hash(data), size: data.length, mode, chunks }
  }
  private async readObject(digest: string): Promise<Buffer> {
    if (!HASH.test(digest)) throw new Error('Invalid checkpoint object hash')
    const data = await decompress(
      await this.readSafe(path.join(this.directory, 'objects', digest), 257 * 1024),
      { maxOutputLength: 256 * 1024 }
    )
    if (hash(data) !== digest) throw new Error('Corrupt checkpoint object')
    return data
  }
  async content(version: FileVersion | null): Promise<Buffer> {
    if (!version) return Buffer.alloc(0)
    const buffers: Buffer[] = []
    let length = 0
    for (const digest of version.chunks) {
      const data = await this.readObject(digest)
      length += data.length
      if (length > version.size || length > this.limits.fileBytes)
        throw new Error('Checkpoint content exceeds declared size')
      buffers.push(data)
    }
    const data = Buffer.concat(buffers)
    if (length !== version.size || hash(data) !== version.hash)
      throw new Error('Corrupt checkpoint file')
    return data
  }
  private validate(value: unknown): Checkpoint {
    if (!value || typeof value !== 'object') throw new Error('Invalid checkpoint')
    const record = value as Checkpoint
    if (
      record.version !== 1 ||
      !Number.isSafeInteger(record.sequence) ||
      record.sequence <= 0 ||
      !UUID.test(record.id) ||
      record.workspace !== this.workspace ||
      !['tool', 'restore'].includes(record.kind) ||
      !['pending', 'ready'].includes(record.state) ||
      typeof record.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(record.createdAt)) ||
      !record.owner ||
      !Number.isSafeInteger(record.owner.pid) ||
      record.owner.pid <= 0 ||
      typeof record.owner.host !== 'string' ||
      record.owner.host.length > 255 ||
      typeof record.toolName !== 'string' ||
      record.toolName.length > 100 ||
      !Array.isArray(record.changes) ||
      record.changes.length > this.limits.paths
    )
      throw new Error('Invalid checkpoint manifest')
    for (const key of ['toolCallId', 'operationId', 'sessionId', 'sourceId'] as const)
      if (
        record[key] !== undefined &&
        (typeof record[key] !== 'string' || record[key]!.length > 200)
      )
        throw new Error('Invalid checkpoint identity')
    const seen = new Set<string>()
    let size = 0
    for (const change of record.changes) {
      if (
        typeof change.path !== 'string' ||
        this.relative(change.path) !== change.path ||
        seen.has(change.path)
      )
        throw new Error('Invalid checkpoint path')
      seen.add(change.path)
      if (
        change.before === undefined ||
        (record.state === 'ready' && change.after === undefined) ||
        (record.kind === 'restore' && change.after === undefined)
      )
        throw new Error('Missing checkpoint file version')
      for (const version of [change.before, change.after]) {
        if (version === null || version === undefined) continue
        if (
          !HASH.test(version.hash) ||
          !Number.isSafeInteger(version.size) ||
          version.size < 0 ||
          version.size > this.limits.fileBytes ||
          !Number.isSafeInteger(version.mode) ||
          version.mode < 0 ||
          version.mode > 0o777 ||
          !Array.isArray(version.chunks) ||
          version.chunks.length > Math.ceil(this.limits.fileBytes / (16 * 1024)) + 1 ||
          !version.chunks.every(digest => typeof digest === 'string' && HASH.test(digest))
        )
          throw new Error('Invalid checkpoint file version')
        size += version.size
      }
    }
    if (size > 2 * this.limits.operationBytes) throw new Error('Checkpoint operation too large')
    return record
  }
  async read(id: string): Promise<Checkpoint> {
    if (!UUID.test(id)) throw new Error('Checkpoint requires a full UUID')
    if (!(await this.assertStore())) throw new Error('No checkpoints in this workspace')
    const record = this.validate(
      JSON.parse(
        (
          await this.readSafe(path.join(this.directory, 'records', id + '.json'), RECORD_BYTES)
        ).toString()
      )
    )
    if (record.id !== id) throw new Error('Checkpoint ID mismatch')
    return record
  }
  async list(): Promise<Checkpoint[]> {
    if (!(await this.assertStore())) return []
    const dir = await fs.opendir(path.join(this.directory, 'records'))
    const records: Checkpoint[] = []
    let visited = 0
    for await (const entry of dir) {
      if (++visited > 1024) throw new Error('Checkpoint manifest directory exceeds scan limit')
      if (entry.name.endsWith('.tmp')) continue
      if (
        !entry.isFile() ||
        !UUID.test(entry.name.replace(/\.json$/, '')) ||
        !entry.name.endsWith('.json')
      )
        throw new Error('Unexpected checkpoint manifest entry')
      records.push(await this.read(entry.name.slice(0, -5)))
    }
    return records.sort((a, b) => b.sequence - a.sequence || b.id.localeCompare(a.id))
  }
  private async write(record: Checkpoint): Promise<void> {
    this.validate(record)
    const body = JSON.stringify(record)
    if (Buffer.byteLength(body) > RECORD_BYTES) throw new Error('Checkpoint manifest too large')
    await this.atomic(path.join(this.directory, 'records', record.id + '.json'), body)
  }
  private fresh(
    toolName: string,
    changes: FileChange[],
    metadata: Partial<Checkpoint> = {}
  ): Checkpoint {
    return {
      version: 1,
      sequence: ++this.sequence,
      id: randomUUID(),
      workspace: this.workspace,
      createdAt: new Date().toISOString(),
      kind: 'tool',
      state: 'pending',
      toolName,
      owner: { pid: process.pid, host: hostname() },
      changes,
      ...metadata,
    }
  }
  readonly capture: FileMutationHandler = async (mutation, execute) => {
    try {
      const result = await this.lock(async () => {
        if ((await fs.realpath(mutation.cwd)) !== this.cwd)
          throw new Error('Checkpoint workspace mismatch')
        const paths = [...new Set(mutation.paths.map(value => this.relative(value)))].sort()
        if (paths.length > this.limits.paths) throw new Error('Too many checkpoint paths')
        await this.collect(this.limits.records - 1)
        if ((await this.list()).some(record => record.state === 'pending'))
          throw new Error(
            'Unsettled checkpoint exists; inspect /checkpoints and recover before another protected write'
          )
        const changes: FileChange[] = []
        for (const file of paths)
          changes.push({ path: file, before: await this.snapshot(file, true) })
        if (changes.reduce((sum, c) => sum + (c.before?.size ?? 0), 0) > this.limits.operationBytes)
          throw new Error('Checkpoint operation exceeds byte limit')
        if (!paths.length) return execute()
        const record = this.fresh(mutation.toolName, changes, {
          toolCallId: mutation.toolCallId,
          operationId: mutation.operationId,
          sessionId: mutation.sessionId,
        })
        await this.write(record)
        await this.options.fault?.('prepared')
        if (mutation.signal?.aborted) {
          await fs.unlink(path.join(this.directory, 'records', record.id + '.json'))
          throw new Error('Cancelled before protected mutation')
        }
        for (const change of changes) {
          if (!equal(await this.snapshot(change.path, false), change.before)) {
            await fs.unlink(path.join(this.directory, 'records', record.id + '.json'))
            throw new Error(`File changed before protected mutation: ${change.path}`)
          }
        }
        let result: string | undefined
        let failure: unknown
        try {
          result = await execute()
        } catch (e) {
          failure = e
        }
        try {
          await this.options.fault?.('effect')
          for (const change of changes) change.after = await this.snapshot(change.path, true)
          if (
            changes.reduce((sum, c) => sum + (c.after?.size ?? 0), 0) > this.limits.operationBytes
          )
            throw new Error('Checkpoint result exceeds byte limit')
          record.changes = changes.filter(c => !equal(c.before, c.after))
          record.state = 'ready'
          if (record.changes.length) {
            await this.write(record)
            this.notify(`Checkpoint ${record.id} · ${record.changes.length} 个文件`)
          } else await fs.unlink(path.join(this.directory, 'records', record.id + '.json'))
        } catch {
          throw new Error(
            `File mutation may have completed; checkpoint ${record.id} remains pending. Inspect /checkpoints; do not repeat the tool automatically.`
          )
        }
        if (failure) throw failure
        return result!
      })
      this.failure = ''
      return result
    } catch (e) {
      this.failure = e instanceof Error ? e.message : 'Checkpoint failed'
      this.notify(this.status)
      throw e
    }
  }
  private async collect(keep: number, protectedId?: string): Promise<CheckpointUsage> {
    const records = await this.list()
    this.sequence = Math.max(this.sequence, ...records.map(r => r.sequence))
    const cutoff = Date.now() - this.limits.days * 86400_000
    const retained: Checkpoint[] = []
    let completed = 0
    for (const record of records) {
      if (
        record.id === protectedId ||
        record.state === 'pending' ||
        (completed++ < keep && Date.parse(record.createdAt) >= cutoff)
      )
        retained.push(record)
      else await fs.unlink(path.join(this.directory, 'records', record.id + '.json'))
    }
    // Publish reference deletion before reclaiming its objects (crash ordering).
    await this.syncDirectory(path.join(this.directory, 'records'))
    const live = new Set(
      retained.flatMap(record =>
        record.changes.flatMap(c => [...(c.before?.chunks ?? []), ...(c.after?.chunks ?? [])])
      )
    )
    const directory = await fs.opendir(path.join(this.directory, 'objects'))
    let visited = 0
    for await (const entry of directory) {
      if (++visited > this.limits.objects + 1024)
        throw new Error('Checkpoint object directory exceeds scan limit')
      if (!entry.isFile() || (!HASH.test(entry.name) && !entry.name.endsWith('.tmp')))
        throw new Error('Unexpected checkpoint object entry')
      if (!live.has(entry.name)) await fs.unlink(path.join(this.directory, 'objects', entry.name))
    }
    for (const entry of await fs.readdir(path.join(this.directory, 'records')))
      if (entry.endsWith('.tmp')) await fs.unlink(path.join(this.directory, 'records', entry))
    const usage = await this.usage()
    this.used = usage.allocatedBytes
    this.objectCount = usage.objects
    return usage
  }
  async prune(): Promise<CheckpointUsage> {
    return this.lock(() => this.collect(this.limits.records))
  }
  async usage(): Promise<CheckpointUsage> {
    const records = await this.list()
    const usage = {
      records: records.length,
      pending: records.filter(r => r.state === 'pending').length,
      objects: 0,
      logicalBytes: records.reduce(
        (sum, r) =>
          sum + r.changes.reduce((s, c) => s + (c.before?.size ?? 0) + (c.after?.size ?? 0), 0),
        0
      ),
      storedBytes: 0,
      allocatedBytes: 0,
    }
    if (!(await this.assertStore())) return usage
    for (const sub of ['objects', 'records']) {
      const dir = await fs.opendir(path.join(this.directory, sub))
      let visited = 0
      for await (const entry of dir) {
        if (++visited > (sub === 'objects' ? this.limits.objects + 1024 : 1024))
          throw new Error('Checkpoint directory exceeds scan limit')
        const stat = await fs.lstat(path.join(this.directory, sub, entry.name))
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
          throw new Error('Unsafe checkpoint data')
        usage.storedBytes += stat.size
        usage.allocatedBytes += allocated(stat)
        if (sub === 'objects' && HASH.test(entry.name)) usage.objects++
      }
    }
    return usage
  }
  private async plan(id: string, recovery: boolean): Promise<RestorePlan> {
    const record = await this.read(id)
    if (record.state === 'pending' && !recovery)
      throw new Error(
        'Checkpoint has no settled outcome; use /recover UUID to inspect current files explicitly'
      )
    if (record.state === 'ready' && recovery)
      throw new Error('Checkpoint is settled; use /undo UUID')
    if (record.state === 'pending' && record.owner.pid !== process.pid) {
      if (record.owner.host !== hostname())
        throw new Error('Cannot verify checkpoint owner on another host')
      try {
        process.kill(record.owner.pid, 0)
        throw new Error('Checkpoint owner is still running')
      } catch (e) {
        if (errorCode(e) !== 'ESRCH') throw e
      }
    }
    const resume = record.state === 'pending' && record.kind === 'restore'
    const changes: RestorePlan['changes'] = []
    for (const c of record.changes) {
      const from = await this.snapshot(c.path, false)
      const to = resume ? c.after! : c.before
      await this.content(to) // Verify every target before any workspace mutation.
      changes.push({
        path: c.path,
        from,
        to,
        conflict: resume
          ? !equal(from, c.before) && !equal(from, to)
          : !recovery && !equal(from, c.after),
      })
    }
    const token = hash(JSON.stringify({ record, recovery, changes }))
    const lines = [
      `${resume ? '继续中断的回退' : recovery ? '恢复未结算写入前的文件' : '回退文件'} · ${id}`,
      CHECKPOINT_SCOPE,
      '会话原史与运行日志保留。确认后仍会重新校验磁盘；多文件逐个替换。',
      ...changes.map(
        c =>
          `${c.conflict ? 'CONFLICT' : equal(c.from, c.to) ? '已是目标' : !c.to ? '删除' : !c.from ? '恢复' : '替换'}  ${c.path}  ${c.from?.size ?? 0} → ${c.to?.size ?? 0} bytes`
      ),
      ...(recovery
        ? ['原操作未结算，无法证明当前差异均来自 Agent；确认表示接受以上当前文件将被替换。']
        : []),
      `确认令牌: ${token}`,
    ]
    return { id, token, recovery, resume, changes, text: lines.join('\n') }
  }
  async preview(id: string, recovery = false): Promise<RestorePlan> {
    // Readers do not create a store. Serialize against capture/GC if data exists.
    if (!(await this.assertStore())) throw new Error('No checkpoints in this workspace')
    return this.lock(() => this.plan(id, recovery))
  }
  async restore(id: string, token: string, recovery = false): Promise<Checkpoint> {
    return this.lock(async () => {
      const plan = await this.plan(id, recovery)
      if (plan.token !== token)
        throw new Error('Checkpoint or files changed after preview; preview again')
      if (plan.changes.some(c => c.conflict))
        throw new Error('File conflict: refusing to overwrite later edits')
      const pending = (await this.list()).filter(r => r.state === 'pending' && r.id !== id)
      if (pending.length) throw new Error('Another checkpoint is pending; inspect it first')
      await this.collect(this.limits.records - 1, id)
      const source = await this.read(id)
      let record: Checkpoint
      if (plan.resume) record = source
      else {
        const changes: FileChange[] = []
        for (const c of plan.changes) {
          const before = await this.snapshot(c.path, true)
          if (!equal(before, c.from)) throw new Error('File changed while preparing rollback')
          changes.push({ path: c.path, before, after: c.to })
        }
        record = this.fresh('undo', changes, {
          kind: 'restore',
          sourceId: id,
          sessionId: source.sessionId,
        })
        await this.write(record)
        if (source.state === 'pending') {
          await fs.unlink(path.join(this.directory, 'records', source.id + '.json'))
          await this.syncDirectory(path.join(this.directory, 'records'))
        }
      }
      await this.options.fault?.('restore-intent')
      for (const c of record.changes) {
        const live = await this.snapshot(c.path, false)
        if (equal(live, c.after)) continue
        if (!equal(live, c.before))
          throw new Error(`Restore paused at conflict: ${c.path}; /recover ${record.id}`)
        await this.apply(c.path, c.before, c.after!)
        await this.options.fault?.('restored-file')
      }
      record.state = 'ready'
      await this.write(record)
      await this.collect(this.limits.records)
      this.failure = ''
      this.notify(`已回退文件；撤销这次回退: /undo ${record.id}`)
      return record
    })
  }
  private async apply(
    relative: string,
    expected: FileVersion | null,
    target: FileVersion | null
  ): Promise<void> {
    const file = await this.absolute(relative)
    const bytes = await this.content(target)
    if (!equal(await this.snapshot(relative, false), expected))
      throw new Error(`File changed before restore: ${relative}`)
    if (target === null) {
      await fs.unlink(file)
      await this.syncDirectory(path.dirname(file))
      return
    }
    await fs.mkdir(path.dirname(file), { recursive: true })
    await this.absolute(relative)
    const temp = path.join(path.dirname(file), `.zero2agent-restore-${randomUUID()}.tmp`)
    const handle = await fs.open(temp, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.chmod(target.mode)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await this.absolute(relative)
      if (!equal(await this.snapshot(relative, false), expected))
        throw new Error(`File changed before replacement: ${relative}`)
      if (expected === null) {
        await fs.link(temp, file)
        await fs.unlink(temp)
      } else await fs.rename(temp, file)
      await this.syncDirectory(path.dirname(file))
    } finally {
      await fs.unlink(temp).catch(() => {})
    }
  }
}
