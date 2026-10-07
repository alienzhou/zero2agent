import * as readline from 'node:readline'
import { terminalTool } from '@zero2agent/core'
import type { Agent, ApprovalRequest, ApprovalResponse, LoopEventHandlers, TerminalInterruptController } from '@zero2agent/core'
import { appendEntry, compactionLabel, initialState, reduceRuntime } from './runtime-state.js'
import { cellWidth, clipText, graphemes, safeText, textWidth, wrapText } from './display-text.js'
import { cleanupBackgroundOnExit, setupTerminalRuntime } from './setup-terminal-runtime.js'
import { runHumanTerminal } from './human-terminal.js'

const ENTER_SCREEN = '\x1b[?1049h\x1b[?2004h\x1b[?25l'
const LEAVE_SCREEN = '\x1b[0m\x1b[?2004l\x1b[?25h\x1b[?1049l'
const PHASE: Record<string, string> = {
  idle: '等待输入', preparing: '准备上下文', requesting: '等待模型', streaming: '生成回答',
  tools: '执行工具', cancelling: '正在取消', completed: '已完成', cancelled: '已取消', error: '出错',
}
const STATUS: Record<string, string> = {
  pending: '等待', approval: '待审批', running: '运行中', completed: '完成', denied: '已拒绝', error: '失败', cancelled: '已取消',
}

interface PendingApproval {
  request: ApprovalRequest
  text: string
  offset: number
  finish: (allow: boolean, reason: string) => void
}

/** Owns input, rendering and terminal lifetime. The Agent never depends on this UI. */
export class RuntimeTui {
  private state = initialState()
  private agent?: Agent
  private active = false
  private closed = false
  private busy = false
  private compacting = false
  private originalRaw = false
  private buffer = ''
  private cursor = 0
  private paste = false
  private history: string[] = []
  private historyIndex = 0
  private draft = ''
  private scroll = 0
  private approval?: PendingApproval
  private terminalController?: TerminalInterruptController
  private renderTimer?: NodeJS.Timeout
  private tick?: NodeJS.Timeout
  private operation?: Promise<void>
  private done: () => void = () => {}

  readonly events: LoopEventHandlers = {
    onEvent: event => {
      this.state = reduceRuntime(this.state, event)
      this.schedule()
    },
    onCompaction: event => {
      // Manual /compact has no user turn; run() compaction is already in onEvent.
      if (this.compacting) this.notice(compactionLabel(event))
    },
  }

  readonly requestApproval = (request: ApprovalRequest): Promise<ApprovalResponse> => {
    if (this.closed || request.signal.aborted) {
      return Promise.resolve({ requestId: request.id, decision: 'deny', reason: 'Approval expired' })
    }
    return new Promise(resolve => {
      let settled = false
      const onAbort = (): void => finish(false, String(request.signal.reason ?? 'Approval expired'))
      const finish = (allow: boolean, reason: string): void => {
        if (settled) return
        settled = true
        request.signal.removeEventListener('abort', onAbort)
        this.approval = undefined
        resolve({ requestId: request.id, decision: allow ? 'allow' : 'deny', reason })
        this.schedule()
      }
      this.approval = {
        request,
        text: `Approval · ${request.toolName}\n调用: ${request.toolCallId}\n工作目录: ${request.cwd}\n原因: ${request.reason}\n参数（完整 JSON）:\n${JSON.stringify(request.input, null, 2)}`,
        offset: 0,
        finish,
      }
      request.signal.addEventListener('abort', onAbort, { once: true })
      this.schedule()
    })
  }

  async run(agent: Agent): Promise<void> {
    this.agent = agent
    this.originalRaw = process.stdin.isRaw ?? false
    setupTerminalRuntime(undefined, {
      quiet: true,
      onStatusLine: line => this.notice(line),
      attachInterrupts: controller => {
        this.terminalController = controller
        return () => { if (this.terminalController === controller) this.terminalController = undefined }
      },
      runInteractive: async request => {
        this.suspend()
        try { return await runHumanTerminal(request) }
        finally { if (!this.closed) this.acquire() }
      },
    })
    this.notice('输入你的问题；/new 新建对话；/compact 压缩上下文；/terminal [bash命令] 交给人操作；exit 退出')
    const done = new Promise<void>(resolve => { this.done = resolve })
    process.once('exit', this.restoreOnExit)
    try {
      this.acquire()
      await done
    } finally {
      this.suspend()
      process.off('exit', this.restoreOnExit)
    }
  }

