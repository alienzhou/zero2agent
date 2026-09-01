import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const HARNESS = fileURLToPath(new URL('./terminal-pty-harness.mjs', import.meta.url))
const RUNNER = fileURLToPath(new URL('./terminal-pty-runner.py', import.meta.url))

export const CTRL_X = '\x18'
export const CTRL_S = '\x13'

export interface PtyKeypress {
  delayMs: number
  data: string
}

export interface PtyRunOptions {
  cwd: string
  command: string
  keys?: PtyKeypress[]
  timeoutMs?: number
}

export interface PtyRunResult {
  result: string
  statusLines: Array<{ at: number; line: string }>
  exitCode: number
}

function keyToBytes(data: string): number[] {
  return [...data].map(ch => ch.charCodeAt(0))
}

export async function runTerminalInPty(opts: PtyRunOptions): Promise<PtyRunResult> {
  const resultPath = path.join(opts.cwd, 'pty-result.txt')
  const statusPath = path.join(opts.cwd, 'pty-status.jsonl')
  const readyPath = path.join(opts.cwd, 'pty-ready.pid')
  const config = JSON.stringify({
    cwd: opts.cwd,
    command: opts.command,
    resultPath,
    statusLogPath: statusPath,
    readyPath,
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

  const result = await waitForFile(resultPath, 5000)
  const statusRaw = await fs.readFile(statusPath, 'utf8').catch(() => '')
  const statusLines = statusRaw
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as { at: number; line: string })

  if (result.startsWith('HARNESS_ERROR:')) {
    throw new Error(`${result}\n${stderr}`)
  }

  return { result, statusLines, exitCode }
}

export async function waitForReady(readyPath: string, timeoutMs = 5000): Promise<void> {
  await waitForFile(readyPath, timeoutMs)
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      return await fs.readFile(filePath, 'utf8')
    } catch {
      await new Promise(r => setTimeout(r, 50))
    }
  }
  throw new Error(`file not found: ${filePath}`)
}
