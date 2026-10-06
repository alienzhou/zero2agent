# E03-S002 技术来源

图解重制核对日期 2026-10-06；竞品机制保留 2026-10-05 调研快照。工程基线 `73ecdbc`，分支 codex/e03-s002-permissions；图文尚未对外发布。图内均为本期自制 HTML/CSS/SVG 教学示意，不是竞品实机截图。公开来源只取短机制结论，不复制原页面。

工程仓库：[Zero2Agent](https://github.com/alienzhou/zero2agent)。固定代码浏览可将以下路径定位到提交 73ecdbc；提交在开发分支，合并状态以 GitHub 为准。

| ID | 文件或来源 | 支持的内容 |
|---|---|---|
| C01 | specs/E03-product-foundations/S002-permissions/README.md | 课程目标、边界与下一课 |
| C02 | packages/core/src/permissions.ts | 三态、默认模式、规则优先级与精确匹配 |
| C03 | packages/core/src/loop.ts | 执行前闸门、批次快照与配对结果 |
| C04 | packages/core/src/permissions.ts | 请求 ID、冻结快照、超时和取消 |
| C05 | packages/core/src/__tests__/permissions.test.ts | 规则冲突、原始参数、单次范围 |
| C06 | packages/tui/src/approval.ts 与 cli.ts | TTY、JSON 参数显示、y/N、人工终端衔接 |
| C07 | packages/core/src/tools/path-guard.ts 与写工具 | 已有祖先及软链、重新校验、直接工具边界 |
| C08 | e2e/src/permission-contract.test.ts、permission-live.test.ts、permission-live-matrix.test.ts | 本地 SSE/PTY 与本课 22 项真实 MiniMax 验收 |
| C09 | scripts/e03-s002-permission-demo.mjs 与本课 follow-along.md | 离线跟练、临时文件效果与清理 |
| R01 | [Claude 官方权限文档](https://code.claude.com/docs/en/permissions) | deny/ask/allow 顺序，宿主强制执行 |
| R02 | [Codex 官方 sandbox 文档](https://learn.chatgpt.com/docs/sandboxing) | 审批与执行边界分开配置 |
| R03 | [Gemini 官方 policy 文档](https://geminicli.com/docs/reference/policy-engine/) | 规则优先级与无交互询问 |
| R04 | [OpenCode v1 权限文档](https://opencode.ai/docs/permissions/) | 最后匹配与一次授权；不混用 v2 语义 |

四产品完整比较及源码固定提交见工程 researches/permissions/README.md 与 source-pins.json。工程确定性验收检查调用配对和文件效果；真实模型试用只证明当前供应商、当前输入下的行为，不扩张平台范围。

重制图解的事实边界：P06 矩阵限定无显式规则且读写在工作区内；P08 未命中单条 allow 不等于直接 deny；P09 为当前 CLI 字段的教学重排，非实机截图；P10 使用简写请求 ID；P11 的取消仅作用于待审批请求；P12 的路径重查不等于系统沙箱；P15 离线脚本由宿主回调依次回答 deny/allow，并非让读者在该脚本中按键。2026-10-06 重新运行脚本，核对文件存在性与错误回执。
