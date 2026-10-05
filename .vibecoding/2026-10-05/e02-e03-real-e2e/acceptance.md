# E02-S004 / E03-S001 真实模型 E2E 验收

日期：2026-10-05。起点 `07e9697`，分支 `feat/e03-s001-multi-turn`；修复源码 checkpoint 为 `41df6ca`。本机 macOS arm64、Node.js 22.15.1、pnpm 9.15.9，使用生产依赖的原生 node-pty。

使用 MiniMax 国内 Anthropic 兼容端点及 `MiniMax-M2.7`。测试显式设置窗口 30000、输入上限 24000、主输出上限 4096、保守计数；较小的测试预算用于触发压缩，不代表模型的真实最大窗口。

## 发现并修复的缺陷

E03 摘要判断要求响应中每个块都是 text。MiniMax-M2.7 实际返回 HTTP 200、`end_turn` 和 `thinking + text`，导致 `/compact` 失败，自动摘要也失败，长会话最终被输入预算闸门拒绝。

有效修复前复跑为 **1 通过 / 2 失败**：E02 隐私接管通过，E03 手动和自动压缩失败。新增单测先复现 **2 失败 / 23 通过**，修复后 **25 通过**。

现在允许 thinking / redacted_thinking 元信息，但只采用 text。仍拒绝 tool_use / 未知块、非 end_turn、空摘要、非缩减摘要及超出大小或输入预算的摘要。没有通过切换模型或放宽预算隐藏故障。

## 实测结果

| 层级 | 结果 | 范围 |
|---|---|---|
| 真实 MiniMax + 构建后的 CLI + 原生 PTY | **3/3 通过** | 人工接管隐私、多轮纠正后手动压缩与重置、自动压缩 |
| 既有相关 CLI/HTTP/PTY 契约 | **44/44 通过** | 人工终端 31、多轮 6、压缩 7；使用受控本地提供商或不调用模型 |
| 新增跨课 CLI/SDK/PTY 契约 | **5/5 通过** | 多轮隐私、拒绝、真实进程树取消、非 TTY、后台压缩期间接管 |
| 完整离线回归 | **389 通过 / 28 live 跳过** | core 321、E2E 67、cdp-debug 1；包含上述本地测试和新增 5 个 core 回归 |
| 构建 / E2E 类型检查 | 通过 | 重建后执行 live；E2E `tsc --noEmit` |
| lint / 改动文件格式 / diff 空白检查 | 通过 | lint 0 errors / 15 既有 warnings；未声称全仓无历史格式问题 |

真实模型套件耗时 61.64 秒，三个场景均正常退出，所有上游请求 HTTP 200：

- E02：3 次主请求。确认前未执行，确认后 read -s 的虚构私密输入真实写入磁盘；虚构终端输出显示在本机，输入与输出标记均未进入任何模型请求。下一轮仍只收到回执元信息。
- E03 手动：7 次主请求、1 次摘要。实际读取随机项目配置，纠正端口为 9237，手动压缩后不重新读取文件，直接将摘要中的随机项目名和最终端口写入 recalled.json。`/new` 本地重置，不调用模型、不撤销磁盘副作用；新请求只有新输入。
- E03 自动：5 次主请求、4 次摘要。逐轮追加长材料并完成压缩；所有完整请求的保守估算均在 24000 内，实测最大 17124。此数值是本项目估算，不是提供商实际 tokenizer 的证明。

## 复现

在根目录 `.env.local` 配置 `ANTHROPIC_API_KEY` 和 `ANTHROPIC_BASE_URL`，不要把密钥写进命令或提交到 Git。真实模型命令会调用外部 API，输入为测试生成的虚构数据。

```sh
pnpm build
E2E_LIVE=1 MODEL_NAME=MiniMax-M2.7 CONTEXT_WINDOW=30000 MAX_INPUT_TOKENS=24000 MAX_OUTPUT_TOKENS=4096 \
  pnpm --filter @zero2agent/e2e exec vitest run src/human-terminal-session-live.test.ts --no-file-parallelism --reporter=verbose

E2E_LIVE=0 pnpm -r --workspace-concurrency=1 run test --no-file-parallelism
pnpm --filter @zero2agent/e2e exec tsc --noEmit -p tsconfig.json
pnpm lint
```

可选设置 `E2E_EVIDENCE_DIR` 保存请求正文、响应状态/块类型和终端输出；不保存密钥、认证头或环境文件。只有隔离目录中的虚构数据进入请求。

本轮机器结果保存在本机：

```text
/Users/zhouhongxuan/.codex/visualizations/2026/10/05/01a109f6-3679-7771-9bca-20d42c14b5a6/zero2agent-e02-review/
  e02-e03-e2e-existing.json
  e02-e03-e2e-cross-story.json
  e02-e03-e2e-minimax-m27.json          # 初跑含测试驱动误判
  e02-e03-e2e-minimax-m27-recheck.json  # 有效产品红测：1 通过 / 2 失败
  e02-e03-e2e-minimax-m27-fixed.json    # 同模型修复后：3 通过
  offline-regression.log
  live-traces/*.json
```

## 范围与待办

新增测试只验证这次实际执行的 MiniMax-M2.7 场景和本机 POSIX 路径；原有另外 25 项 live 测试未执行。不能由一次摘要事实恢复推断任意对话语义无损，也未验证 Linux、Windows、真实登录、复杂守护化逃逸或全屏终端矩阵。

此前源码复核中的 E02 TERM 强制覆盖仍为待办：人工终端把 vt100 / screen-256color 都替换成 xterm-256color。受控异步 stdout 慢写实验曾发现尾部丢失，但本机普通 TTY 同步写未复现，不能当作常规 macOS 使用故障。本次生产修复仅针对已经由真实 MiniMax 重现的摘要兼容问题。
