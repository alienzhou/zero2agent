# E01-S001: 任务清单

> 开发任务拆解与进度跟踪。  
> **Story 状态**：✅ 已完成（Step 1–6 已与 E01-S001 交付对齐；「临时待办」仍为 Backlog。）

---

## 开发任务

### Step 1: 环境准备

- [x] 安装 `@anthropic-ai/sdk` 依赖
- [x] 配置环境变量（ANTHROPIC_API_KEY 等）
- [x] 更新 `packages/core/package.json`

### Step 2: LLM 客户端

- [x] 创建 `packages/core/src/llm/anthropic.ts`
- [x] 实现 Anthropic 客户端封装
- [x] 支持 baseURL 配置切换

### Step 3: 工具定义

- [x] 创建 `packages/core/src/tools/index.ts`
- [x] 定义 Tool 接口类型
- [x] 实现 `read_file` 工具
- [x] 实现 `list_directory` 工具

### Step 4: ReACT 循环

- [x] 创建/更新 `packages/core/src/loop.ts`
- [x] 实现主循环逻辑
- [x] 实现工具调用解析
- [x] 实现工具执行器
- [x] 添加循环终止条件

### Step 5: 集成与导出

- [x] 更新 `packages/core/src/index.ts` 导出
- [x] 创建简单的 Agent 入口

### Step 6: 测试验证

- [x] 端到端测试："帮我看看 package.json 的内容"
- [x] 测试递归目录列表
- [x] 测试错误处理（文件不存在等）

---

## 临时待办

- [ ] 确认 MiniMax 等兼容 API 的 baseURL 配置方式
- [ ] 决定是否需要简单的 CLI 入口用于测试

---

## 进度跟踪

| Step | 状态 | 备注 |
|------|------|------|
| Step 1 | ✅ 已完成 | S001 交付 |
| Step 2 | ✅ 已完成 | S001 交付 |
| Step 3 | ✅ 已完成 | S001 交付 |
| Step 4 | ✅ 已完成 | S001 交付 |
| Step 5 | ✅ 已完成 | S001 交付 |
| Step 6 | ✅ 已完成 | S001 交付 |

**状态说明**：
- 🔜 待开始
- 🚧 进行中
- ✅ 已完成
- ⏸️ 暂停
