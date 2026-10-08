# 跟练：修改、查看、回退，再撤销回退

[课程](./README.md) | [验收](./details/03-verification-checklist.md)

## 固定版本

```bash
git fetch origin --tags
git switch --detach E03-S006-file-checkpoints-18p
pnpm install --frozen-lockfile
pnpm build
node scripts/e03-s006-checkpoint-demo.mjs
```

这会创建独立临时目录，本地 HTTP 返回确定性响应，生产 CLI / SDK 实际写入 settings.txt。最终 PASS 核对 light → dark → light → dark，并把文件手改成 human 后验证旧确认令牌失败。预期冲突会向 stderr 输出失败，演示本身仍应退出 0。

## 在真实 TUI 里操作

```bash
node scripts/e03-s006-checkpoint-demo.mjs --tui
```

1. 输入 `/checkpoints`，选择 write_file 记录，按 Enter。
2. 检查 `-theme=light` 和 `+theme=dark`；按 r 打开回退预览。
3. 按 Enter，确认默认是取消，文件仍为 dark。再次进入差异并按 r。
4. 这次按 y；得到新 UUID，它表示本次回退。对这个新记录再 `/undo UUID`，就能恢复 dark。
5. `/checkpoint-stats` 查看占用，Esc 返回。日志、会话列表和 `/compact` 仍可使用。
6. 输入 exit，临时目录会删除。不要把演示目录当作持久项目。

## 在自己的临时项目测试

构建后从项目目录运行仓库的 `packages/tui/dist/cli.js`；该路径需替换为自己的绝对路径。配置原有模型环境，用 Agent 的 write_file 或 replace_in_file 修改一个小文件。不要通过 terminal 模拟本课受保护编辑。

```bash
node /你的仓库/packages/tui/dist/cli.js --checkpoints
node /你的仓库/packages/tui/dist/cli.js --checkpoint UUID
node /你的仓库/packages/tui/dist/cli.js --undo UUID
# 阅读文件清单，复制本次完整令牌后执行：
node /你的仓库/packages/tui/dist/cli.js --undo UUID --confirm TOKEN
```

这些管理命令不需要 API key。先不确认，手工改一下同一文件；旧令牌必须报 `changed after preview`，文件仍是手工内容。新预览应显示 CONFLICT；没有强制覆盖快捷方式。

## 空间实验与失败实验

```bash
node scripts/e03-s006-checkpoint-benchmark.mjs
pnpm --filter @zero2agent/e2e exec vitest run src/checkpoint-store.test.ts src/checkpoint-runtime.test.ts
```

基准使用固定种子的高熵语料和临时存储，记录实际字节、分配字节、保存分位耗时及恢复后的字节哈希。它会更新 researches/file-checkpoints/acceptance/benchmark.json。测试另含真实子进程 SIGKILL、分步回退故障、磁盘预算、损坏块与并发锁。

如果运行被杀而留下 pending，先确认旧进程结束，再 `/recover UUID` 阅读当前文件状态。不要重发原工具请求来“补日志”。无法证明旧 PID 已退出、清单损坏或锁初始化本身中断时会拒绝恢复；保留目录供排查，不要自动删除未知恢复证据。

## 保护开关

`--no-checkpoints` 只关闭新捕获；历史列表与显式回退仍可使用。`--no-save` 和 `--no-log` 分别控制会话与诊断。若从 HOME 本身启动，默认存储就在工作区内；读取与关闭保护仍可启动，真正受保护写入需要把 ZERO2AGENT_CHECKPOINT_DIR 指到工作区外。

文件快照含正文。仅在自己的受控临时目录尝试删除和恢复，不把密钥文件放入演示材料。真实服务验收是独立层级，结果见验收页，不把离线 SSE 当成真实模型。
