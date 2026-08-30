/**
 * 第二层 E2E：CLI 真实行为（调用真实 LLM）
 *
 * 这一层是 E2E 的重点：spawn 真实 CLI 进程 + 真实模型，验证完整任务闭环。
 * 断言对象是「磁盘上的最终事实」和「用户在终端看到的输出」，而不是 Agent
 * 返回的字符串——模型措辞不稳定，文件内容和工具调用轨迹才是可靠的断言对象。
 *
 * 会消耗 token，因此默认跳过。启用方式：
 *   E2E_LIVE=1 pnpm --filter @zero2agent/e2e test
 * 或在 .env.local 中写 E2E_LIVE=1
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  runCli,
  stripAnsi,
  makeTempWorkspace,
  isLiveEnabled,
  liveSkipReason,
} from './helpers/cli.js'

const live = isLiveEnabled()

if (!live) {
  // eslint-disable-next-line no-console
  console.log(`[e2e] 跳过真实 LLM 用例：${liveSkipReason()}`)
}

describe.skipIf(!live)('CLI 真实行为：读能力', () => {
  let cleanup: (() => Promise<void>) | undefined

  afterEach(async () => {
    await cleanup?.()
    cleanup = undefined
  })

  it('应能读取文件内容并在输出中体现', async () => {
    const ws = await makeTempWorkspace({
      'config.json': JSON.stringify({ appName: 'kettle-service', port: 8123 }, null, 2),
    })
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['读取 config.json，告诉我 appName 和 port 分别是什么'],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    // 断言模型确实拿到了文件里的事实，而非凭空作答
    expect(output).toContain('kettle-service')
    expect(output).toContain('8123')
    // 断言走了工具，而不是直接猜
    expect(output).toContain('read_file')
  })

  it('应能列目录并找到其中的文件', async () => {
    const ws = await makeTempWorkspace({
      'src/alpha.ts': 'export const a = 1;\n',
      'src/beta.ts': 'export const b = 2;\n',
      'README.md': '# demo\n',
    })
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['src 目录下有哪些文件？'],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('alpha.ts')
    expect(output).toContain('beta.ts')
  })

  it('应能按内容搜索并定位到正确的文件', async () => {
    const ws = await makeTempWorkspace({
      'a.ts': 'const timeout = 1;\n',
      'b.ts': 'const RETRY_BUDGET = 7;\n',
      'c.ts': 'const other = 3;\n',
    })
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['搜索哪个文件里定义了 RETRY_BUDGET'],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    expect(stripAnsi(result.output)).toContain('b.ts')
  })
})

describe.skipIf(!live)('CLI 真实行为：写能力闭环', () => {
  let cleanup: (() => Promise<void>) | undefined

  afterEach(async () => {
    await cleanup?.()
    cleanup = undefined
  })

  it('应能创建文件，且内容真实落到磁盘', async () => {
    const ws = await makeTempWorkspace()
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['创建一个文件 greeting.txt，内容就是一行 "hello zero2agent"'],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)

    // 关键断言：磁盘上的事实，而不是模型说它做了
    const content = await fs.readFile(path.join(ws.dir, 'greeting.txt'), 'utf8')
    expect(content).toContain('hello zero2agent')
  })

  it('应能就地修改文件，且保留未涉及的内容', async () => {
    const ws = await makeTempWorkspace({
      'version.ts': [
        "export const NAME = 'demo';",
        "export const VERSION = '1.0.0';",
        "export const AUTHOR = 'nobody';",
        '',
      ].join('\n'),
    })
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['把 version.ts 里的 VERSION 从 1.0.0 改成 2.5.0，其他不要动'],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)

    const content = await fs.readFile(path.join(ws.dir, 'version.ts'), 'utf8')
    expect(content).toContain('2.5.0')
    expect(content).not.toContain('1.0.0')
    // 未被要求改动的行必须原样保留
    expect(content).toContain("NAME = 'demo'")
    expect(content).toContain("AUTHOR = 'nobody'")
  })

  it('应能删除文件', async () => {
    const ws = await makeTempWorkspace({
      'keep.txt': 'keep me\n',
      'obsolete.txt': 'delete me\n',
    })
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['删除 obsolete.txt 这个文件'],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)

    await expect(fs.access(path.join(ws.dir, 'obsolete.txt'))).rejects.toThrow()
    // 不该波及其他文件
    await expect(fs.access(path.join(ws.dir, 'keep.txt'))).resolves.toBeUndefined()
  })
})

describe.skipIf(!live)('CLI 真实行为：多工具协同', () => {
  let cleanup: (() => Promise<void>) | undefined

  afterEach(async () => {
    await cleanup?.()
    cleanup = undefined
  })

  it('应能先搜索定位、再修改，完成跨工具的多轮任务', async () => {
    const ws = await makeTempWorkspace({
      'src/one.ts': 'export const x = 1;\n',
      'src/two.ts': 'export const LEGACY_FLAG = true;\n',
      'src/three.ts': 'export const z = 3;\n',
    })
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['找到定义 LEGACY_FLAG 的文件，把它的值从 true 改成 false'],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)

    const content = await fs.readFile(path.join(ws.dir, 'src/two.ts'), 'utf8')
    expect(content).toContain('LEGACY_FLAG = false')

    // 这个任务必须至少经历两类工具：先定位，再改写
    const output = stripAnsi(result.output)
    const usedSearch = /grep_search|find_files|list_directory|read_file/.test(output)
    const usedWrite = /replace_in_file|write_file/.test(output)
    expect(usedSearch).toBe(true)
    expect(usedWrite).toBe(true)
  })

  it('目标文件不存在时应如实说明，而不是伪造成功', async () => {
    const ws = await makeTempWorkspace({ 'only.txt': 'hi\n' })
    cleanup = ws.cleanup

    const result = await runCli({
      args: ['读取 does-not-exist.txt 的内容'],
      cwd: ws.dir,
    })

    expect(result.code).toBe(0)
    // 不要求具体措辞，只要求表达出「没有/不存在/失败」之一
    expect(stripAnsi(result.output)).toMatch(/不存在|没有找到|没有|无法|失败|not exist|Error/i)
  })
})

describe.skipIf(!live)('CLI 真实行为：交互模式', () => {
  let cleanup: (() => Promise<void>) | undefined

  afterEach(async () => {
    await cleanup?.()
    cleanup = undefined
  })

  it('交互模式下应能完成一轮真实任务', async () => {
    const ws = await makeTempWorkspace({ 'note.md': '# 待办\n- 写测试\n' })
    cleanup = ws.cleanup

    const result = await runCli({
      cwd: ws.dir,
      stdin: '读取 note.md 的内容\n',
    })

    expect(result.code).toBe(0)
    const output = stripAnsi(result.output)
    expect(output).toContain('你: ')
    expect(output).toContain('待办')
  })
})
