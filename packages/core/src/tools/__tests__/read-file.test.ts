import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { readFileTool } from '../read-file.js'
import type { ToolContext } from '../types.js'

let tmpDir: string
let ctx: ToolContext

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-test-'))
  ctx = { cwd: tmpDir }

  await fs.writeFile(
    path.join(tmpDir, 'hello.txt'),
    'line1\nline2\nline3\nline4\nline5'
  )
  await fs.writeFile(path.join(tmpDir, 'empty.txt'), '')
  await fs.mkdir(path.join(tmpDir, 'subdir'))
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('read_file', () => {
  it('读取完整文件内容，带行号前缀', async () => {
    const result = await readFileTool.execute({ path: 'hello.txt' }, ctx)
    expect(result).toContain('001|line1')
    expect(result).toContain('005|line5')
    expect(result.split('\n')).toHaveLength(5)
  })

  it('支持 start_line / end_line 范围读取', async () => {
    const result = await readFileTool.execute({
      path: 'hello.txt',
      start_line: 2,
      end_line: 4,
    }, ctx)
    const lines = result.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('002|line2')
    expect(lines[2]).toBe('004|line4')
  })

  it('只指定 start_line 时读取到文件末尾', async () => {
    const result = await readFileTool.execute({
      path: 'hello.txt',
      start_line: 4,
    }, ctx)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('004|line4')
  })

  it('只指定 end_line 时从文件开头读取', async () => {
    const result = await readFileTool.execute({
      path: 'hello.txt',
      end_line: 2,
    }, ctx)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('001|line1')
  })

  it('文件不存在时返回错误信息', async () => {
    const result = await readFileTool.execute({ path: 'nonexistent.txt' }, ctx)
    expect(result).toMatch(/Error:.*not found/i)
  })

  it('路径是目录时返回错误信息', async () => {
    const result = await readFileTool.execute({ path: 'subdir' }, ctx)
    expect(result).toMatch(/Error:.*Not a file/i)
  })

  it('空文件返回空行号内容', async () => {
    const result = await readFileTool.execute({ path: 'empty.txt' }, ctx)
    expect(result).toBe('001|')
  })
})
