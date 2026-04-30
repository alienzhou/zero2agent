/**
 * Prompt 模块入口
 *
 * 导出 System Prompt 和 UserTask 构建相关的类型和函数
 */

// 类型导出
export type { SystemPromptOptions, UserTaskOptions } from "./types.js";

// System Prompt Builder 导出
export {
  buildRoleSection,
  buildScopeSection,
  buildToolPolicySection,
  buildWorkflowSection,
  buildOutputSection,
  buildSystemPrompt,
} from "./system.js";

// UserTask Builder 导出
export { buildUserTaskMessage } from "./user-task.js";