  private notice(text: string): void {
    this.state = appendEntry(this.state, { kind: 'notice', text: text.slice(-12_000) })
    this.schedule()
  }

  private acquire(): void {
    if (this.active || this.closed) return
    this.active = true
    readline.emitKeypressEvents(process.stdin)
    process.stdin.setRawMode(true)
    process.stdin.on('keypress', this.onKey)
    process.stdin.once('end', this.onEnd)
    process.stdin.once('error', this.onEnd)
    process.stdout.on('resize', this.onResize)
    process.on('SIGINT', this.onInterrupt)
    process.once('SIGTERM', this.onTerminate)
    process.once('SIGHUP', this.onHangup)
    process.stdin.resume()
    process.stdout.write(ENTER_SCREEN)
    this.tick = setInterval(() => { if (this.busy) this.schedule() }, 250)
    this.render()
  }

  private suspend(): void {
    if (!this.active) return
    this.active = false
    clearTimeout(this.renderTimer)
    this.renderTimer = undefined
    clearInterval(this.tick)
    process.stdin.off('keypress', this.onKey)
    process.stdin.off('end', this.onEnd)
    process.stdin.off('error', this.onEnd)
    process.stdout.off('resize', this.onResize)
    process.off('SIGINT', this.onInterrupt)
    process.off('SIGTERM', this.onTerminate)
    process.off('SIGHUP', this.onHangup)
    process.stdin.pause()
    if (!process.stdin.destroyed && !process.stdin.readableEnded) process.stdin.setRawMode(this.originalRaw)
    process.stdout.write(LEAVE_SCREEN)
  }

  private restoreOnExit = (): void => { this.suspend() }
  private onEnd = (): void => { void this.close() }
  private onTerminate = (): void => { void this.close(143) }
  private onHangup = (): void => { void this.close(129) }
  private onResize = (): void => { this.render() }
  private onInterrupt = (): void => {
    if (!this.busy) { void this.close(); return }
    this.agent?.cancelTurn()
    this.approval?.finish(false, 'Turn cancelled by user')
    this.state = { ...this.state, phase: 'cancelling' }
    this.schedule()
  }

