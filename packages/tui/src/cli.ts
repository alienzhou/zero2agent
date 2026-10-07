#!/usr/bin/env node
/**
 * zero2agent CLI 入口
 */
import { Agent, buildSystemPrompt, terminalTool } from '@zero2agent/core'
import type { LoopEventHandlers } from '@zero2agent/core'
import * as readline from 'node:readline'
import path from 'node:path'
import { cleanupBackgroundOnExit, setupTerminalRuntime } from './setup-terminal-runtime.js'

import { createApprovalHandler, permissionOptionsFromEnv } from './approval.js'
import { RuntimeTui } from './runtime-tui.js'

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

let hasStreamedText = false

function resetStreamState() {
  hasStreamedText = false
}

const events: LoopEventHandlers = {
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

async function main() {
  if (process.argv[2] === '--terminal') {
    setupTerminalRuntime()
    const command = process.argv.slice(3).join(' ') || 'exec /bin/bash --noprofile --norc -i'
    const result = await terminalTool.execute(
      { command, interactive: true },
      { cwd: process.cwd() }
    )
    process.stdout.write(result + '\n')
    const code = result.match(/^Exit code: (\d+)$/m)
    const signal = result.match(/^Signal: (\d+)$/m)
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
    return
  }
  loadLocalEnv()

  const args = process.argv.slice(2)
  const plain = args[0] === '--plain'
  if (plain) args.shift()
  const messageArg = args[0]
  const tui = !messageArg && !plain && process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== 'dumb'
    ? new RuntimeTui()
    : undefined

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('错误: 请设置 ANTHROPIC_API_KEY 环境变量')
    process.exit(1)
  }

  setupTerminalRuntime()

  const approvalReadline: { current?: readline.Interface } = {}
  const agent = new Agent({
    permissions: permissionOptionsFromEnv(tui?.requestApproval ?? createApprovalHandler(() => approvalReadline.current)),
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

  if (tui) {
    await tui.run(agent)
    return
  }

  if (messageArg) {
    try {
      resetStreamState()
      await agent.run(messageArg)
      console.log()
    } catch (error) {
      console.error('\n执行出错:', (error as Error).message)
      process.exitCode = 1
    } finally {
      agent.cancelCompaction()
    }
    return
  }

  // 交互模式
  console.log('zero2agent - Agent Harness（文件读写演示）')
  console.log(
    '输入你的问题；/new 新建对话；/compact 压缩上下文；/terminal [bash命令] 交给人操作；exit 退出\n'
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
      .finally(() => {
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
        if (trimmed === '/new') {
          agent.reset()
          process.stdout.write('已开始新对话。仅清空对话历史；文件、日志与后台进程保持不变。\n')
        } else if (trimmed === '/compact') {
          const changed = await agent.compact()
          process.stdout.write(
            changed ? '已压缩工作上下文，完整会话记录保留。\n' : '当前没有可压缩的历史。\n'
          )
        } else if (trimmed === '/terminal' || trimmed.startsWith('/terminal ')) {
          const command =
            trimmed.slice('/terminal'.length).trim() || 'exec /bin/bash --noprofile --norc -i'
          process.stdout.write(
            (await terminalTool.execute({ command, interactive: true }, { cwd: process.cwd() })) +
              '\n'
          )
        } else {
          await agent.run(trimmed)
        }
        console.log('\n')
      } catch (error) {
        console.error('\n错误:', (error as Error).message, '\n')
      }

      prompt()
    })
  }

  prompt()
}

main().catch(error => {
  console.error('启动失败:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
