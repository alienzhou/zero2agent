# 失败与修正

- 调研克隆 `anthropic-sdk-typescript` 的 `v0.52.0` 分支失败：远端没有该名称。安装锁定 npm 0.52.0 后确认源码布局为 src/client.ts；后续使用包版本、锁文件 integrity 与源码哈希，远端 Tag 另行查询，不伪造版本对应。
- 远端查询找到实际 Tag `sdk-v0.52.0`，成功克隆到固定 Commit b7ebb908；报告同时注明安装包与源码版本。
- 首次实现 build 因旧 waitForAbort import 未使用失败；移除后通过。
- 首轮 104 项专项有 2 项旧断言失败：新增 SDK timeout/maxRetries 参数，以及迭代上限现在以预算错误停止。保留历史配对、实例复用和下一轮正常继续断言，调整对应选项/终态断言；随后 Core 全量 439 项通过。生产的 message_stop 检查没有放宽，旧完整响应 mock 改为真实发出结束证据。
