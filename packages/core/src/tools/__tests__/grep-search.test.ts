import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { grepSearchTool } from '../grep-search.js'

const execute = grepSearchTool.execute

let tmpDir: string
let originalCwd: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-grep-test-'))
  originalCwd = process.cwd()
  process.chdir(tmpDir)

  // 构造测试文件结构
  await fs.mkdir(path.join(tmpDir, 'src'))
  await fs.mkdir(path.join(tmpDir, 'src', 'utils'))
  await fs.mkdir(path.join(tmpDir, 'tests'))

  await fs.writeFile(
    path.join(tmpDir, 'src', 'index.ts'),
    [
      'import { helper } from "./utils/helper.js"',
      'import { format } from "./utils/format.js"',
      '',
      'export function main() {',
      '  const result = helper()',
      '  return format(result)',
      '}',
    ].join('\n')
  )

  await fs.writeFile(
    path.join(tmpDir, 'src', 'utils', 'helper.ts'),
    [
      'export function helper() {',
      '  return { value: 42 }',
      '}',
      '',
      'export function unused() {',
      '  return null',
      '}',
    ].join('\n')
  )

  await fs.writeFile(
    path.join(tmpDir, 'src', 'utils', 'format.ts'),
    [
      'export function format(data: unknown) {',
      '  return JSON.stringify(data)',
      '}',
    ].join('\n')
  )

  await fs.writeFile(
    path.join(tmpDir, 'tests', 'helper.test.ts'),
    [
      'import { helper } from "../src/utils/helper.js"',
      '',
      'test("helper returns 42", () => {',
      '  expect(helper().value).toBe(42)',
      '})',
    ].join('\n')
  )

  await fs.writeFile(
    path.join(tmpDir, 'README.md'),
    '# Test Project\n\nThis is a test project.\n'
  )

  // 用 utimes 设定修改时间，确保排序可预测
  const now = Date.now()
  await fs.utimes(path.join(tmpDir, 'src', 'index.ts'), now / 1000, now / 1000)
  await fs.utimes(path.join(tmpDir, 'src', 'utils', 'helper.ts'), (now - 2000) / 1000, (now - 2000) / 1000)
  await fs.utimes(path.join(tmpDir, 'src', 'utils', 'format.ts'), (now - 4000) / 1000, (now - 4000) / 1000)
  await fs.utimes(path.join(tmpDir, 'tests', 'helper.test.ts'), (now - 6000) / 1000, (now - 6000) / 1000)
})

afterAll(async () => {
  process.chdir(originalCwd)
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('grep_search', () => {
  // ── 基本搜索 ──────────────────────────────────────

  it('搜索到匹配内容，返回 Gemini CLI 风格输出', async () => {
    const result = await execute({ pattern: 'helper' })

    expect(result).toMatch(/^Found \d+ matches for "helper" in \d+ files/)
    expect(result).toContain('File:')
    expect(result).toContain('---')
    expect(result).toMatch(/L\d+:/)
  })

  it('搜索结果包含正确的行内容', async () => {
    const result = await execute({ pattern: 'export function main' })

    expect(result).toContain('Found 1 matches for "export function main" in 1 files')
    expect(result).toContain('index.ts')
    expect(result).toMatch(/L4: export function main\(\)/)
  })

  it('跨多个文件搜索', async () => {
    const result = await execute({ pattern: 'export function' })

    expect(result).toContain('index.ts')
    expect(result).toContain('helper.ts')
    expect(result).toContain('format.ts')
  })

  // ── 参数功能 ──────────────────────────────────────

  it('path 参数限制搜索范围', async () => {
    const result = await execute({ pattern: 'helper', path: 'src/utils' })

    expect(result).toContain('helper.ts')
    expect(result).not.toContain('index.ts')
    expect(result).not.toContain('helper.test.ts')
  })

  it('include 参数过滤文件类型', async () => {
    const result = await execute({ pattern: 'helper', include: '*.test.ts' })

    expect(result).toContain('helper.test.ts')
    expect(result).not.toContain('index.ts')
  })

  it('exclude 参数排除文件', async () => {
    const result = await execute({ pattern: 'helper', exclude: '*.test.ts' })

    expect(result).not.toContain('helper.test.ts')
    expect(result).toContain('helper.ts')
  })

  it('context 参数显示上下文行', async () => {
    const result = await execute({ pattern: 'export function main', context: 1 })

    // 匹配行用 ':'，上下文行用 '-'
    expect(result).toMatch(/L4: export function main/)
    expect(result).toMatch(/L\d+-/)
  })

  it('context 为 0 时不显示上下文行', async () => {
    const result = await execute({ pattern: 'export function main', context: 0 })

    expect(result).not.toMatch(/L\d+-/)
  })

  // ── 排序 ──────────────────────────────────────────

  it('结果按文件修改时间降序排列', async () => {
    const result = await execute({ pattern: 'helper', path: 'src' })

    // index.ts 修改时间最新，应排第一
    const indexPos = result.indexOf('index.ts')
    const helperPos = result.indexOf('helper.ts')
    expect(indexPos).toBeLessThan(helperPos)
  })

  // ── 输出格式 ──────────────────────────────────────

  it('输出使用相对路径', async () => {
    const result = await execute({ pattern: 'export function main' })

    // 不应包含临时目录的绝对路径前缀
    expect(result).not.toContain(tmpDir)
    expect(result).toContain('src/index.ts')
  })

  it('文件块之间用 --- 分隔', async () => {
    const result = await execute({ pattern: 'export function' })
    const separators = result.split('\n').filter((l: string) => l === '---')
    // 每个文件块前有一个 ---
    expect(separators.length).toBeGreaterThanOrEqual(3)
  })

  // ── 正则支持 ──────────────────────────────────────

  it('支持正则表达式搜索', async () => {
    const result = await execute({ pattern: 'function\\s+\\w+\\(' })

    expect(result).toContain('function main(')
    expect(result).toContain('function helper(')
  })

  // ── 错误处理 ──────────────────────────────────────

  it('搜索路径不存在时返回错误', async () => {
    const result = await execute({ pattern: 'test', path: 'nonexistent/dir' })
    expect(result).toMatch(/Error:.*not found/i)
  })

  it('无匹配结果时返回提示', async () => {
    const result = await execute({ pattern: 'xyznonexistent12345' })
    expect(result).toBe('No matches found.')
  })

  it('无效正则返回友好错误', async () => {
    const result = await execute({ pattern: '[invalid' })
    expect(result).toMatch(/Error:.*regex/i)
  })

  // ── 工具定义 ──────────────────────────────────────

  it('工具名称和 schema 正确', () => {
    expect(grepSearchTool.name).toBe('grep_search')
    expect(grepSearchTool.input_schema.required).toEqual(['pattern'])
    expect(grepSearchTool.input_schema.properties).toHaveProperty('pattern')
    expect(grepSearchTool.input_schema.properties).toHaveProperty('path')
    expect(grepSearchTool.input_schema.properties).toHaveProperty('include')
    expect(grepSearchTool.input_schema.properties).toHaveProperty('exclude')
    expect(grepSearchTool.input_schema.properties).toHaveProperty('context')
  })

  it('工具描述包含截断上限', () => {
    expect(grepSearchTool.description).toContain('100')
  })
})
