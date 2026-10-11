# 跟练：从大结果中取回证据

[课程](README.md) | [验收证据](details/03-verification-checklist.md)

使用 Node.js 22+、pnpm 9+ 和 POSIX bash。本课验证平台为 macOS；Linux/Windows 不冒称已经实测。

## 不需要密钥的实验

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @zero2agent/e2e exec vitest run src/result-references.test.ts
```

夹具在临时工作区创建一份约 315 KB 的长行文件，末尾放置随机 `EVIDENCE-<UUID>`。本地 HTTP/SSE 服务给出确定的模型响应，执行的是构建后的生产 CLI、真实文件与真实终端。

分别测试 read_file 和 terminal 两个来源，每套启动四个独立 CLI 进程：

| 进程 | 先预测 | 核对的实际结果 |
| --- | --- | --- |
| 创建 | 整份日志会进入下一次请求吗？ | 保存一次正文，下一次请求只含引用；随后读取末尾证据 |
| 恢复 | 是否需要再执行原工具？ | 使用保存的同一引用回读；源工具累计一次调用 |
| 拒绝 | 旧审批能否继续授权？ | 当前 read_tool_result deny 生效，不返回新正文 |
| 清理后读取 | 缺少正文是否会重跑命令？ | RESULT_MISSING，配对错误，源工具仍只有一次 |

每套 9 次实际 HTTP 请求，每份请求小于 30,000 字节；这不是通用 token 上限，只是该夹具观察到并断言的请求大小。Session JSON 不含长串 filler，正文 SHA-256 与元信息一致。测试结束自动清理工作区。

要保留本次证据：

```bash
E2E_EVIDENCE_DIR=../researches/result-references/acceptance/local \
  pnpm --filter @zero2agent/e2e exec vitest run src/result-references.test.ts
```

证据目录相对 E2E 包工作目录。压缩 JSON 保存请求、CLI 输出、实际正文身份和被测源码哈希，不保存 HTTP 授权头。

## 字节边界与失败实验

```bash
pnpm --filter @zero2agent/core exec vitest run src/__tests__/result-store.test.ts
```

重点看三个预测：

- `A中𠮷B` 的第一段 limit=6，应该返回 `A中`，next_offset=4，下一页从完整的四字节字符开始。
- 工作区软链接曾指向外部文件，删除软链接后，旧结果仍是外部来源。read-only 不得借此读取；default 回读需要新的批准。
- 工具实际执行后输出存储超限，只能报告“已执行但正文保存失败”。测试用计数器证明没有为了补输出再次执行。

其他用例覆盖相同内容去重、改坏/清理正文、过期回收、旧快照与续租共享正文、读取预算、取消、非法 UTF-8、目录别名、快照校验及真实终端流式保存。

## 真实模型实验

在本地 `.env.local` 配置既有的模型服务参数后运行：

```bash
E2E_LIVE=1 E2E_EVIDENCE_DIR=../researches/result-references/acceptance/live \
  pnpm --filter @zero2agent/e2e exec vitest run src/result-references-live.test.ts
```

这会调用你配置的真实模型服务。测试只创建合成日志，证据值不出现在 prompt 中。模型先调用一次 read_file，再用 read_tool_result 读取末尾；验收同时检查源调用次数、引用身份、配对结果与最终回答，不能只凭最终文本判断执行成功。未开启 E2E_LIVE 或没有密钥时，该项会跳过。

## 手工体验

```bash
node -e "require('fs').writeFileSync('large.log','line '.repeat(50000)+'\nEVIDENCE=MY-TAIL\n')"
pnpm --filter @zero2agent/tui start
```

让 Agent 先完整读取 large.log，再根据短回执读取末尾 256 字节。用 `/session` 查看当前会话，退出后用既有 `--resume <session-id>` 路径继续；正文和快照需要留在同一台机器和原工作区。若修改结果存储目录，旧正文不会自动迁移。

展示层使用既有工具详情，不新增快捷键；TUI、plain、管道与单次入口共享 Core 的结果策略。手工测试结束可删除合成的 large.log；清理结果目录前确认不再需要相关会话的引用。
