#!/usr/bin/env node
/**
 * zero2agent CLI 入口
 */
import { Agent, buildSystemPrompt, terminalTool, validateRunLimits } from '@zero2agent/core'
import type { LoopEventHandlers } from '@zero2agent/core'
import * as readline from 'node:readline'
import path from 'node:path'
import { cleanupBackgroundOnExit, setupTerminalRuntime } from './setup-terminal-runtime.js'

import { createApprovalHandler, permissionOptionsFromEnv } from './approval.js'
import { RuntimeTui } from './runtime-tui.js'
import { Conversations } from './conversations.js'
import { SessionStore, type SessionItem } from './session-store.js'
import { LogStore, RunJournal, formatLog } from './run-log.js'
import { CheckpointStore, CHECKPOINT_SCOPE } from './checkpoint-store.js'
import {
  formatCheckpoints,
  formatCheckpointDiff,
  formatCheckpointUsage,
} from './checkpoint-view.js'
import { safeText } from './display-text.js'
import { RUN_LIMIT_FLAGS, limitValue, runLimitsFromEnv } from './run-options.js'
import { requestNoticeLabel } from './runtime-state.js'

// ── 环境变量 ───────────────────────────────────────

/**
 * 加载仓库根目录的 .env.local（若存在）
 * 用 Node 22 内置的 loadEnvFile，避免为此引入 dotenv 依赖
 */
function loadLocalEnv() {
  // E2E 契约层需要可控环境，跳过自动加载本地密钥
  if (process.env.ZERO2AGENT_SKIP_LOCAL_ENV === '1') return
  const envPath = path.resolve(import.meta.dirname, '../../..', '.env.local')
  try {
    process.loadEnvFile(envPath)
  } catch {
    // 文件不存在时忽略，仍可通过 export 配置
  }
}

// ── ANSI 样式 ──────────────────────────────────────

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'

// ── 工具输出摘要 ──────────────────────────────────

function summarizeToolOutput(toolName: string, output: string): string {
  if (output.startsWith('Error:') || output.startsWith('No ')) {
    return output.split('\n')[0]
  }

  const firstLine = output.split('\n')[0]

  if (toolName === 'find_files' && firstLine.startsWith('Found ')) {
    return firstLine
  }
  if (toolName === 'grep_search' && firstLine.startsWith('Found ')) {
    return firstLine
  }
  if (toolName === 'read_file') {
    return `Read ${output.split('\n').length} lines`
  }
  if (toolName === 'list_directory') {
    return `Listed ${output.split('\n').filter(l => l.trim()).length} entries`
  }
  if (toolName === 'write_file' || toolName === 'delete' || toolName === 'replace_in_file') {
    return firstLine
  }
  if (toolName === 'terminal') {
    const statusLine = output.split('\n').find(l => l.startsWith('Status:'))
    const exitLine = output.split('\n').find(l => l.startsWith('Exit code:'))
    const signalLine = output.split('\n').find(l => l.startsWith('Signal:'))
    return [statusLine, exitLine, signalLine].filter(Boolean).join(' · ') || firstLine
  }
  return `${output.length} chars`
}

function formatToolInput(input: Record<string, unknown>): string {
  return Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => (typeof v === 'string' ? `${k}: "${v}"` : `${k}: ${v}`))
    .join(', ')
}

// ── 事件处理 ───────────────────────────────────────

let activeJournal: RunJournal | undefined
let hasStreamedText = false

function resetStreamState() {
  hasStreamedText = false
}

