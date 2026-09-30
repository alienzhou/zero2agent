# S004 跟练与人工验收

> 本地候选版本：`7438fa892a9887595d91070731dab6eba6237370`。已完成本机自动验证和工具驱动的真实终端操作；没有替用户签收，也尚未推送、合入或打 Tag。

[Story](./README.md) | [验收证据](./details/03-verification-checklist.md) | [本轮复核记录](../../../.vibecoding/2026-09-30/e02-s004-acceptance/acceptance.md)

## 准备固定版本

已持有本地提交的作者，可以从 Zero2Agent 仓库创建独立跟练目录，避免影响原有未提交改动：

```sh
git worktree add --detach ../zero2agent-s004-practice 7438fa892a9887595d91070731dab6eba6237370
cd ../zero2agent-s004-practice
pnpm install --frozen-lockfile
pnpm build
```

该提交目前未推送，外部读者不能仅靠 clone main 获得它。正式发布时需先公开这一提交，再验证获取路径。环境要求为 Node.js ≥22、pnpm ≥9、POSIX 真实终端；本次实测是 macOS arm64，不代表 Linux 已验收，Windows 不支持。

## 练习一：让程序读取你的输入

在跟练目录运行，无需 API key：

```sh
node packages/tui/dist/cli.js --terminal 'read -r -p "Name: " name; printf "Hello %s\n" "$name"'
```

1. 确认看到命令、工作目录与 `Allow human terminal? [y/N]`。
2. 输入 `y` 并回车，等待 `Name:`，再输入虚构名字 `Zero2Agent`。
3. 应看到 `Hello Zero2Agent`，随后是 `Status: human-controlled completed`、`Exit code: 0`，并回到原命令行。
4. 再运行一次，确认时直接回车：应拒绝执行，不能进入 `Name:`。

不要把确认和后续输入作为一次粘贴提交；跨数据块粘贴隔离尚不在保证内。

## 练习二：保留 bash 状态，再返回 Agent

在已配置的 Agent REPL 中输入 `/terminal`，确认后逐条执行：

```sh
lesson_value=42; printf 'FIRST=%s\n' "$lesson_value"
printf 'SECOND=%s\n' "$((lesson_value * 2))"
exit
```

应依次得到 `FIRST=42`、`SECOND=84`；`exit` 后重新出现 Agent 的 `你:` 提示。这验证同一个 bash 会话保留状态，未调用模型代填。

没有模型配置时，可用以下离线入口只验证斜杠命令与终端恢复：

```sh
env ANTHROPIC_API_KEY=fake-manual-acceptance ANTHROPIC_BASE_URL=http://127.0.0.1:1 ZERO2AGENT_SKIP_LOCAL_ENV=1 node packages/tui/dist/cli.js
```

此入口只输入 `/terminal ...` 与 `exit`；它不是可聊天的假模型，普通自然语言消息会尝试访问这个不可用的本机地址。不要填真实 key。

## 练习三：隐藏输入与明确中止

在 Agent 的 `你:` 提示后输入：

```text
/terminal read -rs -p 'Token: ' token; printf '\nTOKEN_LENGTH=%s\n' "${#token}"
```

确认后等待 `Token:`，输入虚构字符串 `FAKE-ONLY-TOKEN` 并回车。应只看到 `TOKEN_LENGTH=15`，不回显该字符串。回执只含状态元信息，最后回到 `你:`；随后输入 `exit` 应正常退出 Agent。

另开独立入口运行 `node packages/tui/dist/cli.js --terminal 'sleep 300'`。确认后按 `Ctrl-]`，应结束接管并报告 `cancelled`。本次默认 sleep 场景得到 `Signal: 15`、CLI 退出码 143；其他程序的退出码可能不同，不能把这一数值当作所有取消的固定值。

Ctrl-C/Ctrl-D 会交给程序，不能替代 `Ctrl-]` 的宿主中止职责。

## 自动回归入口

```sh
pnpm build
E2E_LIVE=0 pnpm --filter @zero2agent/core exec vitest run src/tools/__tests__/terminal-p0-review.test.ts -t '后台 job 持有 pipe' --no-file-parallelism
E2E_LIVE=0 pnpm --filter @zero2agent/e2e exec vitest run src/human-terminal-contract.test.ts --no-file-parallelism
E2E_LIVE=0 pnpm -r --workspace-concurrency=1 run test --no-file-parallelism
```

PTY 自动测试还依赖 Python 3、bash、ps、stty、less。根目录的 `pnpm test:acceptance` 当前仍对应 S003 报告脚本，不用于证明本课验收。

## 留给用户确认的项目

- [ ] 在常用终端中，正文、光标、备用屏幕和窗口尺寸表现正常。
- [ ] 连续两次进入/退出后，方向键、删除键、中文输入和新的 Agent 输入正常。
- [ ] 已阅读代码与平台/隐私边界，认可这一候选版本作为课程跟练版本。
- [ ] 授权后再推送、合入和发布；本表没有代填签收。

工具驱动操作已证明上面的输入/输出流程，但不能替代你对常用终端画面、键感和最终发布范围的判断。
