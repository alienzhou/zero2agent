# 摘要质量：可复现脚本与验收摘要

固定集最终任务/关键项 **56/56**，普通事实 **63/63**；0/1/3 次压缩组为 8/8、24/24、24/24。模型配置、硬预算和严格门槛保持。原 728 份记录及新 56 份分别保留，没有补跑失败或拼接成功。

仓库保存生产相关剧本、评分器、三份无网络跟练、调用方输入、必要的真实失败回归夹具及紧凑结果摘要。全部原始记录、逐请求成本、工程日志、截图、中间方案和旧提交历史移到 [Release 归档](https://github.com/alienzhou/zero2agent/releases/tag/E04-S003-summary-quality)，下载地址、大小和 SHA-256 见 [evidence-archive.json](evidence-archive.json)。

解压归档后运行 `node researches/summary-quality/verify-archive.mjs /absolute/path/to/extracted-archive`，验证完整快照与历史 bundle 的逐文件 SHA-256；归档内 README 说明如何在独立审计克隆恢复旧提交。原冻结源码身份继续有效，但不再作为发布分支的祖先。

[评测方法和结果](evaluation/README.md) · [结果 JSON](evaluation/results.json) · [课程跟练](../../specs/E04-reliability-and-context/S003-summary-quality/follow-along.md)
