# E01-S001: 技术设计

> ReACT 基础版的详细技术设计方案。

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Agent                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                         ReACT Loop                                │   │
│  │                                                                   │   │
│  │    ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐  │   │
│  │    │  用户   │────▶│  模型   │────▶│  工具   │────▶│  结果   │  │   │
│  │    │  输入   │     │  调用   │     │  执行   │     │  返回   │  │   │
│  │    └─────────┘     └─────────┘     └─────────┘     └─────────┘  │   │
│  │         │                                               │        │   │
│  │         └───────────────── 循环 ◀───────────────────────┘        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐            │
│  │  LLM Client  │     │    Tools     │     │   Messages   │            │
│  │  (Anthropic) │     │  Definition  │     │   History    │            │
│  └──────────────┘     └──────────────┘     └──────────────┘            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. LLM 客户端设计

### 2.1 SDK 选型

使用 `@anthropic-ai/sdk` 官方 TypeScript SDK。

**理由**：
- 官方维护，类型定义完善
- 支持 `baseURL` 配置，可切换到兼容提供商（如 MiniMax）
- Tool Use 机制清晰（`stop_reason: "tool_use"`）

### 2.2 配置方式

```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL,  // 可选，默认官方 API
  apiKey: process.env.ANTHROPIC_API_KEY,
})
```

**环境变量**：
- `ANTHROPIC_API_KEY`：API 密钥（必须）
- `ANTHROPIC_BASE_URL`：API 地址（可选，用于切换提供商）
- `MODEL_NAME`：模型名称（可选，默认 `claude-sonnet-4-20250514`）

### 2.3 消息格式

Anthropic API 使用 content blocks 格式：

```typescript
// 用户消息
{ role: "user", content: "帮我看看 package.json 的内容" }

// 助手消息（包含工具调用）
{
  role: "assistant",
  content: [
    { type: "text", text: "我来读取这个文件..." },
    { type: "tool_use", id: "call_xxx", name: "read_file", input: { path: "package.json" } }
  ]
}

// 工具结果（作为 user 消息返回）
{
  role: "user",
  content: [
    { type: "tool_result", tool_use_id: "call_xxx", content: "{\"name\": \"zero2agent\"...}" }
  ]
}
```

---

## 3. 工具设计

### 3.1 工具接口

```typescript
interface Tool {
  name: string
  description: string
  input_schema: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
  }
  execute: (input: Record<string, unknown>) => Promise<string>
}
```

### 3.2 read_file 工具

**功能**：读取指定文件的内容，支持行号范围。

**参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | ✅ | 文件相对路径 |
| `start_line` | number | ❌ | 起始行号（从 1 开始） |
| `end_line` | number | ❌ | 结束行号（包含） |

**实现要点**：
- 不提供行号范围时，返回全部内容
- 提供行号范围时，返回指定范围的内容
- 每行带行号前缀，格式：`001|const x = 1`

**输出示例**：
```
001|{
002|  "name": "zero2agent",
003|  "version": "0.0.0"
004|}
```

**错误处理**：
- 文件不存在：返回 `Error: File not found: <path>`
- 读取失败：返回 `Error: Failed to read file: <reason>`

### 3.3 list_directory 工具

**功能**：列出指定目录的文件和子目录。

**参数**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | ✅ | 目录相对路径 |
| `recursive` | boolean | ❌ | 是否递归列出（默认 false） |

**实现要点**：
- 非递归：只列出直接子项
- 递归：列出所有层级，用缩进表示层级关系
- 每行显示完整相对路径（方便模型直接使用）

**输出示例（非递归）**：
```
[dir] src/
[file] package.json
[file] README.md
```

**输出示例（递归）**：
```
[dir] src/
  [file] src/index.ts
  [file] src/agent.ts
  [dir] src/llm/
    [file] src/llm/index.ts
    [file] src/llm/anthropic.ts
[file] package.json
[file] README.md
```

