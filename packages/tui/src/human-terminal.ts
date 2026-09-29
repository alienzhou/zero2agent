import { getBaseShellEnv } from '@zero2agent/core'
import type { HumanTerminalRequest, HumanTerminalResult } from '@zero2agent/core'
import type { IPty } from '@lydell/node-pty'
import type { Interface } from 'node:readline'
import { StringDecoder } from 'node:string_decoder'
import { execFileSync } from 'node:child_process'
import { HumanProcessTree } from './human-terminal-process.js'

const MAX_INPUT_BYTES = 64 * 1024
const MAX_PENDING_OUTPUT = 1024 * 1024
const RESET_TERMINAL = '\x1b[0m\x1b[?25h\x1b[?1049l\x1b[?2004l'
let leased = false

/** Exclusive ownership prevents readline/history from consuming private terminal keys. */
function acquireInput(rl?: Interface): () => void {
  const input = process.stdin
  const stty = (...args: string[]): string =>
    execFileSync('/bin/stty', args, {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'ignore'],
      timeout: 1000,
    }).trim()
  const terminalMode = stty('-g')
  const wasRaw = input.isRaw
  const wasFlowing = input.readableFlowing
  const events = ['data', 'keypress', 'end', 'error'] as const
  const saved = events.map(event => [event, input.rawListeners(event)] as const)
  input.pause()
  for (const event of events) input.removeAllListeners(event)
  // Startup and teardown gaps still belong to the private input lease.
  input.on('data', () => {})
  let released = false
  const restore = (): void => {
    if (released) return
    released = true
    input.pause()
    for (const event of events) input.removeAllListeners(event)
    // tcsetattr/drain and terminal writes may block after the PTY master disappears.
    // There is no live terminal to restore; the owning CLI will exit below.
    if (input.readableEnded || input.destroyed) return
    try {
      input.setRawMode(wasRaw ?? false)
      stty(terminalMode)
    } finally {
      for (const [event, listeners] of saved) {
        for (const listener of listeners) input.on(event, listener as (...args: unknown[]) => void)
      }
      if (input.readableEnded || input.destroyed) rl?.close()
      // A previously untouched stdin must not keep a one-shot CLI alive after handoff.
      else if (wasFlowing === true) input.resume()
    }
  }
  try {
    input.setRawMode(true)
    // The inner PTY already applies CR/LF translation; don't translate a second time.
    stty('-opost')
  } catch (error) {
    restore()
    throw error
  }
  return restore
}

