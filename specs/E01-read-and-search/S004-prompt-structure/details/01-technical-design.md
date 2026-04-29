# E01-S004: 技术设计

> System Prompt Builder 和 UserTask Builder 的设计说明，重点解释消息层级、section 结构和实现要点。

---

## 整体结构

这次改动分三个部分，按依赖关系排列：

1. **Prompt Builder 模块**（先做）
   - 新增 `packages/core/src/prompt/` 目录
   - 实现 `buildSystemPrompt(options)` 和 `buildUserTaskMessage(options)`
   - 代码入口：`system.ts`、`user-task.ts`、`index.ts`

2. **TUI 集成**（后做）
   - 移除 `cli.ts` 中的内联 SYSTEM_PROMPT
   - 改为调用 prompt builder
   - 代码入口：`packages/tui/src/cli.ts`

3. **Agent 层适配**（可选）
   - Agent 构造 UserTaskContext
   - 用户输入包装为 UserTask
   - 代码入口：`packages/core/src/agent.ts`

---

## 消息层级设计

### 六层消息模型

S004 把 prompt 相关的信息分成六层：

| 层级 | 定义 | S004 处理 |
|------|------|-----------|
| System | 模型最稳定、最高优先级的行为约束 | ✅ 实现 |
| Instruction | 来自项目、组织、用户偏好的外部规则 | 只预留位置 |
| User Task | 用户原始输入及当前任务上下文 | ✅ 定义格式 |
| Task Mode | plan/debug/review 等模式规则 | 只预留扩展点 |
| Tool | 工具 schema、调用策略、tool response | ✅ 确认策略 |
| Response | 最终回答的呈现契约 | ✅ 放入 Output section |

### 优先级原则

```text
System > Project Instruction > User Preference > Task
```

当规则冲突时，按此优先级解决。

---

## System Prompt Builder

### 函数签名

```typescript
interface SystemPromptOptions {
  // 预留扩展位，S004 暂不使用
  instructions?: string[];
  mode?: string;
}

function buildSystemPrompt(options?: SystemPromptOptions): string;
```

### 5 个 Section 的具体内容

#### 1. Role / Identity

```text
你是 Zero2Agent 课程配套的一个只读文件 Agent Harness 演示。
你在宿主进程里驱动模型与工具协作，帮助用户查看文件和目录内容。
```

职责：说明 Agent 是谁、为什么存在。

#### 2. Scope / Capability

```text
你可以：
- 读取文件内容
- 列出目录结构
- 搜索文件内容
- 按模式查找文件

你不能：
- 编辑或创建文件
- 执行 shell 命令
- 访问网络
```

职责：明确能力边界，防止模型越权。

#### 3. Tool Policy

```text
工具使用策略：
- 查找文件名或路径时，优先使用 find_files
- 查找文件内容时，使用 grep_search
- 定位后再用 read_file 精读
- 需要了解目录结构时使用 list_directory
- find_files 和 grep_search 可以组合使用：先定位文件，再搜索内容
```

职责：指导工具选择和组合，不重复工具参数说明。

#### 4. Workflow

```text
面对用户任务时的默认推进方式：
1. 先理解用户想要什么
2. 定位可能相关的文件或目录
3. 读取必要内容
4. 必要时使用搜索缩小范围
5. 综合信息给出回答
```

职责：描述普通任务的默认推进方式，不写 mode-specific 规则。

#### 5. Output Contract

```text
回答要求：
- 使用中文回答
- 保持简洁，不要冗余解释
- 必要时引用文件路径
- 如果无法完成任务，说明原因
```

职责：约束最终输出的格式和风格。

### Section 组装

```typescript
function buildSystemPrompt(options?: SystemPromptOptions): string {
  const sections = [
    buildRoleSection(),
    buildScopeSection(),
    buildToolPolicySection(),
    buildWorkflowSection(),
    buildOutputSection(),
  ];
  
  // 预留 instruction 插入位置
  if (options?.instructions?.length) {
    // 未来实现
  }
  
  return sections.join('\n\n');
}
```

---

## UserTask Builder

### 函数签名

```typescript
interface UserTaskOptions {
  rawUserMessage: string;
  cwd?: string;
  date?: string;
  // 预留扩展位
  platform?: string;
  repoRoot?: string;
}

function buildUserTaskMessage(options: UserTaskOptions): string;
```

### 输出格式

采用 XML-like tags：