**错误处理**：
- 目录不存在：返回 `Error: Directory not found: <path>`
- 不是目录：返回 `Error: Not a directory: <path>`

---

## 4. ReACT 循环设计

### 4.1 核心流程

```typescript
async function runLoop(userMessage: string): Promise<string> {
  const messages = [{ role: "user", content: userMessage }]
  
  while (true) {
    // 1. 调用 LLM
    const response = await client.messages.create({
      model: MODEL_NAME,
      max_tokens: 4096,
      tools: toolDefinitions,
      messages,
    })
    
    // 2. 检查结束条件
    if (response.stop_reason === "end_turn") {
      return extractTextContent(response.content)
    }
    
    // 3. 处理工具调用
    if (response.stop_reason === "tool_use") {
      // 添加助手消息
      messages.push({ role: "assistant", content: response.content })
      
      // 执行工具并收集结果
      const toolResults = await executeToolCalls(response.content)
      
      // 添加工具结果
      messages.push({ role: "user", content: toolResults })
    }
  }
}
```

### 4.2 工具执行

```typescript
async function executeToolCalls(content: ContentBlock[]): Promise<ToolResultBlock[]> {
  const results: ToolResultBlock[] = []
  
  for (const block of content) {
    if (block.type === "tool_use") {
      const tool = tools.find(t => t.name === block.name)
      
      if (!tool) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: Unknown tool: ${block.name}`,
        })
        continue
      }
      
      try {
        const output = await tool.execute(block.input)
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
        })
      } catch (error) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: ${error.message}`,
        })
      }
    }
  }
  
  return results
}
```

### 4.3 循环终止条件

| 条件 | 处理 |
|------|------|
| `stop_reason === "end_turn"` | 正常结束，返回文本内容 |
| `stop_reason === "tool_use"` | 执行工具，继续循环 |
| `stop_reason === "max_tokens"` | 达到 token 上限，返回当前内容 |
| 循环次数超限 | 防止无限循环，强制结束 |

---

## 5. 设计决策记录（ADR）

### ADR-01: 使用 Anthropic SDK 而非 OpenAI SDK

**状态**：已决定

**上下文**：需要选择 LLM SDK 来实现工具调用。

**决策**：使用 `@anthropic-ai/sdk`。

**备选方案**：
- OpenAI SDK：生态更广，但 S001 已有实现，想换个体验
- 自己封装 fetch：灵活但工作量大

**理由**：
1. 官方 SDK，类型完善
2. 支持 baseURL 切换，可复用到 MiniMax 等兼容 API
3. Tool Use 机制比 Function Calling 更清晰

### ADR-02: 错误返回字符串而非抛异常

**状态**：已决定

**上下文**：工具执行出错时如何处理。

**决策**：返回错误信息字符串，如 `Error: File not found: xxx`。

**备选方案**：
- 抛异常让上层捕获
- 返回结构化错误对象

**理由**：
1. 让模型能看到错误信息，自行决定下一步（如尝试其他路径）
2. 简化循环逻辑，不需要 try-catch 到处写
3. 符合 MVP 简单原则

### ADR-03: 递归目录使用缩进 + 完整路径格式

**状态**：已决定

**上下文**：递归列出目录时的输出格式。

**决策**：使用 2 空格缩进表示层级，每行显示完整相对路径。

**备选方案**：
- 只显示文件名（模型需要自己拼接路径）
- 树形 ASCII 图（漂亮但解析困难）
- JSON 格式（精确但占 token）

**理由**：
1. 模型可以直接复制路径调用 `read_file`
2. 缩进清晰表示层级关系
3. 纯文本格式对 token 友好

---

## 6. 不做的事情（参见 Backlog）

- 路径安全检查（后续迭代添加）
- 文件写入等危险操作
- Tool Registry 抽象
- 复杂的错误处理和重试机制
- 流式输出

详见 [04-backlog.md](./04-backlog.md)。
