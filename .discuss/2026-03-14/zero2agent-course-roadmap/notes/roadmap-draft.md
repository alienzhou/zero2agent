# Zero2Agent 课程 Roadmap 草案

## 总体结构

| Epic | 核心目标 | 当前范围 |
|------|----------|----------|
| Epic 1 | 能看 / 能查 | 最小只读闭环、内容搜索、文件集合搜索、Prompt 结构回看 |
| Epic 2 | 能动 / 能改 / 能执行 | 文件修改、终端执行、特殊命令处理 |
| Epic 3 | 基础能力与产品化 | TUI、会话、日志、Checkpoint、安全边界 |
| Epic 4 | 健壮性与上下文管理 | 异常处理、长上下文、工具上下文管理 |
| Epic 5 | 扩展能力 | AGENTS、md skills、MCP、Hooks |

## Epic 1：能看 / 能查

### Story 1：让 Agent 跑起最小只读闭环

- ReAct 循环
- `read_file`
- `list_files / list_directory`

### Story 2：让 Agent 能在内容里定位信息

- `grep search`

### Story 3：让 Agent 能在文件集合里定位目标

- `glob search`

### Story 4：回看 ReAct 模式并固定 Prompt 结构

- System Prompt 的工程结构
- 工具描述如何组织
- User Message 如何进入 Prompt 框架

## Epic 2：能动 / 能改 / 能执行

### Story 1：让 Agent 能直接改动工作区

- `Write to File`
- `Delete`

### Story 2：让 Agent 能更高效地修改已有内容

- `Replace in File`

### Story 3：让 Agent 能主动驱动执行环境

- `Terminal`（正常执行路径）

### Story 4：让 Agent 不会被特殊命令轻易拖住

- 长时间不退出的命令
- 前台阻塞进程
- 交互式命令

## Epic 3：基础能力与产品化

当前先预告以下方向：

- TUI 与产品外壳
- Agent Core 与 UI 解耦的架构改造
- 会话管理
- 日志与 Checkpoint
- 安全边界 Epic：
  - Approval
  - 权限控制
  - 工作目录校验

## Epic 4：健壮性与上下文管理

当前先预告以下方向：

- 异常处理
- 长上下文管理
- 工具上下文管理
- 速度、稳定性与 token 成本优化

## Epic 5：扩展能力

当前先预告以下方向：

- AGENTS
- md skills
- MCP
- Hooks

## 更后面的方向

当前先作为远期预告保留：

- Agent Teams
- Plan
- Task List
- Long Running

## 课程呈现方式

- **主流程**：跟着做 + 最小必要理解
- **扩展阅读**：解释为什么这样设计
- **延伸与深入**：说明未来还会继续优化的问题
