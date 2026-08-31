/**
 * E02-S003 terminal 契约层 E2E
 * 直接驱动 @zero2agent/core 工具链，不调 LLM。
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { allTools, readFileTool, terminalTool } from '@zero2agent/core'
import { makeTempWorkspace } from './helpers/cli.js'

describe('E02-S003 terminal 契约：工具链集成', () => {
  let cleanup: (() => Promise<void>) | undefined

  afterEach(async () => {
    await cleanup?.()
    cleanup = undefined
  })

  it('[P0] 构建产物 allTools 含 terminal', () => {
    const names = allTools.map(t => t.name)
    expect(names).toContain('terminal')
    expect(names).toHaveLength(8)
  })

  it('[P0] terminal 创建文件 + read_file 回读', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup
    const ctx = { cwd: ws.dir }

    const run = await terminalTool.execute({ command: 'echo e2e-ok > created.txt' }, ctx)
    expect(run).toContain('Exit code: 0')

    const content = await fs.readFile(path.join(ws.dir, 'created.txt'), 'utf-8')
    expect(content.trim()).toBe('e2e-ok')

    const viaTool = await readFileTool.execute({ path: 'created.txt' }, ctx)
    expect(viaTool).toContain('e2e-ok')
  })

  it('[P0] workdir 子目录执行', async () => {
    const ws = await makeTempWorkspace({ 'sub/.keep': '' })
    cleanup = ws.cleanup
    const ctx = { cwd: ws.dir }

    const result = await terminalTool.execute({ command: 'pwd | tail -1', workdir: 'sub' }, ctx)
    expect(result).toContain('Exit code: 0')
    expect(result).toContain('sub')
  })

  it('[P0] 超大输出落盘后 read_file 可读', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup
    const ctx = { cwd: ws.dir }

    const result = await terminalTool.execute(
      { command: 'for i in $(seq 1 900); do echo spill_$i; done' },
      ctx
    )

    expect(result).toContain('Saved to:')
    expect(result).not.toContain('<untrusted_command_output')

    const saved = result.match(/Saved to: (.+)/)?.[1]?.trim()
    expect(saved).toBeTruthy()

    const readBack = await readFileTool.execute({ path: saved! }, { cwd: path.dirname(saved!) })
    expect(readBack).toContain('spill_900')
  }, 60_000)

  it('[P0] 越界 workdir 拒绝', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await terminalTool.execute(
      { command: 'echo x', workdir: '/etc' },
      { cwd: ws.dir }
    )
    expect(result).toContain('outside the workspace')
  })
})
