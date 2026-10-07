import * as readline from 'node:readline'
import { terminalTool } from '@zero2agent/core'
import type {
  Agent,
  ApprovalRequest,
  ApprovalResponse,
  LoopEventHandlers,
  TerminalInterruptController,
} from '@zero2agent/core'
import { appendEntry, compactionLabel, initialState, reduceRuntime } from './runtime-state.js'
import type { TimelineEntry } from './runtime-state.js'
import { clipText, graphemes, safeText, textWidth, wrapText } from './display-text.js'
import { cleanupBackgroundOnExit, setupTerminalRuntime } from './setup-terminal-runtime.js'
import { runHumanTerminal } from './human-terminal.js'

const ENTER_SCREEN = '\x1b[?1049h\x1b[?2004h\x1b[?25l'
const LEAVE_SCREEN = '\x1b[0m\x1b[?2004l\x1b[?25h\x1b[?1049l'
const PHASE: Record<string, string> = {
  idle: '等待输入',
  preparing: '准备上下文',
  requesting: '等待模型',
  streaming: '生成回答',
  tools: '执行工具',
  cancelling: '正在取消',
  completed: '已完成',
  cancelled: '已取消',
  error: '出错',
}
const STATUS: Record<string, string> = {
  pending: '等待',
  approval: '待审批',
  running: '运行中',
  completed: '完成',
  denied: '已拒绝',
  error: '失败',
  cancelled: '已取消',
}
const COMMANDS = ['/new', '/compact', '/terminal', '/help']
const HELP =
  '输入编辑：← → / Home End 移动，↑ ↓ 在多行中移动或查看历史，Ctrl-U 清空前文，Ctrl-W 删除词。\nCtrl-J 换行；粘贴支持多行，粘贴结束后 Enter 发送；运行中可编辑草稿，完成后 Enter 发送。\n查看：PgUp/PgDn 滚动，Ctrl-End 回到底部；Ctrl-O 展开工具，Alt-↑/↓ 选择工具。\n审批：↑↓ / PgUp/PgDn / Home End 查看全部参数，y 允许本次，n / Enter / Esc 拒绝。\n运行：Ctrl-C 取消本轮（不回滚文件），Ctrl-X 停止前台命令，Ctrl-S 转后台。\n空闲：Ctrl-C 先清草稿，空草稿时退出；Ctrl-D 空草稿时退出。\n命令：/new 新对话，/compact 压缩，/terminal 人工终端，/help 帮助，exit 退出。'
const toolKey = (call: { turnId: string; toolCallId: string }): string =>
  `${call.turnId}:${call.toolCallId}`

