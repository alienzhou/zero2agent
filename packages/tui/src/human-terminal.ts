import { getBaseShellEnv } from '@zero2agent/core'
import type { HumanTerminalRequest, HumanTerminalResult } from '@zero2agent/core'
import type { IPty } from '@lydell/node-pty'
import type { Interface } from 'node:readline'
import { StringDecoder } from 'node:string_decoder'
import { HumanProcessTree } from './human-terminal-process.js'

const MAX_INPUT_BYTES = 64 * 1024
const MAX_PENDING_OUTPUT = 1024 * 1024
const RESET_TERMINAL = '\x1b[0m\x1b[?25h\x1b[?1049l\x1b[?2004l'
let leased = false

/** Exclusive ownership prevents readline/history from consuming private terminal keys. */
function acquireInput(rl?: Interface): () => void {
  const input = process.stdin
  const wasRaw = input.isRaw
  const wasPaused = input.isPaused()
  const events = ['data', 'keypress', 'end', 'error'] as const
  const saved = events.map(event => [event, input.rawListeners(event)] as const)
  input.pause()
  for (const event of events) input.removeAllListeners(event)
  input.setRawMode(true)
  return () => {
    input.pause()
    for (const event of events) input.removeAllListeners(event)
    input.setRawMode(wasRaw ?? false)
    for (const [event, listeners] of saved) {
      for (const listener of listeners) input.on(event, listener as (...args: unknown[]) => void)
    }
    if (input.readableEnded || input.destroyed) rl?.close()
    else if (!wasPaused) input.resume()
  }
}

function confirm(): Promise<boolean> {
  return new Promise(resolve => {
    let line = ''
    const input = process.stdin
    const finish = (allowed: boolean) => {
      input.pause()
      input.off('data', onData)
      input.off('end', onEnd)
      input.off('error', onEnd)
      input.off('close', onEnd)
      process.stdout.write('\r\n')
      resolve(allowed)
    }
    const onEnd = () => finish(false)
    const onData = (chunk: Buffer | string) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          // Never forward the remainder of a pasted confirmation into the child.
          finish(/^(y|yes)$/i.test(line.trim()))
          return
        }
        if (char === '\x03' || char === '\x04' || char === '\x1b') {
          finish(false)
          return
        }
        if (char === '\x7f' || char === '\b') {
          if (line.length) {
            line = line.slice(0, -1)
            process.stdout.write('\b \b')
          }
        } else if (/^[a-z ]$/i.test(char) && line.length < 16) {
          line += char
          process.stdout.write(char)
        } else {
          finish(false)
          return
        }
      }
    }
    input.on('data', onData)
    input.once('end', onEnd)
    input.once('error', onEnd)
    input.once('close', onEnd)
    process.stdout.write('Allow human terminal? [y/N] ')
    input.resume()
  })
}

function dimensions(): { cols: number; rows: number } {
  return {
    cols: Math.max(1, process.stdout.columns || 80),
    rows: Math.max(1, process.stdout.rows || 24),
  }
}

function interactiveEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(getBaseShellEnv())) {
    if (value !== undefined) env[key] = value
  }
  // Unlike S003, don't force GIT_EDITOR=true or suppress terminal authentication.
  delete env.BASH_ENV
  env.TERM = process.env.TERM && process.env.TERM !== 'dumb' ? process.env.TERM : 'xterm-256color'
  env.HISTFILE = '/dev/null'
  return env
}

