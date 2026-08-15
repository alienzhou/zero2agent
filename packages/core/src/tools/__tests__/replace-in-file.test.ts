import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { replaceInFileTool } from '../replace-in-file.js'
import type { ToolContext } from '../types.js'

let tmpDir: string
let ctx: ToolContext

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-replace-test-'))
  ctx = { cwd: tmpDir }
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('replace_in_file', () => {
  // ── 基础功能 ──────────────────────────────────────

  it('唯一匹配时替换成功，且只动那一处', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'const timeout = 30\nconst retries = 3\n')

    const result = await replaceInFileTool.execute(
      { path: 'a.txt', old_string: 'timeout = 30', new_string: 'timeout = 60' },
      ctx
    )

    expect(result).toContain('Replaced a.txt (1 occurrence)')
    const written = await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8')
    expect(written).toBe('const timeout = 60\nconst retries = 3\n')
  })

  it('替换后保留文件其余内容不变', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'line1\nline2\nline3\n')

    await replaceInFileTool.execute(
      { path: 'a.txt', old_string: 'line2', new_string: 'LINE2' },
      ctx
    )

    const written = await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8')
    expect(written).toBe('line1\nLINE2\nline3\n')
  })

  it('new_string 为空字符串时等价删除片段', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'keep\nremove me\nkeep\n')

    const result = await replaceInFileTool.execute(
      { path: 'a.txt', old_string: 'remove me\n', new_string: '' },
      ctx
    )

    expect(result).toContain('(1 occurrence)')
    const written = await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8')
    expect(written).toBe('keep\nkeep\n')
  })

  it('replace_all=true 替换所有匹配处并报告处数', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'foo bar foo baz foo\n')

    const result = await replaceInFileTool.execute(
      { path: 'a.txt', old_string: 'foo', new_string: 'qux', replace_all: true },
      ctx
    )

    expect(result).toContain('Replaced a.txt (3 occurrences)')
    const written = await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8')
    expect(written).toBe('qux bar qux baz qux\n')
  })

  // ── 匹配语义 ──────────────────────────────────────

  it('0 次匹配时返回 Match not found，且不写文件', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello\n')

    const result = await replaceInFileTool.execute(
      { path: 'a.txt', old_string: 'nonexistent', new_string: 'x' },
      ctx
    )

    expect(result).toContain('Error: Match not found')
    const written = await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8')
    expect(written).toBe('hello\n')
  })

  it('多匹配且默认时返回 Match not unique，不自动选第一个', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'x = 1\nx = 2\n')

    const result = await replaceInFileTool.execute(
      { path: 'a.txt', old_string: 'x =', new_string: 'y =' },
      ctx
    )

    expect(result).toContain('Error: Match not unique')
    expect(result).toContain('2 occurrences')
    const written = await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8')
    expect(written).toBe('x = 1\nx = 2\n')
  })

  it('replace_all=true 且 0 次匹配仍报错', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello\n')

    const result = await replaceInFileTool.execute(
      { path: 'a.txt', old_string: 'nope', new_string: 'x', replace_all: true },
      ctx
    )

    expect(result).toContain('Error: Match not found')
  })

  // ── 特殊字符（$ 等替换占位符） ──────────────────────

  it('new_string 含 $ 时按字面量写入，不被解释为替换占位符', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'price = 1\n')

    await replaceInFileTool.execute(
      { path: 'a.txt', old_string: 'price = 1', new_string: 'price = $5 && $&' },
      ctx
    )

    const written = await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8')
    expect(written).toBe('price = $5 && $&\n')
  })

  // ── 安全边界 ──────────────────────────────────────

  it('改 ../ 之外路径被拒绝，且不产生磁盘副作用', async () => {
    const result = await replaceInFileTool.execute(
      { path: '../escape.txt', old_string: 'a', new_string: 'b' },
      ctx
    )

    expect(result).toMatch(/Error:.*outside the workspace/)
    await expect(fs.access(path.join(tmpDir, '..', 'escape.txt'))).rejects.toThrow()
  })

  it('改绝对路径逃逸被拒绝', async () => {
    const result = await replaceInFileTool.execute(
      { path: '/etc/hosts', old_string: 'a', new_string: 'b' },
      ctx
    )
    expect(result).toMatch(/Error:.*outside the workspace/)
  })

  // ── 错误处理 ──────────────────────────────────────

  it('文件不存在时报 File not found', async () => {
    const result = await replaceInFileTool.execute(
      { path: 'missing.txt', old_string: 'a', new_string: 'b' },
      ctx
    )
    expect(result).toContain('Error: File not found')
  })

  it('目标是目录时报错', async () => {
    await fs.mkdir(path.join(tmpDir, 'somedir'))

    const result = await replaceInFileTool.execute(
      { path: 'somedir', old_string: 'a', new_string: 'b' },
      ctx
    )
    expect(result).toContain('Error:')
    expect(result).toContain('is a directory')
  })

  it('old_string 为空时报错', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello\n')

    const result = await replaceInFileTool.execute(
      { path: 'a.txt', old_string: '', new_string: 'x' },
      ctx
    )
    expect(result).toContain('Error: old_string must not be empty')
  })

  // ── 工具定义 ──────────────────────────────────────

  it('工具名称和 schema 正确', () => {
    expect(replaceInFileTool.name).toBe('replace_in_file')
    expect(replaceInFileTool.input_schema.required).toEqual(['path', 'old_string', 'new_string'])
    expect(replaceInFileTool.input_schema.properties).toHaveProperty('path')
    expect(replaceInFileTool.input_schema.properties).toHaveProperty('old_string')
    expect(replaceInFileTool.input_schema.properties).toHaveProperty('new_string')
    expect(replaceInFileTool.input_schema.properties).toHaveProperty('replace_all')
  })
})
