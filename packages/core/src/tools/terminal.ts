import { spawn, type ChildProcess } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  drainCompletionNotices,
  queueCompletionNotice,
  registerBackgroundProcess,
  unregisterBackgroundProcess,
} from './process-registry.js'
import { buildSpawnEnv, consumeShellEnvFailureNotice } from './shell-env.js'
import { getTerminalRuntimeHooks } from './terminal-runtime.js'
import type { Tool, ToolContext } from './types.js'

// ── 常量（定稿 spec / D01-D05） ─────────────────────

const MAX_OUTPUT_LINES = 800
const MAX_OUTPUT_BYTES = 20 * 1024
const SKIP_HINT_MS = 10_000
const WALL_TIME_THRESHOLD_MS = 3_000
const KILL_GRACE_MS = 500
const READ_DRAIN_TIMEOUT_MS = 2_000
const STATUS_TICK_MS = 1_000
const SHELL = '/bin/bash'

interface TerminalInput {
  command: string
  workdir?: string
}

export type TerminalOutcome = 'completed' | 'cancelled' | 'skipped' | 'drain-timeout'

interface RunResult {
  outcome: TerminalOutcome
  exitCode?: number
  signal?: string
  wallTimeMs: number
  sink: OutputSink
  pid: number
  command: string
  incompleteNote?: boolean
}

// ── workdir 解析（不复用 resolveInsideCwd） ─────────

export function resolveWorkdir(
  ctx: ToolContext,
  workdir?: string
): { path: string } | { error: string } {
  if (!workdir) return { path: ctx.cwd }

  const resolved = path.resolve(ctx.cwd, workdir)
  const rel = path.relative(ctx.cwd, resolved)

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { error: `Error: ${workdir} is outside the workspace, operation refused` }
  }

  return { path: resolved }
}

// ── watcher 包装（防线②） ───────────────────────────

export function wrapCommand(userCommand: string): string {
  const agentPid = process.pid
  return `( while kill -0 ${agentPid} 2>/dev/null; do sleep 1; done; kill -- -$$ 2>/dev/null ) >/dev/null 2>&1 &
_w=$!
${userCommand}
__code=$?
kill $_w 2>/dev/null
exit $__code`
}

export function sanitizeCommandInOutput(output: string, userCommand: string): string {
  const wrapped = wrapCommand(userCommand)
  let text = output.replaceAll(wrapped, userCommand)
  // wrapper 导致行号 +1
  text = text.replace(/bash: line 2:/g, 'bash: line 1:')
  return text
}

// ── OutputSink 状态机 ───────────────────────────────

export class OutputSink {
  private bufs: Buffer[] = []
  private memoryBytes = 0
  lineCount = 0
  totalLineCount = 0
  totalBytes = 0
  logPath: string | null = null
  private writeStream: fs.WriteStream | null = null
  spilled = false

  private countChunk(chunk: Buffer): void {
    this.totalBytes += chunk.length
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 0x0a) {
        this.lineCount++
        this.totalLineCount++
      }
    }
  }

  private openLogFile(): void {
    if (this.writeStream) return
    const hex = crypto.randomBytes(4).toString('hex')
    this.logPath = path.join(os.tmpdir(), `zero2agent-${hex}.log`)
    this.writeStream = fs.createWriteStream(this.logPath)
  }

  private flushBuffersToDisk(): void {
    if (!this.writeStream) return
    for (const buf of this.bufs) {
      this.writeStream.write(buf)
    }
  }

  enterSpillMode(): void {
    if (!this.writeStream) {
      this.openLogFile()
      this.flushBuffersToDisk()
    }
    this.spilled = true
    this.bufs = []
    this.memoryBytes = 0
  }

  /** 10 秒触发：落盘但保留内存 */
  flushForTime(): void {
    if (!this.writeStream) {
      this.openLogFile()
      this.flushBuffersToDisk()
    }
  }

  append(chunk: Buffer): void {
    this.countChunk(chunk)

    if (this.writeStream) {
      this.writeStream.write(chunk)
    }

    if (this.spilled) return

    this.bufs.push(chunk)
    this.memoryBytes += chunk.length

    if (this.lineCount > MAX_OUTPUT_LINES || this.memoryBytes > MAX_OUTPUT_BYTES) {
      this.enterSpillMode()
    }
  }

  getBodyText(): string {
    return Buffer.concat(this.bufs).toString('utf-8')
  }

  async closeStream(): Promise<void> {
    if (!this.writeStream) return
    await new Promise<void>((resolve, reject) => {
      this.writeStream!.end(() => resolve())
      this.writeStream!.on('error', reject)
    })
  }

  formatSize(): string {
    const kb = Math.ceil(this.totalBytes / 1024)
    return `${this.totalLineCount} lines / ${kb} KB`
  }
}

// ── 进程组清理 ─────────────────────────────────────

