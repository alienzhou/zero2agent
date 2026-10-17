import { resolvePhysicalPath, isInsidePath } from './tools/path-guard.js'
import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { runHookProcess, HookProcessError } from './hook-process.js'
import type { ExecutionBoundary } from './execution-recovery.js'

export type HookStage = 'beforeTool' | 'afterTool' | 'beforeComplete'
export interface HookDefinition {
  id: string
  stage: HookStage
  command: string
  args?: string[]
  env?: Record<string, string>
  sources: string[]
  tool?: string
  timeoutMs?: number
}
export interface HookConfig {
  version: 1
  hooks: HookDefinition[]
  watch?: string[]
}
export interface HookOptions {
  file?: string
  config?: HookConfig
  trust?: string[]
}
export interface HookBinding {
  id: string
  identity: string
  stage: HookStage
}
export interface HookTool {
  id: string
  name: string
  paths: string[]
}
export interface HookCheck {
  checkId: string
  hookId: string
  identity: string
  stage: HookStage
  state: 'not-started' | 'unknown' | 'passed' | 'blocked'
  cause?: string
  tool?: HookTool
  receipt?: { isError: boolean; sha256: string }
  resolves?: string
}
export interface HookSnapshot {
  version: 1
  bindings: HookBinding[]
  checks: HookCheck[]
  writes: string[]
}
export interface HookView extends HookBinding {
  trusted: boolean
}
export class HookError extends Error {
  constructor(
    readonly stage: HookStage,
    readonly hookId: string,
    readonly causeCode: string
  ) {
    super(
      `Hook ${stage}/${hookId}: ${causeCode}. ${stage === 'beforeTool' ? 'The tool was not executed.' : stage === 'afterTool' ? 'The tool already executed; its receipt and effects are retained.' : 'Task is incomplete.'} Inspect effects and pending checks; never replay automatically.`
    )
    this.name = 'HookError'
  }
}
const stages = ['beforeTool', 'afterTool', 'beforeComplete']
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const idPattern = /^[a-zA-Z0-9_-]{1,32}$/
const identityPattern = /^[a-f0-9]{64}$/
const uuid = /^[0-9a-f-]{36}$/
const ownKeys = (v: object, allowed: string[]): boolean =>
  Object.keys(v).every(k => allowed.includes(k))
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const pathList = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) &&
  v.length <= max &&
  v.every(p => typeof p === 'string' && p.length > 0 && p.length <= 4096 && !p.includes('\0'))
