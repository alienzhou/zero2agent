import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Buffer } from 'node:buffer'
import type { Tool, ToolContext } from './types.js'
import { resolveInsideCwd } from './path-guard.js'

interface WriteFileInput {
  path: string
  content: string
}

/**
 * write_file 工具：全量写入文件内容。
 *
 * 语义：
 * - 文件不存在则创建、已存在则整篇覆盖（不 append、不做局部修改）
 * - 自动创建缺失的父目录（mkdir -p）
 * - 写前探测是否已存在，回执区分「已创建」vs「已覆盖」
 * - 目标路径必须落在工作区（cwd）内，越界硬拒绝
 */
export const writeFileTool: Tool = {
  name: 'write_file',
  description:
    '将完整内容写入指定文件（全量覆盖，非追加）。文件不存在则创建，已存在则整篇覆盖；缺失的父目录会自动创建。只能写入工作区目录内的路径。局部修改请使用 replace_in_file（若可用）。',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '目标文件的相对路径（基于工作区解析）',
      },
      content: {
        type: 'string',
        description: '要写入的完整文件内容',
      },
    },
    required: ['path', 'content'],
  },
  execute: async (input: Record<string, unknown>, ctx: ToolContext): Promise<string> => {
    const { path: filePath, content } = input as unknown as WriteFileInput

    // 1. 物理边界校验：越界硬拒绝，不产生任何磁盘副作用
    const resolvedPath = resolveInsideCwd(ctx.cwd, filePath)
    if (resolvedPath === null) {
      return `Error: ${filePath} is outside the workspace, operation refused`
    }

    try {
      // 2. 探测是否已存在（决定回执用「创建」还是「覆盖」）
      let existed = false
      try {
        const stat = await fs.stat(resolvedPath)
        if (stat.isDirectory()) {
          return `Error: ${filePath} is a directory, cannot write`
        }
        existed = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
        // ENOENT：文件不存在，属正常「新建」路径
      }

      // 3. 自动创建缺失的父目录
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true })

      // 4. 全量写入
      await fs.writeFile(resolvedPath, content, 'utf-8')

      // 5. 回执（区分新建/覆盖，含字节数）
      const bytes = Buffer.byteLength(content, 'utf-8')
      const action = existed ? 'Overwrote' : 'Created'
      return `${action} ${filePath} (${bytes} bytes written)`
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'EACCES') {
        return `Error: Permission denied writing ${filePath}`
      }
      if (err.code === 'EISDIR') {
        return `Error: ${filePath} is a directory, cannot write`
      }
      return `Error: Failed to write file: ${err.message}`
    }
  },
}
