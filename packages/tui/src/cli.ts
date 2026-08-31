#!/usr/bin/env node
/**
 * zero2agent CLI 入口
 */
import {
  Agent,
  buildSystemPrompt,
  getTerminalRuntimeHooks,
  listBackgroundProcesses,
  setTerminalRuntimeHooks,
} from '@zero2agent/core'
import type { LoopEventHandlers } from '@zero2agent/core'
import * as readline from 'node:readline'
import path from 'node:path'

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
    return statusLine ?? exitLine ?? firstLine
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
}

// ── terminal 运行时（按键接管 / 运行中提示） ────────

function setupTerminalRuntime(rl?: readline.Interface): void {
  const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true

  setTerminalRuntimeHooks({
    isTTY,
    onStatus: line => {
      process.stdout.write(`${DIM}${line}${RESET}\n`)
    },
    attachInterrupts: controller => {
      if (!isTTY) return () => {}

      readline.emitKeypressEvents(process.stdin)
      const wasRaw = process.stdin.isRaw
      if (process.stdin.isTTY) process.stdin.setRawMode(true)
      rl?.pause()

      const onKeypress = (_str: string, key: readline.Key) => {
        if (!key) return
        if (key.ctrl && key.name === 'x') controller.signalCancel()
        if (key.ctrl && key.name === 's') controller.signalSkip()
      }
      process.stdin.on('keypress', onKeypress)

      return () => {
        process.stdin.removeListener('keypress', onKeypress)
        if (process.stdin.isTTY) process.stdin.setRawMode(wasRaw ?? false)
        rl?.resume()
      }
    },
    promptBackgroundCleanup: async entries => {
      if (!isTTY || entries.length === 0) return false
      console.log(`\n还有 ${entries.length} 个后台命令在运行：`)
      for (const e of entries) {
        const elapsed = Math.round((Date.now() - e.startAt) / 1000)
        console.log(`  [${e.pid}] ${e.command} （已运行 ${elapsed}s）`)
      }
      return new Promise(resolve => {
        const cleanupRl = readline.createInterface({ input: process.stdin, output: process.stdout })
        cleanupRl.question('要一并结束吗？(y/N) ', answer => {
          cleanupRl.close()
          resolve(answer.trim().toLowerCase() === 'y')
        })
      })
    },
  })
}

async function cleanupBackgroundOnExit(): Promise<void> {
  const entries = listBackgroundProcesses()
  if (entries.length === 0) return

  const runtime = getTerminalRuntimeHooks()
  const shouldKill = await runtime.promptBackgroundCleanup?.(entries)
  if (!shouldKill) return

  for (const entry of entries) {
    try {
      process.kill(-entry.pid, 'SIGTERM')
    } catch {
      try {
        process.kill(entry.pid, 'SIGTERM')
      } catch {
        // ignore
      }
    }
  }
}

async function main() {
  loadLocalEnv()

  const messageArg = process.argv[2]

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('错误: 请设置 ANTHROPIC_API_KEY 环境变量')
    process.exit(1)
  }

  setupTerminalRuntime()

  const agent = new Agent({
    systemPrompt: buildSystemPrompt(),
    events,
    cwd: process.cwd(),
  })

  if (messageArg) {
    try {
      resetStreamState()
      await agent.run(messageArg)
      console.log()
    } catch (error) {
      console.error('\n执行出错:', (error as Error).message)
      process.exit(1)
    }
    return
  }

  // 交互模式
  console.log('zero2agent - Agent Harness（文件读写演示）')
  console.log('输入你的问题，输入 exit 退出\n')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  setupTerminalRuntime(rl)

  // stdin 结束（EOF / 管道输入耗尽）后不能再 question，否则抛 ERR_USE_AFTER_CLOSE
  let closed = false
  rl.on('close', () => {
    closed = true
    void cleanupBackgroundOnExit()
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
        await agent.run(trimmed)
        console.log('\n')
      } catch (error) {
        console.error('\n错误:', (error as Error).message, '\n')
      }

      prompt()
    })
  }

  prompt()
}

main()
