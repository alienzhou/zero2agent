#!/usr/bin/env node
/**
 * zero2agent CLI 入口
 */
import { Agent, buildSystemPrompt } from '@zero2agent/core'
import type { LoopEventHandlers } from '@zero2agent/core'
import * as readline from 'node:readline'
import path from 'node:path'

// ── 环境变量 ───────────────────────────────────────

/**
 * 加载仓库根目录的 .env.local（若存在）
 * 用 Node 22 内置的 loadEnvFile，避免为此引入 dotenv 依赖
 */
function loadLocalEnv() {
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

// ── 主流程 ─────────────────────────────────────────

async function main() {
  loadLocalEnv()

  const messageArg = process.argv[2]

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('错误: 请设置 ANTHROPIC_API_KEY 环境变量')
    process.exit(1)
  }

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

  // stdin 结束（EOF / 管道输入耗尽）后不能再 question，否则抛 ERR_USE_AFTER_CLOSE
  let closed = false
  rl.on('close', () => {
    closed = true
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
