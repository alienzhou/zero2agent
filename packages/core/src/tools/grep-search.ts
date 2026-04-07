import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import type { Tool, ToolContext } from './types.js'

// ── 常量 ──────────────────────────────────────────────

const MAX_MATCHES = 100

// ── ripgrep JSON Lines 类型 ──────────────────────────

interface RgMatchData {
  path: { text: string }
  lines: { text: string }
  line_number: number
  submatches: unknown[]
}

interface RgContextData {
  path: { text: string }
  lines: { text: string }
  line_number: number
}

type RgMessage =
  | { type: 'match'; data: RgMatchData }
  | { type: 'context'; data: RgContextData }
  | { type: 'begin' | 'end' | 'summary'; data: unknown }

// ── 内部类型 ─────────────────────────────────────────

interface MatchLine {
  filePath: string
  lineNumber: number
  content: string
  isContext: boolean
}

interface GrepSearchInput {
  pattern: string
  path?: string
  include?: string
  exclude?: string
  context?: number
}

// ── ripgrep 调用 ────────────────────────────────────

function buildRgArgs(input: GrepSearchInput, searchPath: string): string[] {
  const args = [
    '--json',
    '--line-number',
    '--color=never',
    '--hidden',
    '--no-messages',
  ]

  if (input.include) args.push('--glob', input.include)
  if (input.exclude) args.push('--glob', `!${input.exclude}`)
  if (input.context && input.context > 0) args.push('--context', String(input.context))

  args.push('--regexp', input.pattern, searchPath)
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

// ── JSON Lines 解析 ─────────────────────────────────

function parseRgOutput(stdout: string): MatchLine[] {
  const lines: MatchLine[] = []

  for (const rawLine of stdout.split('\n')) {
    if (!rawLine.trim()) continue

    let msg: RgMessage
    try {
      msg = JSON.parse(rawLine) as RgMessage
    } catch {
      continue
    }

    if (msg.type === 'match') {
      lines.push({
        filePath: msg.data.path.text,
        lineNumber: msg.data.line_number,
        content: msg.data.lines.text.replace(/\n$/, ''),
        isContext: false,
      })
    } else if (msg.type === 'context') {
      lines.push({
        filePath: msg.data.path.text,
        lineNumber: msg.data.line_number,
        content: msg.data.lines.text.replace(/\n$/, ''),
        isContext: true,
      })
    }
  }

  return lines
}

// ── 按文件分组 ──────────────────────────────────────

interface FileGroup {
  filePath: string
  lines: MatchLine[]
  matchCount: number
}

function groupByFile(lines: MatchLine[]): FileGroup[] {
  const map = new Map<string, MatchLine[]>()

  for (const line of lines) {
    const existing = map.get(line.filePath)
    if (existing) {
      existing.push(line)
    } else {
      map.set(line.filePath, [line])
    }
  }

  const groups: FileGroup[] = []
  for (const [filePath, fileLines] of map) {
    groups.push({
      filePath,
      lines: fileLines,
      matchCount: fileLines.filter((l) => !l.isContext).length,
    })
  }

  return groups
}

// ── 按修改时间排序 ──────────────────────────────────

async function sortByMtime(groups: FileGroup[]): Promise<void> {
  const mtimeMap = new Map<string, number>()

  await Promise.all(
    groups.map(async (g) => {
      try {
        const stat = await fs.stat(g.filePath)
        mtimeMap.set(g.filePath, stat.mtimeMs)
      } catch {
        mtimeMap.set(g.filePath, 0)
      }
    })
  )

  groups.sort((a, b) => (mtimeMap.get(b.filePath) ?? 0) - (mtimeMap.get(a.filePath) ?? 0))
}

// ── 截断 ────────────────────────────────────────────

function truncateMatches(groups: FileGroup[]): { groups: FileGroup[]; totalMatches: number; truncated: boolean } {
  let totalMatches = 0
  for (const g of groups) {
    totalMatches += g.matchCount
  }

  if (totalMatches <= MAX_MATCHES) {
    return { groups, totalMatches, truncated: false }
  }

  // 按文件顺序保留前 MAX_MATCHES 条匹配
  const result: FileGroup[] = []
  let remaining = MAX_MATCHES

  for (const g of groups) {
    if (remaining <= 0) break

    if (g.matchCount <= remaining) {
      result.push(g)
      remaining -= g.matchCount
    } else {
      // 部分保留：只取前 remaining 条匹配及其上下文
      const keptLines: MatchLine[] = []
      let keptMatches = 0
      for (const line of g.lines) {
        if (!line.isContext) {
          if (keptMatches >= remaining) break
          keptMatches++
        }
        keptLines.push(line)
      }
      result.push({ filePath: g.filePath, lines: keptLines, matchCount: keptMatches })
      remaining = 0
    }
  }

  return { groups: result, totalMatches, truncated: true }
}

// ── 格式化输出（Gemini CLI 风格） ──────────────────

function formatOutput(
  groups: FileGroup[],
  totalMatches: number,
  fileCount: number,
  pattern: string,
  truncated: boolean,
  basePath: string,
): string {
  const header = `Found ${totalMatches} matches for "${pattern}" in ${fileCount} files`
  const parts: string[] = [header]

  for (const group of groups) {
    const relativePath = path.relative(basePath, group.filePath)
    const fileBlock: string[] = ['---', `File: ${relativePath}`]

    for (const line of group.lines) {
      const separator = line.isContext ? '-' : ':'
      fileBlock.push(`L${line.lineNumber}${separator} ${line.content}`)
    }

    parts.push(fileBlock.join('\n'))
  }

  if (truncated) {
    parts.push('---')
    parts.push(
      `(Results truncated: showing ${MAX_MATCHES} of ${totalMatches} matches. Consider narrowing your search pattern or path.)`
    )
  }

  return parts.join('\n')
}

// ── 工具定义 ────────────────────────────────────────

export const grepSearchTool: Tool = {
  name: 'grep_search',
  description:
    `Search file contents using regex patterns. Returns matching lines with file paths and line numbers, sorted by file modification time. Results are truncated to ${MAX_MATCHES} matches. Respects .gitignore rules.`,
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'Directory to search in (relative path, defaults to project root)',
      },
      include: {
        type: 'string',
        description: 'File glob pattern to include, e.g. "*.ts"',
      },
      exclude: {
        type: 'string',
        description: 'File glob pattern to exclude, e.g. "*.test.ts"',
      },
      context: {
        type: 'number',
        description: 'Number of context lines to show before and after each match (default: 0)',
      },
    },
    required: ['pattern'],
  },

  execute: async (input: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
    const params = input as unknown as GrepSearchInput
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
      if (errorMsg.includes('regex')) {
        return `Error: Invalid regex pattern "${params.pattern}": ${errorMsg}`
      }
      return `Error: Search failed: ${errorMsg}`
    }

    if (exitCode === 1 || !stdout.trim()) {
      return 'No matches found.'
    }

    // 解析、分组、排序、截断、格式化
    const matchLines = parseRgOutput(stdout)
    const groups = groupByFile(matchLines)
    await sortByMtime(groups)

    const totalFileCount = groups.length
    const { groups: truncatedGroups, totalMatches, truncated } = truncateMatches(groups)

    // 基于 ctx.cwd 计算相对路径
    return formatOutput(truncatedGroups, totalMatches, totalFileCount, params.pattern, truncated, ctx.cwd)
  },
}
