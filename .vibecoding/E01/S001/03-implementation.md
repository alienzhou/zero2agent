# 03 - 代码实现

> Thread: 参考实现 React 基础示例
> 日期: 2026-03-12

---

## 背景

基于前序讨论确定的技术方案和 Specs 文档，开始实现 E01-S001 ReACT 基础版。

---

## Round 1: 启动实现

**🧑 User:**

> 参考 `specs/E01-read-and-search/S001-react-basic` 实现
> *(附带 specs 目录上下文)*

**🤖 Agent:**

读取了 Specs 目录下的所有文档（overview、technical-design、task-list），了解了：
- 迭代目标：实现最基础的 ReACT 循环 + 工具调用
- 技术选型：Anthropic SDK + Tool Use
- 任务清单：6 个 Step

创建了 Todo List 跟踪进度：

| Step | 任务 |
|------|------|
| 1 | 环境准备：安装 @anthropic-ai/sdk 依赖 |
| 2 | LLM 客户端：实现 Anthropic 客户端封装 |
| 3 | 工具定义：实现 read_file 和 list_directory |
| 4 | ReACT 循环：实现核心 Loop 逻辑 |
| 5 | 集成导出：统一导出入口 |
| 6 | 端到端测试：验证功能 |

---

## 实现过程

### Step 1: 环境准备

更新 `packages/core/package.json`：

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.52.0",
    "@zero2agent/shared": "workspace:*"
  }
}
```

### Step 2: LLM 客户端

创建 `packages/core/src/llm/anthropic.ts`：

```typescript
/**
 * Anthropic LLM 客户端封装
 * 支持通过 baseURL 切换到兼容 API 提供商（如 MiniMax）
 */
import Anthropic from "@anthropic-ai/sdk"

export interface LLMConfig {
  apiKey?: string
  baseURL?: string
  model?: string
}

export function createAnthropicClient(config: LLMConfig = {}) {
  return new Anthropic({
    apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    baseURL: config.baseURL || process.env.ANTHROPIC_BASE_URL,
  })
}

export function getModelName(config: LLMConfig = {}): string {
  return config.model || process.env.MODEL_NAME || "claude-sonnet-4-20250514"
}
```

### Step 3: 工具定义

**工具接口 (`tools/types.ts`)：**

```typescript
export interface Tool {
  name: string
  description: string
  inputSchema: object
  execute: (input: Record<string, unknown>) => Promise<string>
}
```

**read_file 工具 (`tools/read-file.ts`)：**

```typescript
export const readFileTool: Tool = {
  name: "read_file",
  description: "读取指定文件的内容",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "文件路径" },
      start_line: { type: "number", description: "起始行号（可选）" },
      end_line: { type: "number", description: "结束行号（可选）" },
    },
    required: ["path"],
  },
  execute: async (input) => {
    // 读取文件，支持行号范围
    // 错误时返回错误信息字符串
  },
}
```

**list_directory 工具 (`tools/list-directory.ts`)：**

```typescript
export const listDirectoryTool: Tool = {
  name: "list_directory",
  description: "列出目录内容",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "目录路径" },
      recursive: { type: "boolean", description: "是否递归列出" },
    },
    required: ["path"],
  },
  execute: async (input) => {
    // 列出目录，支持递归
    // 输出格式：缩进 + 完整相对路径
  },
}
```

### Step 4: ReACT 循环

创建 `packages/core/src/loop.ts`：

```typescript
/**
 * ReACT 循环实现
 * Reasoning + Acting 的核心逻辑
 */
export async function runLoop(options: RunLoopOptions): Promise<string> {
  const { prompt, tools, llmConfig, maxIterations = 10 } = options
  const client = createAnthropicClient(llmConfig)
  const model = getModelName(llmConfig)

  const messages: Message[] = [{ role: "user", content: prompt }]

  for (let i = 0; i < maxIterations; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      tools: tools.map(toAnthropicTool),
      messages,
    })

    // 处理文本响应
    const textContent = response.content.find((c) => c.type === "text")
    if (textContent) {
      console.log("[Agent]", textContent.text)
    }

    // 检查是否需要调用工具
    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((c) => c.type === "tool_use")

      // 添加 assistant 消息
      messages.push({ role: "assistant", content: response.content })

      // 执行工具并收集结果
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const tool = tools.find((t) => t.name === block.name)
          const result = tool
            ? await tool.execute(block.input)
            : `Error: Unknown tool ${block.name}`
          return { type: "tool_result", tool_use_id: block.id, content: result }
        })
      )

      // 添加工具结果
      messages.push({ role: "user", content: toolResults })
    } else {
      // end_turn - 返回最终结果
      return textContent?.text || ""
    }
  }

  return "Max iterations reached"
}
```

### Step 5: 统一导出

更新 `packages/core/src/index.ts`：

```typescript
// LLM 客户端
export { createAnthropicClient, getModelName } from "./llm/index.js"
export type { LLMConfig } from "./llm/index.js"