async function bridge(pty: IPty): Promise<HumanTerminalResult> {
  const input = process.stdin
  const output = process.stdout
  const decoder = new StringDecoder('utf8')
  const tree = new HumanProcessTree(pty.pid)
  let stopping: Promise<void> | undefined
  let exited: { exitCode: number; signal?: number } | undefined
  let cancelled = false
  let failure = false
  let finished = false
  let resolveExit: () => void = () => {}
  const exit = new Promise<void>(resolve => { resolveExit = resolve })

  const stop = () => {
    cancelled = true
    if (!stopping) {
      stopping = tree.terminate().catch(() => {
        failure = true
        try { pty.kill('SIGKILL') } catch { /* Process may have already exited. */ }
      })
    }
    return stopping
  }
  const onInput = (chunk: Buffer | string) => {
    if (finished || cancelled) return
    const text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
    if (text.includes('\x1d') || Buffer.byteLength(text) > MAX_INPUT_BYTES) {
      void stop()
      return
    }
    try { pty.write(text) } catch { failure = true; void stop() }
  }
  const onInputEnd = () => { void stop() }
  const onDrain = () => { if (!finished && !exited) pty.resume() }
  const onResize = () => {
    if (finished || exited) return
    try { const { cols, rows } = dimensions(); pty.resize(cols, rows) } catch { /* Exit can race resize. */ }
  }
  const dataSubscription = pty.onData(data => {
    if (finished) return
    if (output.writableLength + Buffer.byteLength(data) > MAX_PENDING_OUTPUT) {
      failure = true
      void stop()
      return
    }
    if (!output.write(data)) pty.pause()
  })
  const exitSubscription = pty.onExit(event => { exited = event; resolveExit() })
  const tracker = setInterval(() => {
    try { tree.capture() } catch { failure = true; void stop() }
  }, 500)
  let stopTimer: NodeJS.Timeout | undefined
  const pollStop = setInterval(() => {
    if (cancelled && !stopTimer) stopTimer = setTimeout(resolveExit, 2000)
  }, 50)
  input.on('data', onInput)
  input.once('end', onInputEnd)
  input.once('close', onInputEnd)
  input.once('error', onInputEnd)
  output.on('drain', onDrain)
  output.on('resize', onResize)
  input.resume()
  try {
    tree.capture()
    output.write('Human terminal active — Ctrl-C/Ctrl-D go to the program; Ctrl-] stops this session.\r\n')
    await exit
    input.pause()
    clearInterval(tracker)
    // Clean ordinary background descendants even when the original command exited normally.
    await (stopping ?? tree.terminate())
    await new Promise(resolve => setTimeout(resolve, 20))
    if (output.writableLength) {
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); output.off('drain', done); resolve() }
        const timer = setTimeout(done, 2000)
        output.once('drain', done)
      })
    }
    if (failure) throw new Error('Human terminal I/O or process cleanup failed')
    return {
      status: cancelled || exited?.signal ? 'cancelled' : 'completed',
      ...(exited ? { exitCode: exited.exitCode, signal: exited.signal } : {}),
    }
  } finally {
    finished = true
    input.pause()
    clearInterval(tracker)
    clearInterval(pollStop)
    if (stopTimer) clearTimeout(stopTimer)
    input.off('data', onInput)
    input.off('end', onInputEnd)
    input.off('close', onInputEnd)
    input.off('error', onInputEnd)
    output.off('drain', onDrain)
    output.off('resize', onResize)
    dataSubscription.dispose()
    exitSubscription.dispose()
    try { pty.kill() } catch { /* Native backend may already be disposed. */ }
  }
}

/** Human keyboard/PTY interaction stays outside tool-result and conversation storage. */
export async function runHumanTerminal(
  request: HumanTerminalRequest,
  rl?: Interface
): Promise<HumanTerminalResult> {
  if (process.platform === 'win32' || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Human terminal requires a POSIX CLI/TTY')
  }
  if (leased) throw new Error('A human terminal already owns this input')
  leased = true
  let restore: (() => void) | undefined
  let pty: IPty | undefined
  let externalSignal: NodeJS.Signals | undefined
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  const handlers = signals.map(signal => {
    const handler = () => {
      externalSignal = signal
      // EOF-like stream handling cannot cancel a confirmation; injecting no input
      // is not approval. A separate event ends the current owner safely.
      process.stdin.emit('end')
    }
    process.once(signal, handler)
    return [signal, handler] as const
  })
  const onExit = () => {
    if (pty) {
      try { new HumanProcessTree(pty.pid).signal('SIGKILL') } catch { /* Best effort on synchronous exit. */ }
      try { pty.kill('SIGKILL') } catch { /* Already gone. */ }
    }
    try { process.stdin.setRawMode(false) } catch { /* Terminal can have disconnected. */ }
  }
  process.once('exit', onExit)
  try {
    restore = acquireInput(rl)
    process.stdout.write(`\r\nHuman terminal request\r\nCommand: ${JSON.stringify(request.command)}\r\nDirectory: ${JSON.stringify(request.cwd)}\r\n`)
    if (!await confirm() || externalSignal) return { status: 'declined' }
    const { spawn } = await import('@lydell/node-pty')
    pty = spawn('/bin/bash', ['--noprofile', '--norc', '-c', request.command], {
      cwd: request.cwd,
      env: interactiveEnvironment(),
      name: 'xterm-256color',
      ...dimensions(),
    })
    return await bridge(pty)
  } finally {
    process.stdin.pause()
    process.off('exit', onExit)
    for (const [signal, handler] of handlers) process.off(signal, handler)
    try {
      process.stdout.write(RESET_TERMINAL + '\r\n')
      restore?.()
    } finally {
      leased = false
    }
    if (externalSignal) process.kill(process.pid, externalSignal)
  }
}
