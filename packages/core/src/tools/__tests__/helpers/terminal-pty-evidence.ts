import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const HARNESS = fileURLToPath(new URL('./terminal-pty-harness.mjs', import.meta.url))
const RUNNER = fileURLToPath(new URL('./terminal-pty-runner.py', import.meta.url))
const TUI_SETUP = fileURLToPath(
  new URL('../../../../../tui/dist/setup-terminal-runtime.js', import.meta.url)
)

export const CTRL_X = '\x18'
export const CTRL_S = '\x13'
export const CTRL_C = '\x03'

export interface PtyKeypress {
  delayMs: number
  data: string
}

export interface PtyRunOptions {
  cwd: string
  command: string
  keys?: PtyKeypress[]
  timeoutMs?: number
  /** Ctrl-C 等信号退出时不强制要求 result 文件 */
  expectSignalExit?: boolean
}

export interface PtyStatusLine {
  at: number
  sinceStartMs: number
  line: string
}

export interface PtyRunResult {
  result: string | null
  statusLines: PtyStatusLine[]
  exitCode: number
  rlTrace: string[]
}

function keyToBytes(data: string): number[] {
  return [...data].map(ch => ch.charCodeAt(0))
}

export async function ensureTuiBuiltForPty(): Promise<void> {
  try {
    await fs.access(TUI_SETUP)
  } catch {
    const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('pnpm', ['--filter', '@zero2agent/tui', 'build'], {
        cwd: repoRoot,
        stdio: 'inherit',
      })
      proc.on('exit', code =>
        code === 0 ? resolve() : reject(new Error(`tui build failed: ${code}`))
      )
      proc.on('error', reject)
    })
  }
}

export async function runTerminalInPty(opts: PtyRunOptions): Promise<PtyRunResult> {
  await ensureTuiBuiltForPty()

  const resultPath = path.join(opts.cwd, 'pty-result.txt')
  const statusPath = path.join(opts.cwd, 'pty-status.jsonl')
  const readyPath = path.join(opts.cwd, 'pty-ready.pid')
  const commandStartPath = path.join(opts.cwd, 'pty-command-start.txt')
  const rlTracePath = path.join(opts.cwd, 'pty-rl-trace.json')
  const config = JSON.stringify({
    cwd: opts.cwd,
    command: opts.command,
    resultPath,
    statusLogPath: statusPath,
    readyPath,
    commandStartPath,
    rlTracePath,
  })
  const keysJson = JSON.stringify(
    (opts.keys ?? []).map(k => ({ delayMs: k.delayMs, bytes: keyToBytes(k.data) }))
  )

  const proc = spawn('python3', [RUNNER, HARNESS, config, keysJson], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`PTY harness timed out after ${opts.timeoutMs ?? 60_000}ms\n${stderr}`))
    }, opts.timeoutMs ?? 60_000)
    proc.on('exit', code => {
      clearTimeout(timer)
      resolve(code ?? 1)
    })
    proc.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
  })

  const result = await readOptionalFile(resultPath, opts.expectSignalExit ? 500 : 5000)
  const statusRaw = await fs.readFile(statusPath, 'utf8').catch(() => '')
  const statusLines = statusRaw
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as PtyStatusLine)

  if (result?.startsWith('HARNESS_ERROR:')) {
    throw new Error(`${result}\n${stderr}`)
  }

  const rlTraceRaw = await fs.readFile(rlTracePath, 'utf8').catch(() => '[]')
  const rlTrace = JSON.parse(rlTraceRaw) as string[]

  return { result, statusLines, exitCode, rlTrace }
}

export async function waitForReady(readyPath: string, timeoutMs = 5000): Promise<void> {
  await waitForFile(readyPath, timeoutMs)
}

async function readOptionalFile(filePath: string, timeoutMs: number): Promise<string | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      return await fs.readFile(filePath, 'utf8')
    } catch {
      await new Promise(r => setTimeout(r, 50))
    }
  }
  return null
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<string> {
  const content = await readOptionalFile(filePath, timeoutMs)
  if (content === null) {
    throw new Error(`file not found: ${filePath}`)
  }
  return content
}
