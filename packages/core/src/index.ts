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
  readToolResultTool,
  readHistoryTool,
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

export { TurnCancelledError, RunBudgetError } from './runtime.js'
export { DEFAULT_RUN_LIMITS, validateRunLimits } from './run-budget.js'
export type { RunLimits } from './run-budget.js'
export type { RuntimeEvent, RequestNotice } from './runtime.js'

export { DiagnosticEmitter, diagnosticLabel, diagnosticNumber } from './diagnostics.js'
export type { DiagnosticEvent, DiagnosticObserver, DiagnosticContext } from './diagnostics.js'

export type { FileMutation, FileMutationHandler } from './file-mutations.js'

export { ResultStore, ResultStoreError } from './result-store.js'
export { EvidenceReadIncompleteError } from './result-read-recovery.js'
export type {
  ResultStoreOptions,
  ResultSnapshot,
  ResultEntry,
  ResultSource,
} from './result-store.js'

export {
  formatArtifactTask,
  validateArtifactContract,
  ARTIFACT_LIMITS,
} from './artifact-contract.js'
export type { ArtifactContract, ArtifactRule, ArtifactValue } from './artifact-contract.js'
export { ArtifactCompletionError } from './artifact-completion.js'
export type { ArtifactFailure } from './artifact-completion.js'

export {
  ExecutionPersistenceError,
  RecoveryRequiredError,
  validateExecutionRecovery,
} from './execution-recovery.js'
export type {
  ExecutionPersistence,
  ExecutionBoundary,
  ExecutionRecovery,
} from './execution-recovery.js'

export {
  ProjectInstructions,
  ProjectInstructionError,
  PROJECT_INSTRUCTION_LIMITS,
} from './project-instructions.js'
export type {
  ProjectInstructionOptions,
  ProjectInstructionView,
  ProjectInstructionEntry,
} from './project-instructions.js'
export { Skills, SkillError, SKILL_LIMITS } from './skills.js'
export type { SkillsOptions, SkillView, SkillEntry, SkillSelectionSnapshot } from './skills.js'
export { SkillFormatError, parseSkillFile, parseSkillHeader } from './skill-format.js'

export {
  McpController,
  McpUnknownOutcomeError,
  mcpToolName,
  validateMcpOptions,
} from './mcp/client.js'
export type { McpOptions, McpServerConfig, McpServerView } from './mcp/client.js'
export type { ExternalSource } from './external-source.js'
