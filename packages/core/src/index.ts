/**
 * @zero2agent/core
 * ReACT Agent 核心模块
 */

// Agent 类
export { Agent } from './agent.js'
export type { AgentOptions } from './agent.js'
export { Session } from './session.js'
export { validateSessionSnapshot } from './session-snapshot.js'
export type { SessionSnapshot } from './session-snapshot.js'
export { ContextBudgetError } from './context-budget.js'
export type { ContextOptions } from './context-budget.js'
export type { CompactionEvent } from './context-manager.js'

// LLM 客户端
export { createAnthropicClient, getModelName } from './llm/index.js'
export type { LLMConfig } from './llm/index.js'

// 工具定义
export {
  allTools,
  readFileTool,
  listDirectoryTool,
  terminalTool,
  toAnthropicTool,
  setTerminalRuntimeHooks,
  getTerminalRuntimeHooks,
  listBackgroundProcesses,
  getBaseShellEnv,
} from './tools/index.js'
export type {
  Tool,
  ToolContext,
  ToolExecutionMetadata,
  HumanTerminalRequest,
  HumanTerminalResult,
  TerminalRuntimeHooks,
  TerminalInterruptController,
} from './tools/index.js'

// Prompt 构建器
export {
  buildSystemPrompt,
  buildUserTaskMessage,
  buildRoleSection,
  buildScopeSection,
  buildToolPolicySection,
  buildWorkflowSection,
  buildOutputSection,
} from './prompt/index.js'
export type { SystemPromptOptions, UserTaskOptions } from './prompt/index.js'

// ReACT 循环
export { runLoop } from './loop.js'
export type { RunLoopOptions, LoopEventHandlers } from './loop.js'

export { PermissionController } from './permissions.js'
export type {
  PermissionAction,
  PermissionMode,
  PermissionRule,
  PermissionDecision,
  PermissionOptions,
  ApprovalRequest,
  ApprovalResponse,
} from './permissions.js'

export { TurnCancelledError } from './runtime.js'
export type { RuntimeEvent } from './runtime.js'

export { DiagnosticEmitter, diagnosticLabel, diagnosticNumber } from './diagnostics.js'
export type { DiagnosticEvent, DiagnosticObserver, DiagnosticContext } from './diagnostics.js'

export type { FileMutation, FileMutationHandler } from './file-mutations.js'
