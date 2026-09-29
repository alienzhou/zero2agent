import { execFileSync } from 'node:child_process'

interface ProcessIdentity {
  pid: number
  parent: number
  group: number
  started: string
}

function snapshot(): ProcessIdentity[] {
  const output = execFileSync('/bin/ps', ['-ax', '-o', 'pid=', '-o', 'ppid=', '-o', 'pgid=', '-o', 'lstart='], {
    encoding: 'utf8',
    timeout: 1000,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return output.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
    return match
      ? [{ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), started: match[4] }]
      : []
  })
}

/** Tracks this PTY's ordinary descendants, not arbitrary daemon/namespace escape. */
export class HumanProcessTree {
  private readonly known = new Map<number, string>()

  constructor(private readonly root: number) {}

  capture(): ProcessIdentity[] {
    const rows = snapshot()
    const owned = new Set<number>()
    for (const row of rows) {
      if (
        row.pid === this.root ||
        row.group === this.root ||
        this.known.get(row.pid) === row.started
      ) {
        owned.add(row.pid)
      }
    }
    let changed = true
    while (changed) {
      changed = false
      for (const row of rows) {
        if (owned.has(row.parent) && !owned.has(row.pid)) {
          owned.add(row.pid)
          changed = true
        }
      }
    }
    const result = rows.filter(row => owned.has(row.pid) && row.pid !== process.pid)
    for (const row of result) this.known.set(row.pid, row.started)
    return result
  }

  signal(signal: NodeJS.Signals): void {
    // Re-read identities immediately before signaling to reduce PID reuse risk.
    const owned = this.capture()
    const current = new Map(snapshot().map(row => [row.pid, row.started]))
    for (const row of owned.reverse()) {
      if (current.get(row.pid) !== row.started) continue
      try {
        process.kill(row.pid, signal)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
  }

  async terminate(): Promise<void> {
    this.signal('SIGTERM')
    await new Promise(resolve => setTimeout(resolve, 150))
    this.signal('SIGKILL')
  }
}
