import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { deleteTool } from '../delete.js'
import type { ToolContext } from '../types.js'

let tmpDir: string
let ctx: ToolContext

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-delete-test-'))
  ctx = { cwd: tmpDir }
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function touch(rel: string): Promise<void> {
  const abs = path.join(tmpDir, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, 'x')
}

describe('delete', () => {
  // ── 基础功能 ──────────────────────────────────────

  it('删除单个存在的文件成功', async () => {
    await touch('a.txt')

    const result = await deleteTool.execute({ paths: ['a.txt'] }, ctx)

    expect(result).toBe('Deleted: a.txt')
    await expect(fs.access(path.join(tmpDir, 'a.txt'))).rejects.toThrow()
  })

  it('删除多个文件（数组）全部成功', async () => {
    await touch('a.txt')
    await touch('c.txt')

    const result = await deleteTool.execute({ paths: ['a.txt', 'c.txt'] }, ctx)

    expect(result).toBe('Deleted: a.txt, c.txt')
  })

  // ── 部分失败（方案 B）────────────────────────────

  it('部分失败时不中断，逐条汇总成功与失败', async () => {
    await touch('a.txt')
    await touch('c.txt')

    const result = await deleteTool.execute({ paths: ['a.txt', 'b.txt', 'c.txt'] }, ctx)

    // a、c 删成功，b 不存在
    expect(result).toContain('Deleted: a.txt, c.txt')
    expect(result).toContain('failed: b.txt (file not found)')
    // 不带 Error: 前缀（部分成功）
    expect(result).not.toMatch(/^Error:/)
  })

  it('删不存在的文件 → 标记为 file not found', async () => {
    await touch('a.txt')
    const result = await deleteTool.execute({ paths: ['a.txt', 'nope.txt'] }, ctx)
    expect(result).toContain('nope.txt (file not found)')
  })

  it('删目录 → 标记为失败（拒绝删目录）', async () => {
    await touch('a.txt')
    await fs.mkdir(path.join(tmpDir, 'somedir'))

    const result = await deleteTool.execute({ paths: ['a.txt', 'somedir'] }, ctx)

    expect(result).toContain('Deleted: a.txt')
    expect(result).toContain('somedir (is a directory')
    // 目录仍在
    await expect(fs.access(path.join(tmpDir, 'somedir'))).resolves.toBeUndefined()
  })

  it('全部失败时用 Error: 前缀', async () => {
    const result = await deleteTool.execute({ paths: ['x.txt', 'y.txt'] }, ctx)

    expect(result).toMatch(/^Error: Failed to delete:/)
    expect(result).toContain('x.txt (file not found)')
    expect(result).toContain('y.txt (file not found)')
  })

  // ── 安全边界 ──────────────────────────────────────

  it('数组中越界项被标记为失败，且不删除工作区外文件', async () => {
    await touch('a.txt')
    // 在上级目录放一个文件，确认不会被删
    const outside = path.join(tmpDir, '..', `z2a-outside-${path.basename(tmpDir)}.txt`)
    await fs.writeFile(outside, 'keep')

    const result = await deleteTool.execute(
      { paths: ['a.txt', `../${path.basename(outside)}`] },
      ctx
    )

    expect(result).toContain('Deleted: a.txt')
    expect(result).toContain('outside the workspace')
    // 工作区外的文件仍在
    await expect(fs.access(outside)).resolves.toBeUndefined()

    await fs.rm(outside, { force: true })
  })

  // ── 边界场景 ──────────────────────────────────────

  it('空数组返回提示而非报错', async () => {
    const result = await deleteTool.execute({ paths: [] }, ctx)
    expect(result).toBe('No files to delete')
  })

  it('同一路径重复出现：首次成功，后续标记 file not found', async () => {
    await touch('a.txt')
    const result = await deleteTool.execute({ paths: ['a.txt', 'a.txt'] }, ctx)

    expect(result).toContain('Deleted: a.txt')
    expect(result).toContain('a.txt (file not found)')
  })

  // ── 工具定义 ──────────────────────────────────────

  it('工具名称和 schema 正确', () => {
    expect(deleteTool.name).toBe('delete')
    expect(deleteTool.input_schema.required).toEqual(['paths'])
    expect(deleteTool.input_schema.properties).toHaveProperty('paths')
  })
})
