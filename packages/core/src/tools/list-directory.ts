import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Tool } from "./types.js";

interface ListDirectoryInput {
  path: string;
  recursive?: boolean;
}

/**
 * 递归列出目录内容
 */
async function listDirRecursive(
  dirPath: string,
  depth: number = 0
): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results: string[] = [];

  // 按名称排序，目录在前
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of sorted) {
    const fullPath = path.join(dirPath, entry.name);
    const indent = "  ".repeat(depth);
    const type = entry.isDirectory() ? "[dir]" : "[file]";
    const displayPath = entry.isDirectory() ? `${fullPath}/` : fullPath;

    results.push(`${indent}${type} ${displayPath}`);

    if (entry.isDirectory()) {
      const subEntries = await listDirRecursive(fullPath, depth + 1);
      results.push(...subEntries);
    }
  }

  return results;
}

/**
 * list_directory 工具：列出目录结构
 */
export const listDirectoryTool: Tool = {
  name: "list_directory",
  description:
    "列出指定目录的文件和子目录。可以选择递归列出所有层级的内容。",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "目录的相对路径",
      },
      recursive: {
        type: "boolean",
        description: "是否递归列出子目录内容（默认 false）",
      },
    },
    required: ["path"],
  },
  execute: async (input: Record<string, unknown>): Promise<string> => {
    const { path: dirPath, recursive = false } = input as unknown as ListDirectoryInput;

    try {
      // 检查路径是否存在
      await fs.access(dirPath);
      const stat = await fs.stat(dirPath);

      if (!stat.isDirectory()) {
        return `Error: Not a directory: ${dirPath}`;
      }

      if (recursive) {
        const lines = await listDirRecursive(dirPath);
        return lines.join("\n");
      }

      // 非递归模式
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      const lines = sorted.map((entry) => {
        const type = entry.isDirectory() ? "[dir]" : "[file]";
        const fullPath = path.join(dirPath, entry.name);
        const displayPath = entry.isDirectory() ? `${fullPath}/` : fullPath;
        return `${type} ${displayPath}`;
      });

      return lines.join("\n");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return `Error: Directory not found: ${dirPath}`;
      }
      return `Error: Failed to list directory: ${(error as Error).message}`;
    }
  },
};
