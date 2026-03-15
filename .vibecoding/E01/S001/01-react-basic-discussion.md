# 01 - ReACT 基础版方案讨论

> Thread: 讨论初步计划，制定基础版 ReACT 模式
> 日期: 2026-03-12

---

## 背景

这是 E01-S001 迭代的起点，目标是通过讨论确定 ReACT 基础版的实现方案。

---

## Round 1: 启动讨论

**🧑 User:**

> 看一下我们是否还可以参考其他的一种初步情况。把你的这些初步计划，我们做一个第一个基础版的 ReACT 模式。你看我们先做什么呢？
> 
> *(附带 discuss-for-specs skill)*

**🤖 Agent:**

加载了 discuss-for-specs skill，查看了现有的项目结构和代码（`loop.ts` 里已预留 `tool_calls` 分支），然后创建了讨论 outline：

**分析要点：**

看了现有的 `loop.ts`，代码里已经预留了 `tool_calls` 分支：

```typescript
if (response.finishReason === 'tool_calls') {
  // TODO S002: 解析工具调用，执行工具，添加结果到消息
}
```

这说明设计意图是**利用 Function Calling 机制**，而不是自己解析 Prompt 输出。

**建议分两步走：**

### Step 1: 最小验证版
1. 定义 Tool 接口 - 统一工具的描述格式
2. 实现 1 个简单工具 - 比如 `read_file`
3. 修改 LLM 调用 - 传入 tools 参数
4. 实现 tool_calls 解析 - 提取工具名和参数
5. 执行工具 - 调用实际函数
6. 拼接结果 - 继续循环

### Step 2: 可扩展版（S003+）
- Tool Registry 注册机制
- 多工具支持
- 错误处理和重试
- 工具权限控制

**你觉得这个路径合理吗？**

---

## Round 2: 确定 MVP 定位

**🧑 User:**

> 我希望先实现一个非常基础的版本。虽然很多实际工程化的内容目前都不太需要包含，但在初期设计的时候也要考虑到后续的扩展。
> 
> 因为我们之后会逐步把它完善得更加工程化，我担心一上来就做得特别复杂，会导致理解难度太高。所以我建议在内容的第一阶段，即基础版中，主要让大家建立起"调用模型去完成实际任务"的意识。
> 
> 整个课程的内容设计是分阶段的，所以我们在第一阶段的第一个点位里，主要做到最小可行（MVP）：
> 
> 1. 能够编码两到三个最基础的工具
> 2. 对于文件系统来说，先做只读的功能，纯粹实现"读文件"和"读目录结构"
> 3. 暂时不要做过度的抽象
> 
> 关于调用方式，肯定是用 Function Calling 或者 tool_calls 这种格式。目前的最新格式应该就是 tool use 这种吧？

**🤖 Agent:**

确认了用户需求，更新 outline 记录决策：

- ✅ D01: MVP 定位 - Toy/Demo 级别，重点是让人建立"调用模型完成任务"的意识
- ✅ D02: 工具范围 - 只读工具（read_file, list_directory）
- ✅ D04: 调用方式 - OpenAI tools + tool_calls（后改为 Anthropic Tool Use）
- ✅ D05: 抽象程度 - 初期少做抽象，小步快跑

**建议的实现步骤：**

```
Step 1: 定义工具（最简单的 TypeScript 类型 + 2个具体工具）
         ↓
Step 2: 修改 LLM 调用（让模型知道有哪些工具可用）
         ↓
Step 3: 实现 Loop 的 tool_calls 分支（核心！）
         ↓
Step 4: 端到端测试
```

---

## Round 3: 调整 SDK 选择

**🧑 User:**

> 我想要先调整下策略，使用 anthropic ts sdk 接入模型，基础版先支持这个

**🤖 Agent:**

查阅了 Anthropic 文档，了解 Tool Use 机制，更新决策：

- ✅ D03: LLM SDK - 使用 Anthropic TypeScript SDK（@anthropic-ai/sdk）

**Anthropic Tool Use 核心流程：**

```
1. 发送请求（带 tools 定义）
   client.messages.create({ tools: [...], messages: [...] })
         ↓
2. Claude 返回 tool_use（stop_reason: "tool_use"）
   content: [{ type: "tool_use", id, name, input }]
         ↓
3. 执行工具，返回 tool_result
   messages.push({ role: "user", content: [{ type: "tool_result", ... }] })
         ↓
4. 继续循环，直到 stop_reason: "end_turn"
```

---

## Round 4: 工具设计细节

**🧑 User:**

