/**
 * D01 工具基本盘 — CLI + 真实 LLM live E2E
 * 设计：command/workdir、stdout/stderr 合流、exit code 回执
 */
import { describe, it, expect, afterEach } from 'vitest'
import { runCli, stripAnsi, makeTempWorkspace } from '../helpers/cli.js'
import { live } from '../helpers/live.js'

describe.skipIf(!live)('D01 工具基本盘', () => {
  let cleanup: (() => Promise<void>) | undefined

  afterEach(async () => {
    await cleanup?.()
    cleanup = undefined
  })

  it('workdir 应在相对子目录执行', async () => {
    const ws = await makeTempWorkspace({ 'src/nested.txt': 'nested-ok\n' })
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['用 terminal、workdir=src 执行 pwd，并告诉我路径里是否包含 src'],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toMatch(/src/i)
  })

  it('非零退出码应进入回执', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['用 terminal 执行 exit 42，如实告诉我退出码'],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toMatch(/42/)
  })

  it('stdout 与 stderr 应合流回执', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await runCli({
      args: [
        '用 terminal 执行 bash -c "echo merge-stdout-only; echo merge-stderr-only >&2"，把 stdout 和 stderr 两行原文都告诉我',
      ],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toContain('merge-stdout-only')
    expect(output).toContain('merge-stderr-only')
  })
})
