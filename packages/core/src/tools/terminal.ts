import { notifyObserver } from '../runtime.js'
import { spawn, type ChildProcess } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { realpath } from 'node:fs/promises'
import {
  drainCompletionNotices,
  queueCompletionNotice,
  registerBackgroundProcess,
  unregisterBackgroundProcess,
} from './process-registry.js'
import { buildSpawnEnv, consumeShellEnvFailureNotice } from './shell-env.js'
import { getTerminalRuntimeHooks } from './terminal-runtime.js'
import type { Tool, ToolContext, ToolExecutionMetadata } from './types.js'

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
  interactive?: boolean
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

export async function resolveWorkdir(
  ctx: ToolContext,
  workdir?: string
): Promise<{ path: string } | { error: string }> {
  let cwdReal: string
  try {
    cwdReal = await realpath(ctx.cwd)
  } catch {
    return { error: `Error: workspace path not found: ${ctx.cwd}` }
  }

  if (!workdir) return { path: cwdReal }

  const resolved = path.resolve(cwdReal, workdir)
  let targetReal: string
  try {
    targetReal = await realpath(resolved)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      // 目录尚不存在时用语义路径，但仍须落在工作区内
      targetReal = resolved
    } else {
      return { error: `Error: workdir not accessible: ${workdir}` }
    }
  }

  const rel = path.relative(cwdReal, targetReal)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { error: `Error: ${workdir} is outside the workspace, operation refused` }
  }

  return { path: targetReal }
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
  storageError?: string
  private closed = false
  private closePromise?: Promise<void>

  constructor(
    private options: {
      path?: string
      maxBytes?: number
      pause?: () => void
      resume?: () => void
    } = {}
  ) {}
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
    this.logPath = this.options.path ?? path.join(os.tmpdir(), `zero2agent-${hex}.log`)
    this.writeStream = fs.createWriteStream(this.logPath, { flags: 'wx', mode: 0o600 })
    this.writeStream.on('error', () => {
      this.storageError = 'RESULT_STORAGE_FAILED: terminal output could not be saved completely'
      this.options.resume?.()
    })
    this.writeStream.on('drain', () => this.options.resume?.())
  }

  private flushBuffersToDisk(): void {
    if (!this.writeStream) return
    for (const buf of this.bufs) {
      if (!this.writeStream.write(buf)) this.options.pause?.()
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
    if (this.closed) return
    this.countChunk(chunk)
    if (this.totalBytes > (this.options.maxBytes ?? Number.MAX_SAFE_INTEGER)) {
      this.storageError =
        'RESULT_CAPACITY: terminal output exceeded the storage limit; output is incomplete'
      this.spilled = true
      this.bufs = []
      this.memoryBytes = 0
    }
    if (this.storageError) return

    if (this.writeStream) {
      if (!this.writeStream.write(chunk)) this.options.pause?.()
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
    if (this.closePromise) return this.closePromise
    this.closed = true
    const stream = this.writeStream
    if (!stream || stream.destroyed) return
    this.closePromise = new Promise<void>(resolve => {
      stream.once('close', resolve)
      stream.end()
    })
    return this.closePromise
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

export async function runCommand(
  userCommand: string,
  cwd: string,
  turnSignal?: AbortSignal,
  onResultMetadata?: (metadata: ToolExecutionMetadata) => void,
  outputOptions?: { path: string; maxBytes: number; onBackgroundClosed?: () => Promise<void> }
): Promise<RunResult> {
  turnSignal?.throwIfAborted()
  const wrapped = wrapCommand(userCommand)
  const sink = new OutputSink({
    ...outputOptions,
    pause: () => {
      child.stdout?.pause()
      child.stderr?.pause()
    },
    resume: () => {
      child.stdout?.resume()
      child.stderr?.resume()
    },
  })
  const startAt = Date.now()
  const runtime = getTerminalRuntimeHooks()

  let outcome: TerminalOutcome = 'completed'
  let exitCode: number | undefined
  let signal: string | undefined
  let incompleteNote = false
  let cancelled = false
  let cancellationCleanup: Promise<void> | undefined
  let skipped = false
  let drainTimedOut = false
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
      turnSignal?.removeEventListener('abort', interruptController.signalCancel)
      detachOnce()
      resolve()
    }

    let detached = false
    let detachRaw: (() => void) | undefined = undefined

    function detachOnce(): void {
      if (detached) return
      detached = true
      detachRaw?.()
    }

    const interruptController = {
      signalCancel: () => {
        if (cancelled || skipped) return
        cancelled = true
        cancellationCleanup = killProcessTree(child)
        void cancellationCleanup.then(finish)
      },
      signalSkip: () => {
        if (!skipAvailable || cancelled || skipped) return
        skipped = true
        detachOnce()
        finish()
      },
    }

    detachRaw = runtime.attachInterrupts?.(interruptController)
    turnSignal?.addEventListener('abort', interruptController.signalCancel, { once: true })
    if (turnSignal?.aborted) interruptController.signalCancel()

    child.on('exit', (code, sig) => {
      exitCode = code ?? exitCode
      signal = sig ?? signal
      // 防线③：进程已退出但管道未关闭（setsid 曾孙攥着 fd）
      drainTimer = setTimeout(() => {
        if (!settled) {
          incompleteNote = true
          drainTimedOut = true
          outcome = 'drain-timeout'
          finish()
        }
      }, READ_DRAIN_TIMEOUT_MS)
    })

    child.on('close', () => {
      detachOnce()
      finish()
    })

    child.on('error', () => {
      detachOnce()
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
    child.on('close', (code, sig) => {
      notifyObserver(() =>
        onResultMetadata?.({
          terminalOutcome: 'background-completed',
          exitCode: code ?? 1,
          pid,
          signal: sig ?? undefined,
        })
      )
      unregisterBackgroundProcess(pid)
      queueCompletionNotice(userCommand, pid)
      void sink
        .closeStream()
        .then(() => outputOptions?.onBackgroundClosed?.())
        .catch(() => {
          // A retained reservation is conservative: later writes report capacity/busy instead of hiding lost output.
          queueCompletionNotice(
            'Output reservation cleanup failed; inspect the result directory before starting more output.',
            pid
          )
        })
    })
    registerBackgroundProcess({
      pid,
      command: userCommand,
      logPath: sink.logPath,
      startAt,
      skippedAt: Date.now(),
    })
  } else if (cancelled) {
    await cancellationCleanup
    outcome = 'cancelled'
    const raced = await Promise.race([closePromise, sleep(READ_DRAIN_TIMEOUT_MS).then(() => null)])
    if (raced === null) {
      incompleteNote = true
      exitCode = 124
    } else {
      exitCode = raced.code ?? 124
      signal = raced.signal ?? undefined
    }
    await sink.closeStream()
  } else if (drainTimedOut) {
    outcome = 'drain-timeout'
    // drain 超时后不再等待 close，避免被逃逸后代挂死
    await sink.closeStream()
  } else {
    const closeResult = await closePromise
    exitCode = closeResult.code ?? 1
    signal = closeResult.signal ?? undefined
    if (incompleteNote) {
      outcome = 'drain-timeout'
    }
    await sink.closeStream()
  }

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

function sanitizeUntrustedBody(body: string): string {
  // 防止命令输出伪造闭合边界（即使无 id 属性也会干扰解析）
  return body.replace(/<\/untrusted_command_output\b/gi, '<\\/untrusted_command_output')
}

function formatUntrustedBody(body: string, nonce: string): string {
  const safe = sanitizeUntrustedBody(body)
  return `<untrusted_command_output id="${nonce}">\n${safe}\n</untrusted_command_output>`
}

export function formatReceipt(
  result: RunResult,
  envFailureNotice: boolean,
  completionNotices: string[],
  resultReference?: string
): string {
  const parts: string[] = []
  const { sink, outcome, wallTimeMs } = result
  const nonce = crypto.randomBytes(4).toString('hex')

  if (envFailureNotice) {
    parts.push('Note: could not load your shell profile; PATH may be incomplete.')
  }

  if (sink.storageError) {
    return `Error: ${sink.storageError}. Command status: ${outcome}; exit code: ${result.exitCode ?? 'unknown'}. Side effects were not rolled back; do not re-run automatically.`
  }

  if (outcome === 'skipped') {
    const elapsed = Math.round(wallTimeMs / 1000)
    parts.push(`Status: skipped by user — still running in background (pid ${result.pid})`)
    parts.push(`Elapsed: ${elapsed} seconds (when skipped)`)
    parts.push(`Output so far: ${sink.formatSize()} (still growing)`)
    if (sink.logPath) {
      parts.push(`Saved to: ${sink.logPath}`)
      parts.push('')
      parts.push(
        'Unsealed output: still being written; no immutable result reference exists yet. Use read_file or grep_search on that path with current file permission.'
      )
      parts.push(`To check whether it is still alive, run: kill -0 ${result.pid}`)
    }
    appendNotices(parts, completionNotices)
    return parts.join('\n')
  }

  if (outcome === 'cancelled') {
    parts.push(`Status: cancelled by user (after ${Math.round(wallTimeMs / 1000)}s)`)
    if (sink.spilled && sink.logPath) {
      parts.push(`Output before cancellation: ${sink.formatSize()}`)
      parts.push(resultReference ?? `Saved to: ${sink.logPath}`)
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
    if (sink.logPath) parts.push(resultReference ?? `Saved to: ${sink.logPath}`)
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
  permission: { effect: 'execute', paths: [] },
  name: 'terminal',
  description:
    'Execute a shell command via bash -c in the workspace. stdout and stderr are merged. ' +
    'Returns exit code and output wrapped in an untrusted isolation tag. ' +
    'Non-zero exit codes are normal output, not tool errors. ' +
    'By default this is non-interactive: commands needing tty or user input will fail; use flags like -y or --no-input. ' +
    'Set interactive=true for human takeover, requiring an actual CLI TTY and user confirmation. ' +
    'Interactive mode is not for unattended execution; the human supplies input, and interactive content is not recorded or sent to the model. ' +
    'Never put credentials in command. Do not automatically retry a declined interactive request. ' +
    'Use workdir instead of cd — each call is a new process and cd does not persist. ' +
    'Hosts without result storage return a raw file path; use read_file or grep_search with current permission. ' +
    'Very large output (>800 lines / 20KB) is saved once and omitted from the receipt. Read a sealed result with read_tool_result using its reference and byte ranges. Background output is unsealed and still growing; raw-path reads require file permission.',
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
      interactive: {
        type: 'boolean',
        description:
          'Human-controlled terminal requiring a real TTY and user confirmation (default: false)',
      },
    },
    required: ['command'],
  },

  execute: async (input: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
    const { command, workdir, interactive } = input as unknown as TerminalInput

    if (interactive !== undefined && typeof interactive !== 'boolean') {
      return 'Error: interactive must be a boolean'
    }

    if (!command || typeof command !== 'string' || command.trim() === '') {
      return 'Error: command must not be empty'
    }

    const workdirResult = await resolveWorkdir(ctx, workdir)
    if ('error' in workdirResult) {
      return workdirResult.error
    }

    try {
      await fs.promises.access(workdirResult.path)
    } catch {
      return `Error: workdir not found: ${workdir ?? '.'}`
    }

    ctx.signal?.throwIfAborted()
    if (interactive) {
      const runtime = getTerminalRuntimeHooks()
      if (!runtime.isTTY || !runtime.runInteractive) {
        return 'Error: human-controlled terminal requires an interactive CLI/TTY with host support'
      }

      try {
        const result = await runtime.runInteractive({
          command,
          cwd: workdirResult.path,
          ...(ctx.signal && { signal: ctx.signal }),
        })
        notifyObserver(() =>
          ctx.onResultMetadata?.({
            terminalOutcome: result.status,
            exitCode: result.exitCode,
            signal: result.signal,
          })
        )
        // Only status metadata crosses back to the model; never echo host output or input.
        const parts = [`Status: human-controlled ${result.status}`]
        if (result.exitCode !== undefined) parts.push(`Exit code: ${result.exitCode}`)
        if (result.signal !== undefined) parts.push(`Signal: ${result.signal}`)
        if (result.status === 'declined') {
          parts.push('User declined execution. Do not automatically retry.')
        }
        parts.push('Interactive content was not recorded or sent to the model.')
        return parts.join('\n')
      } catch {
        // Host errors may contain terminal content or credentials; do not forward them.
        return 'Error: human-controlled terminal failed; interactive content was not recorded or sent to the model'
      }
    }

    if (ctx.results && !ctx.resultSource) {
      return 'Error: terminal result storage requires host-provided source identity; command was not executed.'
    }

    // 先触发 env 采集，再消费失败提示（P1：首次回执即告知）
    buildSpawnEnv()
    const completionNotices = drainCompletionNotices()
    const envFailureNotice = consumeShellEnvFailureNotice()

    let result: RunResult
    let outputPath: string | undefined
    try {
      outputPath = await ctx.results?.spoolPath()
      const outputOptions = ctx.results
        ? {
            path: outputPath!,
            maxBytes: ctx.results.maxResultBytes,
            onBackgroundClosed: () => ctx.results!.releaseSpool(outputPath!, true),
          }
        : undefined
      result = await runCommand(
        command,
        workdirResult.path,
        ctx.signal,
        ctx.onResultMetadata,
        outputOptions
      )
    } catch (err) {
      if (outputPath) await ctx.results?.releaseSpool(outputPath)
      const msg = (err as Error).message
      if (msg.includes('ENOENT')) {
        return 'Error: bash not found; S003 assumes POSIX + bash'
      }
      return `Error: Failed to execute command: ${msg}`
    }

    notifyObserver(() =>
      ctx.onResultMetadata?.({
        terminalOutcome: result.outcome,
        exitCode: result.exitCode,
        pid: result.pid,
        signal: result.signal,
      })
    )
    let reference: string | undefined
    if (ctx.results && ctx.resultSource && result.sink.logPath && result.outcome !== 'skipped') {
      try {
        if (result.sink.spilled && !result.sink.storageError) {
          reference = ctx.results.receipt(
            await ctx.results.seal(result.sink.logPath, ctx.resultSource)
          )
        } else {
          await fs.promises.rm(result.sink.logPath, { force: true })
        }
      } catch (error) {
        result.sink.storageError = `Result sealing failed after command settled: ${(error as Error).message}`
      }
    }
    if (outputPath && result.outcome !== 'skipped') {
      try {
        await ctx.results?.releaseSpool(outputPath)
      } catch (error) {
        result.sink.storageError = `Result cleanup failed after command settled: ${(error as Error).message}`
      }
    }
    return formatReceipt(result, envFailureNotice, completionNotices, reference)
  },
}
