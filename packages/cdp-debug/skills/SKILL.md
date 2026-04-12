---

## name: cdp-debug-node
description: >
  Programmatic Node.js debugging via CDP using the cdp-debug HTTP server and CLI.
  Use when debugging a Node project with breakpoints, call stacks, and scope variables;
  when the user mentions CDP, Chrome DevTools Protocol, --inspect, breakpoints, or
  wants an AI agent to drive a debugger like VS Code.

# CDP Debug（Node.js）— AI Agent 使用说明

本 Skill 配合 monorepo 包 `@zero2agent/cdp-debug`：常驻 **HTTP Server** 持有 **CDP WebSocket**，CLI 通过 `**.cdp-debug.json`** 找到 Server 端口，从而在无状态下反复调用调试能力。

## 前置

- 已构建：`pnpm --filter @zero2agent/cdp-debug build`
- CLI：`pnpm exec cdp-debug`（或在仓库根 `pnpm exec cdp-debug`，需 PATH 能解析到 `packages/cdp-debug/dist/cli/index.js`）
- 断点文件路径需与 **Node 实际加载路径** 一致；MVP 优先调试 **编译产物**（如 `dist/...js`），而非仅 TypeScript 源（无 source map 时）。

## 工作流（循环）

1. 分析代码，确定断点文件与行号（1-based）。
2. 启动会话：`cdp-debug start <entry>`（后台 `&`），或目标已用 `--inspect` 启动时用 `cdp-debug connect`。
3. `cdp-debug bp set path/to/file.js:LINE`
4. 请用户触发会命中断点的操作；完成后回复 `done`。
5. `cdp-debug status` 查看是否 `paused`；若未暂停，可 `cdp-debug pause` 或调整断点。
6. 命中后：`cdp-debug stack`、`cdp-debug vars`、`cdp-debug eval "<expr>"` 收集运行时证据。
7. `cdp-debug resume` 继续，或换断点重复。
8. 结束：`cdp-debug stop`（关闭 Server、断开 CDP、删 session 文件）。

## CLI 速查


| 命令                                   | 说明                                                   |
| ------------------------------------ | ---------------------------------------------------- |
| `cdp-debug start <entry> [extra...]` | `--inspect` 启动目标 + HTTP Server + 写 `.cdp-debug.json` |
| `cdp-debug connect`                  | 仅连接已有 `--inspect` 进程（不 spawn）                        |
| `cdp-debug status`                   | 连接/暂停状态                                              |
| `cdp-debug bp set file:line`         | 设断点（`file:line` 最后一段为行号）                             |
| `cdp-debug bp list`                  | 列出断点                                                 |
| `cdp-debug bp remove <id>`           | 按 id 删除                                              |
| `cdp-debug resume` / `pause`         | 继续 / 暂停                                              |
| `cdp-debug vars [--depth n]`         | 当前作用域变量（需已暂停）                                        |
| `cdp-debug stack`                    | 调用栈                                                  |
| `cdp-debug eval "<expr>"`            | 表达式求值                                                |
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
- `POST /resume` `POST /pause`
- `GET /variables?depth=1`
- `GET /callstack`
- `POST /evaluate` body: `{ "expression": "..." }`
- `POST /stop`

## 对话约定


| 用户回复            | 含义                       |
| --------------- | ------------------------ |
| `done`          | 已按步骤复现 / 已触发断点相关路径       |
| `stop` / `exit` | 结束调试并执行 `cdp-debug stop` |


## 约束

- 无暂停时不要求 `vars`/`stack`/`eval` 的强语义结果；先 `status` 或 `resume`/`bp` 调整。
- 不要在日志中记录密钥、token、密码。

## 安装 Skill

将本目录拷贝或符号链接到项目：

```bash
ln -sf /path/to/packages/cdp-debug/skills /path/to/project/.cursor/skills/cdp-debug
```

