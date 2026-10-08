# E04-S001 交付审计

原目标：完整推进E04-S001。用户追加要求：E04合为四课；课程页不能持续使用单调规则卡片。本次完成S001的实现、工程与实际效果验收、教学材料及可审阅交付；人工审查、main合并和网站部署继续以实际状态为准。

| 要求 | 权威证据 | 当前结论 |
| --- | --- | --- |
| 四课分工与S001范围 | .discuss/2026-10-08/e04-course-plan、Epic4 README及S001五篇details | 已实现S001，S002–S004保持规划，没有空壳Spec |
| 可取消的有限传输恢复、单一重试所有者 | request-executor.ts、真实HTTP/SSE专项33项、offline-confirmed.txt | 通过，SDK隐藏重试关闭 |
| 主模型、摘要、provider计数共用预算 | loop/context/agent、Core全仓446项 | 通过，实际attempt分别计数 |
| 半截流不提交历史/不执行工具 | failure-recovery.test.ts、真实SDK断流与PTY草稿证据 | 通过 |
| 新调用重新授权；重复失败/拒绝有界 | run-budget.ts/loop.ts、故障及权限回归、人工declined测试 | 通过 |
| 批次全配对、效果不重放、晚到结算 | 文件字节/Checkpoint专项、live fault injection、late.txt测试 | 通过；没有假装回滚 |
| 四种CLI入口、参数与展示 | run-options.ts、CLI/PTY专项12项及E2E全仓173项 | 通过 |
| 日志身份、原生退出与隐私 | diagnostics/run-log、exit7、只读live回归、正文排除断言 | 通过；用量缺失不猜成本 |
| 旧多轮/压缩/授权/保存/人工终端/Checkpoint兼容 | 默认pnpm test 620通过，另3项真实服务 | 通过实际范围，57离线live用例跳过 |
| 终端清理与输入所有权 | PTY无损原始字节、stty三路径与取消后新Turn | 通过darwin范围 |
| build、types、lint、format、site | acceptance下各原始结果及source-hashes.json | 通过，lint44既有警告 |
| 18页课程内容重写及双端验证 | author.cjs、content-plan、最终18HTML、verification-final/checks.json、作者实际看图记录 | 通过，图形按关系组织；作者自查不替代人工审阅 |
| 跟练/延伸/复盘/过程记录/导航 | follow-along、两篇deep-dive、Retro、dialogue/failures、上下游README和Changelog | 齐全 |
| 源与产物一致及证据来源 | source-hashes.json、课程源码哈希、PTY/live来源 | 当前字节吻合，原失败不覆盖 |
| 原主工作区用户修改保留 | 主工作区.snapshot.yaml/review.md的前后sha256 | 最后推送前再次核对 |
| 固定Tag、远端分支和PR | 尚待实际创建和远端身份核对 | 未完成，不能据本表标记整目标完成 |

已知范围：一次日志不可用提示复测未再出现，原因未确定；慢shell夹具曾超过生产采集窗口，原断言与时限未放宽，默认全仓重验通过。未知费用、任意JS硬终止、跨进程执行恢复与外部幂等属于边界/后续课程。
