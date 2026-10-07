import { hostname } from 'node:os'
import { terminalTool, TurnCancelledError, type Agent } from '@zero2agent/core'
import { LogStore, RunJournal, formatLog, type LogItem } from './run-log.js'
import { SessionStore, type SessionItem, type StoredSession } from './session-store.js'

export const RECOVERY_NOTICE =
  '[Harness] The previous process stopped before saving the operation outcome. Only the last settled conversation is restored. Tools may already have changed files or started processes. Inspect the workspace before continuing; do not replay old calls automatically.'

/** Shared by TUI, plain and single-shot hosts; persistence is not part of model execution. */
export class Conversations {
  private current?: StoredSession
  private dirty = false
  private busy = false
  private cancelled = false
  private writing = false
  private operation?: Promise<unknown>
  constructor(
    readonly agent: Agent,
    private store?: SessionStore,
    private logs?: LogStore,
    private journal?: RunJournal
  ) {
    this.current = store?.fresh()
    this.journal?.host('session-new', { sessionId: this.id })
  }
  get status(): string {
    return this.current
      ? `${this.current.id} · ${this.writing ? '正在保存' : this.dirty ? '尚未保存 /save 重试' : this.current.pending ? `本轮未结算 r${this.current.revision}` : this.current.revision ? `已保存 r${this.current.revision}` : '新会话'}`
      : '临时会话（未启用保存）'
  }
  get id(): string | undefined {
    return this.current?.id
  }
  get logStatus(): string {
    return this.journal?.status ?? '日志记录已关闭'
  }
  get logId(): string | undefined {
    return this.journal?.id
  }
  get logFailed(): boolean {
    return !!this.journal?.failure
  }
  async listLogs(): Promise<LogItem[]> {
    await this.journal?.flush()
    if (!this.logs) throw new Error('此宿主没有日志浏览器。')
    return this.logs.list()
  }
  async readLog(id = this.logId, operationId?: string): Promise<string> {
    await this.journal?.flush()
    if (!this.logs || !id) throw new Error('没有当前运行日志；使用 /logs 查看以前的运行。')
    return `${this.logStatus}\n${this.journal?.id === id ? this.journal.file + '\n' : ''}${formatLog(await this.logs.read(id, operationId))}`
  }
  async closeLogs(exitCode = 0): Promise<void> {
    try {
      await this.operation
    } catch {
      /* Execution error has its own reporting path. */
    }
    await this.journal?.close(exitCode)
  }
  async terminal(command: string): Promise<string> {
    this.assertIdle()
    this.busy = true
    this.journal?.host('terminal-start', { sessionId: this.id })
    let observed = false
    try {
      const result = await terminalTool.execute(
        { command, interactive: true },
        {
          cwd: process.cwd(),
          onResultMetadata: metadata => {
            observed = true
            this.journal?.host(
              metadata.terminalOutcome === 'cancelled' || metadata.terminalOutcome === 'declined'
                ? 'terminal-cancelled'
                : 'terminal-completed',
              { sessionId: this.id, ...metadata }
            )
          },
        }
      )
      if (!observed) this.journal?.host('terminal-error', { sessionId: this.id })
      return result
    } catch (error) {
      this.journal?.host('terminal-error', { sessionId: this.id })
      throw error
    } finally {
      await this.journal?.flush()
      this.busy = false
    }
  }
  private assertIdle(): void {
    if (this.busy) throw new Error('Wait for the running operation before switching sessions.')
  }
  async list(): Promise<SessionItem[]> {
    if (!this.store) throw new Error('当前使用 --no-save；会话保存和恢复已关闭。')
    return this.store.list()
  }
  async save(): Promise<void> {
    this.assertIdle()
    this.busy = true
    try {
      await this.flush()
    } finally {
      this.busy = false
    }
  }
  private async flush(pending?: StoredSession['pending'], force = false): Promise<void> {
    if (!this.store || !this.current || (!this.dirty && !pending && !force)) return
    this.writing = true
    this.journal?.host('save-start', { sessionId: this.id, revision: this.current.revision })
    try {
      this.current = await this.store.save(this.current, this.agent.snapshot(), pending)
      this.dirty = false
      this.journal?.host('save-completed', { sessionId: this.id, revision: this.current.revision })
    } catch (error) {
      this.dirty = true
      this.journal?.host('save-error', { sessionId: this.id })
      throw new Error(
        `会话尚未保存，内存保留；/save 可重试。${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      this.writing = false
    }
  }
  async newSession(): Promise<void> {
    this.assertIdle()
    this.busy = true
    try {
      await this.flush()
      this.agent.reset()
      this.current = this.store?.fresh()
      this.journal?.host('session-new', { sessionId: this.id })
      this.dirty = false
    } finally {
      this.busy = false
    }
  }
  async resume(id: string): Promise<string> {
    this.assertIdle()
    this.busy = true
    try {
      return await this.load(id)
    } finally {
      this.busy = false
    }
  }
  private async load(id: string): Promise<string> {
    if (!this.store) throw new Error('当前使用 --no-save，无法恢复。')
    await this.flush()
    const candidate = await this.store.load(id)
    if (candidate.pending) {
      if (candidate.pending.host !== hostname())
        throw new Error('旧运行来自其他主机，无法确认已结束；请在原主机处理。')
      try {
        process.kill(candidate.pending.pid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
          throw new Error('无法确认旧进程已退出，暂不恢复。')
        // Dead process: restore only the settled snapshot, never its pending execution.
        candidate.state.messages.push({ role: 'assistant', content: RECOVERY_NOTICE })
        this.agent.restore(candidate.state)
        this.current = candidate
        this.journal?.host('session-resume', { sessionId: this.id, revision: candidate.revision })
        this.dirty = true
        return '已恢复上次结算的历史。上次运行中断，工具可能已修改文件；继续前请检查工作区。'
      }
      throw new Error('该会话的旧进程仍在运行，暂不恢复；先结束原运行。')
    }
    this.agent.restore(candidate.state)
    this.current = candidate
    this.journal?.host('session-resume', { sessionId: this.id, revision: candidate.revision })
    this.dirty = false
    return '已恢复会话。历史工具只供查看；新操作使用当前权限与模型配置。'
  }
  async resumeLatest(): Promise<string> {
    const latest = (await this.list())[0]
    if (!latest) throw new Error('当前工作目录没有已保存会话。')
    return this.resume(latest.id)
  }
  cancelTurn(): void {
    if (this.busy) this.cancelled = true
    this.agent.cancelTurn()
  }
  run(message: string): Promise<string> {
    const work = this.perform('turn', () => this.agent.run(message, { sessionId: this.id }))
    this.operation = work
    return work
  }
  compact(): Promise<boolean> {
    const work = this.perform('compact', () => this.agent.compact({ sessionId: this.id }))
    this.operation = work
    return work
  }
  private async perform<T>(kind: 'turn' | 'compact', execute: () => Promise<T>): Promise<T> {
    this.assertIdle()
    this.busy = true
    this.cancelled = false
    try {
      await this.flush()
      // Reserve the next generation before any provider or tool can produce effects.
      await this.flush({ kind, pid: process.pid, host: hostname() })
      let result: T | undefined
      let failure: unknown
      try {
        if (this.cancelled) throw new TurnCancelledError()
        result = await execute()
      } catch (error) {
        failure = error
      }
      this.dirty = !!this.store
      try {
        await this.flush(undefined, true)
      } catch (error) {
        if (failure)
          throw new AggregateError(
            [failure, error],
            `${failure instanceof Error ? failure.message : String(failure)}；${(error as Error).message}`
          )
        throw error
      }
      if (failure) throw failure
      return result as T
    } finally {
      await this.journal?.flush()
      this.busy = false
    }
  }
}