// 工具
export { readFileTool, listDirectoryTool } from "./tools/index.js"
export type { Tool } from "./tools/index.js"

// ReACT 循环
export { runLoop } from "./loop.js"
export type { RunLoopOptions } from "./loop.js"

// Agent 类
export { Agent } from "./agent.js"
```

### Step 6: CLI 测试入口

创建 `examples/simple-agent.ts`：

```typescript
#!/usr/bin/env node
/**
 * 简单的 CLI 测试入口
 * 用法: npx tsx examples/simple-agent.ts "你的问题"
 */
import { runLoop, readFileTool, listDirectoryTool } from "@zero2agent/core"

const query = process.argv[2] || "帮我看看这个项目的结构"

const result = await runLoop({
  prompt: query,
  tools: [readFileTool, listDirectoryTool],
})

console.log("\n[Result]", result)
```

---

## Round 2: 修复导出问题

**🧑 User:**

> fix：pnpm --filter @zero2agent/tui start
> 
> SyntaxError: The requested module '@zero2agent/core' does not provide an export named 'Agent'

**🤖 Agent:**

发现问题：tui 包需要 `Agent` 类，但 core 包没有导出。

**修复：**

1. 创建 `packages/core/src/agent.ts`：

```typescript
/**
 * Agent 类 - 封装 ReACT 循环的简化入口
 */
export class Agent {
  private tools: Tool[]
  private llmConfig: LLMConfig

  constructor(options: AgentOptions = {}) {
    this.tools = options.tools || [readFileTool, listDirectoryTool]
    this.llmConfig = options.llmConfig || {}
  }

  async run(prompt: string): Promise<string> {
    return runLoop({
      prompt,
      tools: this.tools,
      llmConfig: this.llmConfig,
    })
  }
}
```

2. 更新导出
3. 创建 `packages/tui/src/cli.ts`

修复后 CLI 可以正常启动。

---

## 最终成果

### 创建的文件

| 文件 | 说明 |
|------|------|
| `packages/core/src/llm/anthropic.ts` | Anthropic 客户端封装，支持 baseURL 切换 |
| `packages/core/src/llm/index.ts` | LLM 模块导出 |
| `packages/core/src/tools/types.ts` | Tool 接口定义 |
| `packages/core/src/tools/read-file.ts` | `read_file` 工具实现 |
| `packages/core/src/tools/list-directory.ts` | `list_directory` 工具实现 |
| `packages/core/src/tools/index.ts` | 工具模块导出 |
| `packages/core/src/loop.ts` | ReACT 循环核心逻辑 |
| `packages/core/src/agent.ts` | Agent 类封装 |
| `packages/core/src/index.ts` | 统一导出入口 |
| `packages/tui/src/cli.ts` | CLI 入口 |
| `examples/simple-agent.ts` | 测试示例 |

### 如何测试

```bash
# 设置 API Key
export ANTHROPIC_API_KEY="your-api-key"

# 运行测试
npx tsx examples/simple-agent.ts "帮我看看 package.json 的内容"
npx tsx examples/simple-agent.ts "列出 packages 目录的结构"

# 或使用 CLI
pnpm --filter @zero2agent/tui start "你的问题"
```

---

## VibeCoding 要点

1. **引用 Spec 作为上下文**: 通过 `specs/E01-read-and-search/S001-react-basic` 目录引用，让 Agent 了解实现目标
2. **Todo List 跟踪进度**: 使用 Todo List 分步实现，确保不遗漏
3. **遇到问题及时修复**: 发现导出问题后立即修复，保持代码可运行
4. **构建验证**: 每个步骤后运行构建，确保类型正确
5. **最小化测试**: 先跑通基础功能，复杂测试后续迭代
