import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { listDirectoryTool } from '../list-directory.js'
import type { ToolContext } from '../types.js'

let tmpDir: string
let ctx: ToolContext

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-test-'))
  ctx = { cwd: tmpDir }

  await fs.mkdir(path.join(tmpDir, 'src'))
  await fs.writeFile(path.join(tmpDir, 'src', 'index.ts'), '')
  await fs.writeFile(path.join(tmpDir, 'README.md'), '')
  await fs.writeFile(path.join(tmpDir, 'package.json'), '{}')
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('list_directory', () => {
  it('列出目录内容，目录排在文件前面', async () => {
    const result = await listDirectoryTool.execute({ path: '.' }, ctx)
    const lines = result.split('\n')

    expect(lines[0]).toMatch(/\[dir\]/)
    expect(lines[0]).toContain('src/')

    const fileLines = lines.filter((l: string) => l.includes('[file]'))
    expect(fileLines.length).toBe(2)
  })

  it('recursive 模式递归列出子目录', async () => {
    const result = await listDirectoryTool.execute({ path: '.', recursive: true }, ctx)
    expect(result).toContain('[dir]')
    expect(result).toContain('index.ts')
    expect(result).toContain('README.md')
  })

  it('recursive 模式输出相对路径而非绝对路径', async () => {
    const result = await listDirectoryTool.execute({ path: '.', recursive: true }, ctx)
    // 不应包含临时目录的绝对路径前缀
    expect(result).not.toContain(tmpDir)
    // 应包含相对路径格式（与用户传入路径一致）
    expect(result).toContain('src/')
    expect(result).toContain('src/index.ts')
  })

  it('recursive 模式子目录条目有缩进', async () => {
    const result = await listDirectoryTool.execute({ path: '.', recursive: true }, ctx)
    const lines = result.split('\n')
    const indentedLine = lines.find((l: string) => l.startsWith('  '))
    expect(indentedLine).toBeDefined()
    expect(indentedLine).toContain('index.ts')
  })

  it('目录不存在时返回错误信息', async () => {
    const result = await listDirectoryTool.execute({ path: 'nope' }, ctx)
    expect(result).toMatch(/Error:.*not found/i)
  })

  it('路径是文件时返回错误信息', async () => {
    const result = await listDirectoryTool.execute({ path: 'README.md' }, ctx)
    expect(result).toMatch(/Error:.*Not a directory/i)
  })

  it('空目录返回空字符串', async () => {
    const emptyDir = path.join(tmpDir, 'empty-dir')
    await fs.mkdir(emptyDir)
    const result = await listDirectoryTool.execute({ path: 'empty-dir' }, ctx)
    expect(result).toBe('')
  })
})
