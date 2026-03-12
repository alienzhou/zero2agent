# S01-E001: 任务清单

> 开发任务拆解与进度跟踪。

---

## 开发任务

### Step 1: 环境准备

- [ ] 安装 `@anthropic-ai/sdk` 依赖
- [ ] 配置环境变量（ANTHROPIC_API_KEY 等）
- [ ] 更新 `packages/core/package.json`

### Step 2: LLM 客户端

- [ ] 创建 `packages/core/src/llm/anthropic.ts`
- [ ] 实现 Anthropic 客户端封装
- [ ] 支持 baseURL 配置切换

### Step 3: 工具定义

- [ ] 创建 `packages/core/src/tools/index.ts`
- [ ] 定义 Tool 接口类型
- [ ] 实现 `read_file` 工具
- [ ] 实现 `list_directory` 工具

### Step 4: ReACT 循环

- [ ] 创建/更新 `packages/core/src/loop.ts`
- [ ] 实现主循环逻辑
- [ ] 实现工具调用解析
- [ ] 实现工具执行器
- [ ] 添加循环终止条件

### Step 5: 集成与导出

- [ ] 更新 `packages/core/src/index.ts` 导出
- [ ] 创建简单的 Agent 入口

### Step 6: 测试验证

- [ ] 端到端测试："帮我看看 package.json 的内容"
- [ ] 测试递归目录列表
- [ ] 测试错误处理（文件不存在等）

---

## 临时待办

- [ ] 确认 MiniMax 等兼容 API 的 baseURL 配置方式
- [ ] 决定是否需要简单的 CLI 入口用于测试

---

## 进度跟踪

| Step | 状态 | 备注 |
|------|------|------|
| Step 1 | 🔜 待开始 | |
| Step 2 | 🔜 待开始 | |
| Step 3 | 🔜 待开始 | |
| Step 4 | 🔜 待开始 | |
| Step 5 | 🔜 待开始 | |
| Step 6 | 🔜 待开始 | |

**状态说明**：
- 🔜 待开始
- 🚧 进行中
- ✅ 已完成
- ⏸️ 暂停
