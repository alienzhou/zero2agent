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
| 原主工作区用户修改保留 | 主工作区.snapshot.yaml/review.md的前后sha256 | 再次核对两份sha256均与开始一致 |
| 固定Tag、远端分支和PR | PR #23已Open/Draft、MERGEABLE、已关联聊天；远端Tag E04-S001-failure-recovery固定21e946d | 已核对远端引用与课程字节；后续记录提交不改变Tag |

已知范围：一次日志不可用提示复测未再出现，原因未确定；慢shell夹具曾超过生产采集窗口，原断言与时限未放宽，默认全仓重验通过。未知费用、任意JS硬终止、跨进程执行恢复与外部幂等属于边界/后续课程。


远端固定课程版本：`E04-S001-failure-recovery` → `21e946dae8208e5391edc14ff3321ae26e2fd114`。[PR #23](https://github.com/alienzhou/zero2agent/pull/23)为Open/Draft，目标main，分支codex/e04-s001-failure-recovery，创建后已通过app工具关联当前聊天；未配置GitHub状态检查。本记录属于随后交付状态更新，固定Tag保留当时完整实现、课程与工程证据。

最终静态核对：297份改动/新文件（含解压gzip）均未包含当前配置密钥；新增/改动Markdown相对链接全部存在。全部记录源码哈希与当前字节相同；固定Tag中的作者源、CSS及18份HTML与最终浏览器QA字节逐一相同。

原工作区未提交文件仍保留：.discuss/.snapshot.yaml sha256=20fb81107425e4e15ecedd0b96de8b4102443d8508b06398bf54525e8b903f62，review.md sha256=6027f663b68817df6af5c69105ffc2dc4d122eb557b9b381ca403a73ea7c3dd9。独立worktree的实现不覆盖它们。

逐项工程、教学和可审阅交付要求均有对应证据。人工审查、main合并与网站部署尚未进行，未以AI自查替代这些后续动作。
