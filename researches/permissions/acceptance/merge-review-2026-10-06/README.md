# PR #17 合入准备核验

2026-10-06。用户询问“17 是不是搞完了，可以准备合入了”。本轮在干净的权限工作区，将 main 的在线教程与制作流程纳入候选，再检查工程与资料完整性。

## 候选与源码

- main 基线：ce4d721；集成提交：d323848，合并无冲突。
- packages/ 与已验收的生产版本 73ecdbc 无差异，e2e/ 与 8e47cae 无差异。此次只同步主干站点、整理中英文课程入口和补充核验记录。
- AI 复核 Controller、Loop、Agent、路径守卫、CLI Approval 与相关测试，没有发现本课范围内的新阻断。默认询问、一次请求绑定、取消/超时、审批后边界重查和拒绝无副作用均有覆盖。

## 本轮重新执行

| 检查 | 结果与证据 |
| --- | --- |
| pnpm build | 通过，全部工程包构建完成 |
| E2E_LIVE=0 pnpm -r --workspace-concurrency=1 run test --no-file-parallelism | [463 通过](./offline.txt)：cdp-debug 1、core 375、确定性 E2E 87；50 live 按本轮配置跳过 |
| pnpm lint | [0 错误、15 条已有告警](./lint.txt) |
| e2e tsc --noEmit | 通过，退出码 0，无诊断 |
| 改动 TS 的 Prettier 检查 | [通过](./changed-ts-format.txt) |
| pnpm site:build | [10 章、135 篇图解通过资源和页序校验](./site-build.txt)，重建不改变站点产物 |
| 离线权限示例 | [拒绝无文件、批准有文件](./permission-demo.txt)，回执正确配对 |
| git diff --check origin/main...HEAD | 通过 |

## 已有真实模型证据

重新核对 runtime-audit：压缩证据 SHA-256 与 summary.json 一致，50 份原始记录的哈希均匹配原 JSON 编码，137 项汇总状态全部通过。50 live 与 124 次 HTTP 200 是此前 macOS / MiniMax-M2.7 的实测结果；本轮没有再次调用真实 API。生产和测试源码未变，因此保留已有证据，并用此次离线回归验证与站点主干的整合。

详见[原始实测与范围](../runtime-audit/README.md)。不把原全量失败与补跑改写成一次全绿，不扩大为 Linux、Windows 或竞品实机均已测。

## 合入判断

工程实现、本课交付和当前本机自动检查已完成，可以进入合入。课程维护入口已统一到本仓库，中英文 README 同步进度。此记录是 AI 复核和自动回归，人工审阅由用户完成；PR 仍等待合入，GitHub 没有云端 CI 检查项。
