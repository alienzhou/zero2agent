import { hostname } from 'node:os'
import type { Agent } from '@zero2agent/core'
import { SessionStore, type SessionItem, type StoredSession } from './session-store.js'

export const RECOVERY_NOTICE =
  '[Harness] The previous process stopped before saving the operation outcome. Only the last settled conversation is restored. Tools may already have changed files or started processes. Inspect the workspace before continuing; do not replay old calls automatically.'

/** Shared by TUI, plain and single-shot hosts; persistence is not part of model execution. */
export class Conversations {
  private current?: StoredSession
  private dirty = false
  private busy = false
  constructor(
    readonly agent: Agent,
    private store?: SessionStore
  ) {
    this.current = store?.fresh()
  }
  get status(): string {
    return this.current
      ? `${this.current.id} · ${this.dirty ? '尚未保存 /save 重试' : this.current.revision ? `已保存 r${this.current.revision}` : '新会话'}`
      : '临时会话（未启用保存）'
  }
  get id(): string | undefined {
    return this.current?.id
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
    await this.flush()
  }
  private async flush(pending?: StoredSession['pending'], force = false): Promise<void> {
    if (!this.store || !this.current || (!this.dirty && !pending && !force)) return
    try {
      this.current = await this.store.save(this.current, this.agent.snapshot(), pending)
      this.dirty = false
    } catch (error) {
      this.dirty = true
      throw new Error(
        `会话尚未保存，内存保留；/save 可重试。${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  async newSession(): Promise<void> {
    this.assertIdle()
    await this.flush()
    this.agent.reset()
    this.current = this.store?.fresh()
    this.dirty = false
  }
  async resume(id: string): Promise<string> {
    this.assertIdle()
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
        this.dirty = true
        return '已恢复上次结算的历史。上次运行中断，工具可能已修改文件；继续前请检查工作区。'
      }
      throw new Error('该会话的旧进程仍在运行，暂不恢复；先结束原运行。')
    }
    this.agent.restore(candidate.state)
    this.current = candidate
    this.dirty = false
    return '已恢复会话。历史工具只供查看；新操作使用当前权限与模型配置。'
  }
  async resumeLatest(): Promise<string> {
    const latest = (await this.list())[0]
    if (!latest) throw new Error('当前工作目录没有已保存会话。')
    return this.resume(latest.id)
  }
  run(message: string): Promise<string> {
    return this.perform('turn', () => this.agent.run(message))
  }
  compact(): Promise<boolean> {
    return this.perform('compact', () => this.agent.compact())
  }
  private async perform<T>(kind: 'turn' | 'compact', execute: () => Promise<T>): Promise<T> {
    this.assertIdle()
    this.busy = true
    try {
      await this.flush()
      // Reserve the next generation before any provider or tool can produce effects.
      await this.flush({ kind, pid: process.pid, host: hostname() })
      let result: T | undefined
      let failure: unknown
      try {
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
      this.busy = false
    }
  }
}
