# 执行闸门与一次批准

采用 Agent 私有 Controller 和显式宿主规则；不在展示 observer 里等待审批。复用 Session 的调用/结果配对。默认读允许、写/执行询问、无宿主拒绝；deny 先于 ask 和 allow。使用随机 request ID、冻结参数与有限等待；取消和过期结果不能放行。模式和 SDK 是宿主授权，不接受模型自报已批准。完整依据见 researches/permissions/README.md 与 S002 技术设计。
