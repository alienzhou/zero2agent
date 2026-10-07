import { constants } from 'node:fs'
import { mkdir, open, realpath, readdir, stat, type FileHandle } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import type { DiagnosticEvent } from '@zero2agent/core'
import { diagnosticLabel, diagnosticNumber } from '@zero2agent/core'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const LOG_LIMITS = {
  line: 8192,
  queue: 1024 * 1024,
  file: 64 * 1024 * 1024,
  display: 200,
  identities: 10000,
  list: 500,
}
const NUMBERS = [
  'messageCount',
  'toolCount',
  'maxOutputTokens',
  'durationMs',
  'firstTextMs',
  'textChars',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'httpStatus',
  'inputFields',
  'outputChars',
  'before',
  'after',
  'revision',
  'pid',
  'exitCode',
] as const
const LABELS = [
  'sessionId',
  'requestId',
  'model',
  'stopReason',
  'providerRequestId',
  'toolCallId',
  'toolName',
  'action',
  'trigger',
  'errorKind',
  'operation',
  'terminalOutcome',
  'signal',
] as const
const EVENTS: Record<string, string[]> = {
  host: [
    'start',
    'end',
    'session-new',
    'session-resume',
    'save-start',
    'save-completed',
    'save-error',
    'terminal-start',
    'terminal-completed',
    'terminal-cancelled',
    'terminal-error',
  ],
  operation: ['start', 'completed', 'cancelled', 'error'],
  request: ['start', 'completed', 'cancelled', 'error'],
  tool: ['metadata', 'pending', 'approval', 'running', 'completed', 'denied', 'error', 'cancelled'],
  permission: ['initial', 'resolved', 'boundary'],
  phase: ['preparing', 'requesting', 'streaming', 'tools', 'cancelling'],
  compaction: ['pruned', 'background', 'waiting', 'foreground', 'completed', 'failed'],
  notice: ['shown'],
}
export interface LogRecord extends Omit<Partial<DiagnosticEvent>, 'seq' | 'kind'> {
  version: 1
  runId: string
  seq: number
  at: string
  kind: DiagnosticEvent['kind'] | 'host'
  event: string
  operationSeq?: number
  revision?: number
  pid?: number
  exitCode?: number
}
export interface LogItem {
  id: string
  title: string
  updatedAt: string
  error?: string
}
export interface LogReport {
  id: string
  records: LogRecord[]
  count: number
  omitted: number
  warnings: string[]
}
export type LogFailure =
  | 'open'
  | 'write'
  | 'sync'
  | 'close'
  | 'queue-limit'
  | 'file-limit'
  | 'record-limit'
  | 'invalid-event'
export interface LogOptions {
  root?: string
  queueBytes?: number
  fileBytes?: number
  onFailure?: (failure: LogFailure) => void
}

function validateRecord(value: unknown, runId: string): LogRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效日志记录')
  const r = value as LogRecord
  const keys = new Set([
    'version',
    'runId',
    'seq',
    'at',
    'kind',
    'event',
    'operationId',
    'operationSeq',
    'purpose',
    ...NUMBERS,
    ...LABELS,
  ])
  if (
    Object.keys(r).some(k => !keys.has(k)) ||
    r.version !== 1 ||
    r.runId !== runId ||
    !Number.isSafeInteger(r.seq) ||
    r.seq < 1 ||
    typeof r.at !== 'string' ||
    !Number.isFinite(Date.parse(r.at)) ||
    !EVENTS[r.kind]?.includes(r.event)
  )
    throw new Error('日志版本或字段无效')
  if (r.purpose !== undefined && !['model', 'summary', 'count'].includes(r.purpose))
    throw new Error('日志请求用途无效')
  for (const k of LABELS)
    if (r[k] !== undefined && !diagnosticLabel(r[k])) throw new Error('日志字符串字段无效')
  for (const k of NUMBERS)
    if (r[k] !== undefined && diagnosticNumber(r[k]) !== r[k]) throw new Error('日志数值字段无效')
  if (
    r.operationId !== undefined &&
    (!UUID.test(r.operationId) || !Number.isSafeInteger(r.operationSeq) || r.operationSeq! < 1)
  )
    throw new Error('日志操作身份无效')
  if (r.kind !== 'host' && !r.operationId) throw new Error('日志缺少操作身份')
  if (
    r.kind === 'request' &&
    (!r.requestId ||
      !UUID.test(r.requestId) ||
      !['model', 'summary', 'count'].includes(r.purpose ?? ''))
  )
    throw new Error('日志请求身份无效')
  const enums: Record<string, string[]> = {
    action: ['allow', 'ask', 'deny'],
    trigger: ['auto', 'manual', 'overflow'],
    operation: ['turn', 'compact'],
    terminalOutcome: [
      'completed',
      'cancelled',
      'declined',
      'skipped',
      'drain-timeout',
      'background-completed',
    ],
    errorKind: [
      'cancelled',
      'timeout',
      'auth',
      'rate-limit',
      'context',
      'http',
      'network',
      'other',
    ],
  }
  for (const [key, values] of Object.entries(enums))
    if (
      (r as unknown as Record<string, unknown>)[key] !== undefined &&
      !values.includes(String((r as unknown as Record<string, unknown>)[key]))
    )
      throw new Error('日志枚举字段无效')
  return r
}

