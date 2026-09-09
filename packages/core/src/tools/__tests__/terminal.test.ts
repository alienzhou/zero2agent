import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  terminalTool,
  resolveWorkdir,
  wrapCommand,
  formatReceipt,
  OutputSink,
} from '../terminal.js'
import { clearProcessRegistryForTests } from '../process-registry.js'
import { resetTerminalRuntimeHooksForTests, setTerminalRuntimeHooks } from '../terminal-runtime.js'
import type { ToolContext } from '../types.js'

let tmpDir: string
let ctx: ToolContext

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-terminal-test-'))
  ctx = { cwd: tmpDir }
  clearProcessRegistryForTests()
  resetTerminalRuntimeHooksForTests()
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('resolveWorkdir', () => {
  it('省略 workdir 时使用 ctx.cwd（realpath）', async () => {
    const { path: p } = await resolveWorkdir(ctx)
    expect(p).toBe(await fs.realpath(tmpDir))
  })

  it('子目录合法', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'))
    const { path: p } = await resolveWorkdir(ctx, 'src')
    expect(p).toBe(await fs.realpath(path.join(tmpDir, 'src')))
  })

  it('"." 合法（与 resolveInsideCwd 不同）', async () => {
    const { path: p } = await resolveWorkdir(ctx, '.')
    expect(p).toBe(await fs.realpath(tmpDir))
  })

  it('越界 workdir 拒绝', async () => {
    const result = await resolveWorkdir(ctx, '../outside')
    expect(result).toEqual({
      error: 'Error: ../outside is outside the workspace, operation refused',
    })
  })
})

describe('terminal', () => {
  it('echo hello 返回 Exit code: 0 且输出在隔离标签内', async () => {
    const result = await terminalTool.execute({ command: 'echo hello' }, ctx)

    expect(result).toContain('Exit code: 0')
    expect(result).toContain('<untrusted_command_output id="')
    expect(result).toContain('hello')
    expect(result).not.toMatch(/^Error:/)
  })

  it('exit 1 是普通回执不是 Error', async () => {
    const result = await terminalTool.execute({ command: 'exit 1' }, ctx)
    expect(result).toContain('Exit code: 1')
    expect(result.startsWith('Error:')).toBe(false)
  })

  it('stderr 合流', async () => {
    const result = await terminalTool.execute({ command: 'echo err_msg >&2' }, ctx)
    expect(result).toContain('err_msg')
  })

  it('空命令返回 Error', async () => {
    expect(await terminalTool.execute({ command: '' }, ctx)).toBe(
      'Error: command must not be empty'
    )
  })

  it('workdir 生效', async () => {
    await fs.mkdir(path.join(tmpDir, 'subdir'))
    const result = await terminalTool.execute({ command: 'pwd', workdir: 'subdir' }, ctx)
    expect(result).toContain('Exit code: 0')
    expect(result).toContain('subdir')
  })

  it('中文/emoji 跨 chunk 不乱码', async () => {
    const result = await terminalTool.execute(
      { command: 'node -e "process.stdout.write(\'😀\'.repeat(100))"' },
      ctx
    )
    expect(result).not.toContain('\uFFFD')
    expect(result).toContain('😀')
  })

  it('nonce 每次不同', async () => {
    const r1 = await terminalTool.execute({ command: 'echo a' }, ctx)
    const r2 = await terminalTool.execute({ command: 'echo b' }, ctx)
    const id1 = r1.match(/id="([a-f0-9]+)"/)?.[1]
    const id2 = r2.match(/id="([a-f0-9]+)"/)?.[1]
    expect(id1).toBeTruthy()
    expect(id2).toBeTruthy()
    expect(id1).not.toBe(id2)
  })

  it('超大输出越界后回执不含正文，含 Saved to', async () => {
    const result = await terminalTool.execute(
      { command: 'for i in $(seq 1 900); do echo line_$i; done' },
      ctx
    )

    expect(result).toContain('Total:')
    expect(result).toContain('Saved to:')
    expect(result).not.toContain('line_1')
    expect(result).not.toContain('<untrusted_command_output')
  }, 30_000)

  it('取消时终止长时命令', async () => {
    const marker = `z2a_cancel_${Date.now()}`
    setTerminalRuntimeHooks({
      isTTY: true,
      attachInterrupts: controller => {
        setTimeout(() => controller.signalCancel(), 300)
        return () => {}
      },
    })

    const result = await terminalTool.execute({ command: `sleep 30 # ${marker}` }, ctx)
    expect(result).toContain('Status: cancelled by user')
  }, 20_000)
})

describe('OutputSink', () => {
  it('越界后清空内存 bufs', () => {
    const sink = new OutputSink()
    const big = Buffer.from('x'.repeat(21 * 1024))
    sink.append(big)
    expect(sink.spilled).toBe(true)
    expect(sink.getBodyText()).toBe('')
  })
})

describe('wrapCommand', () => {
  it('包含用户命令原文', () => {
    expect(wrapCommand('echo hi')).toContain('echo hi')
  })
})

describe('formatReceipt', () => {
  it('取消未越界时给正文', () => {
    const sink = new OutputSink()
    sink.append(Buffer.from('error detail\n'))
    const receipt = formatReceipt(
      {
        outcome: 'cancelled',
        wallTimeMs: 6000,
        sink,
        pid: 1,
        command: 'false',
      },
      false,
      []
    )
    expect(receipt).toContain('Status: cancelled by user')
    expect(receipt).toContain('error detail')
  })
})
