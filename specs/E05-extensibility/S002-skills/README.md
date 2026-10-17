# E05-S002：Skills 的发现与按需加载

[首页](../../../README.md) · [E05 四课](../README.md) · [跟练](follow-along.md) · [验收](details/03-verification-checklist.md)

状态：调研、实现、工程回归、文档与 11 页课程已完成，已提交 [PR #29](https://github.com/alienzhou/zero2agent/pull/29) 待用户 review；未合并、未部署。真实服务保留两版完整成绩，逐例证据复用范围见验收页。

同一金额修复任务，Agent 先看到技能名称与描述，选中 `fix-with-tests` 才读取步骤，需要报告结构时再读取参考文件。单纯发现、加载和查看技能不运行脚本；后续命令仍经过当前宿主授权。

格式遵循 [Agent Skills 开放标准](https://agentskills.io/specification)，发现位置、数量、容量和刷新策略是本项目选择。默认项目 `.agents/skills/`，外部目录必须显式配置并经过当前读取权限。完整标准与实现差异见 [技术设计](details/01-technical-design.md)。

- [范围与导航](details/00-overview.md)
- [技术设计与具体上限](details/01-technical-design.md)
- [开发清单](details/02-task-list.md)
- [逐项验收](details/03-verification-checklist.md)
- [后续范围](details/04-backlog.md)