interface PendingApproval {
  request: ApprovalRequest
  text: string
  offset: number
  displayed: boolean
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
  private expanded = new Set<string>()
  private selectedTool?: string
  private revealSelected = false
  private cachedEntries?: TimelineEntry[]
  private cachedSignature = ''
  private cachedTimeline: string[] = []
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
      return Promise.resolve({
        requestId: request.id,
        decision: 'deny',
        reason: 'Approval expired',
      })
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
        displayed: false,
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
        return () => {
          if (this.terminalController === controller) this.terminalController = undefined
        }
      },
      runInteractive: async request => {
        this.suspend()
        try {
          return await runHumanTerminal(request)
        } finally {
          if (!this.closed) this.acquire()
        }
      },
    })
    this.notice(
      '输入你的问题。/new 新建对话 · /compact 压缩 · /terminal 人工终端 · /help 快捷键 · exit 退出'
    )
    const done = new Promise<void>(resolve => {
      this.done = resolve
    })
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
    this.tick = setInterval(() => {
      if (this.busy) this.schedule()
    }, 250)
    this.render()
  }

  private suspend(): void {
    if (!this.active) return
    this.active = false
    // A PTY lease consumes its own bytes, including a pending paste-end marker.
    this.paste = false
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
    if (!process.stdin.destroyed && !process.stdin.readableEnded)
      process.stdin.setRawMode(this.originalRaw)
    process.stdout.write(LEAVE_SCREEN)
  }

  private restoreOnExit = (): void => {
    this.suspend()
  }
  private onEnd = (): void => {
    void this.close()
  }
  private onTerminate = (): void => {
    void this.close(143)
  }
  private onHangup = (): void => {
    void this.close(129)
  }
  private onResize = (): void => {
    this.render()
  }
  private onInterrupt = (): void => {
    if (!this.busy) {
      if (this.buffer) {
        this.buffer = ''
        this.cursor = 0
        this.draft = ''
        this.historyIndex = this.history.length
        this.notice('草稿已清空；空草稿时 Ctrl-C 退出。')
        return
      }
      void this.close()
      return
    }
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
    } finally {
      this.done()
    }
  }

  private onKey = (text: string | undefined, key: readline.Key = {}): void => {
    if (!this.active || this.closed) return
    if (key.sequence === '\x1b[200~') {
      this.paste = true
      return
    }
    if (key.sequence === '\x1b[201~') {
      this.paste = false
      return
    }
    if (this.paste) {
      if (!this.approval && text) this.insert(safeText(text.replaceAll('\r', '\n')))
      return
    }
    if (key.ctrl && key.name === 'c') {
      this.onInterrupt()
      return
    }
    const page = Math.max(1, (process.stdout.rows || 24) - 7)
    if (this.approval) {
      const approval = this.approval
      // Typeahead from the composer cannot approve a dialog that has not been painted yet.
      if (!approval.displayed) return
      const total = wrapText(approval.text, this.width()).length
      if (key.name === 'up' || key.name === 'pageup')
        approval.offset -= key.name === 'up' ? 1 : page
      else if (key.name === 'down' || key.name === 'pagedown')
        approval.offset += key.name === 'down' ? 1 : page
      else if (key.name === 'home') approval.offset = 0
      else if (key.name === 'end') approval.offset = total
      else if (text?.toLowerCase() === 'y') approval.finish(true, 'User approved this call')
      else if (text?.toLowerCase() === 'n' || key.name === 'return' || key.name === 'escape')
        approval.finish(false, 'User denied this call')
      approval.offset = Math.max(0, Math.min(Math.max(0, total - page), approval.offset))
      this.schedule()
      return
    }
    if (key.name === 'pageup' || key.name === 'pagedown') {
      this.scroll = Math.max(0, this.scroll + (key.name === 'pageup' ? page : -page))
      this.schedule()
      return
    }
    if (key.ctrl && key.name === 'end') {
      this.scroll = 0
      this.schedule()
      return
    }
    const tools = this.state.entries.filter(entry => entry.kind === 'tool')
    const selected = tools.findIndex(entry => toolKey(entry.call) === this.selectedTool)
    if (key.meta && (key.name === 'up' || key.name === 'down') && tools.length) {
      const index = Math.max(
        0,
        Math.min(
          tools.length - 1,
          (selected < 0 ? tools.length - 1 : selected) + (key.name === 'up' ? -1 : 1)
        )
      )
      this.selectedTool = toolKey(tools[index].call)
      this.revealSelected = true
      this.schedule()
      return
    }
    if (key.ctrl && key.name === 'o') {
      const last = tools.at(-1)
      const id = this.selectedTool ?? (last ? toolKey(last.call) : undefined)
      if (id) {
        if (this.expanded.has(id)) this.expanded.delete(id)
        else this.expanded.add(id)
        this.revealSelected = true
      }
      this.schedule()
      return
    }
    if (this.busy) {
      if (key.ctrl && key.name === 'x') {
        this.terminalController?.signalCancel()
        return
      }
      if (key.ctrl && key.name === 's') {
        this.terminalController?.signalSkip()
        return
      }
    }
    const chars = graphemes(this.buffer)
    const lineStart = this.cursor === 0 ? 0 : chars.lastIndexOf('\n', this.cursor - 1) + 1
    const nextBreak = chars.indexOf('\n', this.cursor)
    const lineEnd = nextBreak < 0 ? chars.length : nextBreak
    if (key.name === 'return') {
      if (this.busy) {
        this.notice('本轮仍在运行，草稿已保留；完成后按 Enter 发送。')
        return
      }
      const input = this.buffer.trim()
      this.buffer = ''
      this.cursor = 0
      if (input) {
        this.history = [...this.history.slice(-49), input]
        this.historyIndex = this.history.length
        this.draft = ''
        this.operation = this.submit(input)
      }
    } else if (key.name === 'enter' || (key.ctrl && key.name === 'j')) {
      this.insert('\n')
    } else if (key.name === 'tab') {
      const matches = COMMANDS.filter(command => command.startsWith(this.buffer))
      if (matches.length === 1) {
        this.buffer = matches[0]
        this.cursor = graphemes(this.buffer).length
      }
    } else if (key.ctrl && key.name === 'd' && !this.buffer && !this.busy) void this.close()
    else if (key.ctrl && key.name === 'u') {
      this.buffer = chars.slice(this.cursor).join('')
      this.cursor = 0
    } else if (key.ctrl && key.name === 'w') {
      const left = chars
        .slice(0, this.cursor)
        .join('')
        .replace(/\S*\s*$/, '')
      this.buffer = left + chars.slice(this.cursor).join('')
      this.cursor = graphemes(left).length
    } else if (key.name === 'left') this.cursor = Math.max(0, this.cursor - 1)
    else if (key.name === 'right') this.cursor = Math.min(chars.length, this.cursor + 1)
    else if (key.name === 'home' || (key.ctrl && key.name === 'a')) this.cursor = lineStart
    else if (key.name === 'end' || (key.ctrl && key.name === 'e')) this.cursor = lineEnd
    else if (key.name === 'backspace') {
      if (this.cursor) {
        chars.splice(--this.cursor, 1)
        this.buffer = chars.join('')
      }
    } else if (key.name === 'delete') {
      chars.splice(this.cursor, 1)
      this.buffer = chars.join('')
    } else if (key.name === 'up' || key.name === 'down') {
      if (key.name === 'up' && lineStart > 0) {
        const previousEnd = lineStart - 1
        const previousStart = previousEnd === 0 ? 0 : chars.lastIndexOf('\n', previousEnd - 1) + 1
        this.cursor = Math.min(previousEnd, previousStart + this.cursor - lineStart)
        this.schedule()
        return
      }
      if (key.name === 'down' && lineEnd < chars.length) {
        const nextEnd = chars.indexOf('\n', lineEnd + 1)
        this.cursor = Math.min(
          nextEnd < 0 ? chars.length : nextEnd,
          lineEnd + 1 + this.cursor - lineStart
        )
        this.schedule()
        return
      }
      if (this.historyIndex === this.history.length) this.draft = this.buffer
      this.historyIndex = Math.max(
        0,
        Math.min(this.history.length, this.historyIndex + (key.name === 'up' ? -1 : 1))
      )
      this.buffer = this.history[this.historyIndex] ?? this.draft
      this.cursor = graphemes(this.buffer).length
    } else if (text && !key.ctrl && !key.meta && !key.sequence?.startsWith('\x1b'))
      this.insert(safeText(text).replaceAll('\n', ' '))
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
    if (input === 'exit' || input === 'quit') {
      void this.close()
      return
    }
    this.busy = true
    this.scroll = 0
    this.state = appendEntry(this.state, { kind: 'user', text: input })
    this.state.startedAt = Date.now()
    this.schedule()
    try {
      if (input === '/new') {
        this.agent!.reset()
        this.state = initialState()
        this.expanded.clear()
        this.selectedTool = undefined
        this.notice('已开始新对话。仅清空对话历史；文件、日志与后台进程保持不变。')
      } else if (input === '/compact') {
        this.compacting = true
        this.state.phase = 'preparing'
        const changed = await this.agent!.compact()
        this.notice(changed ? '已压缩工作上下文，完整会话记录保留。' : '当前没有可压缩的历史。')
        this.state.phase = 'completed'
      } else if (input === '/help') {
        this.notice(HELP)
        this.state.phase = 'idle'
      } else if (input === '/terminal' || input.startsWith('/terminal ')) {
        const command =
          input.slice('/terminal'.length).trim() || 'exec /bin/bash --noprofile --norc -i'
        this.notice(
          await terminalTool.execute({ command, interactive: true }, { cwd: process.cwd() })
        )
        this.state.phase = 'completed'
      } else await this.agent!.run(input)
    } catch (error) {
      const cancelled = error instanceof Error && error.name === 'TurnCancelledError'
      this.state.phase = cancelled ? 'cancelled' : 'error'
      this.notice(
        cancelled
          ? '本轮已取消。已完成的工具结果保留；已发生的文件修改不会回滚。'
          : `错误: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      this.compacting = false
      this.busy = false
      this.schedule()
    }
  }

  private width(): number {
    return Math.max(1, (process.stdout.columns || 80) - 1)
  }

  private composer(width: number): { lines: string[]; column: number; row: number } {
    const prefix = clipText(this.busy ? '草稿: ' : '你: ', Math.max(0, width - 1))
    const chars = graphemes(this.buffer)
    const before = prefix + chars.slice(0, this.cursor).join('')
    const wrapped = wrapText(prefix + this.buffer, width)
    const cursorLines = wrapText(before, width)
    let row = cursorLines.length - 1
    let column = textWidth(cursorLines.at(-1) ?? '')
    if (column === width) {
      row++
      column = 0
      if (wrapped.length <= row) wrapped.push('')
    }
    const height = Math.min(3, wrapped.length)
    const start = Math.max(0, Math.min(row, wrapped.length - height))
    return { lines: wrapped.slice(start, start + height), row: row - start, column: column + 1 }
  }

  private schedule(): void {
    if (!this.active || this.renderTimer) return
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined
      this.render()
    }, 25)
  }

  private render(): void {
    if (!this.active || this.closed) return
    if (process.stdout.writableLength > 262_144) {
      this.schedule()
      return
    }
    const width = this.width()
    const rows = Math.max(1, process.stdout.rows || 24)
    const composer = this.composer(width)
    const bodyHeight = Math.max(1, rows - 4 - (this.approval ? 1 : composer.lines.length))
    const elapsed =
      this.busy && this.state.startedAt
        ? ` · ${((Date.now() - this.state.startedAt) / 1000).toFixed(1)}s`
        : ''
    const spinner = this.busy ? ['◐', '◓', '◑', '◒'][Math.floor(Date.now() / 250) % 4] : '●'
    const header = `${spinner} zero2agent · ${this.approval ? '等待审批' : (PHASE[this.state.phase] ?? this.state.phase)}${elapsed}`
    const lines = [clipText(header, width), clipText(`工作目录: ${process.cwd()}`, width)]
    let cursorRow = rows
    if (this.approval) {
      const all = wrapText(this.approval.text, width)
      this.approval.offset = Math.min(this.approval.offset, Math.max(0, all.length - bodyHeight))
      lines.push(...all.slice(this.approval.offset, this.approval.offset + bodyHeight))
      while (lines.length < 2 + bodyHeight) lines.push('')
      lines.push(
        clipText(
          `详情 ${this.approval.offset + 1}–${Math.min(all.length, this.approval.offset + bodyHeight)} / ${all.length} 行（可滚动查看全部参数）`,
          width
        )
      )
      lines.push(clipText('↑↓ / PgUp PgDn / Home End 查看 · Ctrl-C 取消本轮', width))
      lines.push(clipText('允许这次操作？[y/N]: y 本次允许 · Enter 默认拒绝', width))
      this.approval.displayed = true
    } else {
      let timeline: string[] = []
      const lastTool = this.state.entries.filter(entry => entry.kind === 'tool').at(-1)
      const visibleToolIds = new Set(
        this.state.entries.filter(entry => entry.kind === 'tool').map(entry => toolKey(entry.call))
      )
      for (const id of this.expanded) if (!visibleToolIds.has(id)) this.expanded.delete(id)
      if (this.selectedTool && !visibleToolIds.has(this.selectedTool)) this.selectedTool = undefined
      const signature = `${width}:${this.selectedTool}:${[...this.expanded].join(',')}`
      if (this.cachedEntries === this.state.entries && signature === this.cachedSignature)
        timeline = this.cachedTimeline
      else {
        if (this.state.discarded) timeline.push(`[较早的 ${this.state.discarded} 条显示记录已移除]`)
        for (const entry of this.state.entries) {
          if (entry.kind === 'tool') {
            const call = entry.call
            const isSelected =
              toolKey(call) ===
              (this.selectedTool ?? (lastTool ? toolKey(lastTool.call) : undefined))
            const expanded = this.expanded.has(toolKey(call))
            timeline.push(
              ...wrapText(
                `┌ ${isSelected ? '◆' : '◇'} ${call.toolName.slice(0, 100)} · ${STATUS[call.status]} · ${call.toolCallId.slice(0, 100)}${call.durationMs !== undefined ? ` · ${call.durationMs}ms` : ''}`,
                width
              )
            )
            if (call.input) {
              const inputLines = wrapText(
                JSON.stringify(call.input, null, expanded ? 2 : undefined),
                Math.max(1, width - 2)
              )
              timeline.push(
                ...(expanded ? inputLines : inputLines.slice(0, 2)).map(line =>
                  clipText(`│ ${line}`, width)
                )
              )
              if (!expanded && inputLines.length > 2)
                timeline.push(clipText('│ … 参数已折叠 · Ctrl-O 展开', width))
            }
            if (call.reason && !call.output?.includes(call.reason))
              timeline.push(
                ...wrapText(call.reason, Math.max(1, width - 2)).map(line =>
                  clipText(`│ ${line}`, width)
                )
              )
            if (call.output) {
              const output = wrapText(call.output, Math.max(1, width - 2))
              timeline.push(
                ...(expanded ? output : output.slice(0, 3)).map(line =>
                  clipText(`│ ${line}`, width)
                )
              )
              if (!expanded && output.length > 3)
                timeline.push(clipText(`│ … 结果共 ${output.length} 行 · Ctrl-O 展开`, width))
            }
            timeline.push(clipText('└', width))
          } else {
            const label =
              entry.kind === 'user' ? '你 › ' : entry.kind === 'notice' ? '· ' : 'Agent › '
            timeline.push(...wrapText(label + entry.text, width))
          }
        }
        this.cachedEntries = this.state.entries
        this.cachedSignature = signature
        this.cachedTimeline = timeline
      }
      this.scroll = Math.min(this.scroll, Math.max(0, timeline.length - bodyHeight))
      if (this.revealSelected) {
        const selectedLine = timeline.findIndex(line => line.startsWith('┌ ◆'))
        if (selectedLine >= 0)
          this.scroll = Math.max(0, timeline.length - bodyHeight - selectedLine)
        this.revealSelected = false
      }
      const end = Math.max(bodyHeight, timeline.length - this.scroll)
      lines.push(...timeline.slice(Math.max(0, end - bodyHeight), end))
      while (lines.length < 2 + bodyHeight) lines.push('')
      lines.push(
        clipText(
          `─ ${this.busy ? '运行中 · 可编辑草稿' : '输入'} ${this.scroll ? `· 向上 ${this.scroll} 行 · Ctrl-End 回到底部 ` : ''}`.padEnd(
            width,
            '─'
          ),
          width
        )
      )
      const matches =
        this.buffer.startsWith('/') && !this.buffer.includes(' ')
          ? COMMANDS.filter(command => command.startsWith(this.buffer))
          : []
      lines.push(
        clipText(
          matches.length
            ? `Tab 补全: ${matches.join('  ')}`
            : this.busy
              ? width < 60
                ? 'Ctrl-C 取消 · 草稿保留 · /help'
                : 'Ctrl-C 取消本轮 · Ctrl-O 工具详情 · /help 快捷键'
              : width < 60
                ? 'Enter 发送 · /help'
                : 'Enter 发送 · Ctrl-O 工具详情 · PgUp/PgDn 查看 · /help',
          width
        )
      )
      cursorRow = lines.length + composer.row + 1
      lines.push(...composer.lines)
    }
    // Very short windows still expose the active focus; no row extends outside the viewport.
    const visible = lines.length > rows ? lines.slice(-rows) : lines
    const frame = visible
      .map((line, index) => {
        const style =
          index === 0
            ? this.approval
              ? '\x1b[1;33m'
              : '\x1b[1;36m'
            : index === 1
              ? '\x1b[2m'
              : line.startsWith('你 ›')
                ? '\x1b[32m'
                : line.startsWith('Agent ›')
                  ? '\x1b[36m'
                  : line.startsWith('┌')
                    ? line.includes('· 完成')
                      ? '\x1b[1;32m'
                      : line.includes('· 失败') || line.includes('· 已拒绝')
                        ? '\x1b[1;31m'
                        : line.includes('· 待审批') || line.includes('· 已取消')
                          ? '\x1b[1;33m'
                          : '\x1b[1;36m'
                    : line.startsWith('· ') || line.startsWith('│')
                      ? '\x1b[2m'
                      : ''
        return `\x1b[2K${style}${clipText(line, width)}\x1b[0m`
      })
      .join('\r\n')
    const cursor = !this.approval
      ? `\x1b[${Math.max(1, cursorRow - Math.max(0, lines.length - rows))};${composer.column}H\x1b[?25h`
      : '\x1b[?25l'
    process.stdout.write(`\x1b[?25l\x1b[H${frame}\x1b[J${cursor}`)
  }
}
