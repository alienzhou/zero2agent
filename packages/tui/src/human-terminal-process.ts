import { execFileSync } from 'node:child_process'

interface ProcessIdentity {
  pid: number
  parent: number
  group: number
  started: string
}

function snapshot(): ProcessIdentity[] {
  const output = execFileSync(
    '/bin/ps',
    ['-ax', '-o', 'pid=', '-o', 'ppid=', '-o', 'pgid=', '-o', 'lstart='],
    {
      encoding: 'utf8',
      timeout: 1000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }
  )
  return output.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
    return match
      ? [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            group: Number(match[3]),
            started: match[4],
          },
        ]
      : []
  })
}

/** Tracks this PTY's ordinary descendants, not arbitrary daemon/namespace escape. */
export class HumanProcessTree {
  private readonly known = new Map<number, string>()
  private scanned = false
  private groupRetired = false

  constructor(private readonly root: number) {
    if (!Number.isSafeInteger(root) || root <= 1 || root === process.pid) {
      throw new Error('Invalid owned PTY process')
    }
  }

  capture(): ProcessIdentity[] {
    const rows = snapshot()
    const owned = new Set<number>()
    const leader = rows.find(row => row.pid === this.root)
    const expectedLeader = this.known.get(this.root)
    if (this.scanned && leader && expectedLeader && leader.started !== expectedLeader) {
      this.groupRetired = true
    }
    if (this.scanned && !rows.some(row => row.group === this.root)) this.groupRetired = true
    for (const row of rows) {
      if (
        (!this.scanned && row.pid === this.root) ||
        (!this.groupRetired && row.group === this.root) ||
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
    this.scanned = true
    return result
  }

  signal(signal: NodeJS.Signals): void {
    let owned: ProcessIdentity[] = []
    let scanFailed = false
    try {
      owned = this.capture()
    } catch {
      scanFailed = true
    }
    // forkpty creates this process group. A lost parent is not a lost group;
    // it can still contain children created since the previous observation.
    this.signalGroup(signal)
    if (scanFailed) throw new Error('Could not inspect terminal descendants')
    // Re-read identities before addressing descendants outside the original group.
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

  signalGroup(signal: NodeJS.Signals): void {
    if (this.groupRetired) return
    try {
      process.kill(-this.root, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') this.groupRetired = true
      else throw error
    }
  }

  async terminate(): Promise<void> {
    let failed = false
    try {
      this.signal('SIGTERM')
    } catch {
      failed = true
    }
    await new Promise(resolve => setTimeout(resolve, 150))
    try {
      this.signal('SIGKILL')
    } catch {
      failed = true
    }
    if (failed) throw new Error('Terminal cleanup required group-only fallback')
  }
}
