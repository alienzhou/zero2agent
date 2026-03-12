# ReACT 基础版实现方案讨论

## 🔵 Current Focus
- 所有决策已确认，准备进入实现阶段

## ⚪ Pending
（暂无）

## ✅ Confirmed

### 版本与迭代管理

- **D13**: 版本编号 - 采用两层结构：Stage（阶段）+ Iteration（迭代）
  - 格式：`S01-E001`（Stage 2位 + E + 迭代3位）
  - 每个 Stage 内迭代从 001 开始
  - E000（仓库初始化）保留原样，不加 Stage 前缀
- **D14**: Stage 1 定位 - 基础 POC，核心是跑通模式和流程，非完美工程化
- **D15**: Commit Message 格式 - `[S01-E001] type(scope): description`
- **D16**: 索引文件维护 - 每次 commit 检查更新：
  - CHANGELOG.md：必须更新
  - specs/README.md：新建 Spec 时更新
  - retros/README.md：新建复盘时更新
- **D17**: Git Hook - 添加 post-commit hook 提示 AI 检查索引文件

### 技术实现

- **D01**: MVP 定位 - 这是 Toy/Demo 级别，重点是让人建立"调用模型完成任务"的意识
- **D02**: 工具范围 - 只做 2 个只读工具（read_file, list_directory）
- **D03**: LLM SDK - 使用 Anthropic TypeScript SDK（@anthropic-ai/sdk），支持通过 baseURL 配置切换模型提供商（如 MiniMax）
- **D04**: 调用方式 - 使用 Anthropic Tool Use（stop_reason: tool_use）
- **D05**: 抽象程度 - 初期少做抽象，后续阶段再拆分工程化
- **D06**: 课程设计 - 分阶段迭代，S01-E001 为基础版，后续逐步完善
- **D07**: read_file 工具 - 支持行号范围（start_line, end_line 参数）
- **D08**: list_directory 工具 - 支持递归（recursive 参数）
- **D09**: 输出格式 - 纯文本，对模型友好
- **D10**: 路径安全 - 基础版暂不做安全检查，后续迭代添加
- **D11**: 错误处理 - 返回错误信息字符串，让模型能自我纠正
- **D12**: 递归目录格式 - 缩进表示层级 + 完整相对路径（方便模型直接使用）

## ❌ Rejected
- 过度抽象（Tool Registry、Plugin 系统等）
- 复杂的错误处理和重试机制
- 文件写入等危险操作（初期只做只读）
- OpenAI SDK（改用 Anthropic SDK）

## 📋 Current Status

### 已有基础
- E001 已完成：基础 Agent 结构、LLM 调用、简化版 Loop
- 架构决策已确认：Monorepo 三包结构
- loop.ts 中已预留 tool_calls 处理位置

### 待实现
- 工具定义系统 (Tool Definition)
- 工具注册表 (Tool Registry)
- 工具执行器 (Tool Executor)
- LLM 响应解析（提取 tool_calls）
- 工具结果格式化

## 🔍 可参考的模式

1. **OpenAI Function Calling 模式**
   - 优点：LLM 原生支持，格式规范
   - 缺点：与 OpenAI API 耦合

2. **LangChain Tool 模式**
   - 优点：成熟生态，抽象良好
   - 缺点：过于复杂

3. **经典 ReACT Prompt 模式**
   - 优点：简单直接，模型无关
   - 缺点：需要解析自由文本

4. **Anthropic Tool Use 模式**
   - 优点：Claude 原生支持
   - 缺点：与 Claude API 耦合

5. **统一 Tool 抽象 + Adapter 模式**
   - 优点：灵活可扩展
   - 缺点：初期实现复杂度高
