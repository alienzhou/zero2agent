export type { Tool } from "./types.js";
export { toAnthropicTool } from "./types.js";
export { readFileTool } from "./read-file.js";
export { listDirectoryTool } from "./list-directory.js";

import { readFileTool } from "./read-file.js";
import { listDirectoryTool } from "./list-directory.js";
import type { Tool } from "./types.js";

/**
 * 所有可用工具的列表
 */
export const allTools: Tool[] = [readFileTool, listDirectoryTool];
