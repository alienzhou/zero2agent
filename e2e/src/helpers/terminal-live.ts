/**
 * terminal live E2E 辅助：进程检测、git 夹具、回执解析
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

/** 进程是否仍存活 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  const r = spawnSync('kill', ['-0', String(pid)], { encoding: 'utf-8' })
  return r.status === 0
}

/** 夹具回收：尽力终止孤儿进程（先进程组再单 pid） */
export function killPidBestEffort(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return
  spawnSync('kill', ['-TERM', `-${pid}`], { encoding: 'utf-8' })
  if (isPidAlive(pid)) spawnSync('kill', ['-TERM', String(pid)], { encoding: 'utf-8' })
  if (isPidAlive(pid)) spawnSync('kill', ['-KILL', String(pid)], { encoding: 'utf-8' })
}

/** 读取工作区内的 pid 文件 */
export async function readPidFile(wsDir: string, rel = 'orphan.pid'): Promise<number> {
  const raw = (await fs.readFile(path.join(wsDir, rel), 'utf8')).trim()
  const pid = Number(raw)
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`invalid pid file ${rel}: ${raw}`)
  }
  return pid
}

/** 初始化可跑 git log 的仓库（多提交，便于触发 pager） */
export async function initGitRepoWithCommit(wsDir: string): Promise<void> {
  const run = (cmd: string) => {
    const r = spawnSync('bash', ['-lc', cmd], { cwd: wsDir, encoding: 'utf-8' })
    if (r.status !== 0) throw new Error(`git setup failed: ${cmd}\n${r.stderr}`)
  }
  run('git init -q')
  run('git config user.email "z2a-live@test.local"')
  run('git config user.name "z2a-live"')
  for (let i = 1; i <= 5; i++) {
    const f = `file-${i}.txt`
    await fs.writeFile(path.join(wsDir, f), `content ${i}\n`, 'utf8')
    run(`git add ${f} && git commit -q -m "commit-${i}"`)
  }
}

/** 最小 PATH 父进程环境（证伪 login shell 采集） */
export function minimalParentCliEnv(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: '/usr/bin:/bin',
    ZERO2AGENT_SKIP_LOCAL_ENV: '1',
    E2E_LIVE: '1',
  }
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (process.env.ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL
  return env
}

/** CLI 输出里是否含 terminal 回执关键句（防线③ drain） */
export function hasDrainPipeNote(output: string): boolean {
  return /descendant process may still be holding the output pipe/i.test(output)
}

/** CLI 输出里是否含 Wall time 字段（terminal 回执，非模型转述） */
export function hasWallTimeInReceipt(output: string): boolean {
  return /Wall time:\s*\d+s/i.test(output)
}

/** 提取最后一次 terminal(command: "...") 里的命令字面量 */
export function extractTerminalCommand(output: string): string | null {
  const matches = [...output.matchAll(/terminal\(command: "((?:\\.|[^"\\])*)"\)/g)]
  if (matches.length === 0) return null
  return matches[matches.length - 1][1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

export function expectTerminalCommand(output: string, mustInclude: string): void {
  const cmd = extractTerminalCommand(output)
  if (!cmd) throw new Error('terminal(command: ...) not found in CLI output')
  if (!cmd.includes(mustInclude)) {
    throw new Error(`terminal command mismatch.\nExpected fragment: ${mustInclude}\nActual: ${cmd}`)
  }
}

/** 从 CLI 输出解析 terminal 工具执行耗时（毫秒） */
export function extractTerminalExecMs(output: string): number | null {
  const m = output.match(/Exit code: \d+ \((\d+)ms\)/)
  return m ? Number(m[1]) : null
}

/** PATH 是否明显宽于最小 /usr/bin:/bin（login shell 采集） */
export function pathLooksCollected(output: string): boolean {
  if (/\/(opt\/homebrew|\.nvm|\.cargo|\.local\/bin|fnm)/i.test(output)) return true
  if (/\/Users\/[^/\s]+\/[^:\s]+/.test(output)) return true

  const m = output.match(/PATH[=:\s]+([^\n<"]+)/i)
  if (!m) return false
  const parts = m[1].split(':').map(p => p.trim()).filter(Boolean)
  const minimal = new Set(['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin'])
  return parts.some(p => !minimal.has(p)) || parts.length > 4
}
