# 协作记录

2026-10-08：核对 main `71ff873`、AGENTS.md 与四课候选课表。保留原工作区 `.discuss/.snapshot.yaml`、`review.md`；创建独立 Git worktree。依赖按锁文件安装，基线 build 通过。

读取固定 npm SDK 0.52.0 源码与 Anthropic 官方错误文档、Gemini CLI 固定源码。确认主模型使用 SDK 默认两次重试，摘要/计数显式关闭；SDK fetch 超时与整个流生命周期不同，message_stop 必须单独验证。使用仓库 repo-research 取证格式，不启动子代理。

agent-better-checkpoint 辅助 skill 仍缺失，按 AGENTS.md 普通 Story 提交保存阶段结果。完整实现和最终交付状态随后补充。
