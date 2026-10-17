import { validateExternalSources, type ExternalSource } from './external-source.js'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { resolvePhysicalPath } from './tools/path-guard.js'

export interface ResultSource {
  toolName: string
  toolCallId: string
  /** Resolved paths read by the original tool, plus its workspace. Never model supplied on recall. */
  paths: string[]
  external?: ExternalSource[]
}
export interface ResultEntry {
  reference: string
  sha256: string
  bytes: number
  createdAt: number
  expiresAt: number
  source: ResultSource
}
export interface ResultSnapshot {
  version: 1 | 2
  scope: string
  workspace: string
  entries: ResultEntry[]
}
export interface ResultStoreOptions {
  directory?: string
  maxResultBytes?: number
  maxTotalBytes?: number
  maxResults?: number
  ttlMs?: number
}
export const INLINE_RESULT_BYTES = 20 * 1024
export const MAX_RESULT_READ_BYTES = 4096
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HASH = /^[0-9a-f]{64}$/
const MAX_ENTRIES = 128
const HARD_BYTES = 16 * 1024 * 1024

export class ResultStoreError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(`${code}: ${message}`)
  }
}
function fail(code: string, message: string): never {
  throw new ResultStoreError(code, message)
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

/** Metadata is versioned and bounded; it can never select an arbitrary body path. */
export function validateResultSnapshot(value: unknown): ResultSnapshot {
  const invalid = (): never => fail('INVALID_RESULT_SNAPSHOT', 'Invalid result reference catalog.')
  if (
    !object(value) ||
    ![1, 2].includes(value.version as number) ||
    typeof value.scope !== 'string' ||
    !UUID.test(value.scope) ||
    typeof value.workspace !== 'string' ||
    !path.isAbsolute(value.workspace) ||
    value.workspace.length > 4096 ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_ENTRIES
  )
    invalid()
  const snapshot = value as unknown as ResultSnapshot
  const ids = new Set<string>()
  for (const entry of snapshot.entries) {
    if (
      !object(entry) ||
      typeof entry.reference !== 'string' ||
      !UUID.test(entry.reference) ||
      ids.has(entry.reference) ||
      typeof entry.sha256 !== 'string' ||
      !HASH.test(entry.sha256) ||
      !integer(entry.bytes, 0, HARD_BYTES) ||
      !integer(entry.createdAt, 0, Number.MAX_SAFE_INTEGER) ||
      !integer(entry.expiresAt, entry.createdAt, Number.MAX_SAFE_INTEGER) ||
      !object(entry.source) ||
      typeof entry.source.toolName !== 'string' ||
      !entry.source.toolName ||
      entry.source.toolName.length > 256 ||
      typeof entry.source.toolCallId !== 'string' ||
      !entry.source.toolCallId ||
      entry.source.toolCallId.length > 256 ||
      !Array.isArray(entry.source.paths) ||
      entry.source.paths.length > 128 ||
      entry.source.paths.some(p => typeof p !== 'string' || !path.isAbsolute(p) || p.length > 4096)
    )
      invalid()
    if (entry.source.external !== undefined) {
      if (snapshot.version !== 2) invalid()
      validateExternalSources(entry.source.external)
    }
    ids.add(entry.reference)
  }
  // Whitelist fields rather than copying caller-supplied paths or credentials.
  return {
    version: snapshot.version,
    scope: snapshot.scope,
    workspace: snapshot.workspace,
    entries: snapshot.entries.map(e => ({
      reference: e.reference,
      sha256: e.sha256,
      bytes: e.bytes,
      createdAt: e.createdAt,
      expiresAt: e.expiresAt,
      source: {
        toolName: e.source.toolName,
        toolCallId: e.source.toolCallId,
        paths: [...e.source.paths],
        ...(e.source.external && { external: validateExternalSources(e.source.external) }),
      },
    })),
  }
}

/** Reject symlinks in every ancestor, including when a saved catalog is opened after restart. */
async function directory(location: string, create: boolean): Promise<void> {
  const absolute = path.resolve(location)
  let cursor = path.parse(absolute).root
  for (const component of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component)
    if (create)
      await fs.mkdir(cursor, { mode: 0o700 }).catch(error => {
        if (error.code !== 'EEXIST') throw error
      })
    const stat = await fs.lstat(cursor)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      fail('UNSAFE_RESULT_PATH', 'Result directory contains a symlink or non-directory.')
  }
}

