# E03-S001 技术来源与核验范围

资料截止：2026-10-01。工程实现基线 `ea498a3` 与最终验收测试 `3829868` 已合入 `main`（`f883252`）并打 Tag；课程尚未对外发布。

公开项目：[alienzhou/zero2agent](https://github.com/alienzhou/zero2agent)。下表均为本项目源码、Spec或明确标注的教学情景。代码路径按zero2agent仓库根目录定位；版本以 `main` 和 Story Tag 为准。跨仓相对路径不写入发布来源。

| ID | 图中判断 | 项目内证据与核验范围 | 页码 |
|---|---|---|---|
| C01 | 本期合并多轮与压缩；下期权限与Approval | specs/E03-product-foundations/S001-multi-turn/README.md | 1、2、18 |
| C02 | 第二轮需要先前上下文 | packages/core/src/loop.ts；对话为教学示意，非模型实测 | 1、2、3 |
| C03 | Session/Turn/Loop生命周期与归属 | packages/core/src/session.ts；本期技术设计details/01-technical-design.md | 3、4、5 |
| C04 | Agent复用Session；静态调用一次性 | packages/core/src/agent.ts；P5省略配置的教学节选 | 5 |
| C05 | tool_use/tool_result按ID配对 | packages/core/src/loop.ts；Anthropic Messages协议范围，write_1是示意 | 6 |
| C06 | 失败留完整证据，发送视图可压缩 | packages/core/src/session.ts、context-manager.ts；端口3000→4000是教学情景 | 7 |
| C07 | 半截流不入史，输出截断不执行工具 | packages/core/src/loop.ts；参数框非事故截图 | 8 |
| C08 | /new清历史、摘要并取消后台压缩 | packages/tui/src/cli.ts、packages/core/src/session.ts、context-manager.ts | 9 |
| C09 | 主轮次/手动压缩/reset互斥，代次防迟到结果 | packages/core/src/session.ts、context-manager.ts | 9、12 |
| C10 | 验证请求和状态，不凭模型自述 | 本期Spec与工程验收清单；P16是验证方案，非本子任务新测试报告 | 16 |
| C11 | 根目录启动与逐轮练习 | 本期follow-along.md；P17为改编练习，未编造模型回答 | 17 |
| C12 | 原始会话仅内存，不做落盘恢复 | packages/core/src/session.ts与本期Story范围 | 18 |
| C13 | 完整预算、UTF-8保守估算、provider失败闭锁、45/65/85% | packages/core/src/context-budget.ts；比例以输入预算为分母，45%不是必达保证 | 10、11 |
| C14 | 轻量缩短、后台稳定前缀、前台等候接管、保留尾部 | packages/core/src/context-manager.ts；私有临时结果可按行回读，原始历史不删 | 11、12 |
| C15 | /compact前台命令与SDK三个入口 | packages/tui/src/cli.ts、packages/core/src/agent.ts、session.ts；getContext是消息视图，不是最终请求 | 13、17 |
| C16 | 大当前输入拒绝、失败不采用、超限有限恢复、不重跑工具 | packages/core/src/context-manager.ts、loop.ts、context-budget.ts | 14 |
| C17 | 摘要自身分块计数、分层、有限调用与重试 | packages/core/src/context-summary.ts；历史为引用材料，不执行指令；结构合格不证明语义无损 | 15 |
| C18 | HTTP/SSE协议验证与模型效果分开 | 本期details/03-verification-checklist.md；验收测试3829868全量379通过、25真实模型测试跳过，未调用真实模型 | 16 |
| C19 | 压缩实现已合入 main 并打 Tag，课程未发布 | `main` 的 `f883252`；CLI支持CONTEXT_WINDOW/MAX_INPUT_TOKENS/MAX_OUTPUT_TOKENS/CONTEXT_COUNTING | 17、18 |

## 当前核验状态

本次按上述核心源码与本期Story核对18页正文。代码基线ea498a3、验收测试3829868全仓379项通过、25项真实模型测试因缺少API Key跳过；包含预算29、摘要20、管理器22、Loop压缩12及真实CLI压缩7项测试。图内不固定测试总数，明细以工程验收清单为准。

本地HTTP/SSE服务能检查CLI实际请求、消息配对、预算与失败状态，不等于远端模型测试或摘要质量评分。不承诺任意厂商、任意大输入都能成功。

## 图源与字体

全部画面为本期HTML/CSS可编辑示意，无外部图片。使用本机Songti SC、PingFang SC与系统等宽字体，源包不分发系统字体。18页主图与手机图已逐页审阅；跨系统重建需复核换行与字体。
