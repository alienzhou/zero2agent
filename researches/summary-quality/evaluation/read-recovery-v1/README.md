# 最终读取纠错版：严格验收通过

原运行时冻结于 `00f0e786ef5e4cad06a336841f8cc828c6375838`。完整单轮 56 例，任务/关键项 56/56、普通事实 63/63、结构 56/56，无禁止调用。0/1/3 次组分别 8/8、24/24、24/24。

生产工具说明明确互斥读取方式，宿主登记未解决读取，在原预算内至多一次纠错；仍失败则未完成。有效读取不认证语义。真实一轮 56 次产物检查、0 次结构修复、0 次读取纠错；确定性前后对照单独证明流程变化。历史基线 54/56、前候选 55/56 是不同时间的同调用方输入对照，不能把全部差异归于纠错。

主模型 138 次、摘要 102 次、计数 0；输入 776311、输出 38211，cache_read 412932、cache_write 0，无缺失输入/输出用量。输入成本高于前候选。请求名、服务回执身份与来源范围见[评测入口](../README.md)。

紧凑证据见 [results.json](../results.json)，全部原始记录、逐例 SHA-256、41 份源码/运行时身份、历史复核及成本见 [Release 归档](https://github.com/alienzhou/zero2agent/releases/tag/E04-S003-summary-quality) 中的 `snapshot/researches/summary-quality/evaluation/read-recovery-v1/candidate/`。原 728 份与新增 56 份完整保留。

2026-10-16 仅重建提交并将运行产物移到附件：实际功能代码沿用已验收版本，无关格式化恢复主干；旧源码身份通过归档 bundle 查证。课程 [验收页](../../../../specs/E04-reliability-and-context/S003-summary-quality/details/03-verification-checklist.md)记录重建后的工程检查。
