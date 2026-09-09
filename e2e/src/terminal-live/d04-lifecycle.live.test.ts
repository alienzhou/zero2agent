/**
 * D04 三道防线 — CLI + 真实 LLM live E2E
 * ① nohup/disown：只 spawn 落 pid，CLI 秒返且孙进程仍存活（killpg 由 PTY 单测覆盖）
 * ③ (sleep N) & exit 0：读取侧约 2s drain resolve
 */
import { describe, it, expect, afterEach } from 'vitest'
import { runCli, stripAnsi, makeTempWorkspace } from '../helpers/cli.js'
import { live } from '../helpers/live.js'
import {
  expectTerminalCommand,
  extractTerminalExecMs,
  hasDrainPipeNote,
  isPidAlive,
  killPidBestEffort,
  readPidFile,
} from '../helpers/terminal-live.js'

const NOHUP_CMD =
  'nohup sleep 120 > /dev/null 2>&1 & echo $! > orphan-nohup.pid'
const DISOWN_CMD =
  "nohup bash -c 'sleep 120 & echo $! > orphan-disown.pid; disown' > /dev/null 2>&1 &"

describe.skipIf(!live)('D04 三道防线', () => {
  let cleanup: (() => Promise<void>) | undefined
  let orphanPid: number | undefined

  afterEach(async () => {
    if (orphanPid !== undefined && isPidAlive(orphanPid)) {
      killPidBestEffort(orphanPid)
    }
    orphanPid = undefined
    await cleanup?.()
    cleanup = undefined
  })

  it('后台存活：nohup 落 pid 后 CLI 远短于 120s 返回，kill -0 仍为 true', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const started = Date.now()
    const result = await runCli({
      args: [
        `只用 terminal 一次，不要 read_file/ps/kill。command 必须是字面量：${NOHUP_CMD}`,
      ],
      cwd: ws.dir,
    })
    const wallMs = Date.now() - started

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expectTerminalCommand(output, NOHUP_CMD)

    const pid = await readPidFile(ws.dir, 'orphan-nohup.pid')
    orphanPid = pid
    expect(wallMs).toBeLessThan(30_000)
    expect(isPidAlive(pid)).toBe(true)
    const execMs = extractTerminalExecMs(output)
    if (execMs !== null) expect(execMs).toBeLessThan(15_000)
  }, 90_000)

  it('后台存活：disown 落 pid 后 CLI 远短于 120s 返回，kill -0 仍为 true', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const started = Date.now()
    const result = await runCli({
      args: [
        `只用 terminal 一次，不要 read_file/ps/kill。command 必须是字面量：${DISOWN_CMD}`,
      ],
      cwd: ws.dir,
    })
    const wallMs = Date.now() - started

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expectTerminalCommand(output, DISOWN_CMD)

    const pid = await readPidFile(ws.dir, 'orphan-disown.pid')
    orphanPid = pid
    expect(wallMs).toBeLessThan(30_000)
    expect(isPidAlive(pid)).toBe(true)
    const execMs = extractTerminalExecMs(output)
    if (execMs !== null) expect(execMs).toBeLessThan(15_000)
  }, 90_000)

  it('防线③：command 须为 (sleep 8) & exit 0，约 2s drain', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await runCli({
      args: [
        '请用 terminal 一次，command 必须是字面量：(sleep 8) & exit 0。把回执里 Note 和 Exit code 原文告诉我',
      ],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expectTerminalCommand(output, '& exit 0')
    expect(hasDrainPipeNote(output)).toBe(true)
    const execMs = extractTerminalExecMs(output)
    expect(execMs).not.toBeNull()
    expect(execMs!).toBeGreaterThanOrEqual(1500)
    expect(execMs!).toBeLessThan(6_000)
  }, 60_000)
})