async function killProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (!pid) return

  if (process.platform === 'win32') {
    spawn('taskkill', ['/F', '/T', '/PID', String(pid)])
    return
  }

  const send = (sig: NodeJS.Signals, target: number) => {
    try {
      process.kill(target, sig)
    } catch {
      // ignore
    }
  }

  send('SIGTERM', -pid)
  send('SIGTERM', pid)
  await sleep(KILL_GRACE_MS)
  send('SIGKILL', -pid)
  send('SIGKILL', pid)
  await sleep(100)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── 核心执行 ───────────────────────────────────────

export async function runCommand(userCommand: string, cwd: string): Promise<RunResult> {
  const wrapped = wrapCommand(userCommand)
  const sink = new OutputSink()
  const startAt = Date.now()
  const runtime = getTerminalRuntimeHooks()

  let outcome: TerminalOutcome = 'completed'
  let exitCode: number | undefined
  let signal: string | undefined
  let incompleteNote = false
  let cancelled = false
  let skipped = false
  let spawnError: string | null = null

  const child = spawn(SHELL, ['-c', wrapped], {
    cwd,
    env: buildSpawnEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })

  const pid = child.pid ?? 0

  child.stdout?.on('data', (chunk: Buffer) => sink.append(chunk))
  child.stderr?.on('data', (chunk: Buffer) => sink.append(chunk))

  let skipAvailable = false

  const skipHintTimer = setTimeout(() => {
    skipAvailable = true
    if (!sink.spilled) sink.flushForTime()
    if (runtime.isTTY) {
      runtime.onStatus?.(
        `  运行中 ${Math.round((Date.now() - startAt) / 1000)}s   Ctrl-X 取消   Ctrl-S 跳过（转后台继续）`
      )
    }
  }, SKIP_HINT_MS)

  const statusTimer = setInterval(() => {
    if (!runtime.isTTY || skipped || cancelled) return
    const elapsed = Math.round((Date.now() - startAt) / 1000)
    if (elapsed < SKIP_HINT_MS / 1000) {
      runtime.onStatus?.(`  运行中 ${elapsed}s    Ctrl-X 取消`)
    }
  }, STATUS_TICK_MS)

  if (runtime.isTTY) {
    runtime.onStatus?.('  运行中 0s    Ctrl-X 取消')
  }

  const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    resolve => {
      child.on('close', (code, sig) => resolve({ code, signal: sig }))
    }
  )

  child.on('error', err => {
    spawnError = err.message
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      spawnError = 'ENOENT'
    }
  })

  await new Promise<void>(resolve => {
    let settled = false
    let drainTimer: NodeJS.Timeout | null = null

    const finish = () => {
      if (settled) return
      settled = true
      if (drainTimer) clearTimeout(drainTimer)
      resolve()
    }

    const interruptController = {
      signalCancel: () => {
        if (cancelled || skipped) return
        cancelled = true
        void killProcessTree(child).then(finish)
      },
      signalSkip: () => {
        if (!skipAvailable || cancelled || skipped) return
        skipped = true
        finish()
      },
    }

    const detachInterrupts = runtime.attachInterrupts?.(interruptController)

    child.on('exit', () => {
      // 防线③：进程已退出但管道未关闭（setsid 曾孙攥着 fd）
      drainTimer = setTimeout(() => {
        if (!settled) {
          incompleteNote = true
          outcome = 'drain-timeout'
          finish()
        }
      }, READ_DRAIN_TIMEOUT_MS)
    })

    child.on('close', () => {
      detachInterrupts?.()
      finish()
    })

    child.on('error', () => {
      detachInterrupts?.()
      finish()
    })
  })

  clearTimeout(skipHintTimer)
  clearInterval(statusTimer)

  if (spawnError === 'ENOENT') {
    throw new Error('bash not found')
  }
  if (spawnError) {
    throw new Error(spawnError)
  }

  if (skipped) {
    outcome = 'skipped'
    child.unref()
    child.on('close', () => {
      unregisterBackgroundProcess(pid)
      queueCompletionNotice(userCommand, pid)
    })
    registerBackgroundProcess({
      pid,
      command: userCommand,
      logPath: sink.logPath,
      startAt,
      skippedAt: Date.now(),
    })
  } else if (cancelled) {
    outcome = 'cancelled'
    const raced = await Promise.race([closePromise, sleep(READ_DRAIN_TIMEOUT_MS).then(() => null)])
    if (raced === null) {
      incompleteNote = true
      exitCode = 124
    } else {
      exitCode = raced.code ?? 124
      signal = raced.signal ?? undefined
    }
  } else {
    const closeResult = await closePromise
    exitCode = closeResult.code ?? 1
    signal = closeResult.signal ?? undefined
    if (incompleteNote) {
      outcome = 'drain-timeout'
    }
  }

  await sink.closeStream()

  return {
    outcome,
    exitCode,
    signal: signal ?? undefined,
    wallTimeMs: Date.now() - startAt,
    sink,
    pid,
    command: userCommand,
    incompleteNote,
  }
}

// ── 回执组装 ───────────────────────────────────────

