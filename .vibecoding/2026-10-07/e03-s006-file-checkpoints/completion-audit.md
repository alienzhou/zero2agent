# E03-S006 交付自查

用户要求完整推进，并排除 shallow Git 模拟快照。实现采用受信任路径、内容定义分块、压缩 CAS；不初始化额外 Git、不扫描无关树。实测空间、耗时与恢复正确性分别陈述，未把简单基线当同保证性能比较。

## 交付物

- Core 控制契约 + 文件存储 + TUI/CLI；仍支持旧交互，详见 compatibility.md。
- 固定源码/官方文档研究、可复现实验、原始失败与真实进程/真实服务证据。
- 五篇 Spec、跟练、两篇深入阅读、复盘、导航、CHANGELOG、AGENTS.md。
- 20 页原创图解及同提交生成源/产物；PC/H5/页面哈希验证，系列封面保持从零到一做 Agent 为主标题。
- Draft [PR #22](https://github.com/alienzhou/zero2agent/pull/22)，分支 codex/e03-s006-file-checkpoints，Tag E03-S006-file-checkpoints。

## AI 源码审阅

沿权限 → 捕获 → 副作用 → 结算 → 冲突预览 → 恢复意图 → 清理引用检查。发现恢复意图交接双 pending 窗口，先以故障注入复现，再修正并保留缺关联时拒绝断言。正文/元信息存储、后台归属、会话原史与工具配对分别检查。所有实际失败见 failures.md，未将失败降级成已通过。

最终门禁 `8fde2fe`：575 离线通过 / 56 默认跳过；另外 6 项真实服务通过 / 0 跳过。build/types/format/whitespace、演示、终端恢复及课程 QA 通过；lint 44 warnings / 0 errors。验收 SHA-256 绑定代码与测试，后续交付提交只变文档/附件。

人工审阅未完成；未合入 main、未部署。macOS 一个平台，不声称网络文件系统、断电或任意外部写入者隔离已验证。主检出 .discuss/.snapshot.yaml 与 review.md 的用户修改保留。
