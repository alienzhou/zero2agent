/**
 * 定稿 P0 可自动化证据 — 阈值两侧、exit 矩阵、description 契约、
 * drain 计时、真实进程 / PTY 按键（禁止 mock 冒充）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'
import { terminalTool } from '../terminal.js'
import { clearProcessRegistryForTests } from '../process-registry.js'
import { resetTerminalRuntimeHooksForTests } from '../terminal-runtime.js'
import type { ToolContext } from '../types.js'
import {
  CTRL_S,
  CTRL_X,
  runTerminalInPty,
  waitForReady,
} from './helpers/terminal-pty-evidence.js'

const TERMINAL_DIST = fileURLToPath(new URL('../../../dist/tools/terminal.js', import.meta.url))

let tmpDir: string
let ctx: ToolContext

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-ev-'))
  ctx = { cwd: tmpDir }
  clearProcessRegistryForTests()
  resetTerminalRuntimeHooksForTests()
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function pidAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('P0 证据：terminalTool.description 契约', () => {
  it('[P0] description 写明非交互、workdir、超长落盘回读', () => {
    const d = terminalTool.description
    expect(d).toMatch(/non-interactive/i)
    expect(d).toMatch(/workdir instead of cd/i)
    expect(d).toMatch(/cd does not persist/i)
    expect(d).toMatch(/800 lines/i)
    expect(d).toMatch(/20KB/i)
    expect(d).toMatch(/read_file|grep_search/)
  })
})

describe('P0 证据：超长输出阈值两侧', () => {
  it('[P0] 恰好 800 行不越界（回执有正文、无 Saved to）', async () => {
    const result = await terminalTool.execute(
      { command: 'for i in $(seq 1 800); do echo line_$i; done' },
      ctx
    )
    expect(result).toContain('Exit code: 0')
    expect(result).toContain('<untrusted_command_output')
    expect(result).not.toContain('Saved to:')
  }, 30_000)

  it('[P0] 801 行触发越界（无正文、有 Saved to）', async () => {
    const result = await terminalTool.execute(
      { command: 'for i in $(seq 1 801); do echo line_$i; done' },
      ctx
    )
    expect(result).toContain('Saved to:')
    expect(result).not.toContain('<untrusted_command_output')
    expect(result).not.toMatch(/line_1\n/)
  }, 30_000)

  it('[P0] 20KB 以内不越界，略超 20KB 越界', async () => {
    const under = await terminalTool.execute(
      { command: "node -e \"process.stdout.write('x'.repeat(20400))\"" },
      ctx
    )
    expect(under).toContain('<untrusted_command_output')
    expect(under).not.toContain('Saved to:')

    const over = await terminalTool.execute(
      { command: "node -e \"process.stdout.write('y'.repeat(21000))\"" },
      ctx
    )
    expect(over).toContain('Saved to:')
    expect(over).not.toContain('<untrusted_command_output')
  }, 30_000)
})

describe('P0 证据：watcher 退出码矩阵', () => {
  it.each([
    ['0', 'true', 0],
    ['42', 'exit 42', 42],
    ['127', 'nosuchcmd_z2a_evidence_xyz', 127],
    ['3', 'exit 3', 3],
  ] as const)('[P0] exit %s 保真', async (_label, cmd, code) => {
    const result = await terminalTool.execute({ command: cmd }, ctx)
    expect(result).toMatch(new RegExp(`Exit code: ${code}`))
    expect(result.startsWith('Error:')).toBe(false)
  })
})

describe('P0 证据：Wall time 阈值两侧', () => {
  it('[P0] 2.9s 无 Wall time', async () => {
    const result = await terminalTool.execute({ command: 'sleep 2.9' }, ctx)
    expect(result).toContain('Exit code: 0')
    expect(result).not.toContain('Wall time:')
  }, 15_000)

  it('[P0] 3.1s 有 Wall time', async () => {
    const result = await terminalTool.execute({ command: 'sleep 3.1' }, ctx)
    expect(result).toContain('Exit code: 0')
    expect(result).toMatch(/Wall time: [34]s/)
  }, 15_000)
})

describe('P0 证据：读取侧 drain', () => {
  it('[P0] 后台 job 持有 pipe：约 2s drain 返回，不等 5s close', async () => {
    const start = Date.now()
    const result = await terminalTool.execute({ command: '(sleep 5) & exit 0' }, ctx)
    const elapsed = Date.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(1800)
    expect(elapsed).toBeLessThan(3500)
    expect(result).toContain('descendant process may still be holding the output pipe')
  }, 15_000)

  it('[P0] detached 子进程继承 stdout：约 2s drain 返回', async () => {
    const start = Date.now()
    const result = await terminalTool.execute(
      {
        command:
          "node -e \"import{spawn}from'node:child_process';const c=spawn('sleep',['5'],{detached:true,stdio:['ignore','inherit','inherit']});c.unref();process.exit(0)\"",
      },
      ctx
    )
    const elapsed = Date.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(1800)
    expect(elapsed).toBeLessThan(3500)
    expect(result).toContain('descendant process may still be holding the output pipe')
  }, 15_000)
})

describe('P0 证据：非 TTY 降级（默认 runtime，无 mock）', () => {
  it('[P0] 非 TTY 下长命令跑到底并返回 Exit code', async () => {
    const result = await terminalTool.execute({ command: 'sleep 2; echo done' }, ctx)
    expect(result).toMatch(/^Exit code: 0/m)
    expect(result).not.toMatch(/^Status: skipped/m)
    expect(result).toContain('done')
  }, 15_000)
})

describe('P0 证据：PTY 真按键（script PTY + TUI 同款 keypress）', () => {
  it('[P0] 首秒内 Ctrl-X 取消长命令', async () => {
    const { result, statusLines } = await runTerminalInPty({
      cwd: tmpDir,
      command: 'sleep 20',
      keys: [{ delayMs: 400, data: CTRL_X }],
      timeoutMs: 15_000,
    })

    expect(result).toMatch(/^Status: cancelled/m)
    expect(statusLines.some(s => s.line.includes('Ctrl-X 取消'))).toBe(true)
    expect(statusLines.some(s => s.line.includes('Ctrl-S'))).toBe(false)
  }, 20_000)

  it('[P0] 10s 后出现 Ctrl-S 提示，按键可跳过', async () => {
    const { result, statusLines } = await runTerminalInPty({
      cwd: tmpDir,
      command: 'sleep 20',
      keys: [{ delayMs: 10_500, data: CTRL_S }],
      timeoutMs: 25_000,
    })

    expect(result).toMatch(/^Status: skipped/m)
    const skipHints = statusLines.filter(s => s.line.includes('Ctrl-S 跳过'))
    expect(skipHints.length).toBeGreaterThan(0)
    const first = skipHints[0]
    const t0 = statusLines[0]?.at ?? first.at
    expect(first.at - t0).toBeGreaterThanOrEqual(9500)
  }, 30_000)

  it('[P0] PTY Ctrl-X 取消后 nohup sleep 不再存活', async () => {
    const pidFile = path.join(tmpDir, 'nohup.pid')
    const { result } = await runTerminalInPty({
      cwd: tmpDir,
      command: `nohup sleep 60 > /dev/null 2>&1 & echo $! > ${JSON.stringify(pidFile)}; sleep 30`,
      keys: [{ delayMs: 500, data: CTRL_X }],
      timeoutMs: 20_000,
    })

    expect(result).toMatch(/^Status: cancelled/m)
    const pid = Number((await fs.readFile(pidFile, 'utf8')).trim())
    expect(Number.isFinite(pid)).toBe(true)
    await new Promise(r => setTimeout(r, 800))
    expect(await pidAlive(pid)).toBe(false)
  }, 25_000)

  it('[P0] PTY Ctrl-X 取消后 disown sleep 不再存活', async () => {
    const pidFile = path.join(tmpDir, 'disown.pid')
    const { result } = await runTerminalInPty({
      cwd: tmpDir,
      command: `sleep 60 & echo $! > ${JSON.stringify(pidFile)}; disown; sleep 30`,
      keys: [{ delayMs: 500, data: CTRL_X }],
      timeoutMs: 20_000,
    })

    expect(result).toMatch(/^Status: cancelled/m)
    const pid = Number((await fs.readFile(pidFile, 'utf8')).trim())
    await new Promise(r => setTimeout(r, 800))
    expect(await pidAlive(pid)).toBe(false)
  }, 25_000)
})

describe('P0 证据：watcher 防线② — Agent 子进程 SIGKILL', () => {
  it('[P0] SIGKILL harness 后 sleep 孙进程在约 2s 内死亡', async () => {
    const grandchildPidFile = path.join(tmpDir, 'grandchild.pid')
    const harnessPath = path.join(tmpDir, 'watcher-kill9-harness.mjs')
    const readyPath = path.join(tmpDir, 'harness-ready.pid')

    await fs.writeFile(
      harnessPath,
      `import { terminalTool } from ${JSON.stringify(TERMINAL_DIST)};
const grandchildPidFile = ${JSON.stringify(grandchildPidFile)};
import * as fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(readyPath)}, String(process.pid));
await terminalTool.execute(
  { command: 'sleep 60 & echo $! > ' + JSON.stringify(grandchildPidFile) + '; wait' },
  { cwd: ${JSON.stringify(tmpDir)} }
);
`
    )

    const child = spawn(process.execPath, [harnessPath], { stdio: 'ignore', detached: true })
    const childPid = child.pid!
    child.unref()

    await waitForReady(readyPath, 5000)

    let grandchildPid = 0
    const pidDeadline = Date.now() + 5000
    while (Date.now() < pidDeadline) {
      try {
        grandchildPid = Number((await fs.readFile(grandchildPidFile, 'utf8')).trim())
        if (Number.isFinite(grandchildPid) && grandchildPid > 0) break
      } catch {
        await new Promise(r => setTimeout(r, 50))
      }
    }
    expect(Number.isFinite(grandchildPid)).toBe(true)
    expect(await pidAlive(grandchildPid)).toBe(true)

    process.kill(childPid, 'SIGKILL')

    const deadline = Date.now() + 2000
    let dead = false
    while (Date.now() < deadline) {
      if (!(await pidAlive(grandchildPid))) {
        dead = true
        break
      }
      await new Promise(r => setTimeout(r, 100))
    }
    expect(dead).toBe(true)
  }, 35_000)
})
