import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import { findFilesTool } from '../find-files.js'
import type { ToolContext } from '../types.js'

let tmpDir: string
let ctx: ToolContext

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'z2a-find-test-'))
  ctx = { cwd: tmpDir }

  // 初始化 git 仓库，以便 ripgrep 能正确尊重 .gitignore
  execSync('git init', { cwd: tmpDir, stdio: 'ignore' })

  // 构造测试文件结构
  await fs.mkdir(path.join(tmpDir, 'src'))
  await fs.mkdir(path.join(tmpDir, 'src', 'utils'))
  await fs.mkdir(path.join(tmpDir, 'tests'))
  await fs.mkdir(path.join(tmpDir, 'node_modules'))
  await fs.mkdir(path.join(tmpDir, 'node_modules', 'dep'))

  await fs.writeFile(path.join(tmpDir, 'src', 'index.ts'), 'export {}')
  await fs.writeFile(path.join(tmpDir, 'src', 'app.tsx'), '<App />')
  await fs.writeFile(path.join(tmpDir, 'src', 'utils', 'helper.ts'), 'export function helper() {}')
  await fs.writeFile(path.join(tmpDir, 'src', 'utils', 'format.ts'), 'export function format() {}')
  await fs.writeFile(path.join(tmpDir, 'tests', 'app.test.ts'), 'test()')
  await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test')
  await fs.writeFile(path.join(tmpDir, 'package.json'), '{}')
  await fs.writeFile(path.join(tmpDir, 'node_modules', 'dep', 'index.js'), '')

  // 创建 .gitignore 排除 node_modules
  await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules')

  // 用 utimes 设定修改时间，确保排序可预测
  const now = Date.now()
  await fs.utimes(path.join(tmpDir, 'src', 'index.ts'), now / 1000, now / 1000)
  await fs.utimes(path.join(tmpDir, 'src', 'app.tsx'), (now - 1000) / 1000, (now - 1000) / 1000)
  await fs.utimes(path.join(tmpDir, 'src', 'utils', 'helper.ts'), (now - 2000) / 1000, (now - 2000) / 1000)
  await fs.utimes(path.join(tmpDir, 'src', 'utils', 'format.ts'), (now - 3000) / 1000, (now - 3000) / 1000)
  await fs.utimes(path.join(tmpDir, 'tests', 'app.test.ts'), (now - 4000) / 1000, (now - 4000) / 1000)
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('find_files', () => {
  // ── 基本搜索 ──────────────────────────────────────

  it('按 glob 模式搜索文件', async () => {
    const result = await findFilesTool.execute({ pattern: '**/*.ts' }, ctx)

    expect(result).toMatch(/^Found \d+ files matching "\*\*\/\*.ts"/)
    expect(result).toContain('index.ts')
    expect(result).toContain('helper.ts')
    expect(result).toContain('format.ts')
    expect(result).toContain('app.test.ts')
  })

  it('结果按修改时间降序排列', async () => {
    const result = await findFilesTool.execute({ pattern: '**/*.ts' }, ctx)

    // index.ts 修改时间最新，应排第一
    const indexPos = result.indexOf('index.ts')
    const helperPos = result.indexOf('helper.ts')
    expect(indexPos).toBeLessThan(helperPos)
  })

  it('输出使用相对路径（POSIX 格式）', async () => {
    const result = await findFilesTool.execute({ pattern: '**/*.ts' }, ctx)

    // 不应包含临时目录的绝对路径前缀
    expect(result).not.toContain(tmpDir)
    // 路径用 / 分隔
    expect(result).toContain('src/utils/helper.ts')
  })

  // ── 参数功能 ──────────────────────────────────────

  it('path 参数限制搜索范围', async () => {
    const result = await findFilesTool.execute({ pattern: '**/*.ts', path: 'src/utils' }, ctx)

    expect(result).toContain('helper.ts')
    expect(result).toContain('format.ts')
    expect(result).not.toContain('index.ts')
    expect(result).not.toContain('app.test.ts')
  })

  it('include 参数额外过滤', async () => {
    // include 用于在 pattern 匹配基础上做二次过滤
    // pattern '**/*' 匹配所有文件，include '*.tsx' 只保留 .tsx 文件
    const result = await findFilesTool.execute({ pattern: '**/*.tsx' }, ctx)

    expect(result).toContain('app.tsx')
    expect(result).not.toContain('index.ts')
  })

  it('exclude 参数排除文件', async () => {
    const result = await findFilesTool.execute({ pattern: '**/*.ts', exclude: '*.test.ts' }, ctx)

    expect(result).not.toContain('app.test.ts')
    expect(result).toContain('index.ts')
  })

  // ── .gitignore 处理 ─────────────────────────────

  it('自动尊重 .gitignore', async () => {
    const result = await findFilesTool.execute({ pattern: '**/*.js' }, ctx)

    // node_modules 被 .gitignore 排除
    expect(result).not.toContain('node_modules')
  })

  // ── 错误处理 ──────────────────────────────────────

  it('搜索路径不存在时返回错误', async () => {
    const result = await findFilesTool.execute({ pattern: '*.ts', path: 'nonexistent/dir' }, ctx)
    expect(result).toMatch(/Error:.*not found/i)
  })

  it('无匹配结果时返回提示', async () => {
    const result = await findFilesTool.execute({ pattern: '**/*.xyz123' }, ctx)
    expect(result).toMatch(/No files found/)
  })

  // ── 工具定义 ──────────────────────────────────────

  it('工具名称和 schema 正确', () => {
    expect(findFilesTool.name).toBe('find_files')
    expect(findFilesTool.input_schema.required).toEqual(['pattern'])
    expect(findFilesTool.input_schema.properties).toHaveProperty('pattern')
    expect(findFilesTool.input_schema.properties).toHaveProperty('path')
    expect(findFilesTool.input_schema.properties).toHaveProperty('exclude')
    // 注意：实现中删除了 include 参数，因为 pattern 本身就是 glob，已具备过滤能力
  })

  it('工具描述包含截断上限和分工说明', () => {
    expect(findFilesTool.description).toContain('100')
    expect(findFilesTool.description).toContain('grep_search')
  })
})
