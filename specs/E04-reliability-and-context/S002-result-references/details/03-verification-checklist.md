# 验收清单与实际证据

[课程](../README.md) | [跟练](../follow-along.md)

2026-10-11，macOS/darwin，Node v22.15.1，pnpm 9.15.9。源码始于 S001 合并提交 772ab67；实现与修正检查点 f37c348、9db688e、c2f8f5d，最终增量包含提示词更新和底层 terminal 来源守卫。最终字节见[源码哈希](../../../../researches/result-references/acceptance/final/source-hashes.json)。

## 工程与分层运行

| 层级 | 结果与范围 |
| --- | --- |
| pnpm build | 全 workspace 构建通过，使用生产 CLI 产物 |
| 默认 pnpm test | Core 464、E2E 178、CDP 1，共 643 通过；58 项真实服务测试默认跳过 |
| E2E TypeScript | tsc --noEmit 通过 |
| lint / 改动 TS 格式 | 0 错误、44 项既有警告；Prettier 通过 |
| 结果存储专项 | 17 项单元/真实进程测试通过，包含容量预留、UTF-8、外部来源软链接和直接调用前置检查 |
| 本地 HTTP/SSE + 新 CLI 进程 | read_file、terminal 各一套；每套 4 次进程启动、9 次 HTTP、源工具 1 次，全部请求 <30,000 字节 |
| 真实模型 | 1 项通过；从约 300 KB 合成日志回读提示词中未知的随机证据；以保存的调用与结果核对 |
| 既有 CLI / PTY 回归 | 默认全仓覆盖单次、plain、管道、TUI、后台归因与取消；后台日志修正定向 16 项通过 |
| site:build / site:check | 16 章、247 页；本课 18 页包含封面 |
| PC / H5 | Chrome 154.0.8037.99，1440×1000 与 390×844；目录、文字、放大、定位和画布检查通过 |

默认全仓不宣称执行全部真实服务矩阵。真实模型测试在最终提示词更新后再次通过；后续底层 terminal 直接调用来源守卫由专项与默认全仓验证，不把它称为真实模型 terminal 验收。未修改 TUI 键位或人工终端交互，已有 PTY 运行测试覆盖其兼容。

原始输出集中在 [acceptance/final](../../../../researches/result-references/acceptance/final)：[全仓](../../../../researches/result-references/acceptance/final/full-tests.txt)、[构建](../../../../researches/result-references/acceptance/final/build.txt)、[类型](../../../../researches/result-references/acceptance/final/e2e-types.txt)、[lint](../../../../researches/result-references/acceptance/final/lint.txt)、[格式](../../../../researches/result-references/acceptance/final/format.txt)。

## 契约逐项核对

- [x] 大工具结果进入历史前换引用，小结果兼容；大错误保留 is_error 与原 tool_use_id。旧历史仅改变发送视图。
- [x] SHA-256 正文去重；终端原 spool 通过硬链接封存，未重新加载全文写一份副本；快照不包含大正文。
- [x] 有效 UTF-8 长行按 next_offset 完整重建；非法字节额外提供 raw_base64；无 chunks 副本。范围参数、EOF、字符内部偏移与取消均测试。
- [x] 当前 deny 生效；外部来源重新审批；read-only 拒绝外部结果；删除源软链接不会改变既有来源归属。
- [x] 缺失、损坏、未知、过期和工作区不同分别失败，不假装没有副作用，也不自动重放源工具。
- [x] 单份、会话正文/预留、引用数均有界；活跃 spool 不能绕过容量。短输出释放预留；关闭后台日志按实际大小计入。
- [x] 旧快照回收尊重新引用的正文租约；显式版本与字段验证发生在替换会话前；reset 不删除已保存正文。
- [x] 回读消耗工具额度，后续模型请求继续过上下文预算；工具已执行而存储失败时保留真实结算事实。
- [x] 两种来源在不同 Node 进程间恢复同一正文；权限拒绝和删除正文后没有重放源工具。
- [x] 人工终端正文继续不采集，诊断日志保持白名单；后台尚在写入的路径明确 unsealed。

[读文件新进程证据](../../../../researches/result-references/acceptance/final/read_file-restart.json.gz)、[终端新进程证据](../../../../researches/result-references/acceptance/final/terminal-restart.json.gz)和[真实模型证据](../../../../researches/result-references/acceptance/final/live/result-references-live.json.gz)分别保留实际请求/调用、输出、字节身份和运行时源码哈希。它们都是合成资料，不采集用户工作内容或授权头。

## 失败与修正

[首轮 Core](../../../../researches/result-references/acceptance/core-initial.txt)暴露旧测试对工具数量、上下文参数和临时路径的假设，更新契约断言后通过。[首轮全仓](../../../../researches/result-references/acceptance/full-initial.txt)中，后台日志测试在 10 秒提示之前就因存储路径校验失败；修正 macOS 目录别名及缺失父目录解析后，[定向 16 项](../../../../researches/result-references/acceptance/alias-regression.txt)通过，没有放宽等待时间。

人工构造非法 UTF-8 测试时写错一字节，实际解码正确，修正了夹具。课程图内字距和取证绘制等待也在作者审阅中记录。这些记录不被最终绿色结果覆盖。

## 交付与限制

Spec 五篇、跟练、复盘、讨论、协作记录、四课状态及上下游导航已补齐。[课程审阅](../../../../.authoring/site/chapters/epic04-story002/review.md)和[双端报告](../../../../.authoring/site/chapters/epic04-story002/verification/checks.json)对应本次生成源及截图。

回读校验 I/O 与正文大小相关；全机无总磁盘配额；过期正文按会话懒回收，未再打开的目录、后台日志、遗留 pending/reserve/写锁需人工处理。只支持本机同工作区正文恢复，跨机器迁移和崩溃中的工具效果恢复不在本课。

固定 Tag 与交付核对见[交付审计](../../../../.vibecoding/2026-10-11/e04-s002-result-references/completion-audit.md)，合并状态见 [PR #24](https://github.com/alienzhou/zero2agent/pull/24)。已按用户授权通过 PR #24 合入 main；作者检查和自动测试不等同人工代码审查，课程网站已于 2026-10-18 上线。
