# CLI E2E 测试

被测对象是**构建产物 + 真实进程**：所有用例通过 `spawn node packages/tui/dist/cli.js` 驱动，
因此能覆盖到进程边界上的行为——参数解析、环境变量校验、退出码、终端输出格式、交互模式的 stdin。
这是 `packages/core` 内单元测试和进程内测试都覆盖不到的部分。

## 两层结构

| 层 | 文件 | 是否调 LLM | 用途 |
|----|------|-----------|------|
| 契约层 | `src/cli-contract.test.ts` | ❌ | 进程契约：退出码、模式分流、stdin 处理、错误分支。零成本，可进 CI |
| 真实层 | `src/cli-live.test.ts` | ✅ | 完整任务闭环：读、写、删、多工具协同。消耗 token，默认跳过 |

契约层测错误分支时用了一个技巧：把 `ANTHROPIC_BASE_URL` 指向 `http://127.0.0.1:9`。
CLI 会走完全部启动逻辑，但请求必然失败，于是能在零 API 成本下测到错误处理路径。

真实层的断言对象是**磁盘上的最终事实**（文件内容、文件是否被删）和**终端可见输出**，
而不是模型返回的字符串——模型措辞不稳定，拿它做断言会导致测试随机失败。

## 运行

```bash
# 只跑契约层（真实层自动跳过）
pnpm --filter @zero2agent/e2e test

# 连真实层一起跑，需要有效的 API KEY
E2E_LIVE=1 pnpm --filter @zero2agent/e2e test
```

真实层需要同时满足两个条件才会执行：`E2E_LIVE=1` 且 `ANTHROPIC_API_KEY` 存在。
两者缺一即跳过，避免误烧 token。也可以在仓库根目录的 `.env.local` 里写 `E2E_LIVE=1` 长期开启。

> 跑之前需要先 `pnpm build`，因为被测对象是 `dist/` 产物。

## 写用例注意

- 涉及写、删的用例必须用 `makeTempWorkspace()` 创建临时目录，不要在仓库里操作
- 断言输出前先过一遍 `stripAnsi()`，CLI 输出带 ANSI 颜色码
- 想验证"模型真的用了工具而非凭空作答"，可以断言输出里出现了工具名
