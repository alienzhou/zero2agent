/**
 * D03 不杀死 — CLI + 真实 LLM live E2E
 * 设计：不设执行上限；非 TTY 须跑过竞品常见 10s 超时窗口
 */
import { describe, it, expect, afterEach } from 'vitest'
import { runCli, stripAnsi, makeTempWorkspace } from '../helpers/cli.js'
import { live } from '../helpers/live.js'
import { hasWallTimeInReceipt } from '../helpers/terminal-live.js'

describe.skipIf(!live)('D03 不杀死', () => {
  let cleanup: (() => Promise<void>) | undefined

  afterEach(async () => {
    await cleanup?.()
    cleanup = undefined
  })

  it('sleep 16s 应自然结束（超过竞品 10s 默认超时窗口）', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const start = Date.now()
    const result = await runCli({
      args: [
        '用 terminal 执行 sleep 16 && echo survived-16s，完成后告诉我输出里有没有 survived-16s',
      ],
      cwd: ws.dir,
    })
    const elapsed = Date.now() - start

    expect(result.code).toBe(0)
    expect(elapsed).toBeGreaterThanOrEqual(15_000)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toContain('survived-16s')
  }, 90_000)

  it('sleep 12s 应自然结束（仍超过 10s 竞品窗口）', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const start = Date.now()
    const result = await runCli({
      args: [
        '用 terminal 执行 sleep 12 && echo survived-12s，完成后告诉我输出里有没有 survived-12s',
      ],
      cwd: ws.dir,
    })
    const elapsed = Date.now() - start

    expect(result.code).toBe(0)
    expect(elapsed).toBeGreaterThanOrEqual(11_000)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toContain('survived-12s')
  }, 60_000)

  it('sleep 3.5s 回执须含 Wall time 字段', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['用 terminal 执行 sleep 3.5 && echo wall-marker，把 terminal 回执原文告诉我'],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(hasWallTimeInReceipt(output)).toBe(true)
  }, 30_000)
})
