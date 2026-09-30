# S004 工程复验记录 · 2026-09-30

> 功能候选提交：`7438fa892a9887595d91070731dab6eba6237370`。本文件记录工程验证；2026-09-30 19:36 已补登记用户两项试用正常的反馈，公开发布尚未发生。

[跟练步骤](../../../specs/E02-act-and-execute/S004-interactive-commands/follow-along.md) | [验收清单](../../../specs/E02-act-and-execute/S004-interactive-commands/details/03-verification-checklist.md) | [可见对话原文](./visible-dialogue.md)

## 1. P0 计时问题：受控红绿验证

9 月 30 日审查时，旧测试全量运行曾得到 5844ms，违反 `<3500ms`；单独复跑通过。旧测试从 `terminalTool.execute` 前起表，包含了同步加载 shell 环境的时间，而生产 drain 计时器是在子进程 exit 后才启动。

新增 `slow-env-shell.sh`，在测试临时目录复制并设为可执行，固定等待 3 秒再返回无秘密 marker。不读取或修改用户 shell 配置。

| 阶段 | 证据 |
|---|---|
| 原逻辑加慢环境 | `908a903`，普通环境通过、慢环境失败：5758ms 不小于 3500ms |
| 修复 | `395d20a`，先调用真实 getBaseShellEnv 预热缓存，再用 performance.now 计时 |
| 反回归 | 同时验证慢路径 marker 与环境加载 ≥2800ms；普通/慢环境两项通过 |
| 未放宽部分 | execute 计时仍要求 ≥1800ms 且 <3500ms，并检查 drain 提示与 Exit code: 0 |

测量包含预热后的 execute 准备、启动、命令执行和 drain，不是精确的 exit→返回间隔，也不保证冷启动总延迟。受控复现证明旧计时受环境加载干扰，但没有还原先前 5844ms 运行的每一段耗时。

## 2. 独立审查与信号恢复

独立源码审查发现：活终端收到外部 SIGHUP 时，旧实现直接进入断连分支，漏发显示恢复序列。新的真实 PTY 红测中，SIGINT、SIGTERM、物理断连通过；活端 SIGHUP 的 `display_reset` 为 false。

`ceff9aa` 增加对 `/dev/tty` 的非阻塞读取探测：活端 SIGHUP 走常规中止和恢复；不可用端保留同步清理与退出，避免在消失设备上等待异步 drain。四项定向用例全部通过。

活端三信号用例现在同时检查：退出码 130/143/129、完整 termios 属性恢复、显示 RESET 序列、两个 fixture 进程在紧急清理前已消失。`7438fa8` 进一步要求有效 PID 文件，不能把缺失记录或空列表当作清理成功。物理断连用例新增退出码 129 断言。

独立复核未发现新的常规路径阻断问题。尚存低优先级边界：探测只反映当下控制终端读状态；EMFILE 等资源错误也会保守跳过恢复，不证明全部 stdin/stdout 连通性。Linux 行为未实测。RESET 字节与 termios 通过不等于所有终端渲染器的视觉验收。

## 3. 工具驱动真实终端操作

没有调用付费模型、没有输入真实凭据。姓名、状态保留与隐藏输入操作使用本轮前半段构建；信号修复未改变这些路径，后续完整 E2E 继续覆盖它们。中止操作使用信号修复后的构建。

| 场景 | 实际操作 | 可见结果 |
|---|---|---|
| 独立 CLI read | 无 API key，确认后输入 Zero2Agent | Hello Zero2Agent，completed，exit 0 |
| REPL 持续 bash | /terminal，先赋值 42，再计算两倍 | FIRST=42、SECOND=84，exit 后恢复「你:」 |
| 隐藏输入 | 第二次 /terminal，read -rs 输入 FAKE-ONLY-TOKEN | 不回显 token，只显示 TOKEN_LENGTH=15；回执仅元信息 |
| 返回 Agent | 接管结束后输入 exit | 收到「再见！」，宿主 exit 0 |
| 宿主中止 | 独立 CLI 执行 sleep 300，按 Ctrl-] | cancelled、Signal: 15，宿主 exit 143 |

离线 REPL 使用虚构 key 与 `http://127.0.0.1:1`，只操作斜杠命令和 exit。该实验不是实际模型决策 E2E，也不是用户人工签收。

## 4. 全量与工程质量

环境沿用 macOS 14.7.8 arm64、Node 22.15.1、pnpm 9.15.9。命令：

```sh
pnpm build
E2E_LIVE=0 pnpm -r --workspace-concurrency=1 run test --no-file-parallelism
```

- drain 修复后、信号扩展前：连续两轮均为 core 199、E2E 46、cdp-debug 1 通过，25 项 E2E 跳过。
- 信号修复与证据加强后：连续两轮均为 core 199、E2E 48、cdp-debug 1 通过，即每轮 248 通过、25 项 E2E 跳过。人工终端场景增至 30 项。第二轮退出码为 0，候选提交之后没有生产代码或测试文件差异。
- 构建通过；本轮变更 TS 格式通过；lint 为 0 errors / 15 warnings。
- 全仓既有 27 个其他文件的格式问题未重写，不宣称全仓格式全绿。

## 5. 交付与未授权动作

候选提交可供作者本地创建独立 worktree 跟练。没有创建新 worktree 覆盖用户目录，没有推送、合入或打 Tag。用户对 Node REPL 与 less 两项试用已回复「正常」，详见[原文与范围](./user-feedback.md)；不将其扩展为人工源码审查、交互策略调整或发布授权。

课程制作另在 content-generator 的 `feat/zero2agent-e02-s004-course` 分支启动，只交大纲、逐页正文、发布文案草稿与来源，不声称 HTML/PNG 已完成。
