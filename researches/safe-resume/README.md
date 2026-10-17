# S004 验收与证据

本目录只保存复现脚本、精简结果和归档索引。原始进程快照、日志、请求正文及截图位于独立证据包，避免实验附件进入 Git 历史。

- [分层汇总](./verification.json)：命令、结果、源码和运行时哈希。
- [归档索引](./evidence-archive.json)：文件名、SHA-256、字节数与下载入口。
- [离线/真实服务复现](./demo.mjs)：默认只用本机 HTTP；`--live` 才调用已配置服务。
- [故障矩阵](../../e2e/src/safe-resume.test.ts)：17 项定向测试，包括真实子进程和 PTY。
- [课程检查](../../scripts/e04-s004-course-check.mjs)：所有截图写入 tmp，不写入 Git。

审阅阶段的证据包放在 [GitHub 草稿 Release E04-S004-safe-resume-review](https://github.com/alienzhou/zero2agent/releases/tag/untagged-770faef92672460c60f5)，供有仓库权限的 reviewer 下载；不会把草稿说成已公开发布的课程版本。下载后先核对归档 SHA-256，再解压校验：

```sh
shasum -a 256 e04-s004-evidence-20261016.tar.gz
mkdir evidence
tar -xzf e04-s004-evidence-20261016.tar.gz -C evidence
node researches/safe-resume/verify-evidence.mjs evidence
```

归档包含 `evidence/` 的原始失败与最终输出、`source/` 的被验证源文件及 `manifest.json`。复现脚本记录 git HEAD，同时记录实际源码与构建产物哈希；若运行时尚有本轮未提交改动，以哈希对应的归档源码为准。

最终真实服务一例为 3 次模型请求，两个文件各实际写入一次。请求别名为 `claude-sonnet-4-20250514`，服务自报 `MiniMax-M3`。此前实施阶段同一固定案例也通过；各次独立目录均保留；最终存储版本调整后重新验证，没有覆盖前次记录。测试失败主要来自早期夹具错误，修正原因见复盘，原始失败日志也保留。

目前验证 macOS 本机、进程终止与重新启动；没有宣称其他平台、断电或外部系统恰好一次执行。2026-10-17 用户已明确授权最终复核通过后合并，实际状态见 [PR #26](https://github.com/alienzhou/zero2agent/pull/26)；没有把用户授权等同于人工逐行审查，网站未部署。最终复核的修复、重验与独立追加证据包见 verification.json 的 finalReview；此前原始记录保持不变。
