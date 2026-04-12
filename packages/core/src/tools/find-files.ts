import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import type { Tool, ToolContext } from './types.js'
import { Buffer } from 'node:buffer'

// ── 常量 ──────────────────────────────────────────────

const MAX_FILES = 100

// ── 内部类型 ─────────────────────────────────────────

interface FindFilesInput {
  pattern: string
  path?: string
  exclude?: string
}

interface FileEntry {
  filePath: string
  mtimeMs: number
}

// ── ripgrep 调用 ────────────────────────────────────

function buildRgArgs(input: FindFilesInput, searchPath: string): string[] {
  const args = [
    '--files',
    '--hidden',
    '--no-messages',
    '--glob', input.pattern,
  ]

  if (input.exclude) args.push('--glob', `!${input.exclude}`)

  args.push(searchPath)
  return args
}

function runRipgrep(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(rgPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    proc.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        exitCode: code ?? 1,
      })
    })
  })
}

// ── 按修改时间排序 ──────────────────────────────────

async function getFilesWithMtime(filePaths: string[]): Promise<FileEntry[]> {
  const entries: FileEntry[] = []

  await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        const stat = await fs.stat(filePath)
        entries.push({ filePath, mtimeMs: stat.mtimeMs })
      } catch {
        // 文件不存在或无权限，跳过
        entries.push({ filePath, mtimeMs: 0 })
      }
    })
  )

  return entries
}

function sortByMtime(entries: FileEntry[]): FileEntry[] {
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

// ── 格式化输出 ──────────────────────────────────────

function formatOutput(
  entries: FileEntry[],
  totalCount: number,
  pattern: string,
  truncated: boolean,
  basePath: string
): string {
  if (entries.length === 0) {
    return `No files found matching "${pattern}"`
  }

  const header = `Found ${truncated ? `${MAX_FILES}+` : totalCount} files matching "${pattern}"`
  const parts: string[] = [header]

  for (const entry of entries) {
    // 输出相对路径（POSIX 格式）
    const relativePath = path.relative(basePath, entry.filePath).split(path.sep).join('/')
    parts.push(relativePath)
  }

  if (truncated) {
    parts.push(`... and ${totalCount - MAX_FILES} more files`)
  }

  return parts.join('\n')
}

// ── 工具定义 ────────────────────────────────────────

export const findFilesTool: Tool = {
  name: 'find_files',
  description:
    `Search for files by glob pattern. Returns file paths sorted by modification time (newest first). Results are truncated to ${MAX_FILES} files. Respects .gitignore rules. Use this to find files by name; use grep_search to find files by content.`,
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match file paths, e.g. "**/*.ts", "src/**/test_*.js", "*.config.{js,ts}"',
      },
      path: {
        type: 'string',
        description: 'Directory to search in (relative path, defaults to project root)',
      },
      exclude: {
        type: 'string',
        description: 'Glob pattern to exclude, e.g. "node_modules", "dist"',
      },
    },
    required: ['pattern'],
  },

  execute: async (input: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
    const params = input as unknown as FindFilesInput
    const searchPath = path.resolve(ctx.cwd, params.path || '.')

    // 验证搜索路径是否存在
    try {
      await fs.access(searchPath)
    } catch {
      return `Error: Search path not found: ${params.path || '.'}`
    }

    // 构造参数并调用 ripgrep
    const args = buildRgArgs(params, searchPath)
    const { stdout, stderr, exitCode } = await runRipgrep(args)

    // exitCode 1 = 无匹配，exitCode 2 = 错误
    if (exitCode === 2) {
      const errorMsg = stderr.trim() || 'Unknown ripgrep error'
      if (errorMsg.includes('glob')) {
        return `Error: Invalid glob pattern "${params.pattern}": ${errorMsg}`
      }
      return `Error: Search failed: ${errorMsg}`
    }

    if (exitCode === 1 || !stdout.trim()) {
      return `No files found matching "${params.pattern}"`
    }

    // 解析文件路径（每行一个）
    const filePaths = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (filePaths.length === 0) {
      return `No files found matching "${params.pattern}"`
    }

    // 获取 mtime 并排序
    const entries = await getFilesWithMtime(filePaths)
    const sortedEntries = sortByMtime(entries)

    // 截断
    const totalCount = sortedEntries.length
    const truncated = totalCount > MAX_FILES
    const truncatedEntries = sortedEntries.slice(0, MAX_FILES)

    // 基于 ctx.cwd 计算相对路径
    return formatOutput(truncatedEntries, totalCount, params.pattern, truncated, ctx.cwd)
  },
}
