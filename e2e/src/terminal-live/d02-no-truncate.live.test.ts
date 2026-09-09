/**
 * D02 不截断 — CLI + 真实 LLM live E2E
 * 设计：超 800 行/20KB 落盘，渐进式披露
 */
import { describe, it, expect, afterEach } from 'vitest'
import { runCli, stripAnsi, makeTempWorkspace } from '../helpers/cli.js'
import { live } from '../helpers/live.js'

describe.skipIf(!live)('D02 不截断', () => {
  let cleanup: (() => Promise<void>) | undefined

  afterEach(async () => {
    await cleanup?.()
    cleanup = undefined
  })

  it('超 800 行应落盘，回执给路径而非全文', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await runCli({
      args: [
        '用 terminal 执行 seq 1 900。若回执提示 Saved to /tmp，用 read_file 读该文件，告诉我第 1 行和第 900 行数字',
      ],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toMatch(/Saved to:|zero2agent-.*\.log|\/tmp\//i)
    expect(output).toMatch(/\b1\b/)
    expect(output).toMatch(/900/)
    expect(output).toContain('read_file')
  })

  it('小输出应直接出现在回执，不落盘', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['用 terminal 执行 echo tiny-inline-output，把命令输出原文告诉我'],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toContain('tiny-inline-output')
    expect(output).not.toMatch(/Saved to:/)
  })

  it('落盘文件应可用 grep_search 精确检索', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await runCli({
      args: [
        '用 terminal 执行 seq 1 850。若输出落盘，用 grep_search 在落盘文件里搜 "850"，告诉我是否找到',
      ],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toContain('grep_search')
    expect(output).toContain('850')
  })
})
