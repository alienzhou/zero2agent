# E05 四课规划讨论

2026-10-17。用户已要求规划四节课；具体实施方案是本次建议，尚未授权开始各课实现。基线为 main `0bfb9c92a095f32ee09578dc151b1403712809ed`（PR #26，E04 收束）。

> 那你先规划一下 E05 吧，也按四节课来安排，看看每节课具体做什么、怎么验收。

## 课表决定

保留原路线图的 AGENTS、Skills、MCP、Hooks 四个主题，依次编号 S001–S004；四课范围与验收以 [E05 计划](../../../specs/E05-extensibility/course-plan.md)为准。使用同一个小型双包 TypeScript 修复任务贯穿，S004 包含组合验收，不另开一节收官课。

首版 MCP 限本地 stdio 的工具接入；首版 Hook 限执行前、回执保存后、完成前三个同步检查点。这两节承担外部进程和未知效果边界，先限定协议表面，避免扩成账号平台或通用工作流引擎。

## 源码核对

| 现状 | 对本规划的影响 |
| --- | --- |
| `SystemPromptOptions.instructions` 已声明，`buildSystemPrompt` 未使用 | S001 要真正接通请求上下文；不能把预留字段当成已有能力 |
| `Tool.permission` 是宿主可信元数据；未知工具默认需要审批 | MCP 自报 annotations 不能直接映射为可信只读权限 |
| `Tool.execute` 返回字符串；`ResultSource` 以本地路径为主 | S003 要明确 JSON/非文本结果转换、外部服务身份和恢复后的回读授权 |
| 内置 Prompt 列出了固定工具且写有“不能访问网络” | S003 需按实际工具配置更新范围描述；不以扩大 Prompt 代替实际授权 |
| 展示回调通过 `notifyObserver`，不控制执行 | S004 新建等待式控制接口，不能在通知回调里偷偷启动脚本 |
| S004 恢复协议已覆盖逐工具开始/结算，尚无 Hook 阶段 | E05-S004 需要版本化扩展控制状态；工具与 Hook 的结算事实分开 |
| `packages/cdp-debug/skills/SKILL.md` 是既有使用指南，头部不是标准 YAML frontmatter | S002 应修正格式或明确普通指南身份，不用非标准文件证明标准兼容 |

## 指令优先级的更新建议

旧 [E01 D06](../../2026-04-27/e01-s004-prompt-structure/decisions/D06-instruction-position-without-loading.md) 曾提出 `System > Project Instruction > User Preference > Task`，当时只预留分层，没有实现加载。

本次不沿用“项目文件高于用户当轮明确任务”的表述。S001 拟明确：宿主硬边界不可由任何文本放宽；用户明确任务可覆盖项目约定；项目目录越具体，相关文件规则越具体。正式请求构造与提示位置由 S001 Spec 定义并测试；不更改这份历史讨论，也不声称已经实现通用自然语言冲突解析。

## 外部一手来源

2026-10-17 查阅。以下用于核实格式和接口语义；课程中的配置布局、范围、上限和失败策略是 Zero2Agent 的实现建议，不宣称完整兼容某一产品。

| 来源 | 核实内容与本课选择 |
| --- | --- |
| [AGENTS.md 官方说明](https://agents.md/) | Markdown 项目指令、嵌套目录及明确用户要求的覆盖关系。S001 进一步限定工作区发现边界和首次副作用前的补载策略 |
| [Agent Skills 格式规范](https://agentskills.io/specification) | YAML frontmatter、名称/描述、正文及按需资源。S002 采用渐进加载，权限相关可选字段不自动授予能力 |
| [MCP 2025-11-25 Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | 工具发现/调用、分页、文本/结构化结果、错误与 annotations 的信任边界。S003 选择工具子集，声明不支持的内容 |
| [MCP 2025-11-25 Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) | stdio 子进程与 HTTP 是不同的传输入口。本课先做 stdio，远程认证另列 |
| [MCP Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) | 初始化、版本/能力协商和关闭；实施前锁定匹配的 SDK 版本 |
| [MCP Cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation) | 取消与正在执行的请求有关；课程仍按实际观察处理未知效果，不从取消推断回滚 |
| [Claude Code Hooks 官方参考](https://code.claude.com/docs/en/hooks) | 执行前、后、结束阶段有不同的控制语义。S004 借鉴检查点划分，定义更小的本项目协议，不复制其全部事件、退出码和自动续跑策略 |

本轮没有做竞品实机验收，没有安装新 SDK，没有启动 MCP/Hook，没有运行新的模型实验。网页文档不是实测证据。后续每课记录实际依赖版本、源码提交和运行平台。

## 验收与交付约束

- 每节验收表全部是门槛：实际请求、文件字节、服务调用计数与进程清理优先于模型自述。
- 四课共用小夹具；每课固定一正一负两个真实模型案例，不重新展开大规模摘要评测。
- 本地确定性回归与真实服务分层报告；失败保留，不能切模型或放宽要求获得表面通过。
- 课程每篇含封面不超过 18 页，分别使用目录树、加载层次、进程时序和恢复状态图。
- 原始日志、快照和截图从开始就写入忽略目录；Git 仅收小夹具、脚本和精简结果，完整证据另做带校验和归档。
- 规划阶段只建 Epic 入口和完整计划；实施某一 Story 时再补该节五篇 Spec、实现、测试和课程。
