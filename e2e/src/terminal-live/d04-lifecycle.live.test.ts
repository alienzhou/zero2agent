/**
 * D04 三道防线 — CLI + 真实 LLM live E2E
 * ① killpg：落 pid 后杀进程组，CLI 返回后 kill -0 须死
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
  readPidFile,
} from '../helpers/terminal-live.js'

describe.skipIf(!live)('D04 三道防线', () => {
  let cleanup: (() => Promise<void>) | undefined

  afterEach(async () => {
    await cleanup?.()
    cleanup = undefined
  })

  it('killpg：nohup 孙进程落 pid 后应能被杀死', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await runCli({
      args: [
        '严格按顺序：1) terminal 执行 nohup sleep 120 > /dev/null 2>&1 & echo $! > orphan-nohup.pid ；2) terminal 执行 kill -TERM -$(cat orphan-nohup.pid) 2>/dev/null || kill -TERM $(cat orphan-nohup.pid)',
      ],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toMatch(/orphan-nohup\.pid|nohup/)

    const pid = await readPidFile(ws.dir, 'orphan-nohup.pid')
    expect(isPidAlive(pid)).toBe(false)
  }, 90_000)

  it('killpg：disown 孙进程落 pid 后应能被杀死', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await runCli({
      args: [
        "严格按顺序：1) terminal 执行 bash -c 'sleep 120 & echo $! > orphan-disown.pid; disown' ；2) terminal 执行 kill -TERM -$(cat orphan-disown.pid) 2>/dev/null || kill -TERM $(cat orphan-disown.pid)",
      ],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toMatch(/orphan-disown\.pid|disown/)

    const pid = await readPidFile(ws.dir, 'orphan-disown.pid')
    expect(isPidAlive(pid)).toBe(false)
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
