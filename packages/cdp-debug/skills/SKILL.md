---

## name: cdp-debug-node

description: >
  Programmatic Node.js debugging via CDP using the cdp-debug HTTP server and CLI.
  Use when debugging a Node project with breakpoints, call stacks, and scope variables;
  when the user mentions CDP, Chrome DevTools Protocol, --inspect, breakpoints, or
  wants an AI agent to drive a debugger like VS Code.

# CDP Debug（Node.js）— AI Agent 使用说明

本 Skill 配合 monorepo 包 `@zero2agent/cdp-debug`：常驻 **HTTP Server** 持有 **CDP WebSocket**，CLI 通过 `.cdp-debug.json` 找到 Server 端口，从而在无状态下反复调用调试能力。

## 前置

- 已构建：`pnpm --filter @zero2agent/cdp-debug build`
- CLI：`pnpm exec cdp-debug`（或在仓库根 `pnpm exec cdp-debug`，需 PATH 能解析到 `packages/cdp-debug/dist/cli/index.js`）
- 断点文件路径需与 **Node 实际加载路径** 一致；MVP 优先调试 **编译产物**（如 `dist/...js`），而非仅 TypeScript 源（无 source map 时）。

---

## 工作流

**铁律：永远不要在没有运行时证据的情况下连续操作。每一轮断点都必须等用户复现、拿到真实数据后再决定下一步。**

### Phase 1: 初始分析与规划

收到用户的 bug 描述后，**先分析、后动手**：

1. **分析调用链路**——阅读相关源码，梳理出从入口到问题现象的关键调用路径。
2. **提出假设**——给出 2-3 种可能的根因猜测，每种标注置信度（高/中/低）和对应的代码位置。
3. **制定断点计划**——针对最高置信度的假设，选择 1-3 个关键观测点（函数入口、分支条件、数据变换处），写明文件和行号。
4. **向用户展示计划**——将以上分析、假设、断点计划一起告知用户，等用户确认后再启动调试。

> 输出格式示例：
>
> ```
> 📋 调试计划
>
> 问题：用户反馈 xxx 报错
>
> 调用链路：A() → B() → C() → D()
>
> 假设：
>   H1 [高] C() 传入参数为 null — src/c.js:42
>   H2 [中] D() 的返回值未被 await — src/d.js:15
>   H3 [低] B() 缓存命中了过期数据 — src/b.js:88
>
> 断点计划（验证 H1）：
>   BP1: src/c.js:42  — 观察参数 arg 是否为 null
>   BP2: src/b.js:30  — 观察传给 C 的值从何而来
>
> 请确认后我将启动调试会话。
> ```

### Phase 2: 启动会话 & 设置断点

用户确认后：

1. 启动调试会话：
  - `cdp-debug start <entry> --brk`（用 `--brk` 在第一行暂停，确保有时间设断点），或
  - `cdp-debug connect`（目标已用 `--inspect` 启动时）。
2. 按断点计划一次性设好所有断点：`cdp-debug bp set file:line`
3. 设好后 `cdp-debug resume`（从 `--brk` 暂停中放行）。
4. **明确要求用户操作**——告诉用户需要做什么来触发问题（例如："请在浏览器中点击提交按钮"），然后等待用户回复 `done`。

> **在用户回复 `done` 之前，不要执行任何 `status`/`vars`/`stack`/`eval` 命令。**

### Phase 3: 断点命中 → 收集证据

用户回复 `done` 后：

1. `cdp-debug status` — 确认是否命中断点（`paused: true`）。
2. 若已暂停：
  - `cdp-debug stack` — 查看调用栈
  - `cdp-debug vars` — 查看作用域变量
  - `cdp-debug eval "<expr>"` — 对特定表达式求值
3. 若未暂停：说明断点未命中，分析原因（路径不对？条件未满足？），调整断点计划。

### Phase 4: 分析 → 决策

拿到运行时数据后，**必须先分析再行动**：

1. **将证据与假设对照**：哪个假设被证实？哪个被排除？
2. **决策分支**：
  - **根因已确认** → 向用户报告根因、证据、修复建议，然后 `cdp-debug stop` 结束。
  - **当前假设被排除** → 更新假设列表，给出新的断点计划，向用户说明推理过程。
  - **需要更多数据** → 在当前暂停状态下用 `eval` 补充信息，或添加新断点后 `resume`。