function confirm(signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    let line = ''
    let settled = false
    const input = process.stdin
    const finish = (allowed: boolean): void => {
      if (settled) return
      settled = true
      input.resume()
      input.off('data', onData)
      input.off('end', onEnd)
      input.off('error', onEnd)
      input.off('close', onEnd)
      signal.removeEventListener('abort', onEnd)
      process.stdout.write('\r\n')
      resolve(allowed)
    }
    const onEnd = (): void => finish(false)
    const onData = (chunk: Buffer | string): void => {
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
    signal.addEventListener('abort', onEnd, { once: true })
    if (signal.aborted) {
      finish(false)
      return
    }
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

async function bridge(
  pty: IPty,
  signal: AbortSignal,
  tree: HumanProcessTree,
  disconnected: () => never
): Promise<HumanTerminalResult> {
  const input = process.stdin
  const output = process.stdout
  const decoder = new StringDecoder('utf8')
  let stopping: Promise<void> | undefined
  let exited: { exitCode: number; signal?: number } | undefined
  let cancelled = false
  let failure = false
  let finished = false
  let resolveExit: () => void = () => {}
  const exit = new Promise<void>(resolve => {
    resolveExit = resolve
  })

  const clean = (): Promise<void> => {
    if (!stopping) {
      stopping = tree.terminate().catch(() => {
        failure = true
        try {
          tree.signalGroup('SIGKILL')
          pty.kill('SIGKILL')
        } catch {
          /* Process may have already exited. */
        }
      })
    }
    return stopping
  }
  const stop = (): Promise<void> => {
    cancelled = true
    return clean()
  }
  const onInput = (chunk: Buffer | string): void => {
    if (finished || cancelled || exited) return
    const text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
    if (text.includes('\x1d') || Buffer.byteLength(text) > MAX_INPUT_BYTES) {
      void stop()
      return
    }
    try {
      pty.write(text)
    } catch {
      failure = true
      void stop()
    }
  }
  const onInputEnd = (): void => {
    if (input.readableEnded || input.destroyed) disconnected()
    void stop()
  }
  const onOutputError = (): void => {
    failure = true
    void stop()
  }
  const onDrain = (): void => {
    if (!finished && !exited) pty.resume()
  }
  const onResize = (): void => {
    if (finished || exited) return
    try {
      const { cols, rows } = dimensions()
      pty.resize(cols, rows)
    } catch {
      /* Exit can race resize. */
    }
  }
  const dataSubscription = pty.onData(data => {
    if (finished || input.readableEnded || input.destroyed || signal.aborted) return
    if (output.writableLength + Buffer.byteLength(data) > MAX_PENDING_OUTPUT) {
      failure = true
      void stop()
      return
    }
    try {
      if (!output.write(data)) pty.pause()
    } catch {
      onOutputError()
    }
  })
  const exitSubscription = pty.onExit(event => {
    exited = event
    resolveExit()
  })
  const tracker = setInterval(() => {
    try {
      tree.capture()
    } catch {
      failure = true
      void stop()
    }
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
  output.on('error', onOutputError)
  signal.addEventListener('abort', onInputEnd, { once: true })
  if (signal.aborted) void stop()
  input.resume()
  try {
    tree.capture()
    output.write(
      'Human terminal active — Ctrl-C/Ctrl-D go to the program; Ctrl-] stops this session.\r\n'
    )
    await exit
    clearInterval(tracker)
    // Clean ordinary background descendants even when the original command exited normally.
    await clean()
    await new Promise(resolve => setTimeout(resolve, 20))
    if (output.writableLength) {
      await new Promise<void>(resolve => {
        const done = (): void => {
          clearTimeout(timer)
          output.off('drain', done)
          resolve()
        }
        const timer = setTimeout(done, 2000)
        output.once('drain', done)
      })
    }
    if (failure) throw new Error('Human terminal I/O or process cleanup failed')
    return {
      status: cancelled || exited?.signal ? 'cancelled' : 'completed',
      ...(exited ? { exitCode: exited.exitCode } : {}),
      ...(exited?.signal ? { signal: exited.signal } : {}),
    }
  } finally {
    finished = true
    clearInterval(tracker)
    clearInterval(pollStop)
    if (stopTimer) clearTimeout(stopTimer)
    // All paths, including the very first scan failing, reach the same cleanup.
    await clean()
    input.off('data', onInput)
    input.off('end', onInputEnd)
    input.off('close', onInputEnd)
    input.off('error', onInputEnd)
    output.off('drain', onDrain)
    output.off('resize', onResize)
    output.off('error', onOutputError)
    signal.removeEventListener('abort', onInputEnd)
    dataSubscription.dispose()
    exitSubscription.dispose()
    try {
      pty.kill()
    } catch {
      /* Native backend may already be disposed. */
    }
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
  let tree: HumanProcessTree | undefined
  let exitCleaned = false
  let externalSignal: 'SIGINT' | 'SIGTERM' | 'SIGHUP' | undefined
  const controller = new AbortController()
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  const handlers = signals.map(signal => {
    const handler = (): void => {
      externalSignal = signal
      if (signal === 'SIGHUP') disconnect()
      controller.abort()
    }
    process.once(signal, handler)
    return [signal, handler] as const
  })
  const onExit = (): void => {
    if (exitCleaned) return
    exitCleaned = true
    if (pty) {
      try {
        ;(tree ?? new HumanProcessTree(pty.pid)).signal('SIGKILL')
      } catch {
        /* Best effort on synchronous exit. */
      }
      try {
        pty.kill('SIGKILL')
      } catch {
        /* Already gone. */
      }
    }
    try {
      if (!process.stdin.readableEnded && !process.stdin.destroyed) {
        restore?.()
        process.stdin.setRawMode(false)
      }
    } catch {
      /* Terminal can have disconnected. */
    }
  }
  const disconnect = (): never => {
    // A vanished terminal cannot participate in asynchronous drain/restore.
    // Kill the owned execution synchronously, without writing to the dead device.
    externalSignal = 'SIGHUP'
    onExit()
    process.exit(129)
  }
  process.once('exit', onExit)
  try {
    restore = acquireInput(rl)
    process.stdout.write(
      `\r\nHuman terminal request\r\nCommand: ${JSON.stringify(request.command)}\r\nDirectory: ${JSON.stringify(request.cwd)}\r\n`
    )
    if (!(await confirm(controller.signal)) || externalSignal) return { status: 'declined' }
    const { spawn } = await import('@lydell/node-pty')
    if (controller.signal.aborted) return { status: 'declined' }
    pty = spawn('/bin/bash', ['--noprofile', '--norc', '-c', request.command], {
      cwd: request.cwd,
      env: interactiveEnvironment(),
      name: 'xterm-256color',
      ...dimensions(),
    })
    tree = new HumanProcessTree(pty.pid)
    return await bridge(pty, controller.signal, tree, disconnect)
  } finally {
    // Consume pending private bytes before handing listeners back to readline.
    // Keep draining for an event-loop turn while the old owner's lease is intact.
    if (restore && !process.stdin.readableEnded && !process.stdin.destroyed) {
      process.stdin.resume()
      await new Promise<void>(resolve => setImmediate(resolve))
      process.stdin.pause()
      while (process.stdin.read() !== null) {
        /* Discard terminal-era typeahead. */
      }
    }
    process.off('exit', onExit)
    for (const [signal, handler] of handlers) process.off(signal, handler)
    const disconnected = process.stdin.readableEnded || process.stdin.destroyed
    try {
      try {
        if (!disconnected)
          process.stdout.write(RESET_TERMINAL + '\r\nHuman terminal ended; returning control.\r\n')
      } finally {
        restore?.()
      }
    } finally {
      leased = false
      if (externalSignal || disconnected) {
        // Re-raising SIGHUP after removing its watcher can be ignored on macOS.
        // This CLI owns shutdown: restore the terminal, then use the conventional code.
        try {
          if (!disconnected) {
            rl?.close()
            process.stdin.setRawMode(false)
          }
        } catch {
          /* Terminal disconnected. */
        }
        process.exit({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[externalSignal ?? 'SIGHUP'])
      }
    }
  }
}
