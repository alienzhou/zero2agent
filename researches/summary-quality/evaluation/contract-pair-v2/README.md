# 相同字段含义的成对 v2

基线/候选各完整 56 次，任务 54→55/56，候选关键项 55/56，严格门槛未通过。唯一失败为零压缩结果回查：tail/offset 无效后写 unknown，结构校验通过而事实评分失败。

相同输入、字段含义和必要失败回归保留在本目录。全部记录与逐请求用量在 [Release 归档](https://github.com/alienzhou/zero2agent/releases/tag/E04-S003-summary-quality) 的 `snapshot/researches/summary-quality/evaluation/contract-pair-v2/`；原结果不改。最终读取纠错版结果见[评测入口](../README.md)。