export function validateHookConfig(value: unknown): HookConfig {
  const fail = (): never => {
    throw new Error('Invalid or oversized Hook configuration')
  }
  if (
    !plain(value) ||
    !ownKeys(value, ['version', 'hooks', 'watch']) ||
    value.version !== 1 ||
    !Array.isArray(value.hooks) ||
    value.hooks.length > 8 ||
    Buffer.byteLength(JSON.stringify(value)) > 32768 ||
    (value.watch !== undefined && !pathList(value.watch, 32))
  )
    fail()
  const config = value as unknown as HookConfig
  const ids = new Set<string>()
  for (const h of config.hooks) {
    if (
      !plain(h) ||
      !ownKeys(h, ['id', 'stage', 'command', 'args', 'env', 'sources', 'tool', 'timeoutMs']) ||
      typeof h.id !== 'string' ||
      !idPattern.test(h.id) ||
      ids.has(h.id) ||
      !stages.includes(h.stage) ||
      typeof h.command !== 'string' ||
      !path.isAbsolute(h.command) ||
      h.command.includes('\0') ||
      !pathList(h.sources, 8) ||
      !h.sources.length ||
      (h.args !== undefined && !pathList(h.args, 64)) ||
      (h.tool !== undefined && (typeof h.tool !== 'string' || !/^[\w.-]{1,128}$/.test(h.tool))) ||
      (h.timeoutMs !== undefined &&
        (!Number.isSafeInteger(h.timeoutMs) || h.timeoutMs < 1 || h.timeoutMs > 10000)) ||
      (h.env !== undefined &&
        (!plain(h.env) ||
          Object.entries(h.env).some(
            ([k, v]) =>
              !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) || typeof v !== 'string' || v.includes('\0')
          )))
    )
      fail()
    ids.add(h.id)
  }
  return structuredClone(config)
}
export function validateHookSnapshot(value: unknown): HookSnapshot {
  const fail = (): never => {
    throw new Error('Invalid Hook recovery state')
  }
  if (
    !plain(value) ||
    !ownKeys(value, ['version', 'bindings', 'checks', 'writes']) ||
    value.version !== 1 ||
    !Array.isArray(value.bindings) ||
    value.bindings.length > 8 ||
    !Array.isArray(value.checks) ||
    value.checks.length > 512 ||
    !pathList(value.writes, 64) ||
    value.writes.some(p => !path.isAbsolute(p))
  )
    fail()
  const s = value as unknown as HookSnapshot
  const bindings = new Map<string, HookBinding>(),
    checks = new Map<string, HookCheck>()
  for (const b of s.bindings) {
    if (
      !plain(b) ||
      !ownKeys(b, ['id', 'identity', 'stage']) ||
      typeof b.id !== 'string' ||
      !idPattern.test(b.id) ||
      typeof b.identity !== 'string' ||
      !identityPattern.test(b.identity) ||
      !stages.includes(b.stage) ||
      bindings.has(b.id)
    )
      fail()
    bindings.set(b.id, b)
  }
  for (const c of s.checks) {
    const b = bindings.get(c.hookId)
    if (
      !plain(c) ||
      !ownKeys(c, [
        'checkId',
        'hookId',
        'identity',
        'stage',
        'state',
        'cause',
        'tool',
        'receipt',
        'resolves',
      ]) ||
      !uuid.test(c.checkId) ||
      checks.has(c.checkId) ||
      !b ||
      typeof c.identity !== 'string' ||
      !identityPattern.test(c.identity) ||
      b.stage !== c.stage ||
      !['not-started', 'unknown', 'passed', 'blocked'].includes(c.state) ||
      (c.cause !== undefined && (typeof c.cause !== 'string' || !/^[a-z-]{1,40}$/.test(c.cause)))
    )
      fail()
    if (
      c.tool !== undefined &&
      (!plain(c.tool) ||
        !ownKeys(c.tool, ['id', 'name', 'paths']) ||
        typeof c.tool.id !== 'string' ||
        !c.tool.id ||
        c.tool.id.length > 256 ||
        typeof c.tool.name !== 'string' ||
        !/^[\w.-]{1,128}$/.test(c.tool.name) ||
        !pathList(c.tool.paths, 64))
    )
      fail()
    if ((c.stage === 'beforeComplete') !== (c.tool === undefined)) fail()
    if (
      c.receipt !== undefined &&
      (!plain(c.receipt) ||
        !ownKeys(c.receipt, ['isError', 'sha256']) ||
        typeof c.receipt.isError !== 'boolean' ||
        !identityPattern.test(c.receipt.sha256))
    )
      fail()
    if ((c.stage === 'afterTool') !== (c.receipt !== undefined)) fail()
    if (c.resolves !== undefined) {
      const old = checks.get(c.resolves)
      if (
        !old ||
        old.state === 'passed' ||
        old.hookId !== c.hookId ||
        JSON.stringify(old.tool) !== JSON.stringify(c.tool) ||
        JSON.stringify(old.receipt) !== JSON.stringify(c.receipt)
      )
        fail()
    }
    checks.set(c.checkId, c)
  }
  return structuredClone(s)
}
/** Metadata identity includes physical parents, so replacing a directory cannot retain trust. */
async function physical(file: string): Promise<unknown> {
  const real = await fs.realpath(file),
    stat = await fs.stat(file)
  if (!stat.isFile()) throw new Error('Hook source must be a regular file')
  const parents = []
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const s = await fs.stat(dir)
    parents.push([dir, s.dev, s.ino])
    if (dir === path.dirname(dir)) break
  }
  return [real, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, parents]
}
async function bounded(file: string, max: number): Promise<{ bytes: Buffer; identity: unknown }> {
  const before = await physical(file)
  const fd = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const s = await fd.stat()
    if (!s.isFile() || s.size > max) throw new Error('Hook source capacity exceeded')
    const bytes = Buffer.alloc(max + 1)
    const { bytesRead } = await fd.read(bytes, 0, bytes.length, 0)
    const after = await physical(file),
      end = await fd.stat()
    if (
      bytesRead > max ||
      s.ino !== end.ino ||
      s.size !== end.size ||
      s.mtimeMs !== end.mtimeMs ||
      s.ctimeMs !== end.ctimeMs ||
      JSON.stringify(before) !== JSON.stringify(after)
    )
      throw new Error('Hook source changed while reading')
    return { bytes: bytes.subarray(0, bytesRead), identity: after }
  } finally {
    await fd.close()
  }
}
type HookEntry = { definition: HookDefinition; view: HookView }
export class Hooks {
  private options: HookOptions | false
  private state: HookSnapshot = { version: 1, bindings: [], checks: [], writes: [] }
  private entries: HookEntry[] = []
  private config?: HookConfig
  private auditRead?: (file: string) => void
  private uses = 0
  private watched = new Set<string>()
  constructor(
    readonly cwd: string,
    options: HookOptions | false = false
  ) {
    if (
      options &&
      ((options.file && options.config) ||
        (options.trust &&
          (!Array.isArray(options.trust) ||
            options.trust.length > 8 ||
            options.trust.some(
              t => typeof t !== 'string' || !/^[\w-]{1,32}:[a-f0-9]{64}$/.test(t)
            ))))
    )
      throw new Error('Invalid Hook options')
    this.options = structuredClone(options)
  }
  async inspect(): Promise<HookView[]> {
    return (await this.discover()).entries.map(e => e.view)
  }
  private async discover(): Promise<{ config?: HookConfig; entries: HookEntry[] }> {
    if (!this.options) return { entries: [] }
    let raw: unknown = this.options.config,
      configIdentity: unknown
    if (this.options.file) {
      const file = await bounded(path.resolve(this.cwd, this.options.file), 32768)
      raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes))
      configIdentity = file.identity
    }
    const config = validateHookConfig(raw)
    const version = hash(JSON.stringify([config, configIdentity]))
    const entries: HookEntry[] = []
    for (const definition of config.hooks) {
      let total = 0
      const sources = []
      for (const name of definition.sources) {
        const file = await bounded(path.resolve(this.cwd, name), 65536)
        total += file.bytes.length
        if (total > 262144) throw new Error('Hook source total capacity exceeded')
        sources.push([name, file.identity, hash(file.bytes)])
      }
      const identity = hash(
        JSON.stringify([
          version,
          [
            await fs.realpath(this.cwd),
            (await fs.stat(this.cwd)).dev,
            (await fs.stat(this.cwd)).ino,
          ],
          await physical(definition.command),
          sources,
        ])
      )
      entries.push({
        definition,
        view: {
          id: definition.id,
          stage: definition.stage,
          identity,
          trusted: this.options.trust?.includes(`${definition.id}:${identity}`) ?? false,
        },
      })
    }
    if (this.options.trust?.some(t => !entries.some(e => `${e.view.id}:${e.view.identity}` === t)))
      throw new Error('Hook trust is stale or unknown; inspect current versions again')
    return { config, entries }
  }
  async begin(
    saved?: HookSnapshot,
    rebind = false,
    auditRead?: (file: string) => void
  ): Promise<void> {
    this.auditRead = auditRead
    const current = await this.discover()
    this.config = current.config
    this.entries = current.entries
    const bindings = this.entries
      .filter(e => e.view.trusted)
      .map(e => ({ id: e.view.id, identity: e.view.identity, stage: e.view.stage }))
    this.state = saved
      ? validateHookSnapshot(saved)
      : { version: 1, bindings, checks: [], writes: [] }
    if (saved && JSON.stringify(saved.bindings) !== JSON.stringify(bindings)) {
      if (
        !rebind ||
        JSON.stringify(saved.bindings.map(b => [b.id, b.stage])) !==
          JSON.stringify(bindings.map(b => [b.id, b.stage]))
      )
        throw new HookError('beforeComplete', 'recovery', 'current-trust-required')
      // Only the explicit user recheck control may adopt freshly trusted replacement versions.
      this.state.bindings = bindings
    }
    this.uses = 0
    this.watched = new Set(this.state.writes)
  }
  get enabled(): boolean {
    return this.state.bindings.length > 0
  }
  snapshot(): HookSnapshot | undefined {
    return this.enabled ? structuredClone(this.state) : undefined
  }
  pending(): HookCheck[] {
    const resolved = new Set(this.state.checks.filter(c => c.resolves).map(c => c.resolves))
    return structuredClone(
      this.state.checks.filter(c => c.state !== 'passed' && !resolved.has(c.checkId))
    )
  }
  async assertCurrent(): Promise<void> {
    if (!this.enabled) return
    const current = (await this.discover()).entries
      .filter(e => e.view.trusted)
      .map(e => ({ id: e.view.id, identity: e.view.identity, stage: e.view.stage }))
    if (JSON.stringify(current) !== JSON.stringify(this.state.bindings))
      throw new HookError('beforeComplete', 'configuration', 'changed')
  }
  watch(paths: string[]): void {
    const next = new Set([...this.watched, ...paths.map(p => path.resolve(this.cwd, p))])
    if (next.size > 64) throw new HookError('beforeTool', 'watch', 'capacity')
    this.watched = next
    this.state.writes = [...next]
  }
  private async fileState(extra: string[] = []): Promise<string> {
    const files = [
      ...new Set([
        ...this.watched,
        ...(this.config?.watch ?? []).map(p => path.resolve(this.cwd, p)),
        ...extra.map(p => path.resolve(this.cwd, p)),
      ]),
    ].sort()
    if (files.length > 64) throw new HookError('beforeComplete', 'watch', 'capacity')
    let total = 0
    const values = []
    for (const p of files) {
      try {
        if (!isInsidePath(resolvePhysicalPath(this.cwd), resolvePhysicalPath(p), true))
          throw new HookError('beforeComplete', 'watch', 'outside-workspace')
        this.auditRead?.(p)
        const f = await bounded(p, 1048576)
        total += f.bytes.length
        if (total > 8388608) throw new Error('capacity')
        values.push([p, f.identity, hash(f.bytes)])
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') values.push([p, null])
        else throw new HookError('beforeComplete', 'watch', 'unverifiable')
      }
    }
    return hash(JSON.stringify(values))
  }
  reserveAfter(toolName: string, tool?: HookTool): void {
    const count = this.entries.filter(
      e =>
        e.view.trusted &&
        e.view.stage === 'afterTool' &&
        (!e.definition.tool || e.definition.tool === toolName)
    ).length
    if (
      count &&
      tool &&
      Buffer.byteLength(
        JSON.stringify({
          version: 1,
          stage: 'afterTool',
          cwd: this.cwd,
          checkId: '0'.repeat(36),
          tool,
          receipt: { isError: false, sha256: '0'.repeat(64) },
        })
      ) > 32768
    )
      throw new HookError('beforeTool', 'after-check', 'input-capacity')
    if (this.state.checks.length + count > 512 || this.uses + count > 64)
      throw new HookError('beforeTool', 'capacity', 'capacity')
  }
  planAfter(data: { tool: HookTool; receipt: NonNullable<HookCheck['receipt']> }): HookCheck[] {
    this.reserveAfter(data.tool.name)
    const planned = this.entries
      .filter(
        e =>
          e.view.trusted &&
          e.view.stage === 'afterTool' &&
          (!e.definition.tool || e.definition.tool === data.tool.name)
      )
      .map(e => ({
        checkId: randomUUID(),
        hookId: e.view.id,
        identity: e.view.identity,
        stage: e.view.stage,
        state: 'not-started' as const,
        ...structuredClone(data),
      }))
    validateHookSnapshot({ ...this.state, checks: [...this.state.checks, ...planned] })
    this.state.checks.push(...planned)
    return planned
  }
  async run(
    stage: HookStage,
    data: { tool?: HookTool; receipt?: HookCheck['receipt'] },
    persist: (b: ExecutionBoundary) => Promise<void>,
    signal?: AbortSignal,
    notify?: (check: HookCheck, status: 'started' | 'passed' | 'blocked' | 'unknown') => void,
    extra: string[] = [],
    planned: HookCheck[] = []
  ): Promise<void> {
    for (const entry of this.entries.filter(
      e =>
        e.view.trusted &&
        e.view.stage === stage &&
        (!e.definition.tool || e.definition.tool === data.tool?.name)
    ))
      await this.check(
        entry.definition,
        entry.view,
        data,
        persist,
        signal,
        notify,
        undefined,
        extra,
        planned.find(c => c.hookId === entry.view.id)
      )
  }
  private async check(
    definition: HookDefinition,
    binding: HookBinding,
    data: { tool?: HookTool; receipt?: HookCheck['receipt'] },
    persist: (b: ExecutionBoundary) => Promise<void>,
    signal?: AbortSignal,
    notify?: (check: HookCheck, status: 'started' | 'passed' | 'blocked' | 'unknown') => void,
    resolves?: string,
    extra: string[] = [],
    existing?: HookCheck
  ): Promise<void> {
    signal?.throwIfAborted()
    await this.assertCurrent()
    if (++this.uses > 64 || (!existing && this.state.checks.length >= 512))
      throw new HookError(binding.stage, binding.id, 'capacity')
    const before = binding.stage === 'beforeComplete' ? await this.fileState(extra) : undefined
    const check: HookCheck = existing ?? {
      checkId: randomUUID(),
      hookId: binding.id,
      identity: binding.identity,
      stage: binding.stage,
      state: 'unknown',
      ...structuredClone(data),
      ...(resolves && { resolves }),
    }
    const input = JSON.stringify({
      version: 1,
      stage: binding.stage,
      cwd: this.cwd,
      checkId: check.checkId,
      ...data,
    })
    if (Buffer.byteLength(input) > 32768)
      throw new HookError(binding.stage, binding.id, 'input-capacity')
    try {
      validateHookSnapshot({
        ...this.state,
        checks: existing ? this.state.checks : [...this.state.checks, check],
      })
    } catch {
      throw new HookError(binding.stage, binding.id, 'invalid-input')
    }
    if (!existing) this.state.checks.push(check)
    check.state = 'unknown'
    try {
      await persist('hook-start')
    } catch (e) {
      check.state = 'not-started'
      throw e
    }
    notify?.(structuredClone(check), 'started')
    try {
      await this.assertCurrent()
      signal?.throwIfAborted()
      const decision = await runHookProcess(
        {
          command: definition.command,
          args: definition.args ?? [],
          env: definition.env ?? {},
          cwd: this.cwd,
          timeoutMs: definition.timeoutMs ?? 5000,
        },
        input,
        signal
      )
      check.state = decision === 'pass' ? 'passed' : 'blocked'
      if (decision === 'block') check.cause = 'blocked'
      if (before !== undefined && before !== (await this.fileState(extra))) {
        check.state = 'blocked'
        check.cause = 'files-changed'
      }
      await this.assertCurrent()
    } catch (e) {
      check.state = 'unknown'
      check.cause = e instanceof HookProcessError ? e.code : 'changed-or-cancelled'
    }
    await persist('hook-settled')
    notify?.(structuredClone(check), check.state)
    if (check.state !== 'passed')
      throw new HookError(check.stage, check.hookId, check.cause ?? check.state)
  }
  async recheck(
    persist: (b: ExecutionBoundary) => Promise<void>,
    note: string,
    signal?: AbortSignal,
    notify?: (check: HookCheck, status: 'started' | 'passed' | 'blocked' | 'unknown') => void
  ): Promise<void> {
    if (!note.trim() || note.length > 4096)
      throw new Error('Recheck requires an explicit review note of 1..4096 characters')
    const pending = this.pending()
    for (const old of pending) {
      const e = this.entries.find(
        e => e.view.id === old.hookId && e.view.stage === old.stage && e.view.trusted
      )
      if (!e) throw new HookError(old.stage, old.hookId, 'current-trust-required')
      await this.check(
        e.definition,
        e.view,
        { ...(old.tool && { tool: old.tool }), ...(old.receipt && { receipt: old.receipt }) },
        persist,
        signal,
        notify,
        old.checkId
      )
    }
  }
  assertComplete(): void {
    if (this.pending().length)
      throw new HookError('beforeComplete', 'pending', 'explicit-recheck-required')
  }
}