/** One session's immutable bodies. Snapshots store this catalog, never duplicate the bodies. */
export class ResultStore {
  private catalog?: ResultSnapshot
  private cwd = process.cwd()
  private allocatedSpools = new Set<string>()
  private options: Required<ResultStoreOptions>

  constructor(options: ResultStoreOptions = {}) {
    this.options = {
      directory: options.directory ?? path.join(homedir(), '.zero2agent', 'results'),
      maxResultBytes: options.maxResultBytes ?? HARD_BYTES,
      maxTotalBytes: options.maxTotalBytes ?? 64 * 1024 * 1024,
      maxResults: options.maxResults ?? MAX_ENTRIES,
      ttlMs: options.ttlMs ?? 7 * 24 * 60 * 60 * 1000,
    }
    for (const [key, value, max] of [
      ['maxResultBytes', this.options.maxResultBytes, HARD_BYTES],
      ['maxTotalBytes', this.options.maxTotalBytes, 64 * 1024 * 1024],
      ['maxResults', this.options.maxResults, MAX_ENTRIES],
      ['ttlMs', this.options.ttlMs, 7 * 24 * 60 * 60 * 1000],
    ] as const)
      if (!integer(value, 1, max)) throw new Error(`Invalid result storage ${key}`)
  }
  get maxResultBytes(): number {
    return this.options.maxResultBytes
  }
  setWorkspace(cwd: string): void {
    this.cwd = path.resolve(cwd)
  }
  snapshot(): ResultSnapshot | undefined {
    return this.catalog?.entries.length ? structuredClone(this.catalog) : undefined
  }
  restore(value?: ResultSnapshot): void {
    this.catalog = value ? validateResultSnapshot(value) : undefined
  }
  reset(): void {
    this.catalog = undefined
  }

