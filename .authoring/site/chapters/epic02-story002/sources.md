# E02-S002 · 技术来源与证据

核对日期：2026-10-02。主线是本项目的已实现工具；P02–P04 先讲编辑工具演进与 Harness 变薄，P05 起进入当前实现。历史版本、内部评测与课程观点分别注明。

项目：[alienzhou/zero2agent](https://github.com/alienzhou/zero2agent)。核对提交 `07e969753ec599a61984a3a98e742487cbfbf1d8`；S002 完成 Tag `E02-S002-replace-in-file` → `c405767a1d1e5f0cbb3ab9de23854c2e7016aa08`。来源链接固定在核对提交；语义以源码和直接调用结果为准。

| ID | 图内判断 | 原始来源 | 类型与核查范围 | 页码 |
|---|---|---|---|---|
| C01 | write_file 全量写；replace_in_file 用新旧片段表达局部修改。 | [Story README](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/specs/E02-act-and-execute/S002-replace-in-file/README.md)、[工具实现](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/packages/core/src/tools/replace-in-file.ts) | 项目事实；减少模型重复输出无关内容是接口分工推论，不宣称量化加速。 | 1、5、17 |
| C02 | path、old_string、new_string 必填；replace_all 可选，只有严格 true 才开启。原文逐字符匹配，含空白与换行。 | [工具实现与 schema](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/packages/core/src/tools/replace-in-file.ts) | 已核对源码；精确匹配/空白失败直接调用验证。 | 6、10 |
| C03 | 默认零次与多次均不写文件；唯一匹配写入成功；回执含实际处数。 | [countOccurrences 与 execute](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/packages/core/src/tools/replace-in-file.ts)、[既有测试](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/packages/core/src/tools/__tests__/replace-in-file.test.ts) | 已核对源码，真实工具案例 ambiguous、unique、whitespace；核对拒绝后的文件全文未变。 | 7、8、9、16 |
| C04 | 显式批量替换全部非重叠字面量匹配；零次仍报错；字符串、较长名字中的片段也会匹配。 | [split / join 实现](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/packages/core/src/tools/replace-in-file.ts)、[本课复现脚本](./verify-examples.mjs) | batch、batch-not-found、substring-batch 实际调用；不具备 AST / 作用域语义。 | 11、16 |
| C05 | 空原文被拒绝；新内容可为空；插入可通过保留唯一锚点表达。 | [工具实现](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/packages/core/src/tools/replace-in-file.ts)、[技术设计](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/specs/E02-act-and-execute/S002-replace-in-file/details/01-technical-design.md) | insert、delete、empty-original 实际调用；原文末尾含换行时删除该换行。 | 12 |
| C06 | 路径→空原文→stat→readFile→匹配检查→split/join→writeFile→回执。磁盘仍读写全文。 | [execute 顺序](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/packages/core/src/tools/replace-in-file.ts) | 已逐步核对源码；图中核心代码是简化示意，不宣称原子写入或锁定文件。 | 4、13 |
| C07 | 字符串 replacement 中 $& 展开成旧匹配；split/join 与 replace 回调能保留字面量 $&。 | [本课 JS 运行表达式](./verify-examples.mjs)、[既有特殊字符测试](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/packages/core/src/tools/__tests__/replace-in-file.test.ts) | 3 个 JS 表达式直接运行，并执行真实工具 dollar-literal 案例。 | 14 |
| C08 | 路径校验为 resolve/relative 字面路径校验，未解析软链接真实目标。 | [path-guard.ts](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/packages/core/src/tools/path-guard.ts) | 已读源码及明确注释；outside-workspace 实际拒绝。未执行向工作区外写入的软链接实验。 | 15 |
| C09 | 没有 read_file 调用状态约束、文件锁、版本检查、自动回滚和编辑后编译/测试。成功只确认文本替换。 | [完整 execute](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/packages/core/src/tools/replace-in-file.ts)、[Backlog](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/specs/E02-act-and-execute/S002-replace-in-file/details/04-backlog.md) | 源码能力范围和工程推论；未做并发竞态复现；图内明确当前限制。 | 10、15 |
| C10 | 图内练习与回执来自真实工具直接调用；每个例子均重置文件。下一课为 S003 terminal。 | [本课脚本](./verify-examples.mjs)、[S003 README](https://github.com/alienzhou/zero2agent/blob/07e969753ec599a61984a3a98e742487cbfbf1d8/specs/E02-act-and-execute/S003-terminal/README.md) | deterministic examples；未调用模型 API，不作为模型使用工具的 e2e 验证。 | 1、5、8、9、10、11、12、16、17 |
| C11 | Cursor 在 2024-05-14 介绍 Fast Apply：规划与应用分开，专用模型输出完整文件。 | [Cursor 原文](https://cursor.com/blog/instant-apply) | 一手技术文章；历史架构，不据此断言今天的 Cursor 内部实现。图中对照为简化编辑示意。 | 2、4 |
| C12 | 2025 年初 Cline 已用精确匹配、逐行去空白、首尾锚点三级匹配。 | [v3.2.6 diff.ts](https://github.com/cline/cline/blob/1ae1d047cb931a72c6ba0ff1b2ccc72edf1ec03e/src/core/assistant-message/diff.ts)、[版本提交](https://github.com/cline/cline/commit/1ae1d047cb931a72c6ba0ff1b2ccc72edf1ec03e) | 固定历史源码；tag 对应提交时间 2025-01-30。反映匹配工程的复杂度，不作为模型错误率或行业普遍实践的统计。 | 2 |
| C13 | Replit 报告内部代码编辑评测的错误率从 Sonnet 4 的 9% 到 Sonnet 4.5 的 0%。 | [Anthropic 2025-09-29 公告](https://www.anthropic.com/news/claude-sonnet-4-5)、[官方案例中的身份归属，PDF 第 14 页](https://www-cdn.anthropic.com/38a1fb9db81446402a70bc45d104327aab12f3fe.pdf#page=14) | 公告中的客户 Michele Catasta 自述，身份核对为 Replit President；未披露该评测样本量与题型。图内横轴 0–10%，零值仅用点标示，不画非零柱。不是通用基准，也不是替换字符串的独立成功率。 | 3 |
| C14 | Pi 作者在 2025-11-30 展示 read/bash/edit/write 四个默认工具，edit 的合同为精确匹配旧文本。 | [Mario Zechner 原文](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) | 作者公开设计与接口；不把接口描述推断为最新版本底层没有任何容错，也不把四工具当成所有 Agent 的通用充分条件。 | 2 |
| C15 | 模型内化编辑能力后，可以减少专用应用模型与匹配补偿；本课先从基础版实现出发。 | 用户提供的 2026-05-02 分享 Action 章节（见 [research-notes.md](./research-notes.md)）及 C06、C11–C14 | 用户观点与课程推论；原始讲稿中的 90% / 60–70% 为个人估计，未采用。没有宣称所有编辑问题已经消失或 Fast Apply 全行业淘汰；路径、匹配、回执、diff 与测试继续保留。 | 3、4 |

## 运行记录

- 既有 `replace-in-file.test.ts`：2026-10-02 定向运行，14 个测试全部通过。
- 本课 `verify-examples.mjs`：11 个真实工具案例 + 3 个 JavaScript 表达式，结果写入 `output/example-results.json`，包含源码 SHA-256、提交和运行环境。
- 只在脚本创建的临时目录中调用工具，验证后清理；不改 Zero2Agent 代码或用户配置。
- 练习文件是本课构造的数据；工具回执是实际调用输出。覆盖的是确定性执行，不宣称真实模型能自动补上下文或安全规划批量编辑。
- 新增行业部分只使用有日期的公开原文和固定历史源码；P03 的百分比限于已注明的内部评测，不能与本课确定性工具测试混算。18 张上限仅是本用户的创作预算。