const events: LoopEventHandlers = {
  onRequestNotice: notice => {
    process.stdout.write(`\n${DIM}${requestNoticeLabel(notice)}${RESET}\n`)
    hasStreamedText = false
  },
  onText: text => {
    if (!hasStreamedText) {
      process.stdout.write('\n')
      hasStreamedText = true
    }
    process.stdout.write(text)
  },
  onToolStart: (name, input) => {
    if (hasStreamedText) {
      process.stdout.write('\n')
      hasStreamedText = false
    }
    const params = formatToolInput(input)
    process.stdout.write(`${DIM}  ⚡ ${name}(${params})${RESET}\n`)
  },
  onToolEnd: (name, output, durationMs) => {
    const summary = summarizeToolOutput(name, output)
    process.stdout.write(`${DIM}  ${GREEN}✓${RESET}${DIM} ${summary} (${durationMs}ms)${RESET}\n`)
  },
  onToolError: (_name, error) => {
    process.stdout.write(`${DIM}  ${RED}✗${RESET}${DIM} ${error}${RESET}\n`)
  },
  onCompaction: event => {
    const labels = {
      pruned: '已缩短工具正文，完整结果保留为可回读文件。',
      background: '正在后台压缩历史，对话继续。',
      waiting: '上下文接近预算，正在等待后台压缩。',
      foreground: '正在压缩上下文，完成后继续。',
      completed: '上下文压缩完成。',
      failed: '压缩未完成，原始记录已保留；发送前仍会检查预算。',
    }
    process.stdout.write(`\n${DIM}${labels[event.phase]}${RESET}\n`)
  },
}

function printSessions(items: SessionItem[]): void {
  if (!items.length) {
    console.log('当前工作目录没有已保存会话。')
    return
  }
  for (const item of items)
    console.log(
      safeText(
        `${item.id}  ${item.updatedAt}  ${item.title}${item.error ? ` [无法恢复: ${item.error}]` : item.pending ? ' [上次运行未结算]' : ''}`
      )
    )
}

