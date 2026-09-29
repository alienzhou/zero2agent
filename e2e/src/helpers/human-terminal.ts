import { createRequire } from 'node:module'
import path from 'node:path'
import { REPO_ROOT } from './cli.js'

interface PtyProcess {
  pid: number
  write(data: string): void
  resize(columns: number, rows: number): void
  kill(signal?: string): void
  onData(callback: (data: string) => void): { dispose(): void }
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

interface PtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string
      cols: number
      rows: number
      cwd: string
      env: Record<string, string>
    }
  ): PtyProcess
}

/** Load the production dependency, not a second copy or a mocked terminal. */
export function startHumanTerminal(entry: string, args: string[], cwd: string, repl = false) {
  const require = createRequire(path.join(REPO_ROOT, 'packages/tui/package.json'))
  const pty = require('@lydell/node-pty') as PtyModule
  // Deliberately do not inherit API keys, shell startup configuration, or local credentials.
  const child = pty.spawn(process.execPath, [entry, ...args], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: cwd,
      TMPDIR: cwd,
      TERM: 'xterm-256color',
      ZERO2AGENT_SKIP_LOCAL_ENV: '1',
      ...(repl
        ? { ANTHROPIC_API_KEY: 'fake-contract-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' }
        : {}),
    },
  })
  let output = ''
  let ended = false
  const changed = new Set<() => void>()
  child.onData(data => {
    output += data
    for (const notify of changed) notify()
  })
  const exit = new Promise<number>(resolve => {
    child.onExit(event => {
      ended = true
      resolve(event.exitCode)
      for (const notify of changed) notify()
    })
  })

  async function waitFor(marker: string | RegExp, from = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error(`Timed out waiting for ${marker}\n${output.slice(-4000)}`)),
        12_000
      )
      const finish = (error?: Error) => {
        clearTimeout(timeout)
        changed.delete(check)
        if (error) reject(error)
        else resolve(output.slice(from))
      }
      const check = () => {
        const tail = output.slice(from)
        if (typeof marker === 'string' ? tail.includes(marker) : marker.test(tail)) finish()
        else if (ended) finish(new Error(`Process exited before ${marker}\n${output.slice(-4000)}`))
      }
      changed.add(check)
      check()
    })
  }

  async function waitExit(): Promise<number> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        exit,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`CLI did not exit\n${output.slice(-4000)}`)),
            12_000
          )
        }),
      ])
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    get pid() {
      return child.pid
    },
    get output() {
      return output
    },
    write: (data: string) => child.write(data),
    resize: (columns: number, rows: number) => child.resize(columns, rows),
    signal: (signal: NodeJS.Signals) => child.kill(signal),
    waitFor,
    waitExit,
    async close() {
      if (!ended) child.kill('SIGKILL')
      await waitExit()
    },
  }
}