/** Per-process exclusive append file. Failures are visible status, never Agent execution errors. */
export class RunJournal {
  private tail = Promise.resolve()
  private queued = 0
  private bytes = 0
  private seq = 0
  private closed = false
  private ioFailed = false
  private closing?: Promise<void>
  failure?: LogFailure
  readonly id = randomUUID()
  readonly file: string
  private handle?: FileHandle
  private queueLimit: number
  private fileLimit: number
  private secrets: string[]
  private constructor(
    directory: string,
    private options: LogOptions
  ) {
    this.file = path.join(directory, this.id + '.jsonl')
    this.queueLimit = options.queueBytes ?? LOG_LIMITS.queue
    this.fileLimit = options.fileBytes ?? LOG_LIMITS.file
    // Defense in depth for provider/model/tool IDs. Bodies are excluded before this step.
    this.secrets = Object.entries(process.env)
      .filter(([k, v]) => /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(k) && v && v.length >= 4)
      .map(([, v]) => v!)
  }
  static async create(directory: string, options: LogOptions = {}): Promise<RunJournal> {
    const journal = new RunJournal(directory, options)
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      journal.handle = await open(
        journal.file,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      )
      journal.host('start', { pid: process.pid })
    } catch {
      journal.fail('open')
    }
    return journal
  }
  get status(): string {
    return this.failure
      ? `日志不可用 (${this.failure})；任务继续，记录可能不完整`
      : `日志 ${this.id.slice(0, 8)} · ${this.closed ? '已关闭' : '记录中'}`
  }
  private fail(failure: LogFailure): void {
    if (['open', 'write', 'close'].includes(failure)) this.ioFailed = true
    if (this.failure) return
    this.failure = failure
    try {
      this.options.onFailure?.(failure)
    } catch {
      /* Presentation failure is isolated. */
    }
  }
  private label(value: unknown): string | undefined {
    const label = diagnosticLabel(value)
    return label && this.secrets.some(secret => label.includes(secret)) ? 'redacted' : label
  }
  diagnostic(event: DiagnosticEvent): void {
    const data: Record<string, unknown> = {
      operationId: event.operationId,
      operationSeq: event.seq,
    }
    for (const k of LABELS) if (event[k] !== undefined) data[k] = this.label(event[k])
    for (const k of NUMBERS)
      if (k in event) data[k] = diagnosticNumber(event[k as keyof DiagnosticEvent])
    if (event.purpose) data.purpose = event.purpose
    this.append(event.kind, event.event, data)
  }
  host(
    event: string,
    details: {
      sessionId?: string
      revision?: number
      exitCode?: number
      pid?: number
      terminalOutcome?: DiagnosticEvent['terminalOutcome']
      signal?: string | number
    } = {}
  ): void {
    const data: Record<string, unknown> = {}
    if (details.sessionId) data.sessionId = this.label(details.sessionId)
    if (details.terminalOutcome) data.terminalOutcome = this.label(details.terminalOutcome)
    if (details.signal !== undefined) data.signal = this.label(String(details.signal))
    for (const k of ['revision', 'exitCode', 'pid'] as const)
      if (details[k] !== undefined) data[k] = diagnosticNumber(details[k])
    this.append('host', event, data)
  }
  private append(kind: string, event: string, data: Record<string, unknown>): void {
    if (this.closed || this.failure) return
    const candidate = JSON.parse(
      JSON.stringify({
        ...data,
        version: 1,
        runId: this.id,
        seq: this.seq + 1,
        at: new Date().toISOString(),
        kind,
        event,
      })
    )
    let record: LogRecord
    try {
      record = validateRecord(candidate, this.id)
    } catch {
      this.fail('invalid-event')
      return
    }
    const buffer = Buffer.from(JSON.stringify(record) + '\n')
    if (buffer.length > LOG_LIMITS.line) {
      this.fail('record-limit')
      return
    }
    if (this.queued + buffer.length > this.queueLimit) {
      this.fail('queue-limit')
      return
    }
    if (this.bytes + buffer.length > this.fileLimit) {
      this.fail('file-limit')
      return
    }
    this.seq++
    this.queued += buffer.length
    this.bytes += buffer.length
    this.tail = this.tail
      .then(async () => {
        if (this.ioFailed) return
        let offset = 0
        while (offset < buffer.length) {
          const { bytesWritten } = await this.handle!.write(
            buffer,
            offset,
            buffer.length - offset,
            null
          )
          if (bytesWritten < 1) throw new Error('Short write')
          offset += bytesWritten
        }
      })
      .catch(() => this.fail('write'))
      .finally(() => {
        this.queued -= buffer.length
      })
  }
  async flush(): Promise<void> {
    await this.tail
    if (this.failure || !this.handle) return
    try {
      await this.handle.sync()
    } catch {
      this.fail('sync')
    }
  }
  close(exitCode = 0): Promise<void> {
    return (this.closing ??= (async () => {
      this.host('end', { exitCode })
      this.closed = true
      await this.flush()
      try {
        await this.handle?.close()
      } catch {
        this.fail('close')
      }
    })())
  }
}