3. 如果需要继续，**回到 Phase 3**：
  - 添加/调整断点 → `cdp-debug resume` → 要求用户再次复现 → 等 `done` → 收集证据。

> **关键约束：每次 `resume` 后都必须等用户反馈，不要连续 `resume` → `status` → `resume` 盲目循环。**

### Phase 5: 结束

- 根因确认后 `cdp-debug stop` 关闭会话。
- 向用户输出结构化总结：根因、证据链、修复建议。

---

## 完整流程图

```
用户描述问题
    │
    ▼
[Phase 1] 分析调用链 → 提出假设 → 制定断点计划 → 展示给用户
    │
    ▼ 用户确认
[Phase 2] 启动会话 → 设断点 → resume → 要求用户复现
    │
    ▼ 用户回复 done
[Phase 3] status → stack / vars / eval → 收集证据
    │
    ▼
[Phase 4] 分析证据 ──→ 根因确认？──→ 是 → [Phase 5] 报告 & stop
                         │
                         否
                         │
                         ▼
                   更新假设 → 调整断点 → resume → 要求用户复现
                         │
                         └──→ 回到 [Phase 3]
```

---

## CLI 速查


| 命令                                   | 说明                                                   |
| ------------------------------------ | ---------------------------------------------------- |
| `cdp-debug start <entry> [extra...]` | `--inspect` 启动目标 + HTTP Server + 写 `.cdp-debug.json` |
| `cdp-debug start <entry> --brk`      | 同上，但在第一行暂停（推荐，确保有时间设断点）                              |
| `cdp-debug connect`                  | 仅连接已有 `--inspect` 进程（不 spawn）                        |
| `cdp-debug status`                   | 连接/暂停状态                                              |
| `cdp-debug bp set file:line`         | 设断点（`file:line` 最后一段为 1-based 行号）                    |
| `cdp-debug bp list`                  | 列出断点                                                 |
| `cdp-debug bp remove <id>`           | 按 id 删除                                              |
| `cdp-debug resume` / `pause`         | 继续 / 暂停                                              |
| `cdp-debug wait [--timeout ms]`      | 阻塞等待直到命中断点（默认 10s 超时）                                |
| `cdp-debug vars [--depth n]`         | 当前作用域变量（需已暂停）                                        |
| `cdp-debug stack`                    | 调用栈                                                  |
| `cdp-debug eval "<expr>"`            | 在当前栈帧上下文中求值（暂停时为局部作用域）                               |
| `cdp-debug stop`                     | 结束会话                                                 |


公共选项：`--cwd <dir>`（默认当前目录，session 文件写在 `<dir>/.cdp-debug.json`）。

端口：`--inspect-port`（默认 9229）、`--server-port`（默认 7492）。

## HTTP API（可选）

CLI 走 `http://127.0.0.1:<serverPort>`：

- `GET /health`
- `GET /status`
- `POST /breakpoint` body: `{ "file": "...", "line": 1 }`
- `GET /breakpoints`
- `DELETE /breakpoint/:id`
- `POST /resume` / `POST /pause`
- `POST /wait-for-pause?timeout=10000`
- `GET /variables?depth=1`
- `GET /callstack`
- `POST /evaluate` body: `{ "expression": "..." }`
- `POST /stop`

## 对话约定


| 用户回复               | Agent 行为                 |
| ------------------ | ------------------------ |
| `done`             | 用户已完成复现操作，Agent 开始收集断点数据 |
| `confirmed` / `ok` | 用户确认调试计划，Agent 启动会话      |
| `stop` / `exit`    | 结束调试，执行 `cdp-debug stop` |
| `skip`             | 跳过当前假设，Agent 切换到下一个假设    |


## 约束

- **不要在未暂停时调用 `vars`/`stack`/`eval`**——先 `status` 确认 `paused: true`。
- **不要在用户回复 `done` 之前读取调试数据**——没有运行时触发就没有有效数据。
- **不要连续 `resume` 多次**——每次 `resume` 后必须等用户操作并回复。
- 不要在日志中记录密钥、token、密码。

## 安装 Skill

将本目录拷贝或符号链接到项目：

```bash
ln -sf /path/to/packages/cdp-debug/skills /path/to/project/.cursor/skills/cdp-debug
```

