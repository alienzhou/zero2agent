# @zero2agent/core

Agent 核心逻辑包。

## 测试

### 单元测试

```bash
pnpm --filter @zero2agent/core test
```

### 端到端测试

端到端测试使用真实 LLM API，需要在项目根目录配置 `.env.local`：

```
ANTHROPIC_API_KEY=your-api-key
ANTHROPIC_BASE_URL=https://api.example.com  # 可选
```

运行 E2E 测试：

```bash
pnpm --filter @zero2agent/core test src/__tests__/e2e.test.ts
```

> **注意**：E2E 测试会产生 API 调用费用，建议手动触发。
