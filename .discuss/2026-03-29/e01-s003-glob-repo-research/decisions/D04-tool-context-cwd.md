# D04 - Agent 统一工作目录（ToolContext 注入）

**Status**: ✅ 已确认
**Related Outline**: [Back to Outline](../outline.md)

---

## 📋 Background

### 问题 / 需求

zero2agent 当前三个工具（`read_file`、`list_directory`、`grep_search`）都接受相对路径，但没有统一的"工作目录"概念。所有相对路径隐式依赖 `process.cwd()`——即 Node 进程启动时的当前目录。

S003 要加 `find_files` 工具并输出相对路径，这让"基于什么目录做相对"成为必须显式解决的问题。

### 现状分析

| 层级 | 现状 | 问题 |
|------|------|------|
| **Tool 接口** | `execute(input)` 只接收模型参数，无框架上下文 | 工具无法获取 Agent 级配置 |
| **Agent 配置** | `AgentOptions` 无 `cwd` 字段 | 无法在创建 Agent 时指定工作目录 |
| **Loop 层** | `executeToolCalls` 直接调 `tool.execute(input)` | 无上下文传递通道 |
| **TUI 层** | `new Agent({ systemPrompt, events })` | 未传工作目录 |
| **实际行为** | 相对路径按 `process.cwd()` 解析 | 全局状态，脆弱，不可测试 |

### 竞品做法

| 项目 | 机制 | 工具如何获取 |
|------|------|-------------|
| OpenCode | `Instance.directory`（会话级项目根） | 工具执行时通过上下文对象访问 |
| Pi | `cwd` 显式传参 | `FindOperations.glob(pattern, cwd, ...)` |
| Gemini CLI | `workspaceContext.getDirectories()` | 工具实例持有 workspace 引用 |

### 约束

- 改动要小——这是 S003 的配套基础设施，不是独立重构
- 教学项目，方案要易理解
- 现有三个工具需要适配，不能破坏已有行为

---

## 🎯 Objective

为所有工具提供统一的工作目录，使相对路径有明确的解析基准，同时为 `ToolContext` 未来扩展留口子。

---

## 📊 Solution Comparison

| 方案 | 描述 | 优势 | 劣势 | 决策 |
|------|------|------|------|------|
| A. ToolContext 注入 | `execute(input, ctx: ToolContext)` | 显式、可测试、可扩展 | Tool 接口变更，现有工具需适配 | ✅ |
| B. 闭包工厂 | `createTool(cwd): Tool` | 不改 Tool 接口 | 样板代码多，每个工具包一层 | ❌ |
| C. process.chdir | TUI 启动时切换全局 cwd | 零代码改动 | 全局状态、脆弱、不可测试、多工作区不可能 | ❌ |

---

## ✅ Final Decision

### 方案

**ToolContext 注入**：给 `Tool.execute` 加第二个参数 `ctx: ToolContext`。

### 具体设计

**1. 新增 `ToolContext` 类型（`types.ts`）：**

```typescript
export interface ToolContext {
  cwd: string  // Agent 工作目录的绝对路径
}
```

当前只放 `cwd`，后续可按需扩展（如权限模型、截断配置等），不预设不需要的字段。

**2. 修改 `Tool` 接口（`types.ts`）：**

```typescript
export interface Tool {
  name: string
  description: string
  input_schema: { ... }
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>
}
```

**3. Agent 层传入 cwd（`agent.ts`）：**

```typescript
export interface AgentOptions {
  config?: LLMConfig
  tools?: Tool[]
  systemPrompt?: string
  events?: LoopEventHandlers
  cwd?: string  // 默认 process.cwd()
}
```

**4. Loop 层构造并传递（`loop.ts`）：**

```typescript
const ctx: ToolContext = { cwd: options.cwd ?? process.cwd() }
// ...
const output = await tool.execute(block.input, ctx)
```

**5. 各工具适配：**

```typescript
// 示例：read_file
execute: async (input, ctx) => {
  const filePath = path.resolve(ctx.cwd, input.path as string)
  // ...
}
```

**6. TUI 层（`cli.ts`）：**

```typescript
const agent = new Agent({
  systemPrompt: SYSTEM_PROMPT,
  events,
  cwd: process.cwd(),  // 显式传入
})
```

### 决策理由

1. **显式优于隐式**——从依赖全局 `process.cwd()` 变为参数传递，代码意图清晰
2. **可测试**——测试时传不同 `cwd`，不需要 `process.chdir()` 全局状态污染
3. **可扩展**——`ToolContext` 是自然的扩展点，后续加字段（权限、配置等）不需要再改签名
4. **改动可控**——涉及 `types.ts`、`loop.ts`、`agent.ts`、3 个工具文件、`cli.ts`，共 ~7 个文件
5. **教学价值**——"从隐式到显式"是很好的重构案例

### 预期效果

- 所有工具基于 `ctx.cwd` 解析相对路径，行为一致
- `find_files` 输出的相对路径有明确的基准目录
- 测试可以独立指定工作目录，不污染全局状态

---

## ❌ Rejected Solutions

### 方案 B：闭包工厂
- **拒绝原因**：每个工具需要包一层 `createXxxTool(cwd)` 工厂函数，样板代码多，且 `cwd` 被烧入闭包后不易动态修改
- **重新考虑条件**：如果某些工具需要不同的初始化参数（不只是 cwd）

### 方案 C：process.chdir
- **拒绝原因**：全局状态，多线程/并发不安全，测试困难，不支持多工作区
- **重新考虑条件**：不会重新考虑

---

## 📝 实现节奏（纳入 S003）

1. **Step 1 — 基础设施**：改 `ToolContext` + `Tool` 接口 + `AgentOptions` + `runLoop`
2. **Step 2 — 适配现有工具**：`read_file`、`list_directory`、`grep_search` 改为用 `ctx.cwd` 解析路径
3. **Step 3 — 实现 `find_files`**：基于 `ctx.cwd` + `rg --files` 实现新工具

---

## 🔗 Related Links

- [D01 - Glob 底层技术选型](./D01-glob-underlying-tech.md)
- [D03 - find_files 工具参数与行为](./D03-find-files-tool-contract.md)