function formatUntrustedBody(body: string, nonce: string): string {
  return `<untrusted_command_output id="${nonce}">\n${body}\n</untrusted_command_output>`
}

export function formatReceipt(
  result: RunResult,
  envFailureNotice: boolean,
  completionNotices: string[]
): string {
  const parts: string[] = []
  const { sink, outcome, wallTimeMs } = result
  const nonce = crypto.randomBytes(4).toString('hex')

  if (envFailureNotice) {
    parts.push('Note: could not load your shell profile; PATH may be incomplete.')
  }

  if (outcome === 'skipped') {
    const elapsed = Math.round(wallTimeMs / 1000)
    parts.push(`Status: skipped by user — still running in background (pid ${result.pid})`)
    parts.push(`Elapsed: ${elapsed} seconds (when skipped)`)
    parts.push(`Output so far: ${sink.formatSize()} (still growing)`)
    if (sink.logPath) {
      parts.push(`Saved to: ${sink.logPath}`)
      parts.push('')
      parts.push('Use read_file or grep_search on that path; it may still be being written.')
      parts.push(`To check whether it is still alive, run: kill -0 ${result.pid}`)
    }
    appendNotices(parts, completionNotices)
    return parts.join('\n')
  }

  if (outcome === 'cancelled') {
    parts.push(`Status: cancelled by user (after ${Math.round(wallTimeMs / 1000)}s)`)
    if (sink.spilled && sink.logPath) {
      parts.push(`Output before cancellation: ${sink.formatSize()}`)
      parts.push(`Saved to: ${sink.logPath}`)
    } else {
      parts.push('Output before cancellation:')
      const body = sanitizeCommandInOutput(sink.getBodyText(), result.command).trimEnd()
      if (body) {
        parts.push('')
        parts.push(formatUntrustedBody(body, nonce))
      } else {
        parts.push('')
        parts.push('(no output)')
      }
    }
    appendNotices(parts, completionNotices)
    return parts.join('\n')
  }

  if (outcome === 'drain-timeout' || result.incompleteNote) {
    parts.push(
      'Note: a descendant process may still be holding the output pipe. Output may be incomplete.'
    )
  }

  if (result.signal) {
    parts.push(`Signal: ${result.signal}`)
  }

  parts.push(`Exit code: ${result.exitCode ?? 1}`)

  if (wallTimeMs >= WALL_TIME_THRESHOLD_MS) {
    parts.push(`Wall time: ${Math.round(wallTimeMs / 1000)}s`)
  }

  if (sink.spilled) {
    parts.push(`Total: ${sink.formatSize()}`)
    if (sink.logPath) parts.push(`Saved to: ${sink.logPath}`)
  } else {
    const body = sanitizeCommandInOutput(sink.getBodyText(), result.command).trimEnd()
    parts.push('Output:')
    parts.push('')
    if (body) {
      parts.push(formatUntrustedBody(body, nonce))
    } else {
      parts.push('(no output)')
    }
    // 慢但短：有落盘文件也不在回执里提（D03-10）
  }

  appendNotices(parts, completionNotices)
  return parts.join('\n')
}

function appendNotices(parts: string[], notices: string[]): void {
  if (notices.length === 0) return
  parts.push('---')
  for (const notice of notices) {
    parts.push(notice)
  }
}

// ── 工具定义 ─────────────────────────────────────────

export const terminalTool: Tool = {
  name: 'terminal',
  description:
    'Execute a shell command via bash -c in the workspace. stdout and stderr are merged. ' +
    'Returns exit code and output wrapped in an untrusted isolation tag. ' +
    'Non-zero exit codes are normal output, not tool errors. ' +
    'This is a non-interactive environment: commands needing tty or user input will fail; use flags like -y or --no-input. ' +
    'Use workdir instead of cd — each call is a new process and cd does not persist. ' +
    'Very large output (>800 lines / 20KB) is saved to /tmp and omitted from the receipt; use read_file or grep_search to read the saved file.',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute (runs via bash -c)',
      },
      workdir: {
        type: 'string',
        description: 'Relative directory under the workspace to run in (use this instead of cd)',
      },
    },
    required: ['command'],
  },

  execute: async (input: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
    const { command, workdir } = input as unknown as TerminalInput

    if (!command || typeof command !== 'string' || command.trim() === '') {
      return 'Error: command must not be empty'
    }

    const workdirResult = resolveWorkdir(ctx, workdir)
    if ('error' in workdirResult) {
      return workdirResult.error
    }

    try {
      await fs.promises.access(workdirResult.path)
    } catch {
      return `Error: workdir not found: ${workdir ?? '.'}`
    }

    const completionNotices = drainCompletionNotices()
    const envFailureNotice = consumeShellEnvFailureNotice()

    let result: RunResult
    try {
      result = await runCommand(command, workdirResult.path)
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('ENOENT')) {
        return 'Error: bash not found; S003 assumes POSIX + bash'
      }
      return `Error: Failed to execute command: ${msg}`
    }

    return formatReceipt(result, envFailureNotice, completionNotices)
  },
}
