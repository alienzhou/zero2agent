/** Native guardian: parent-pipe EOF terminates the real command even after host SIGKILL. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
let child: ChildProcessWithoutNullStreams | undefined
let starting = true,
  stopping = false,
  header = Buffer.alloc(0)
let deadline: ReturnType<typeof setTimeout> | undefined
const kill = (signal: NodeJS.Signals): void => {
  try {
    if (child?.pid && process.platform !== 'win32') process.kill(-child.pid, signal)
    else child?.kill(signal)
  } catch {
    /* Already gone. */
  }
}
function stop(code: number): void {
  if (stopping) return
  stopping = true
  clearTimeout(deadline)
  kill('SIGTERM')
  setTimeout(() => {
    kill('SIGKILL')
    setTimeout(() => process.exit(code), 50)
  }, 100)
}
process.on('SIGTERM', () => stop(1))
process.on('SIGINT', () => stop(1))
process.stdin.on('end', () => stop(1))
process.stdin.on('error', () => stop(1))
process.stdout.on('error', () => stop(1))
process.stderr.on('error', () => stop(1))
process.stdin.on('data', (bytes: Buffer) => {
  if (!starting) return stop(1)
  if (header.length + bytes.length > 65536) return stop(1)
  header = Buffer.concat([header, bytes])
  const end = header.indexOf(10)
  if (end < 0) return
  starting = false
  try {
    const { config, input } = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(header.subarray(0, end))
    )
    if (
      end !== header.length - 1 ||
      !config ||
      typeof input !== 'string' ||
      !Number.isInteger(config.timeoutMs) ||
      config.timeoutMs < 1 ||
      config.timeoutMs > 10000
    )
      return stop(1)
    child = spawn(config.command, config.args, {
      cwd: config.cwd,
      env: config.env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: 'pipe',
    })
    child.on('error', () => stop(1))
    child.stdin.on('error', () => stop(1))
    let out = 0,
      err = 0
    child.stdout.on('data', (b: Buffer) => {
      out += b.length
      if (out > 4096) stop(1)
      else process.stdout.write(b)
    })
    child.stderr.on('data', (b: Buffer) => {
      err += b.length
      if (err > 16384) stop(1)
      else process.stderr.write(b)
    })
    child.on('close', (code, signal) => stop(code === 0 && !signal ? 0 : 1))
    deadline = setTimeout(() => stop(1), config.timeoutMs)
    child.stdin.end(input)
  } catch {
    stop(1)
  }
})
// No parent can leave an idle or half-started guardian behind indefinitely.
setTimeout(() => {
  if (starting) stop(1)
}, 1000).unref()
