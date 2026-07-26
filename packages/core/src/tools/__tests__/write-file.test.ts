import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { writeFileTool } from '../write-file.js'
import type { ToolContext } from '../types.js'

let tmpDir: string
let ctx: ToolContext

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-write-test-'))
  ctx = { cwd: tmpDir }
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('write_file', () => {
  // ── 基础功能 ──────────────────────────────────────

  it('文件不存在时创建成功，回执标记 Created', async () => {
    const result = await writeFileTool.execute({ path: 'a.txt', content: 'hello' }, ctx)

    expect(result).toMatch(/^Created a\.txt/)
    const written = await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8')
    expect(written).toBe('hello')
  })

  it('文件已存在时覆盖成功，回执标记 Overwrote', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'old')

    const result = await writeFileTool.execute({ path: 'a.txt', content: 'new content' }, ctx)

    expect(result).toMatch(/^Overwrote a\.txt/)
    const written = await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8')
    expect(written).toBe('new content')
  })

  it('全量写入而非追加', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'AAAA')
    await writeFileTool.execute({ path: 'a.txt', content: 'B' }, ctx)

    const written = await fs.readFile(path.join(tmpDir, 'a.txt'), 'utf-8')
    expect(written).toBe('B')
  })

  it('父目录不存在时自动创建（mkdir -p）', async () => {
    const result = await writeFileTool.execute(
      { path: 'src/deep/nested/config.ts', content: 'export {}' },
      ctx
    )

    expect(result).toMatch(/^Created/)
    const written = await fs.readFile(path.join(tmpDir, 'src/deep/nested/config.ts'), 'utf-8')
    expect(written).toBe('export {}')
  })

  it('回执包含写入字节数（按 UTF-8 字节计）', async () => {
    // '中' 在 UTF-8 下占 3 字节
    const result = await writeFileTool.execute({ path: 'a.txt', content: '中' }, ctx)
    expect(result).toContain('(3 bytes written)')
  })

  it('能写出空文件', async () => {
    const result = await writeFileTool.execute({ path: 'empty.txt', content: '' }, ctx)
    expect(result).toMatch(/^Created empty\.txt/)
    expect(result).toContain('(0 bytes written)')
  })

  // ── 安全边界 ──────────────────────────────────────

  it('写 ../ 之外路径被拒绝，且不产生磁盘副作用', async () => {
    const result = await writeFileTool.execute(
      { path: '../escape.txt', content: 'x' },
      ctx
    )

    expect(result).toMatch(/Error:.*outside the workspace/)
    // 不应在上级目录写出文件
    await expect(fs.access(path.join(tmpDir, '..', 'escape.txt'))).rejects.toThrow()
  })

  it('写绝对路径逃逸被拒绝', async () => {
    const result = await writeFileTool.execute(
      { path: '/tmp/z2a-should-not-exist.txt', content: 'x' },
      ctx
    )
    expect(result).toMatch(/Error:.*outside the workspace/)
  })

  // ── 错误处理 ──────────────────────────────────────

  it('目标是已存在目录时报错', async () => {
    await fs.mkdir(path.join(tmpDir, 'somedir'))

    const result = await writeFileTool.execute({ path: 'somedir', content: 'x' }, ctx)
    expect(result).toMatch(/Error:.*is a directory/)
  })

  // ── 工具定义 ──────────────────────────────────────

  it('工具名称和 schema 正确', () => {
    expect(writeFileTool.name).toBe('write_file')
    expect(writeFileTool.input_schema.required).toEqual(['path', 'content'])
    expect(writeFileTool.input_schema.properties).toHaveProperty('path')
    expect(writeFileTool.input_schema.properties).toHaveProperty('content')
  })
})
