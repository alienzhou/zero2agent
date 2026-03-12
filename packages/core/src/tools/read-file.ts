import * as fs from "node:fs/promises";
import type { Tool } from "./types.js";

interface ReadFileInput {
  path: string;
  start_line?: number;
  end_line?: number;
}

/**
 * read_file 工具：读取文件内容，支持行号范围
 */
export const readFileTool: Tool = {
  name: "read_file",
  description:
    "读取指定文件的内容。可以指定起始行号和结束行号来读取部分内容。每行会带有行号前缀。",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "文件的相对路径",
      },
      start_line: {
        type: "number",
        description: "起始行号（从 1 开始，包含）",
      },
      end_line: {
        type: "number",
        description: "结束行号（包含）",
      },
    },
    required: ["path"],
  },
  execute: async (input: Record<string, unknown>): Promise<string> => {
    const { path: filePath, start_line, end_line } = input as unknown as ReadFileInput;

    try {
      // 检查文件是否存在
      await fs.access(filePath);
      const stat = await fs.stat(filePath);

      if (!stat.isFile()) {
        return `Error: Not a file: ${filePath}`;
      }

      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      // 计算行号范围
      const startIdx = start_line ? Math.max(0, start_line - 1) : 0;
      const endIdx = end_line ? Math.min(lines.length, end_line) : lines.length;

      // 格式化输出：行号 + 内容
      const result = lines
        .slice(startIdx, endIdx)
        .map((line, idx) => {
          const lineNum = String(startIdx + idx + 1).padStart(3, "0");
          return `${lineNum}|${line}`;
        })
        .join("\n");

      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return `Error: File not found: ${filePath}`;
      }
      return `Error: Failed to read file: ${(error as Error).message}`;
    }
  },
};
