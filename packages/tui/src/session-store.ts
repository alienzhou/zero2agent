import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { validateSessionSnapshot, type SessionSnapshot } from '@zero2agent/core'

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const REVISION = /^([1-9][0-9]{0,8})\.json$/
const MAX_BYTES = 32 * 1024 * 1024

export interface StoredSession {
  version: 1
  id: string
  cwd: string
  title: string
  createdAt: string
  updatedAt: string
  revision: number
  state: SessionSnapshot
  pending?: { kind: 'turn' | 'compact'; pid: number; host: string }
}
export interface SessionItem {
  id: string
  title: string
  updatedAt: string
  revision: number
  pending: boolean
  error?: string
}

function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code
}
function validId(id: string): void {
  if (!ID.test(id)) throw new Error('Session ID must be a complete lowercase UUID.')
}
async function directory(location: string, create: boolean): Promise<void> {
  if (create) await fs.mkdir(location, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(location)
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('Session directory must not be a symbolic link.')
}

/** Local immutable generations: publish complete bytes with an exclusive link, never overwrite. */
export class SessionStore {
  private constructor(
    readonly cwd: string,
    readonly directory: string
  ) {}

  static async open(
    cwd: string,
    root = process.env.ZERO2AGENT_SESSION_DIR ?? path.join(homedir(), '.zero2agent', 'sessions')
  ): Promise<SessionStore> {
    const canonical = await fs.realpath(cwd)
    const workspace = createHash('sha256').update(canonical).digest('hex')
    return new SessionStore(canonical, path.join(path.resolve(root), workspace))
  }

  fresh(): StoredSession {
    const now = new Date().toISOString()
    return {
      version: 1,
      id: randomUUID(),
      cwd: this.cwd,
      title: '新会话',
      createdAt: now,
      updatedAt: now,
      revision: 0,
      state: { messages: [], context: { through: 0, summary: '' } },
    }
  }

  private async latest(location: string): Promise<number> {
    const files = await fs.readdir(location)
    return files.reduce(
      (latest, file) => Math.max(latest, REVISION.test(file) ? Number(file.slice(0, -5)) : 0),
      0
    )
  }

  async load(id: string): Promise<StoredSession> {
    validId(id)
    await directory(path.dirname(this.directory), false)
    await directory(this.directory, false)
    const location = path.join(this.directory, id)
    await directory(location, false)
    const revision = await this.latest(location)
    if (!revision) throw new Error('Session has no published snapshot.')
    const handle = await fs.open(
      path.join(location, `${revision}.json`),
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_BYTES)
        throw new Error('Session snapshot is not a regular file or exceeds 32 MiB.')
      const data = JSON.parse(await handle.readFile('utf8')) as StoredSession
      if (!data || data.version !== 1) throw new Error('Unsupported session format version.')
      if (data.id !== id || data.cwd !== this.cwd || data.revision !== revision)
        throw new Error('Session identity, workspace or revision does not match.')
      if (
        typeof data.title !== 'string' ||
        data.title.length > 200 ||
        !validDate(data.createdAt) ||
        !validDate(data.updatedAt)
      )
        throw new Error('Invalid session metadata.')
      if (
        data.pending &&
        (!['turn', 'compact'].includes(data.pending.kind) ||
          !Number.isSafeInteger(data.pending.pid) ||
          data.pending.pid <= 0 ||
          typeof data.pending.host !== 'string' ||
          !data.pending.host)
      )
        throw new Error('Invalid pending operation.')
      return {
        version: 1,
        id,
        cwd: this.cwd,
        title: data.title,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        revision,
        state: validateSessionSnapshot(data.state),
        ...(data.pending ? { pending: data.pending } : {}),
      }
    } finally {
      await handle.close()
    }
  }

  async list(): Promise<SessionItem[]> {
    let entries: string[]
    try {
      await directory(path.dirname(this.directory), false)
      await directory(this.directory, false)
      entries = await fs.readdir(this.directory)
    } catch (error) {
      if (code(error) === 'ENOENT') return []
      throw error
    }
    const result: SessionItem[] = []
    for (const id of entries.filter(id => ID.test(id))) {
      try {
        const item = await this.load(id)
        result.push({
          id,
          title: item.title,
          updatedAt: item.updatedAt,
          revision: item.revision,
          pending: !!item.pending,
        })
      } catch (error) {
        result.push({
          id,
          title: '无法读取',
          updatedAt: '',
          revision: 0,
          pending: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  }

  async save(
    current: StoredSession,
    state: SessionSnapshot,
    pending?: StoredSession['pending']
  ): Promise<StoredSession> {
    validId(current.id)
    if (
      current.cwd !== this.cwd ||
      !Number.isSafeInteger(current.revision) ||
      current.revision < 0 ||
      current.revision >= 999_999_999
    )
      throw new Error('Invalid session identity or revision.')
    const snapshot = validateSessionSnapshot(state)
    const first = snapshot.messages.find(
      message => message.role === 'user' && typeof message.content === 'string'
    )
    const next: StoredSession = {
      version: 1,
      id: current.id,
      cwd: this.cwd,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      revision: current.revision + 1,
      title:
        first && typeof first.content === 'string'
          ? first.content.replace(/\s+/g, ' ').slice(0, 120)
          : current.title,
      state: snapshot,
      ...(pending ? { pending } : {}),
    }
    const bytes = JSON.stringify(next) + '\n'
    if (Buffer.byteLength(bytes) > MAX_BYTES)
      throw new Error('Session snapshot exceeds 32 MiB; memory is retained.')
    await directory(path.dirname(this.directory), true)
    await directory(this.directory, true)
    const location = path.join(this.directory, current.id)
    await directory(location, true)
    if ((await this.latest(location)) !== current.revision)
      throw new Error(
        'Session revision conflict: another process saved this conversation. Memory is retained.'
      )
    const temp = path.join(location, `.pending-${randomUUID()}`)
    const target = path.join(location, `${next.revision}.json`)
    const handle = await fs.open(temp, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await fs.link(temp, target)
    } catch (error) {
      if (code(error) === 'EEXIST')
        throw new Error(
          'Session revision conflict: another process saved this conversation. Memory is retained.'
        )
      throw error
    } finally {
      // Temporary files are not published snapshots. Cleanup failure cannot turn a commit into a retry.
      await fs.unlink(temp).catch(() => {})
    }
    // File data is synced. Directory fsync is best effort: do not report a committed generation as unsaved.
    try {
      const dir = await fs.open(location, 'r')
      try {
        await dir.sync()
      } finally {
        await dir.close()
      }
    } catch {
      /* Some local file systems do not support directory fsync. */
    }
    return next
  }
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