async function main() {
  if (process.argv[2] === '--terminal') {
    setupTerminalRuntime()
    const logs = await LogStore.open(process.cwd(), {
      onFailure: () => console.error('日志记录不可用；任务继续。'),
    })
    const journal = process.env.ZERO2AGENT_NO_LOG === '1' ? undefined : await logs.start()
    activeJournal = journal
    journal?.host('terminal-start')
    const command = process.argv.slice(3).join(' ') || 'exec /bin/bash --noprofile --norc -i'
    let observed = false
    const result = await terminalTool.execute(
      { command, interactive: true },
      {
        cwd: process.cwd(),
        onResultMetadata: metadata => {
          observed = true
          journal?.host(
            metadata.terminalOutcome === 'cancelled' || metadata.terminalOutcome === 'declined'
              ? 'terminal-cancelled'
              : 'terminal-completed',
            metadata
          )
        },
      }
    )
    process.stdout.write(result + '\n')
    const code = result.match(/^Exit code: (\d+)$/m)
    const signal = result.match(/^Signal: (\d+)$/m)
    if (!observed) journal?.host('terminal-error')
    process.exitCode =
      result.startsWith('Error:') || result.includes('human-controlled declined')
        ? 1
        : signal
          ? 128 + Number(signal[1])
          : result.includes('human-controlled cancelled')
            ? 130
            : code
              ? Number(code[1])
              : 0
    await journal?.close(Number(process.exitCode ?? 0))
    return
  }
  loadLocalEnv()

  const args = process.argv.slice(2)
  let limits = runLimitsFromEnv()
  let noCheckpoints = process.env.ZERO2AGENT_NO_CHECKPOINTS === '1'
  let checkpointAction: 'list' | 'diff' | 'undo' | 'recover' | 'stats' | 'prune' | undefined
  let checkpointId: string | undefined
  let confirmCheckpoint: string | undefined
  let noLog = process.env.ZERO2AGENT_NO_LOG === '1'
  let listLogs = false
  let readLog: string | undefined
  let logOperation: string | undefined
  let plain = false
  let noSave = process.env.ZERO2AGENT_NO_SAVE === '1'
  let list = false
  let resume: string | undefined
  let latest = false
  while (args[0]?.startsWith('--')) {
    const flag = args.shift()
    if (flag === '--') break
    if (flag && Object.hasOwn(RUN_LIMIT_FLAGS, flag)) {
      const key = RUN_LIMIT_FLAGS[flag as keyof typeof RUN_LIMIT_FLAGS]
      limits = validateRunLimits({ ...limits, [key]: limitValue(flag, args.shift()) })
    } else if (flag === '--no-checkpoints') noCheckpoints = true
    else if (flag === '--confirm') {
      confirmCheckpoint = args.shift()
      if (!confirmCheckpoint || !/^[0-9a-f]{64}$/.test(confirmCheckpoint))
        throw new Error('--confirm requires the preview token')
    } else if (
      [
        '--checkpoints',
        '--checkpoint',
        '--undo',
        '--recover',
        '--checkpoint-stats',
        '--checkpoint-prune',
      ].includes(flag!)
    ) {
      if (checkpointAction) throw new Error('Use one checkpoint action at a time')
      checkpointAction =
        flag === '--checkpoints'
          ? 'list'
          : flag === '--checkpoint'
            ? 'diff'
            : flag === '--undo'
              ? 'undo'
              : flag === '--recover'
                ? 'recover'
                : flag === '--checkpoint-stats'
                  ? 'stats'
                  : 'prune'
      if (['diff', 'undo', 'recover'].includes(checkpointAction)) {
        checkpointId = args.shift()
        if (!checkpointId || checkpointId.startsWith('--'))
          throw new Error(`${flag} requires a UUID`)
      }
    } else if (flag === '--plain') plain = true
    else if (flag === '--no-log') noLog = true
    else if (flag === '--logs') listLogs = true
    else if (flag === '--log' || flag === '--log-operation') {
      const value = args.shift()
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a UUID.`)
      if (flag === '--log') readLog = value
      else logOperation = value
    } else if (flag === '--no-save') noSave = true
    else if (flag === '--list-sessions') list = true
    else if (flag === '--continue') latest = true
    else if (flag === '--resume') {
      resume = args.shift()
      if (!resume || resume.startsWith('--')) throw new Error('--resume requires a session UUID.')
    } else throw new Error(`Unknown option: ${flag}`)
  }
  if ((noSave && (list || resume || latest)) || (resume && latest))
    throw new Error('--no-save cannot restore/list sessions; use either --resume or --continue.')
  if (confirmCheckpoint && !['undo', 'recover'].includes(checkpointAction ?? ''))
    throw new Error('--confirm requires --undo or --recover')
  const checkpoints = await CheckpointStore.open(process.cwd(), {
    onStatus: message => {
      if (tui) tui.checkpointNotice(message)
      else if (message.startsWith('文件保护失败')) console.error(safeText(message))
      else console.log(safeText(message))
    },
  })
  if (checkpointAction) {
    if (args.length || list || resume || latest || listLogs || readLog || logOperation)
      throw new Error('Checkpoint actions cannot run a task or another action')
    if (checkpointAction === 'list') console.log(formatCheckpoints(await checkpoints.list()))
    else if (checkpointAction === 'diff')
      console.log(await formatCheckpointDiff(checkpoints, checkpointId!))
    else if (checkpointAction === 'stats' || checkpointAction === 'prune')
      console.log(
        formatCheckpointUsage(
          checkpointAction === 'prune' ? await checkpoints.prune() : await checkpoints.usage()
        )
      )
    else {
      const recovery = checkpointAction === 'recover'
      if (confirmCheckpoint) {
        const record = await checkpoints.restore(checkpointId!, confirmCheckpoint, recovery)
        console.log(`已回退文件；撤销这次回退: --undo ${record.id}`)
      } else {
        const plan = await checkpoints.preview(checkpointId!, recovery)
        console.log(safeText(plan.text))
        console.log(`确认执行: --${checkpointAction} ${plan.id} --confirm ${plan.token}`)
      }
    }
    return
  }
  const logs = await LogStore.open(process.cwd(), {
    onFailure: () => {
      if (tui) tui.logFailure()
      else console.error('日志记录不可用；任务继续，使用 /log 查看状态。')
    },
  })
  if ((listLogs && readLog) || (logOperation && !readLog))
    throw new Error('Use --logs or --log UUID; --log-operation requires --log.')
  if (listLogs || readLog) {
    if (args.length || list || resume || latest)
      throw new Error('Log reading cannot run a task or restore a session.')
    if (listLogs) {
      const items = await logs.list()
      console.log(
        items.length
          ? items
              .map(
                item =>
                  `${item.id}  ${item.updatedAt}  ${item.title}${item.error ? ` [${item.error}]` : ''}`
              )
              .join('\n')
          : '当前工作目录没有运行日志。'
      )
    } else console.log(safeText(formatLog(await logs.read(readLog!, logOperation))))
    return
  }
  const messageArg = args[0]
  const store = noSave ? undefined : await SessionStore.open(process.cwd())
  if (list) {
    printSessions(await store!.list())
    return
  }
  const tui =
    !messageArg &&
    !plain &&
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    process.env.TERM !== 'dumb'
      ? new RuntimeTui()
      : undefined

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('错误: 请设置 ANTHROPIC_API_KEY 环境变量')
    process.exit(1)
  }

  setupTerminalRuntime()
  const journal = noLog ? undefined : await logs.start()
  activeJournal = journal

  const approvalReadline: { current?: readline.Interface } = {}
  const agent = new Agent({
    limits,
    fileMutations: noCheckpoints ? undefined : checkpoints.capture,
    diagnostics: journal ? event => journal.diagnostic(event) : undefined,
    permissions: permissionOptionsFromEnv(
      tui?.requestApproval ?? createApprovalHandler(() => approvalReadline.current)
    ),
    systemPrompt: buildSystemPrompt(),
    events: tui?.events ?? events,
    cwd: process.cwd(),
    context: {
      contextWindow: process.env.CONTEXT_WINDOW ? Number(process.env.CONTEXT_WINDOW) : undefined,
      maxInputTokens: process.env.MAX_INPUT_TOKENS
        ? Number(process.env.MAX_INPUT_TOKENS)
        : undefined,
      maxOutputTokens: process.env.MAX_OUTPUT_TOKENS
        ? Number(process.env.MAX_OUTPUT_TOKENS)
        : undefined,
      counting: process.env.CONTEXT_COUNTING === 'provider' ? 'provider' : 'conservative',
    },
  })

  const conversations = new Conversations(agent, store, logs, journal, checkpoints, !noCheckpoints)
  let resumed = ''
  if (resume) resumed = await conversations.resume(resume)
  else if (latest) resumed = await conversations.resumeLatest()

  if (tui) {
    try {
      await tui.run(agent, conversations, resumed)
    } finally {
      await conversations.closeLogs(Number(process.exitCode ?? 0))
    }
    return
  }

  if (messageArg) {
    if (resumed) console.error(resumed)
    try {
      resetStreamState()
      await conversations.run(messageArg)
      console.log()
    } catch (error) {
      console.error('\n执行出错:', (error as Error).message)
      process.exitCode = 1
    } finally {
      agent.cancelCompaction()
      await conversations.closeLogs(Number(process.exitCode ?? 0))
    }
    return
  }

  // 交互模式
  console.log('zero2agent - Agent Harness（文件读写演示）')
  console.log(safeText(conversations.status))
  console.log(safeText(conversations.logStatus))
  console.log(safeText(conversations.checkpointStatus))
  console.log(CHECKPOINT_SCOPE)
  if (resumed) console.log(resumed)
  console.log(
    '输入你的问题；/new 新建对话；/sessions 列表；/resume UUID 恢复；/session 当前；/save 重试保存；/compact 压缩上下文；/terminal [bash命令] 交给人操作；/logs 日志列表；/log 当前日志；/checkpoints 文件改动；/diff UUID；/undo UUID 回退预览；exit 退出\n'
  )

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  approvalReadline.current = rl
  setupTerminalRuntime(rl)

  // stdin 结束（EOF / 管道输入耗尽）后不能再 question，否则抛 ERR_USE_AFTER_CLOSE
  let closed = false
  rl.on('close', () => {
    closed = true
    agent.cancelCompaction()
    agent.cancelPendingApprovals()
    void cleanupBackgroundOnExit()
      .catch(error => {
        console.error('退出清理失败:', error instanceof Error ? error.message : String(error))
        process.exitCode = 1
      })
      .finally(async () => {
        await conversations.closeLogs(Number(process.exitCode ?? 0))
        // readline.close() only pauses a pipe; release it after cleanup so exit needs no EOF.
        // Keep TTY handling intact: background cleanup may need a final interactive answer.
        if (!process.stdin.isTTY) process.stdin.destroy()
      })
  })

  const prompt = () => {
    if (closed) return

    rl.question('你: ', async input => {
      const trimmed = input.trim()

      if (trimmed === 'exit' || trimmed === 'quit') {
        try {
          await conversations.save()
        } catch (error) {
          console.error(safeText(String(error)))
          prompt()
          return
        }
        console.log('再见！')
        rl.close()
        return
      }

      if (!trimmed) {
        prompt()
        return
      }

      try {
        resetStreamState()
        if (trimmed === '/checkpoints') {
          console.log(formatCheckpoints(await conversations.listCheckpoints()))
        } else if (trimmed.startsWith('/diff ')) {
          console.log(await conversations.checkpointDiff(trimmed.slice(6).trim()))
        } else if (trimmed === '/checkpoint-stats' || trimmed === '/checkpoint-prune') {
          console.log(await conversations.checkpointUsage(trimmed === '/checkpoint-prune'))
        } else if (/^\/(undo|recover)(?:\s|$)/.test(trimmed)) {
          const [command, id, token, ...extra] = trimmed.split(/\s+/)
          if (extra.length) throw new Error('Use /undo UUID [token] or /recover UUID [token]')
          const recovery = command === '/recover'
          if (token) console.log(await conversations.undo(id, token, recovery))
          else {
            const plan = await conversations.previewUndo(id, recovery)
            console.log(safeText(plan.text))
            console.log(`确认执行: ${command} ${plan.id} ${plan.token}`)
          }
        } else if (trimmed === '/new') {
          await conversations.newSession()
          process.stdout.write('已开始新对话。仅清空对话历史；文件、日志与后台进程保持不变。\n')
        } else if (trimmed === '/sessions') {
          printSessions(await conversations.list())
        } else if (trimmed.startsWith('/resume ')) {
          console.log(await conversations.resume(trimmed.slice(8).trim()))
          console.log(safeText(conversations.status))
        } else if (trimmed === '/resume') {
          printSessions(await conversations.list())
          console.log('使用 /resume UUID 恢复所选会话。')
        } else if (trimmed === '/session') {
          console.log(safeText(conversations.status))
        } else if (trimmed === '/save') {
          await conversations.save()
          console.log(safeText(conversations.status))
        } else if (trimmed === '/logs') {
          const items = await conversations.listLogs()
          console.log(
            items.length
              ? items
                  .map(item => `${item.id} ${item.title}${item.error ? ` [${item.error}]` : ''}`)
                  .join('\n')
              : '当前工作目录没有运行日志。'
          )
        } else if (trimmed === '/log' || trimmed.startsWith('/log ')) {
          const [, id, operationId] = trimmed.split(/\s+/)
          console.log(safeText(await conversations.readLog(id, operationId)))
        } else if (trimmed === '/compact') {
          const changed = await conversations.compact()
          process.stdout.write(
            changed ? '已压缩工作上下文，完整会话记录保留。\n' : '当前没有可压缩的历史。\n'
          )
        } else if (trimmed === '/terminal' || trimmed.startsWith('/terminal ')) {
          const command =
            trimmed.slice('/terminal'.length).trim() || 'exec /bin/bash --noprofile --norc -i'
          process.stdout.write((await conversations.terminal(command)) + '\n')
        } else {
          await conversations.run(trimmed)
        }
        console.log('\n')
      } catch (error) {
        console.error('\n错误:', safeText((error as Error).message), '\n')
      }

      prompt()
    })
  }

  prompt()
}

main().catch(async error => {
  console.error('启动失败:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
  await activeJournal?.close(1)
})
