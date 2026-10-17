import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export class HookProcessError extends Error {
  constructor(readonly code: string) {
    super(`Hook process failed: ${code}`)
  }
}
/** Private pipes; bytes never reach the terminal, model or diagnostic log. */
export async function runHookProcess(
  config: {
    command: string
    args: string[]
    env: Record<string, string>
    cwd: string
    timeoutMs: number
  },
  input: string,
  signal?: AbortSignal
): Promise<'pass' | 'block'> {
  signal?.throwIfAborted()
  if (Buffer.byteLength(input) > 32768) throw new HookProcessError('input-capacity')
  const header = JSON.stringify({ config, input }) + '\n'
  if (Buffer.byteLength(header) > 65536) throw new HookProcessError('input-capacity')
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../dist/hook-runner.js', import.meta.url))],
    {
      cwd: config.cwd,
      env: {},
      shell: false,
      detached: process.platform !== 'win32',
      stdio: 'pipe',
    }
  )
  let output = Buffer.alloc(0),
    stderr = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort = (): void => {}
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (code: string): void => reject(new HookProcessError(code))
      child.on('error', () => fail('spawn'))
      child.stdin.on('error', () => fail('stdin'))
      child.stdout.on('data', (bytes: Buffer) => {
        if (output.length + bytes.length > 4096) fail('stdout-capacity')
        else output = Buffer.concat([output, bytes])
      })
      child.stderr.on('data', (bytes: Buffer) => {
        stderr += bytes.length
        if (stderr > 16384) fail('stderr-capacity')
      })
      child.on('close', (code, term) => (code === 0 && !term ? resolve() : fail('exit')))
      timer = setTimeout(() => fail('timeout'), config.timeoutMs)
      abort = () => fail('cancelled')
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      child.stdin.write(header)
    })
    let value: { version?: unknown; decision?: unknown; reason?: unknown }
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output))
    } catch {
      throw new HookProcessError('protocol')
    }
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some(k => !['version', 'decision', 'reason'].includes(k)) ||
      value.version !== 1 ||
      !['pass', 'block'].includes(value.decision as string) ||
      (value.reason !== undefined &&
        (typeof value.reason !== 'string' || value.reason.length > 512))
    )
      throw new HookProcessError('protocol')
    return value.decision as 'pass' | 'block'
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    await stopGuardian(child)
  }
}

async function stopGuardian(child: ChildProcessWithoutNullStreams): Promise<void> {
  child.stdin.destroy()
  child.stdout.destroy()
  child.stderr.destroy()
  const kill = (s: NodeJS.Signals): void => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, s)
      else child.kill(s)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw new HookProcessError('cleanup')
    }
  }
  const wait = (ms: number): Promise<void> =>
    new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return resolve()
      const done = (): void => {
        clearTimeout(t)
        child.removeListener('exit', done)
        resolve()
      }
      const t = setTimeout(done, ms)
      child.once('exit', done)
    })
  kill('SIGTERM')
  await wait(250)
  kill('SIGKILL')
  await wait(250)
  if (child.pid && child.exitCode === null && child.signalCode === null)
    throw new HookProcessError('cleanup')
}
