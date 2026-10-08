# 失败与修正

- 调研克隆 `anthropic-sdk-typescript` 的 `v0.52.0` 分支失败：远端没有该名称。安装锁定 npm 0.52.0 后确认源码布局为 src/client.ts；后续使用包版本、锁文件 integrity 与源码哈希，远端 Tag 另行查询，不伪造版本对应。
- 远端查询找到实际 Tag `sdk-v0.52.0`，成功克隆到固定 Commit b7ebb908；报告同时注明安装包与源码版本。
- 首次实现 build 因旧 waitForAbort import 未使用失败；移除后通过。
- 首轮 104 项专项有 2 项旧断言失败：新增 SDK timeout/maxRetries 参数，以及迭代上限现在以预算错误停止。保留历史配对、实例复用和下一轮正常继续断言，调整对应选项/终态断言；随后 Core 全量 439 项通过。生产的 message_stop 检查没有放宽，旧完整响应 mock 改为真实发出结束证据。
- E2E 首轮 28 项有 1 项旧日志断言失败：exitCode=7 的原生终端现在正确标记工具 error，原断言只从 completed 查身份。改为核对实际 error 终态和同一请求身份，保留退出码及正文排除断言；随后 28 项通过。新增 CLI/PTY 故障专项扩充后 12 项通过。
- 离线跟练发现 plain 将返回 Error: 的工具显示为绿色 ✓。宿主改为从 Core 结构化 tool-state 读取终态，使用红色 ✗；不解析输出猜执行状态。
- lint 发现两处重写 catch 参数，改用独立 const 选择预算原因。E2E tsc 改从含 TypeScript 依赖的 workspace 执行，根目录未安装该二进制不是类型错误。
- 第一次保存原始全仓输出时，Core 440 通过、2 项 cwd 契约失败；为读取原生终态新增的 onResultMetadata 字段使旧精确对象断言失败。添加对该回调的显式断言，同时保留 cwd 固定、signal 和实际调用参数断言。原始失败保留在 acceptance/offline-initial.txt。