/** Reader and writer roots share workspace isolation, but listing never creates a new run. */
export class LogStore {
  private constructor(
    readonly directory: string,
    private options: LogOptions
  ) {}
  static async open(cwd: string, options: LogOptions = {}): Promise<LogStore> {
    const workspace = await realpath(cwd)
    const hash = createHash('sha256').update(workspace).digest('hex')
    return new LogStore(
      path.join(
        path.resolve(
          options.root ?? process.env.ZERO2AGENT_LOG_DIR ?? path.join(homedir(), '.zero2agent/logs')
        ),
        hash
      ),
      options
    )
  }
  start(): Promise<RunJournal> {
    return RunJournal.create(this.directory, this.options)
  }
  private file(id: string): string {
    if (!UUID.test(id)) throw new Error('日志 ID 必须是完整运行 UUID')
    return path.join(this.directory, id + '.jsonl')
  }
  async list(): Promise<LogItem[]> {
    let names: string[]
    try {
      names = await readdir(this.directory)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error('无法读取日志目录')
    }
    const files: Array<{ id: string; time: number }> = []
    for (const name of names)
      if (name.endsWith('.jsonl') && UUID.test(name.slice(0, -6))) {
        try {
          const info = await stat(path.join(this.directory, name))
          files.push({ id: name.slice(0, -6), time: info.mtimeMs })
        } catch {
          /* A concurrent removal is not an index entry. */
        }
      }
    const items: LogItem[] = []
    for (const file of files.sort((a, b) => b.time - a.time).slice(0, LOG_LIMITS.list)) {
      const item: LogItem = {
        id: file.id,
        title: `运行 ${file.id.slice(0, 8)}`,
        updatedAt: new Date(file.time).toISOString(),
      }
      let handle: FileHandle | undefined
      try {
        handle = await open(this.file(file.id), constants.O_RDONLY | constants.O_NOFOLLOW)
        const info = await handle.stat()
        if (!info.isFile() || info.size > LOG_LIMITS.file) throw new Error('size')
        const buffer = Buffer.alloc(Math.min(info.size, LOG_LIMITS.line))
        await handle.read(buffer, 0, buffer.length, 0)
        const end = buffer.indexOf(10)
        if (end < 0) throw new Error('header')
        const header = validateRecord(JSON.parse(buffer.subarray(0, end).toString()), file.id)
        if (header.kind !== 'host' || header.event !== 'start' || header.seq !== 1)
          throw new Error('header')
        item.updatedAt = header.at
        item.title += ` · ${header.at.slice(0, 16)}`
      } catch {
        item.error = '文件、版本或首行不可读'
      } finally {
        await handle?.close()
      }
      items.push(item)
    }
    return items
  }
  async read(id: string, operationId?: string): Promise<LogReport> {
    if (operationId && !UUID.test(operationId)) throw new Error('操作 ID 必须是完整 UUID')
    const file = this.file(id)
    let handle: FileHandle
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch {
      throw new Error('日志不存在或文件不可安全读取')
    }
    const report: LogReport = { id, records: [], count: 0, omitted: 0, warnings: [] }
    const backgrounds = new Set<number>()
    const operations = new Set<string>(),
      requests = new Set<string>(),
      tools = new Set<string>()
    let lastSeq = 0,
      header = false,
      ended = false,
      pending = Buffer.alloc(0),
      lines = 0,
      matched = 0
    const accept = (buffer: Buffer): void => {
      lines++
      if (buffer.length > LOG_LIMITS.line) throw new Error(`日志第 ${lines} 行过长`)
      let r: LogRecord
      try {
        r = validateRecord(JSON.parse(buffer.toString('utf8')), id)
      } catch {
        throw new Error(`日志第 ${lines} 行损坏或版本不受支持`)
      }
      if (ended || r.seq !== lastSeq + 1) throw new Error(`日志第 ${lines} 行顺序无效`)
      if (!header) {
        if (r.kind !== 'host' || r.event !== 'start') throw new Error('缺少运行起始记录')
        header = true
      }
      lastSeq = r.seq
      report.count++
      if (r.kind === 'host' && r.event === 'end') ended = true
      if (r.kind === 'operation' && r.operationId) {
        if (r.event === 'start') operations.add(r.operationId)
        else operations.delete(r.operationId)
      }
      if (r.kind === 'request' && r.requestId) {
        if (r.event === 'start') requests.add(r.requestId)
        else requests.delete(r.requestId)
      }
      if (r.kind === 'tool' && r.event === 'metadata' && r.pid !== undefined) {
        if (r.terminalOutcome === 'skipped') backgrounds.add(r.pid)
        else if (r.terminalOutcome === 'background-completed') backgrounds.delete(r.pid)
      }
      if (r.kind === 'tool') {
        const key = `${r.operationId}:${r.requestId}:${r.toolCallId}`
        if (['pending', 'approval', 'running'].includes(r.event)) tools.add(key)
        else if (r.event !== 'metadata') tools.delete(key)
      }
      if (operations.size + requests.size + tools.size + backgrounds.size > LOG_LIMITS.identities)
        throw new Error('日志未结束身份数量超限')
      if (!operationId || r.operationId === operationId) {
        matched++
        report.records.push(r)
        if (report.records.length > LOG_LIMITS.display) report.records.shift()
      }
    }
    try {
      const info = await handle.stat()
      if (!info.isFile() || !info.size || info.size > LOG_LIMITS.file)
        throw new Error('日志为空、不是普通文件或超过 64 MiB')
      // Snapshot the current prefix: a concurrent append cannot make this reader chase EOF forever.
      for await (const raw of handle.createReadStream({
        start: 0,
        end: info.size - 1,
        autoClose: false,
        highWaterMark: 16384,
      })) {
        pending = Buffer.concat([pending, raw as Buffer])
        let boundary: number
        while ((boundary = pending.indexOf(10)) >= 0) {
          accept(pending.subarray(0, boundary))
          pending = pending.subarray(boundary + 1)
        }
        if (pending.length > LOG_LIMITS.line) throw new Error('日志行长度超限')
      }
      if (!header) throw new Error('没有完整的运行起始记录')
      if (pending.length) report.warnings.push('末尾一行未写完整；仅展示之前的完整记录。')
      if (!ended)
        report.warnings.push(
          '未见进程退出记录：仍在运行、强制终止或日志故障，不能据此判定没有副作用。'
        )
      if (operations.size || requests.size || tools.size || backgrounds.size)
        report.warnings.push(
          `未闭环：操作 ${operations.size}，请求 ${requests.size}，工具 ${tools.size}，后台进程 ${backgrounds.size}。`
        )
      report.omitted = matched - report.records.length
      if (operationId && !matched) report.warnings.push('没有这个操作的记录。')
      return report
    } finally {
      await handle.close()
    }
  }
}

