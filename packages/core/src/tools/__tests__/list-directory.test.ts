import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { listDirectoryTool } from '../list-directory.js'

const execute = listDirectoryTool.execute

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-test-'))

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
    const result = await execute({ path: tmpDir })
    const lines = result.split('\n')

    expect(lines[0]).toMatch(/\[dir\]/)
    expect(lines[0]).toContain('src/')

    const fileLines = lines.filter((l: string) => l.includes('[file]'))
    expect(fileLines.length).toBe(2)
  })

  it('recursive 模式递归列出子目录', async () => {
    const result = await execute({ path: tmpDir, recursive: true })
    expect(result).toContain('[dir]')
    expect(result).toContain('index.ts')
    expect(result).toContain('README.md')
  })

  it('recursive 模式子目录条目有缩进', async () => {
    const result = await execute({ path: tmpDir, recursive: true })
    const lines = result.split('\n')
    const indentedLine = lines.find((l: string) => l.startsWith('  '))
    expect(indentedLine).toBeDefined()
    expect(indentedLine).toContain('index.ts')
  })

  it('目录不存在时返回错误信息', async () => {
    const result = await execute({ path: path.join(tmpDir, 'nope') })
    expect(result).toMatch(/Error:.*not found/i)
  })

  it('路径是文件时返回错误信息', async () => {
    const result = await execute({ path: path.join(tmpDir, 'README.md') })
    expect(result).toMatch(/Error:.*Not a directory/i)
  })

  it('空目录返回空字符串', async () => {
    const emptyDir = path.join(tmpDir, 'empty-dir')
    await fs.mkdir(emptyDir)
    const result = await execute({ path: emptyDir })
    expect(result).toBe('')
  })
})