```xml
<user_task_context>
  <runtime_context>
    <cwd>/path/to/project</cwd>
    <date>2026-04-29</date>
  </runtime_context>
</user_task_context>

<user_task>
用户原始输入...
</user_task>
```

### 为什么用 XML-like tags

| 候选格式 | 优点 | 缺点 |
|----------|------|------|
| Markdown section | 教学友好 | 用户原文可能包含 Markdown 标题，边界不够强 |
| XML-like tags | 边界清晰，可扩展 | 比 Markdown 稍不自然 |
| JSON/YAML block | 结构化强 | 转义和多行文本麻烦 |

选择 XML-like tags 是因为：
- Runtime Context 是机器注入内容，应该和用户原文有强边界
- 后续可自然扩展 task_mode、focused_files 等字段

### 实现

```typescript
function buildUserTaskMessage(options: UserTaskOptions): string {
  const { rawUserMessage, cwd, date } = options;
  
  const runtimeContext = [
    cwd ? `    <cwd>${cwd}</cwd>` : '',
    date ? `    <date>${date}</date>` : '',
  ].filter(Boolean).join('\n');
  
  return `<user_task_context>
  <runtime_context>
${runtimeContext}
  </runtime_context>
</user_task_context>

<user_task>
${rawUserMessage}
</user_task>`;
}
```

---

## 工具描述策略

### 当前问题

`cli.ts` 中的 SYSTEM_PROMPT 和各工具的 `description` 字段同时维护工具描述：

```typescript
// cli.ts
const SYSTEM_PROMPT = `...
- read_file: 读取文件内容
- grep_search: 搜索文件内容（支持正则表达式）
...`;

// read-file.ts
export const readFileTool: Tool = {
  name: 'read_file',
  description: '读取指定文件的内容...',
  // ...
};
```

### 解决方案

| 位置 | 负责内容 |
|------|----------|
| Tool schema | 工具能做什么、参数是什么、输入输出约束 |
| Tool Policy | 什么时候用工具、如何组合工具 |

System Prompt 不再列出每个工具的完整说明，只写使用策略。

---

## 对现有代码的影响

| 改动 | 文件 | 说明 |
|------|------|------|
| 新增 | `packages/core/src/prompt/system.ts` | System Prompt builder |
| 新增 | `packages/core/src/prompt/user-task.ts` | UserTask builder |
| 新增 | `packages/core/src/prompt/index.ts` | 导出入口 |
| 修改 | `packages/core/src/index.ts` | 导出 prompt 模块 |
| 修改 | `packages/tui/src/cli.ts` | 移除内联 SYSTEM_PROMPT，调用 builder |
| 可选 | `packages/core/src/agent.ts` | 构造 UserTaskContext |

---

## 设计决策记录（ADR）

### ADR-01：Default System 固定为 5 个静态 section

**决策**：Role → Scope → Tool Policy → Workflow → Output

**理由**：
1. 参考 Codex、Gemini CLI、OpenCode、Pi Mono、Aider 的共性模式
2. 职责清晰，每个 section 回答一个问题
3. 顺序符合认知：先知道是谁，再知道能做什么，再知道怎么做

### ADR-02：工具描述只在 tool schema

**决策**：System Prompt 不重复工具参数说明，只写 Tool Policy。

**理由**：
1. 消除双写，单一信息源
2. 模型在 tool calling 阶段才看到 schema description，时序最匹配
3. System Prompt 篇幅可以大幅缩减

### ADR-03：Runtime Context 放入 UserTaskContext

**决策**：cwd、date 等动态信息不进入 Default System。

**理由**：
1. Default System 应尽量稳定
2. 动态内容放进 System 会污染静态 section，不利于 prompt cache
3. 放在 UserTaskContext 让任务上下文更完整

### ADR-04：UserTaskContext 采用 XML-like tags

**决策**：使用 `<user_task_context>` 和 `<user_task>` 标签。

**理由**：
1. 边界清晰，机器注入内容和用户原文有强分隔
2. 用户原文可能包含 Markdown 标题，用 Markdown section 容易混淆
3. 可扩展，后续可加入 task_mode、focused_files 等

---

## 当前不做的事情

这一版明确暂不处理：

- AGENTS.md 搜索和加载
- Instruction conflict resolver
- plan/debug/review 等 mode 实现
- skills 加载
- prompt cache
- tool response hint
- System message 返回 string[]

详细理由见 [04-backlog.md](./04-backlog.md)。