export function formatLog(report: LogReport): string {
  const lines = [
    `运行日志 ${report.id}`,
    `共 ${report.count} 条；展示 ${report.records.length} 条${report.omitted ? `；省略较早 ${report.omitted} 条` : ''}`,
    ...report.warnings.map(w => `注意：${w}`),
  ]
  for (const r of report.records)
    lines.push(
      [
        `#${r.seq} ${r.kind}/${r.event}`,
        r.operationId && `op=${r.operationId}`,
        r.sessionId && `session=${r.sessionId}`,
        r.requestId && `req=${r.requestId}`,
        r.purpose,
        r.model,
        r.toolName && `tool=${r.toolName}`,
        r.toolCallId && `call=${r.toolCallId}`,
        r.action,
        r.durationMs !== undefined && `${r.durationMs}ms`,
        r.inputTokens !== undefined && `in=${r.inputTokens}`,
        r.outputTokens !== undefined && `out=${r.outputTokens}`,
        r.errorKind && `error=${r.errorKind}`,
        r.httpStatus && `http=${r.httpStatus}`,
        r.terminalOutcome && `terminal=${r.terminalOutcome}`,
        r.exitCode !== undefined && `exit=${r.exitCode}`,
        r.pid !== undefined && `pid=${r.pid}`,
        r.signal && `signal=${r.signal}`,
        r.revision !== undefined && `r${r.revision}`,
      ]
        .filter(Boolean)
        .join(' · ')
    )
  return lines.join('\n')
}