  private async close(exitCode?: number): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.agent?.cancelTurn()
    this.agent?.cancelCompaction()
    this.agent?.cancelPendingApprovals()
    this.approval?.finish(false, 'Input closed')
    this.suspend()
    try {
      await this.operation
      if (exitCode === undefined) await cleanupBackgroundOnExit()
      process.stdout.write('再见！\n')
      if (exitCode !== undefined) process.exitCode = exitCode
    } catch (error) {
      process.stderr.write(`退出清理失败: ${safeText(String(error))}\n`)
      process.exitCode = 1
    } finally { this.done() }
  }

  private onKey = (text: string | undefined, key: readline.Key = {}): void => {
    if (!this.active || this.closed) return
    if (key.sequence === '\x1b[200~') { this.paste = true; return }
    if (key.sequence === '\x1b[201~') { this.paste = false; return }
    if (this.paste) {
      if (!this.busy && !this.approval && text) this.insert(safeText(text).replaceAll('\n', ' '))
      return
    }
    if (key.ctrl && key.name === 'c') { this.onInterrupt(); return }
    const page = Math.max(1, (process.stdout.rows || 24) - 5)
    if (this.approval) {
      const approval = this.approval
      const total = wrapText(approval.text, this.width()).length
      if (key.name === 'up' || key.name === 'pageup') approval.offset -= key.name === 'up' ? 1 : page
      else if (key.name === 'down' || key.name === 'pagedown') approval.offset += key.name === 'down' ? 1 : page
      else if (key.name === 'home') approval.offset = 0
      else if (key.name === 'end') approval.offset = total
      else if (text?.toLowerCase() === 'y') approval.finish(true, 'User approved this call')
      else if (text?.toLowerCase() === 'n' || key.name === 'return' || key.name === 'escape') approval.finish(false, 'User denied this call')
      approval.offset = Math.max(0, Math.min(Math.max(0, total - page), approval.offset))
      this.schedule()
      return
    }
    if (key.name === 'pageup' || key.name === 'pagedown') {
      this.scroll = Math.max(0, this.scroll + (key.name === 'pageup' ? page : -page))
      this.schedule()
      return
    }
    if (this.busy) {
      if (key.ctrl && key.name === 'x') this.terminalController?.signalCancel()
      if (key.ctrl && key.name === 's') this.terminalController?.signalSkip()
      return
    }
    const chars = graphemes(this.buffer)
    if (key.name === 'return') {
      const input = this.buffer.trim()
      this.buffer = ''
      this.cursor = 0
      if (input) {
        this.history = [...this.history.slice(-49), input]
        this.historyIndex = this.history.length
        this.draft = ''
        this.operation = this.submit(input)
      }
    } else if (key.ctrl && key.name === 'd' && !this.buffer) void this.close()
    else if (key.ctrl && key.name === 'u') { this.buffer = chars.slice(this.cursor).join(''); this.cursor = 0 }
    else if (key.ctrl && key.name === 'w') {
      const left = chars.slice(0, this.cursor).join('').replace(/\S*\s*$/, '')
      this.buffer = left + chars.slice(this.cursor).join('')
      this.cursor = graphemes(left).length
    } else if (key.name === 'left') this.cursor = Math.max(0, this.cursor - 1)
    else if (key.name === 'right') this.cursor = Math.min(chars.length, this.cursor + 1)
    else if (key.name === 'home' || (key.ctrl && key.name === 'a')) this.cursor = 0
    else if (key.name === 'end' || (key.ctrl && key.name === 'e')) this.cursor = chars.length
    else if (key.name === 'backspace') {
      if (this.cursor) { chars.splice(--this.cursor, 1); this.buffer = chars.join('') }
    } else if (key.name === 'delete') { chars.splice(this.cursor, 1); this.buffer = chars.join('') }
    else if (key.name === 'up' || key.name === 'down') {
      if (this.historyIndex === this.history.length) this.draft = this.buffer
      this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + (key.name === 'up' ? -1 : 1)))
      this.buffer = this.history[this.historyIndex] ?? this.draft
      this.cursor = graphemes(this.buffer).length
    } else if (text && !key.ctrl && !key.meta && !key.sequence?.startsWith('\x1b')) this.insert(safeText(text).replaceAll('\n', ' '))
    this.schedule()
  }

  private insert(text: string): void {
    const chars = graphemes(this.buffer)
    const left = chars.slice(0, this.cursor).join('') + text
    const next = left + chars.slice(this.cursor).join('')
    if (next.length > 16_384) return
    this.buffer = next
    this.cursor = graphemes(left).length
    this.schedule()
  }

  private async submit(input: string): Promise<void> {
    if (input === 'exit' || input === 'quit') { void this.close(); return }
    this.busy = true
    this.scroll = 0
    this.state = appendEntry(this.state, { kind: 'user', text: input })
    this.schedule()
    try {
      if (input === '/new') {
        this.agent!.reset()
        this.state = initialState()
        this.notice('已开始新对话。仅清空对话历史；文件、日志与后台进程保持不变。')
      } else if (input === '/compact') {
        this.compacting = true
        this.state.phase = 'preparing'
        const changed = await this.agent!.compact()
        this.notice(changed ? '已压缩工作上下文，完整会话记录保留。' : '当前没有可压缩的历史。')
        this.state.phase = 'completed'
      } else if (input === '/terminal' || input.startsWith('/terminal ')) {
        const command = input.slice('/terminal'.length).trim() || 'exec /bin/bash --noprofile --norc -i'
        this.notice(await terminalTool.execute({ command, interactive: true }, { cwd: process.cwd() }))
        this.state.phase = 'completed'
      } else await this.agent!.run(input)
    } catch (error) {
      const cancelled = error instanceof Error && error.name === 'TurnCancelledError'
      this.state.phase = cancelled ? 'cancelled' : 'error'
      this.notice(cancelled ? '本轮已取消。已完成的工具结果保留；已发生的文件修改不会回滚。' : `错误: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.compacting = false
      this.busy = false
      this.schedule()
    }
  }

  private width(): number { return Math.max(1, (process.stdout.columns || 80) - 1) }

  private schedule(): void {
    if (!this.active || this.renderTimer) return
    this.renderTimer = setTimeout(() => { this.renderTimer = undefined; this.render() }, 25)
  }

  private render(): void {
    if (!this.active || this.closed) return
    if (process.stdout.writableLength > 262_144) { this.schedule(); return }
    const width = this.width()
    const rows = Math.max(1, process.stdout.rows || 24)
    const bodyHeight = Math.max(1, rows - 5)
    const elapsed = this.busy && this.state.startedAt ? ` · ${((Date.now() - this.state.startedAt) / 1000).toFixed(1)}s` : ''
    const header = `zero2agent · ${this.approval ? '等待审批' : PHASE[this.state.phase] ?? this.state.phase}${elapsed}`
    const lines = [clipText(header, width), clipText(`工作目录: ${process.cwd()}`, width)]
    let cursorColumn = 1
    if (this.approval) {
      const all = wrapText(this.approval.text, width)
      this.approval.offset = Math.min(this.approval.offset, Math.max(0, all.length - bodyHeight))
      lines.push(...all.slice(this.approval.offset, this.approval.offset + bodyHeight))
      while (lines.length < 2 + bodyHeight) lines.push('')
      lines.push(clipText(`详情 ${this.approval.offset + 1}–${Math.min(all.length, this.approval.offset + bodyHeight)} / ${all.length} 行（可滚动查看全部参数）`, width))
      lines.push(clipText('↑↓ / PgUp PgDn / Home End 查看 · Ctrl-C 取消本轮', width))
      lines.push(clipText('允许这次操作？[y/N]: ', width))
    } else {
      const timeline: string[] = []
      if (this.state.discarded) timeline.push(`[较早的 ${this.state.discarded} 条显示记录已移除]`)
      for (const entry of this.state.entries) {
        if (entry.kind === 'tool') {
          const call = entry.call
          timeline.push(...wrapText(`┌ ${call.toolName} · ${STATUS[call.status]} · ${call.toolCallId}${call.durationMs !== undefined ? ` · ${call.durationMs}ms` : ''}`, width))
          if (call.input) timeline.push(...wrapText(`│ ${JSON.stringify(call.input)}`, width).slice(0, 3))
          if (call.reason) timeline.push(...wrapText(`│ ${call.reason}`, width))
          if (call.output) {
            const output = wrapText(call.output, Math.max(1, width - 2))
            timeline.push(...output.slice(0, 4).map(line => clipText(`│ ${line}`, width)))
            if (output.length > 4) timeline.push(clipText(`│ … 结果共 ${output.length} 行（完整结果在会话中）`, width))
          }
          timeline.push(clipText('└', width))
        } else {
          const label = entry.kind === 'user' ? '你 › ' : entry.kind === 'notice' ? '· ' : 'Agent › '
          timeline.push(...wrapText(label + entry.text, width))
        }
      }
      this.scroll = Math.min(this.scroll, Math.max(0, timeline.length - bodyHeight))
      const end = Math.max(bodyHeight, timeline.length - this.scroll)
      lines.push(...timeline.slice(Math.max(0, end - bodyHeight), end))
      while (lines.length < 2 + bodyHeight) lines.push('')
      lines.push('─'.repeat(width))
      lines.push(clipText(this.busy ? 'Ctrl-C 取消本轮 · Ctrl-X 停止命令 · Ctrl-S 转后台 · PgUp/PgDn 查看' : 'Enter 发送 · ↑↓ 输入历史 · PgUp/PgDn 查看 · Ctrl-C 退出', width))
      if (this.busy) lines.push(clipText(`运行中…${this.scroll ? `（历史向上 ${this.scroll} 行）` : ''}`, width))
      else {
        const chars = graphemes(this.buffer)
        const prefix = clipText('你: ', Math.max(0, width - 1))
        const available = Math.max(1, width - textWidth(prefix))
        let start = this.cursor
        let used = 0
        while (start > 0 && used + cellWidth(chars[start - 1]) < available) used += cellWidth(chars[--start])
        lines.push(prefix + clipText(chars.slice(start).join(''), available))
        cursorColumn = Math.min(width, textWidth(prefix) + used + 1)
      }
    }
    // Very short windows still expose the active focus; no row extends outside the viewport.
    const visible = lines.length > rows ? lines.slice(-rows) : lines
    const frame = visible.map(line => `\x1b[2K${clipText(line, width)}`).join('\r\n')
    const cursor = !this.busy && !this.approval ? `\x1b[${visible.length};${cursorColumn}H\x1b[?25h` : '\x1b[?25l'
    process.stdout.write(`\x1b[?25l\x1b[H${frame}\x1b[J${cursor}`)
  }
}
