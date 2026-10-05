# E03-S002 验收证据

2026-10-05。最新 [本机实测补验](./runtime-audit/README.md)：50 项真实模型通过，50 份记录与 124 次 HTTP 200；463 项离线通过、50 live 默认跳过。生产代码 `73ecdbc`，补验测试 `8e47cae`。下表保留首轮交付记录，其 2 项真实模型不能代表全套实测。

首轮固定生产与测试候选 `73ecdbc`。提交只收录请求正文、响应状态和 CLI 输出，不保存 API key 或认证头。

| 验证 | 结果 | 证据 |
|---|---|---|
| 构建与 e2e TypeScript | 通过 | [build](./build.txt) / [types](./types.txt) |
| ESLint | 0 错误、15 条既有风格告警 | [lint](./lint.txt) |
| 本次改动 TS 格式 | 全部通过 | [format](./format.txt) |
| 全量离线 | 463 通过、30 live 默认跳过（Core 375，E2E 87，CDP 1） | [测试输出](./offline-tests.txt) |
| 权限专项单元 | 54 通过，已包含在 Core 总数 | permissions.test.ts |
| 实际 CLI / SSE / PTY | 20 通过，已包含在 E2E 总数 | permission-contract.test.ts |
| MiniMax-M2.7 真实 CLI / PTY | 2 通过，批准前无文件；批准后写入；拒绝后无文件；配对回执与 HTTP 200 | [输出](./live-tests.txt)、[批准](./permission-approve.json)、[拒绝](./permission-deny.json) |
| 课程渲染 | 16 页，0 布局错误、0 孤字告警，已逐页看主图/手机图 | [QA](./course-qa.json) |
| 本地预览 | 320/360/390/768/1440 五种视口无横向溢出，16 张图片加载，37 个资源 HTTP 200 | [预览 QA](./course-preview.json) |
| 交付 ZIP | 名单和逐文件哈希一致，10 项防陈旧/损坏验证通过 | [包哈希](./course-package-manifest.json) |

真实模型证据仅支持当前输入和供应商；确定性异常、软链接、取消、晚到回答、输入篡改和人工 PTY 正文边界由专项测试覆盖。课程完整源与 review 在 content-generator 的 `zero2agent-xhs/epic03-story002/`，固定工程代码仍待人工审阅与合并；课程未对外发布。