> 关于技术实现还有什么要讨论的吗？包括我们的一些工具之类的，虽然功能简单，但有些细节可以再确认一下。

**🤖 Agent:**

提出需要确认的技术细节：

### 1. read_file 工具设计

```typescript
// 方案 A：最简单
read_file({ path: string })

// 方案 B：支持行号范围（防止大文件）
read_file({ path: string, start_line?: number, end_line?: number })
```

### 2. list_directory 工具设计

```typescript
// 方案 A：只列一层
list_directory({ path: string })

// 方案 B：支持递归
list_directory({ path: string, recursive?: boolean })
```

### 3. 其他细节
- 输出格式：纯文本 vs JSON
- 路径安全：是否检查路径穿越
- 错误处理：抛异常 vs 返回错误信息

---

## Round 5: 确认细节

**🧑 User:**

> 因为我们是基础版，所以我觉得所有的代码都可以简单化。我们的迭代策略就是"小步快跑"，很多问题可以留到持续迭代中去考虑。
> 
> 针对这一版：
> 1. 文件读取能力：增加一个"范围读取"的参数能力，定为方案 B
> 2. List 工具：也倾向于支持递归
> 3. 基础版先不用做安全检查
> 4. 出错的时候可以用方案 B 返回

**🤖 Agent:**

确认决策：

- ✅ D06: read_file - 支持 start_line, end_line 参数
- ✅ D07: list_directory - 支持 recursive 参数
- ✅ D08: 路径安全 - 基础版暂不做
- ✅ D09: 错误处理 - 返回字符串信息，让模型自行处理

---

## Round 6: SDK 兼容性

**🧑 User:**

> 我们使用的 SDK 不一定非要用它的模型，因为还有很多其他的模型 API 可以兼容它的格式。
> 
> 比如我们使用像 MiniMax 或者类似的这种功能，它可以接入这个 SDK。

**🤖 Agent:**

查阅 MiniMax 文档后确认：

```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  baseURL: 'https://api.minimaxi.com/anthropic',  // 切换到 MiniMax
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// 然后用法完全一样，只是 model 改成 "MiniMax-M2.5"
```

**环境变量配置方案：**
- `ANTHROPIC_BASE_URL` - 可选，默认是 Anthropic 官方
- `ANTHROPIC_API_KEY` - API 密钥
- `MODEL_NAME` - 模型名称

---

## Round 7: 递归目录格式

**🧑 User:**

> 可以是方案 A。但方案 A 如果是嵌套目录的话，例如因为我要递归，我想列出在 src 下面的文件该怎么列？

**🤖 Agent:**

提出 **缩进 + 完整相对路径** 的格式：

```bash
# 递归（用缩进表示层级）
list_directory({ path: ".", recursive: true })

# 输出：
[dir] src/
  [file] src/index.ts
  [file] src/agent.ts
  [dir] src/llm/
    [file] src/llm/index.ts
    [file] src/llm/anthropic.ts
[dir] docs/
  [file] docs/README.md
[file] package.json
[file] README.md
```

**关键点：**
- 每行显示 **完整相对路径**（如 `src/llm/index.ts`）
- 用 **2 空格缩进** 表示层级关系
- 模型既能看到层级结构，也能直接拿路径去调用 `read_file`

---

## 最终决策汇总

| 编号 | 决策项 | 结论 |
|------|--------|------|
| D01 | 定位 | MVP/Toy 级别，建立"调用模型完成任务"的意识 |
| D02 | 工具范围 | 2 个只读工具：`read_file`, `list_directory` |
| D03 | SDK | Anthropic TypeScript SDK，支持 baseURL 切换 |
| D04 | 调用方式 | Anthropic Tool Use（stop_reason: tool_use） |
| D05 | 抽象程度 | 初期少做抽象，小步快跑 |
| D06 | read_file | 支持 `start_line`, `end_line` 参数 |
| D07 | list_directory | 支持 `recursive` 参数 |
| D08 | 路径安全 | 基础版不做 |
| D09 | 错误处理 | 返回错误信息字符串 |
| D10 | 输出格式 | 纯文本 |
| D11 | 递归目录格式 | 缩进 + 完整相对路径 |

---

## VibeCoding 要点

1. **使用 Skill 引导讨论**: 通过 discuss-for-specs skill 进行结构化讨论，自动维护 outline
2. **每轮更新决策记录**: 每次确认后更新 outline.md，形成可追溯的决策链
3. **小步快跑策略**: 不追求一次完美，先跑通再迭代
4. **主动提问确认细节**: Agent 主动列出需要确认的技术细节，减少返工
