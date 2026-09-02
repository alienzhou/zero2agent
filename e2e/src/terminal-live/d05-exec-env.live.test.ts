/**
 * D05 执行环境 — CLI + 真实 LLM live E2E
 * 父进程 PATH=/usr/bin:/bin，证伪 login shell 采集与 PAGER 覆盖
 */
import { describe, it, expect, afterEach } from 'vitest'
import { runCli, stripAnsi, makeTempWorkspace } from '../helpers/cli.js'
import { live } from '../helpers/live.js'
import {
  extractTerminalExecMs,
  initGitRepoWithCommit,
  minimalParentCliEnv,
  pathLooksCollected,
} from '../helpers/terminal-live.js'

const minimalEnv = minimalParentCliEnv()

describe.skipIf(!live)('D05 执行环境', () => {
  let cleanup: (() => Promise<void>) | undefined

  afterEach(async () => {
    await cleanup?.()
    cleanup = undefined
  })

  it('TERM 应为 dumb（呈现覆盖）', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['用 terminal 执行 echo $TERM，告诉我打印值'],
      cwd: ws.dir,
      inheritEnv: false,
      env: minimalEnv,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toMatch(/dumb/)
  })

  it('PATH 应宽于最小 /usr/bin:/bin（login shell 采集）', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await runCli({
      args: [
        '用 terminal 执行 command -v node && echo PATH=$PATH，把 node 路径和 PATH 原文都告诉我',
      ],
      cwd: ws.dir,
      inheritEnv: false,
      env: minimalEnv,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toMatch(/\/node\b/)
    expect(pathLooksCollected(output)).toBe(true)
  })

  it('PAGER=cat：git log 不应卡在分页器', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup
    await initGitRepoWithCommit(ws.dir)

    const result = await runCli({
      args: ['用 terminal 执行 git log，把输出前几行告诉我（不要卡在分页器）'],
      cwd: ws.dir,
      inheritEnv: false,
      env: minimalEnv,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('terminal')
    expect(output).toMatch(/commit-[1-5]/)
    const execMs = extractTerminalExecMs(output)
    expect(execMs).not.toBeNull()
    expect(execMs!).toBeLessThan(15_000)
  }, 90_000)
})
