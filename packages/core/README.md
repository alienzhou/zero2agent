# @zero2agent/core

Agent 核心逻辑包。

## 测试

### 单元测试

```bash
pnpm --filter @zero2agent/core test
```

### 端到端测试

E2E 测试已迁移到仓库根目录的 [`e2e/`](../../e2e/README.md) 包，被测对象是真实 CLI 进程而非本包的导出。

```bash
# 契约层，不调 LLM
pnpm test:e2e

# 含真实 LLM 层，需要 API KEY
pnpm test:e2e:live
```

配置方式见 [`e2e/README.md`](../../e2e/README.md)。
