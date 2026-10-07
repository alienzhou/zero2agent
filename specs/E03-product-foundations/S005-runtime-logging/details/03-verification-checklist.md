# 验收检查清单

以下状态在实际执行后更新，不把未运行项记为通过。

- [x] 正常请求、工具调用、审批、失败、取消与下一轮可按 ID 关联。
- [x] 主请求、摘要与 provider 计数有起止状态；SDK 内部重试边界说明准确。
- [x] 新建/恢复/保存失败与人工终端生命周期可追查；正文不采集。
- [x] 默认日志、关闭日志、多进程独占与工作区隔离。
- [x] 含密钥/正文的输入、响应和异常不出现在日志；observer 错误不影响执行。
- [x] 队列/文件上限、写入/打开失败可见，任务继续，日志不会冒充完整。
- [x] 正常退出刷新；强制终止可读取完整前缀并报告未闭环。
- [x] UUID、软链接、版本、中部损坏、残缺尾行与显示数量限制。
- [x] 无 API key 的列表/查看不调用模型；日志读取不修改会话或工具文件。
- [x] TUI 草稿/粘贴/快捷键、审批、取消、压缩、会话、PTY 与 plain/管道回归。
- [x] 构建、类型、lint、格式、离线测试、真实模型与原始失败证据。
- [x] 20 页渲染无越界，PC/H5 导航、文字、放大与系列封面。
- [x] 来源固定版本、文档互链、生产/测试/教材哈希核对。
- [x] 固定 Tag、草稿 PR 与最终交付审计。

## 最终自动验证

2026-10-07，macOS / darwin arm64，Node v22.15.1。生产与测试固定源码 **6ab631a12d8d21349b3e77c116dcba7381c6c4c5**；此后交付只增加教材、过程与验收附件。每个文件的 SHA-256、门禁命令/时间/退出码见 [summary.json](../../../../researches/runtime-logging/acceptance/summary.json)，`passed=true`、`sourceStable=true`。

| 层级 | 实际结果 | 能证明什么 |
| --- | --- | --- |
| 完整离线回归 | **555 通过，55 跳过，0 失败**：Core 409 / E2E 145 / CDP 1 | 生产代码与既有回归契约；55 项真实服务用例未在此门禁执行 |
| 新 SDK/HTTP 诊断 | Core 新增 7 项，通过 | 实际 Anthropic SDK、本地 HTTP；请求/工具身份、401、取消、计数、摘要、observer 隔离 |
| 新存储/CLI/PTY | E2E 新增 17 项，通过 | 原生文件效果、后台 close 的归属、人工终端私密字节排除、只读与真实 SIGKILL 前缀 |
| 指定真实服务复验 | **5 执行、5 通过、0 跳过** | 实际读取/重置、拒绝与另请求审批、取消并继续、跨进程恢复、S005 工具关联与无密钥查看 |
| 工程门禁 | build / E2E types / lint / 改动 TS 格式 / diff whitespace 全部通过 | lint 0 错误、29 警告；没有宣称零警告 |
| 可运行跟练 | S005 日志、S004 会话、S003 运行演示通过 | 本地夹具与实际 CLI/SDK/工具；不代表真实服务 |
| 终端恢复 | 正常退出、SIGTERM、SIGHUP stty 检查通过 | 当前 macOS 真实 PTY 的终端模式恢复 |
| 图文课程 | 20 页，无文字越界/重叠；站点 13 章、193 图解 | 图解构建与资源完整性 |
| PC/H5 阅读 | 1440×1000 / 390×844 通过 | 目录跳转、正文、放大/恢复、无横向溢出、pageerror 或 HTTP 错误 |

完整复现：`node scripts/e03-s005-acceptance-report.mjs --live`。真实服务门禁要求五项实际执行；跳过不满足门禁，且会产生模型费用。实际模型请求使用的名称和请求/响应类型存于真实服务附件，兼容端点不据此推断厂商内部的部署版本。

## 证据入口

- [真实服务结果](../../../../researches/runtime-logging/acceptance/live-results.json)及 [原始证据目录](../../../../researches/runtime-logging/acceptance/live-evidence/)：真实请求、PTY 字节、文件效果断言与日志内容；保存前检查 API key。
- [真实 PTY 录制元信息](../../../../researches/runtime-logging/acceptance/screens/capture.json)：96×30 / 42×18，日志状态、列表、选择、查看、End、窄屏与返回。PNG 为实际 node-pty 输出在 xterm.js 6.0.0 的回放；[原始字节](../../../../researches/runtime-logging/acceptance/screens/raw-pty.ansi.gz)无损保存，`.txt` 为去控制码/尾空白的派生展示。
- [课程逐页与双端报告](../../../../.authoring/site/chapters/epic03-story005/verification/browser-checks.json)，包含生成源、CSS 和全部页面 SHA-256；[作者复核](../../../../.authoring/site/chapters/epic03-story005/review.md)另记录 IAB 检查。
- [失败与修正](../../../../.vibecoding/2026-10-07/e03-s005-runtime-logging/failures.md)，保留最初精确上下文回归失败、收尾时机竞争和两轮真实服务审批失败。真实服务证据显示模型未发起调用；补充生产 Prompt 的调用/宿主审批与一次拒绝范围后，以原文件和回执断言复验通过。
- [交互兼容矩阵](../../../../.vibecoding/2026-10-07/e03-s005-runtime-logging/interaction-compatibility.md)对应旧编辑、审批、压缩、会话、命令控制、人工终端、plain 与管道路径。

## 人工与平台边界

- [ ] 人工代码审查与教学审阅、用户签收。
- [ ] Linux / Windows / 网络卷 / 跨主机 / 断电故障实机验证。
- [x] 按用户授权合并 [PR #21](https://github.com/alienzhou/zero2agent/pull/21)，合并提交 4ce87d2。
- [ ] 课程网站部署。

未勾选项没有记为通过。当前仅 macOS 实测；默认日志不收正文，但时刻、身份与用量仍是元信息。未闭环不能推断副作用没发生，日志没有工具重放或文件回退能力。人工终端遵守原有平台约束。

## 固定交付

[PR #21](https://github.com/alienzhou/zero2agent/pull/21) 已于 2026-10-07 按用户授权合入 main（4ce87d2），跟练 Tag `E03-S005-runtime-logging`。分支提交保留工程、测试与失败修正过程，Tag 固定最终教材与证据；没有移动旧课程 Tag。最后变更仅为交付文档，生产和测试哈希仍与 6ab631a 一致。

[逐项交付审计](../../../../.vibecoding/2026-10-07/e03-s005-runtime-logging/completion-audit.md)已核对源码、20 页生成源/产物、真实 PTY 原始字节与哈希、34 篇改动 Markdown 链接及 153 个文件的配置凭据扫描。主 checkout 的两处原有改动保持不变。

合并前复核：远端提交 1976e72 与固定 Tag 和验收生产/测试哈希一致，13 项门禁证据、五项真实服务、20 页 PC/H5、PTY 原始字节及 153 文件凭据扫描核对通过；PR 无冲突且没有待处理审阅意见。远端未配置 CI 检查。合并采用 merge commit，保留课程 checkpoint；本次没有标记未执行的人工专项审查为完成。
