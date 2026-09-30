# E03-S001：分步跟练

[Story](./README.md) | [验收清单](./details/03-verification-checklist.md)

## 版本与前提

本节代码位于本地 `feat/e03-s001-multi-turn` 分支，尚未推送、合入或打 Tag。先确认你拿到的是含 `packages/core/src/session.ts` 的版本；不要把旧 main 当作本节实现。

完成工程验证的代码提交为 `04894d5`，后续提交仅整理课程文档。发布状态独立于本地验证，不提供尚不存在的课程 Tag。

Node.js 22+、pnpm 9+。下列命令从仓库根目录运行；依赖尚未安装时先运行 `pnpm install`。

## 1. 先看到旧问题

阅读上一节的 `runLoop()`：它在函数内创建只有当前 user 的消息数组，end_turn 时直接返回文本。思考两处缺口：谁保存跨轮历史？最终回答为什么也必须保存？

本节基线是提交 `0ca861a`；可用 `git show 0ca861a:packages/core/src/loop.ts` 阅读，不必切换工作区。

## 2. 验证上下文真的跨轮传输

```sh
pnpm build
pnpm --filter @zero2agent/core test -- src/__tests__/session.test.ts
pnpm --filter @zero2agent/e2e test -- src/multi-turn-contract.test.ts
```

第一组捕获发送给 SDK 的消息快照。第二组启动本地 SSE 测试服务和真实 CLI，在临时目录调用 write_file，再发送下一轮输入；断言旧工具结果还在、`/new` 后只剩新消息，而且已经写入的文件没有消失。临时目录由测试清理。

这些测试不需要真实 API key，不向远端模型发送请求。它们验证消息契约与进程集成，不是假装模型理解了上下文。

## 3. 阅读与动手顺序

1. 看 Session 如何在 await 前上锁，以及 finally 如何解锁。试想 reset 在模型生成中执行会怎样。
2. 看 Agent 为什么只构造一次 Session，并固定创建时的 cwd。
3. 看 Loop 的 tool_use 与 max_tokens 分支：同样出现工具调用，为什么只有前者执行？
4. 查看网络错误测试：工具返回“file changed”之后请求失败，下一轮是否仍带有这条证据？
5. 自己补一个测试：连续两次失败后再成功，不应该出现孤立的 tool_use，也不能把上一次的未完成流式文本当成正式回答。

## 4. 手动体验两轮对话

按仓库首页配置模型后，在根目录启动：

```sh
node packages/tui/dist/cli.js
```

逐条输入，等每次重新出现 `你: ` 再继续：

```text
本次练习的代号是 cedar-17，只回复已记住，不要调用工具。
刚才的练习代号是什么？
/new
当前对话中，我是否告诉过你练习代号？不要猜测。
exit
```

第二问应能接续上下文；`/new` 后请求不含旧代号。自然语言回复受模型影响，判断传输是否正确请以测试的请求断言为准。真实模型体验会产生供应商 API 费用，本轮未自动执行。

## 5. 知道哪些事情不会发生

- `/new` 不回退文件，不停止后台进程，不清除终端滚屏，也不删除供应商记录。
- 退出后重新启动不会恢复会话。
- 历史不会自动压缩；长对话仍可能超过模型上下文限制。
- 本节没有新增全局中断 UI；已有 terminal 中止继续通过工具结果反馈。
