import * as fs from 'node:fs/promises'
import type { Tool, ToolContext } from './types.js'
import { resolveInsideCwd } from './path-guard.js'

interface DeleteInput {
  paths: string[]
}

interface FailedItem {
  path: string
  reason: string
}

/**
 * delete 工具：批量删除文件。
 *
 * 语义（方案 B：尽力删 + 逐条汇总）：
 * - 只删文件，不递归删目录（目标是目录 → 该项失败）
 * - 对 paths 数组逐个处理，单个失败不中断其余
 * - 每个路径都单独过工作区边界校验，越界项标记失败
 * - 最后逐条汇总成功与失败：
 *   - 全部成功 → 正常回执
 *   - 全部失败 → Error: 前缀（对 Agent 是彻底失败信号）
 *   - 部分成功 → 如实陈述成败，不带 Error: 前缀
 */
export const deleteTool: Tool = {
  name: 'delete',
  description:
    '删除一个或多个文件。传入文件相对路径数组，逐个尽力删除并逐条汇总结果。只能删除工作区目录内的文件，不删除目录、不递归删除。',
  input_schema: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: '要删除的文件相对路径数组（基于工作区解析）',
      },
    },
    required: ['paths'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
    const { paths } = input as unknown as DeleteInput

    if (!Array.isArray(paths) || paths.length === 0) {
      return 'No files to delete'
    }

    const succeeded: string[] = []
    const failed: FailedItem[] = []

    for (const rel of paths) {
      // 每个路径单独过边界校验——不能因为在数组里就跳过安全检查
      const resolved = resolveInsideCwd(ctx.cwd, rel)
      if (resolved === null) {
        failed.push({ path: rel, reason: 'outside the workspace' })
        continue
      }

      try {
        const stat = await fs.stat(resolved)
        if (stat.isDirectory()) {
          failed.push({ path: rel, reason: 'is a directory, refusing to delete directories' })
          continue
        }
        await fs.rm(resolved)
        succeeded.push(rel)
      } catch (error) {
        const err = error as NodeJS.ErrnoException
        if (err.code === 'ENOENT') {
          failed.push({ path: rel, reason: 'file not found' })
        } else if (err.code === 'EACCES') {
          failed.push({ path: rel, reason: 'permission denied' })
        } else {
          failed.push({ path: rel, reason: err.message })
        }
      }
    }

    return formatReceipt(succeeded, failed)
  },
}

/**
 * 按方案 B 拼装回执。
 */
function formatReceipt(succeeded: string[], failed: FailedItem[]): string {
  const failedText = failed.map((f) => `${f.path} (${f.reason})`).join(', ')

  // 全部失败 → Error: 前缀
  if (succeeded.length === 0) {
    return `Error: Failed to delete: ${failedText}`
  }

  const deletedText = `Deleted: ${succeeded.join(', ')}`

  // 全部成功
  if (failed.length === 0) {
    return deletedText
  }

  // 部分成功
  return `${deletedText}; failed: ${failedText}`
}