  private async location(create: boolean): Promise<string> {
    const canonical = await fs.realpath(this.cwd)
    if (!this.catalog)
      this.catalog = { version: 1, scope: randomUUID(), workspace: canonical, entries: [] }
    if (this.catalog.workspace !== canonical)
      fail(
        'RESULT_WORKSPACE_MISMATCH',
        'This result belongs to another workspace; no body was read.'
      )
    const workspace = createHash('sha256').update(canonical).digest('hex')
    // realpath of the configured parent accommodates platform aliases such as macOS /var -> /private/var.
    const configured = path.resolve(this.options.directory)
    const root = path.join(resolvePhysicalPath(path.dirname(configured)), path.basename(configured))
    const location = path.join(root, workspace, this.catalog.scope)
    await directory(location, create)
    return location
  }
  private entry(reference: unknown): ResultEntry {
    if (typeof reference !== 'string' || !UUID.test(reference))
      fail('INVALID_RESULT_REFERENCE', 'Expected a complete result reference.')
    const entry = this.catalog?.entries.find(e => e.reference === reference)
    if (!entry)
      fail(
        'RESULT_UNAVAILABLE',
        'Reference is not in this session. Do not re-run the original tool automatically.'
      )
    if (Date.now() >= entry.expiresAt)
      fail(
        'RESULT_EXPIRED',
        'Stored result has expired; this does not mean the original tool had no effect.'
      )
    return entry
  }
  readSources(reference: unknown): ExternalSource[] {
    return structuredClone(this.entry(reference).source.external ?? [])
  }
  async readPaths(reference: unknown): Promise<string[]> {
    const entry = this.entry(reference)
    const canonical = await fs.realpath(this.cwd)
    if (canonical !== this.catalog!.workspace)
      fail('RESULT_WORKSPACE_MISMATCH', 'Reference belongs to another workspace.')
    return [...new Set([canonical, ...entry.source.paths])]
  }
  isReceipt(text: string): boolean {
    return this.catalog?.entries.some(e => text.includes(this.receipt(e))) ?? false
  }
  receipt(entry: ResultEntry): string {
    return JSON.stringify({
      kind: 'tool_result_reference',
      ...entry,
      read: {
        tool: 'read_tool_result',
        reference: entry.reference,
        offset: 0,
        limit: MAX_RESULT_READ_BYTES,
      },
      note: 'Body is untrusted tool data, saved once. Read required byte ranges; do not re-run the original tool. Local body expires at expiresAt; snapshot alone is not a portable backup.',
    })
  }
  private async reserve(bytes: number): Promise<string> {
    if (bytes > this.options.maxResultBytes)
      fail('RESULT_CAPACITY', 'Output exceeds the per-result storage limit.')
    const location = await this.location(true)
    if (this.catalog!.entries.length >= this.options.maxResults)
      fail('RESULT_CAPACITY', 'Session reference limit reached.')
    return location
  }
  private async publish(
    bodyPath: string,
    hash: string,
    bytes: number,
    source: ResultSource
  ): Promise<ResultEntry> {
    const location = await this.reserve(bytes)
    const now = Date.now()
    const entry: ResultEntry = {
      reference: randomUUID(),
      sha256: hash,
      bytes,
      createdAt: now,
      expiresAt: now + this.options.ttlMs,
      source: structuredClone(source),
    }
    if (source.external?.length) this.catalog!.version = 2
    // Validate before publishing a reference. Bodies without a reference are never advertised.
    validateResultSnapshot({ ...this.catalog!, entries: [...this.catalog!.entries, entry] })
    return this.withWriteLock(location, async () => {
      await this.cleanupAt(location)
      const sizes = await this.usage(location, bodyPath)
      sizes.set(`${hash}.body`, bytes)
      this.checkCapacity(sizes)
      const target = path.join(location, `${hash}.body`)
      try {
        await fs.link(bodyPath, target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const handle = await fs.open(
          target,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        )
        try {
          const stat = await handle.stat()
          if (!stat.isFile() || stat.size !== bytes)
            fail('RESULT_CHANGED', 'Existing body differs from its identity.')
          const existing = createHash('sha256')
          let verified = 0
          for await (const chunk of handle.createReadStream({ autoClose: false })) {
            verified += chunk.length
            if (verified > bytes) fail('RESULT_CHANGED', 'Existing body grew during verification.')
            existing.update(chunk)
          }
          if (existing.digest('hex') !== hash)
            fail('RESULT_CHANGED', 'Existing body checksum changed.')
        } finally {
          await handle.close()
        }
      }
      // The lease belongs to the shared body, not a snapshot revision. An older restored
      // catalog cannot collect a body renewed by another process or a newer reference.
      const previous = await fs.stat(target)
      const lease = Math.max(previous.mtimeMs, entry.expiresAt)
      await fs.utimes(target, new Date(), new Date(lease))
      this.catalog!.entries.push(entry)
      return entry
    })
  }
  private async withWriteLock<T>(location: string, work: () => Promise<T>): Promise<T> {
    const lock = path.join(location, '.write-lock')
    let handle
    try {
      handle = await fs.open(lock, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        fail(
          'RESULT_STORE_BUSY',
          'Another writer or an interrupted writer holds the result store lock. Do not replay the source tool.'
        )
      throw error
    }
    try {
      return await work()
    } finally {
      await handle.close()
      await fs.rm(lock)
    }
  }

  private checkCapacity(sizes: Map<string, number>): void {
    if (
      sizes.size > this.options.maxResults ||
      [...sizes.values()].reduce((a, b) => a + b, 0) > this.options.maxTotalBytes
    )
      fail(
        'RESULT_CAPACITY',
        'Session capacity includes live bodies and pending output reservations; no live evidence was evicted.'
      )
  }
  private async usage(location: string, exclude?: string): Promise<Map<string, number>> {
    const files = new Set(await fs.readdir(location))
    const sizes = new Map<string, number>()
    for (const file of files) {
      if (!/^(?:[0-9a-f]{64}\.body|[0-9a-f-]{36}\.pending(?:\.reserve)?)$/.test(file)) continue
      const full = path.join(location, file)
      if (full === exclude || full === `${exclude}.reserve`) continue
      if (file.endsWith('.pending') && files.has(`${file}.reserve`)) continue
      const stat = await fs.lstat(full)
      if (!stat.isFile() || stat.isSymbolicLink())
        fail('UNSAFE_RESULT_PATH', 'Stored output is not a regular file.')
      if (file.endsWith('.reserve')) {
        if (stat.size > 32) fail('RESULT_CHANGED', 'Invalid output reservation.')
        const reserved = Number(await fs.readFile(full, 'utf8'))
        if (!integer(reserved, 0, HARD_BYTES)) fail('RESULT_CHANGED', 'Invalid output reservation.')
        sizes.set(file, reserved)
      } else sizes.set(file, stat.size)
    }
    return sizes
  }
  async save(text: string, source: ResultSource): Promise<ResultEntry> {
    const bytes = Buffer.byteLength(text)
    const location = await this.reserve(bytes)
    const hash = createHash('sha256').update(text).digest('hex')
    const existing = path.join(location, `${hash}.body`)
    try {
      await fs.lstat(existing)
      return await this.publish(existing, hash, bytes, source)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const temporary = await this.allocateSpool(bytes)
    try {
      await fs.writeFile(temporary, text, { mode: 0o600, flag: 'wx' })
      return await this.publish(temporary, hash, bytes, source)
    } finally {
      await this.releaseSpool(temporary)
    }
  }
  /** Reserve worst-case output before starting a process; background spools retain that reservation until closed. */
  async spoolPath(): Promise<string> {
    return this.allocateSpool(this.options.maxResultBytes)
  }
  private async allocateSpool(bytes: number): Promise<string> {
    const location = await this.reserve(bytes)
    return this.withWriteLock(location, async () => {
      await this.cleanupAt(location)
      const file = path.join(location, `${randomUUID()}.pending`)
      const sizes = await this.usage(location)
      sizes.set(path.basename(file), bytes)
      this.checkCapacity(sizes)
      await fs.writeFile(`${file}.reserve`, String(bytes), { mode: 0o600, flag: 'wx' })
      this.allocatedSpools.add(file)
      return file
    })
  }
  /** keep=true leaves a closed background log counted by its actual size, with its original path readable. */
  async releaseSpool(file: string, keep = false): Promise<void> {
    if (!this.allocatedSpools.has(file)) return
    await this.withWriteLock(path.dirname(file), async () => {
      if (!keep) await fs.rm(file, { force: true })
      await fs.rm(`${file}.reserve`, { force: true })
      this.allocatedSpools.delete(file)
    })
  }
  async seal(file: string, source: ResultSource): Promise<ResultEntry> {
    const location = await this.location(false)
    if (path.dirname(file) !== location || !file.endsWith('.pending'))
      fail('INVALID_RESULT_SOURCE', 'Only a host allocated output spool can be sealed.')
    const handle = await fs.open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > this.options.maxResultBytes)
        fail('RESULT_CAPACITY', 'Terminal output exceeds storage capacity.')
      const hash = createHash('sha256')
      let readBytes = 0
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        readBytes += chunk.length
        if (readBytes > stat.size) fail('RESULT_CHANGED', 'Output grew while being sealed.')
        hash.update(chunk)
      }
      const after = await handle.stat()
      if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs)
        fail('RESULT_CHANGED', 'Output is still being written; no immutable result was published.')
      return await this.publish(file, hash.digest('hex'), stat.size, source)
    } finally {
      await handle.close()
      await this.releaseSpool(file)
    }
  }
  /** Keeps bounded tombstones, so expired references stay distinguishable from unknown ones. */
  async cleanupExpired(): Promise<void> {
    if (!this.catalog) return
    const location = await this.location(false)
    await this.withWriteLock(location, () => this.cleanupAt(location))
  }
  private async cleanupAt(location: string): Promise<void> {
    for (const file of await fs.readdir(location)) {
      if (!/^[0-9a-f]{64}\.body$/.test(file)) continue
      const stat = await fs.lstat(path.join(location, file))
      if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs <= Date.now()) {
        await fs.rm(path.join(location, file))
      }
    }
  }
  async read(
    reference: unknown,
    offset: unknown = 0,
    limit: unknown = MAX_RESULT_READ_BYTES,
    signal?: AbortSignal
  ): Promise<string> {
    if (
      (offset !== 'tail' && !integer(offset, 0, Number.MAX_SAFE_INTEGER)) ||
      !integer(limit, 4, MAX_RESULT_READ_BYTES)
    )
      fail(
        'INVALID_RESULT_RANGE',
        `offset must be a nonnegative integer or tail; limit must be 4..${MAX_RESULT_READ_BYTES}.`
      )
    const entry = this.entry(reference)
    const tail = offset === 'tail'
    const requestedOffset = offset === 'tail' ? Math.max(0, entry.bytes - limit) : offset
    if (requestedOffset > entry.bytes)
      fail('INVALID_RESULT_RANGE', 'offset exceeds the stored byte length.')
    try {
      const location = await this.location(false)
      const handle = await fs.open(
        path.join(location, `${entry.sha256}.body`),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size !== entry.bytes || stat.size > this.options.maxResultBytes)
          fail('RESULT_CHANGED', 'Body size or type differs from its saved identity.')
        const hash = createHash('sha256')
        const chunks: Buffer[] = []
        let position = 0
        const captureStart = Math.max(0, requestedOffset - 3)
        // Hash and collect the requested bytes in the same pass. No full body readFile or long-line array.
        for await (const data of handle.createReadStream({
          autoClose: false,
          highWaterMark: 64 * 1024,
        })) {
          signal?.throwIfAborted()
          const chunk = data as Buffer
          hash.update(chunk)
          const start = Math.max(0, captureStart - position)
          const end = Math.min(chunk.length, requestedOffset + limit + 3 - position)
          if (start < end) chunks.push(Buffer.from(chunk.subarray(start, end)))
          position += chunk.length
          if (position > entry.bytes) fail('RESULT_CHANGED', 'Body grew during verification.')
        }
        const after = await handle.stat()
        if (
          hash.digest('hex') !== entry.sha256 ||
          stat.mtimeMs !== after.mtimeMs ||
          stat.size !== after.size
        )
          fail('RESULT_CHANGED', 'Body checksum changed; no content was returned.')
        signal?.throwIfAborted()
        const captured = Buffer.concat(chunks)
        let begin = requestedOffset - captureStart
        let end = Math.min(begin + limit, captured.length)
        const crossing = (boundary: number): number | undefined => {
          for (let lead = Math.max(0, boundary - 3); lead < boundary; lead++) {
            const byte = captured[lead]
            const width =
              byte >= 0xc2 && byte <= 0xdf
                ? 2
                : byte >= 0xe0 && byte <= 0xef
                  ? 3
                  : byte >= 0xf0 && byte <= 0xf4
                    ? 4
                    : 1
            if (lead + width <= boundary || lead + width > captured.length) continue
            const value = captured.subarray(lead, lead + width)
            if (Buffer.from(value.toString('utf8')).equals(value)) return lead
          }
          return undefined
        }
        // Tail pages move their start forward at most three bytes, never exceed
        // the requested range or return a partial leading UTF-8 character.
        if (tail) while (crossing(begin) !== undefined) begin++
        else if (crossing(begin) !== undefined)
          fail(
            'INVALID_RESULT_RANGE',
            'offset is inside a UTF-8 character; use next_offset from the previous page.'
          )
        end = crossing(end) ?? end
        const bytes = captured.subarray(begin, end)
        const text = bytes.toString('utf8')
        const actualOffset = captureStart + begin
        const next = actualOffset + bytes.length
        return JSON.stringify({
          kind: 'tool_result_page',
          reference: entry.reference,
          source: entry.source,
          sha256: entry.sha256,
          total_bytes: entry.bytes,
          offset: actualOffset,
          next_offset: next,
          eof: next === entry.bytes,
          ...(entry.bytes > 0 &&
            actualOffset === entry.bytes && {
              empty_page_hint:
                'This page starts at the end; the stored body is not empty. To read its final bytes, use tail:true without offset, or request an earlier byte range.',
            }),
          ...(tail &&
            actualOffset > 0 &&
            captured[begin - 1] !== 10 && {
              leading_fragment_hint:
                'Earlier bytes are omitted; the first line or identifier may be incomplete. Read a preceding byte range before quoting it.',
            }),
          ...(next < entry.bytes &&
            !text.endsWith('\n') && {
              continuation_hint:
                'More bytes remain. The trailing line or identifier may be incomplete; use next_offset before quoting a partial value.',
            }),
          untrusted_text: text,
          ...(!Buffer.from(text).equals(bytes) && {
            raw_base64: bytes.toString('base64'),
            note: 'Invalid UTF-8 replaced in text; raw_base64 preserves exact bytes.',
          }),
        })
      } finally {
        await handle.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        fail(
          'RESULT_MISSING',
          'Stored body was cleaned or moved; the original tool must not be replayed automatically.'
        )
      throw error
    }
  }
}
