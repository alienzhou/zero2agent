# E02-S003: 驱动执行环境（terminal）- 总览

> Epic 2 第 3 个迭代：引入 `terminal` 工具，让 Agent 能执行 shell 命令并拿到真实结果。这是课程里第一个**把控制权交给外部程序**的工具。

---

## 迭代目标

**核心目标**：让学习者理解「Agent 与一个它不写、不控制、可能永不返回的程序之间，边界该怎么划」。

**定位**：Epic 2 的收官环节。S001/S002 让 Agent 能写、能改，S003 让它**能验证自己写的东西**——Agent 第一次闭环。

**你将学到**：

- 起进程只要 20 行，为什么竞品要写 4000 行——重量全在「什么信息进上下文」
- 为什么「截断输出」是在解一个错误的问题，渐进式披露怎么做
- 为什么「超时杀死」应该换成「取消 / 跳过」——不可逆动作与人的判断
- 进程活过 Agent 之后怎么收，以及三种死法为什么需要三道不同的防线
- 「和用户终端保持一致」这句话为什么必须拆成能力与呈现两个相反方向

---

## 核心功能

### terminal 工具

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | string | 是 | 要执行的 shell 命令（走 `bash -c`，支持管道 / `&&` / 重定向） |
| `workdir` | string | 否 | 执行目录，相对 `ctx.cwd` 解析；**用它代替在命令里写 `cd`** |

⚠️ **没有 `timeout` 参数**（[D01-1](../../../../.discuss/2026-08-26/e02-s003-terminal/decisions/D01-tool-baseline.md)）——本 Story 不设执行上限，改用取消/跳过。

**成功回执**（英文，与既有 7 个工具一致）：

```text
Exit code: 0
Output:
<untrusted_command_output id="a3f9c1b2">
total 24
drwxr-xr-x  5 user  staff   160 Aug 30 21:04 src
</untrusted_command_output>
```

**五种终局回执**：

| | 场景 | 形状 |
|---|---|---|
| A | 快 + 短 | `Exit code: 0` + 正文全给 |
| B | 输出越界 | `Total: 12431 lines / 1.2 MB` + `Saved to:` 路径，**正文不给** |
| C | 慢 + 短 | `Exit code: 0` + `Wall time: 47s` + 正文全给 |
| D | 被 Ctrl-S 跳过 | `Status: skipped ... (pid 12345)` + 路径 + 回读引导 |
| E | 被 Ctrl-X 取消 | `Status: cancelled by user (after 6s)` + **已产生的输出照给** |

⚠️ **`Status:` 顶替 `Exit code:` 的位置** —— D 和 E 是仅有的两种没有 exit code 的回执。

**失败回执**：

```text
Error: workdir "../etc" is outside the workspace, operation refused
Error: bash not found; S003 assumes a POSIX environment with bash available
```

---

## 设计原则

1. **单一出口不可破** —— `execute` 始终是 `Promise<string>`，返回侧不加 metadata、不加流式回调。OpenCode V1 把 exit code 挂 metadata 导致模型看不见，是活生生的反例。
2. **不可逆动作交给人** —— 杀死进程、丢弃输出都不可逆，所以是「取消 / 跳过」而非「超时杀死」，是「落盘 + 回读」而非「截断」。
3. **明示缺口 > 假装解决** —— `setsid` 逃逸、磁盘无上限、zsh rc 覆盖不全，全部如实写明而非勉强修补。
4. **不让模型 debug 一个不存在的问题** —— exit code 无条件写、signal 如实透传、env 采集失败要在回执里说。
5. **新信息搭已有通道的便车** —— 回读用既有 `read_file`，提示用既有事件通道，完成通知搭下次回执，**零新工具**。

---

## 技术选型

| 类别 | 选择 | 理由 |
|------|------|------|
| 进程启动 | `spawn('bash', ['-c', cmd], { detached: true })` | 走 shell 才有管道/`&&`；`detached` 是杀进程组的前提 |
| shell 参数 | 不加 `-l`、不加 `-i` | `-i` 会让 zsh 忽略 SIGTERM（超时杀不掉）；`-l` 只用在 env 采集那一次 |
| stdin | `'ignore'` | 让等输入的程序立刻拿到 EOF，走非交互分支（防线 #1） |
| 输出编码 | `Buffer.concat` 后统一 decode | 逐 chunk `toString` 会把跨 chunk 的中文/emoji 切成 `�` |
| 超长输出 | 越 800 行 / 20KB → 流式落盘 + **弃内存** | 阈值经 token 换算校准；弃内存才是流式的意义 |
| 长命令 | 10 秒后可 Ctrl-S 跳过；Ctrl-X 全程可取消 | 不可逆动作交给人 |
| 进程回收 | `kill(-pid)` + watcher 子 shell + 读取侧 2s 超时 | 三种死法三道防线；Node 无 `PR_SET_PDEATHSIG` |
| env 采集 | 启动时 `$SHELL -lc` 一次，模块级缓存 | `process.env` 在非终端启动场景下缺用户 PATH |
| env 覆盖 | `TERM=dumb`、`PAGER`/`GIT_PAGER=cat`、`GIT_EDITOR=true`、凭据弹窗关 | 能力继承、呈现覆盖 |
| 隔离标签 | `<untrusted_command_output id="8hex">`，**nonce 每次随机** | 固定标签名可被命令输出伪造闭合串越狱（实测） |

> 明确**不做**：命令解析 / 黑白名单 / 沙箱、pty、`stdin` 续写、超时上限、给模型的进程管理工具、Windows。

---

## 关键阈值一览

⚠️ **四个阈值服务四个不同的消费者，所以数值不该相等**：

| 阈值 | 数值 | 谁消费 | 定值依据 |
|---|---|---|---|
| `Wall time` 字段 | **3 秒** | 模型（事后） | 噪音下界；实测 5 秒正好压在命令簇上会抖动 |
| 跳过提示 | **10 秒** | 人（运行中） | 耐心上界 |
| 落盘 | **20KB / 800 行** | 上下文预算 | token 换算 |
| 读取侧超时 | **2 秒** | 防挂死 | 正常 close <10ms，2 秒是数量级余量 |

---

## 文档导航

| 编号 | 文档 | 说明 |
|------|------|------|
| 00 | [总览](./00-overview.md) | 本文档 |
| 01 | [技术设计](./01-technical-design.md) | 架构设计与实现方案 |
| 02 | [任务清单](./02-task-list.md) | 开发任务拆解 |
| 03 | [验收检查清单](./03-verification-checklist.md) | 验收时的检查项 |
| 04 | [Backlog](./04-backlog.md) | 当前版本不做的事项 |

> 本目录的 [README.md](../README.md) 是迭代入口，包含教学叙事、目标与设计动机。

---

## 关联文档

- 讨论记录：`.discuss/2026-08-26/e02-s003-terminal/outline.md`
- 决策文档：`.discuss/2026-08-26/e02-s003-terminal/decisions/D01–D05`（81 项决策）
- 竞品调研：`researches/terminal/`（opencode / codex / pi-mono / gemini-cli / aider）
- 迭代日志：`CHANGELOG.md`
