/**
 * @zero2agent/core
 * ReACT Agent 核心模块
 */

// Agent 类
export { Agent } from "./agent.js";
export type { AgentOptions } from "./agent.js";

// LLM 客户端
export { createAnthropicClient, getModelName } from "./llm/index.js";
export type { LLMConfig } from "./llm/index.js";

// 工具定义
export { allTools, readFileTool, listDirectoryTool, toAnthropicTool } from "./tools/index.js";
export type { Tool } from "./tools/index.js";

// ReACT 循环
export { runLoop } from "./loop.js";
export type { RunLoopOptions } from "./loop.js";
