import * as fs from 'node:fs/promises'
import type { Tool, ToolContext } from './types.js'
import { resolveInsideCwd } from './path-guard.js'

interface ReplaceInFileInput {
  path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

/**
 * replace_in_file 工具：对已有文件做精确的局部替换。
 *
 * 语义：
 * - old_string 必须与文件内容逐字符精确匹配（含空白/缩进），不可为空
 * - 默认要求 old_string 唯一出现；出现多次时报「不唯一」，不自动选第一个
 * - replace_all = true 时替换所有匹配处，回执报告实际替换处数
 * - new_string 可为空字符串（等价删除匹配片段）
 * - 目标路径必须落在工作区（cwd）内，越界硬拒绝
 */
export const replaceInFileTool: Tool = {
  name: 'replace_in_file',
  description:
    '对已有文件做精确的局部替换。old_string 必须与文件内容逐字符精确匹配（含空白和缩进），且默认必须唯一出现；若出现多次，请补充更多上下文使 old_string 唯一，或传 replace_all=true 替换全部。new_string 是要替换成的新内容（可为空字符串，表示删除该片段）。只能修改工作区目录内的文件。',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '目标文件的相对路径（基于工作区解析）',
      },
      old_string: {
        type: 'string',
        description: '要匹配的原文片段，必须逐字符精确匹配且唯一出现（不可为空）',
      },
      new_string: {
        type: 'string',
        description: '替换后的新内容（可为空字符串，表示删除匹配片段）',
      },
      replace_all: {
        type: 'boolean',
        description: '是否替换所有匹配处，默认 false（false 时要求 old_string 唯一）',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
    const { path: filePath, old_string, new_string, replace_all } =
      input as unknown as ReplaceInFileInput
    const replaceAll = replace_all === true

    // 1. 物理边界校验：越界硬拒绝，不产生任何磁盘副作用
    const resolvedPath = resolveInsideCwd(ctx.cwd, filePath)
    if (resolvedPath === null) {
      return `Error: ${filePath} is outside the workspace, operation refused`
    }

    // 2. old_string 不可为空（空匹配位置不唯一、语义模糊）
    if (old_string === '') {
      return 'Error: old_string must not be empty'
    }

    // 3. 目标必须是已存在的普通文件
    try {
      const stat = await fs.stat(resolvedPath)
      if (!stat.isFile()) {
        return `Error: ${filePath} is a directory, cannot replace`
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return `Error: File not found: ${filePath}`
      }
      return `Error: Failed to replace: ${(error as Error).message}`
    }

    try {
      // 4. 读出全文，统计匹配次数
      const content = await fs.readFile(resolvedPath, 'utf-8')
      const count = countOccurrences(content, old_string)

      // 5. 匹配语义：0 次=未找到；多匹配且非 replace_all=不唯一
      if (count === 0) {
        return `Error: Match not found: ${filePath}`
      }
      if (!replaceAll && count > 1) {
        return `Error: Match not unique: ${filePath} (${count} occurrences, add more context to disambiguate)`
      }

      // 6. 用 split/join 做字面量替换（规避 String.replace 的 $ 占位符陷阱）
      const newContent = content.split(old_string).join(new_string)
      await fs.writeFile(resolvedPath, newContent, 'utf-8')

      // 7. 回执：报告实际替换处数
      const replaced = replaceAll ? count : 1
      const noun = replaced === 1 ? 'occurrence' : 'occurrences'
      return `Replaced ${filePath} (${replaced} ${noun})`
    } catch (error) {
      return `Error: Failed to replace: ${(error as Error).message}`
    }
  },
}

/**
 * 统计 needle 在 haystack 中按字面量出现的次数。
 * 用 split 计数：split 后段数 - 1 即出现次数。
 */
function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}
