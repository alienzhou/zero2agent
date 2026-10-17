# MCP：固定本地服务与验收

本节将 **MCP 2025-11-25 + 官方 TypeScript SDK 1.26.0** 固定为可复现组合。调查日期为 2026-10-17；这是一组教学兼容基线，版本升级应单独复核协议与测试。

## 协议调查与实现取舍

| 来源 | 调查结论与本节实现 |
| --- | --- |
| [生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) | 初始化协商版本与能力，发 initialized 后才发现/调用；本节仅接受固定版本及 tools 能力。 |
| [stdio 传输](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) | 子进程标准输入输出传逐行 UTF-8 JSON-RPC。官方 Client 负责协议，有界 Transport 在解析前限制字节并管理进程组。 |
| [工具](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | 工具名、输入 Schema、结果的 isError、structuredContent 与 outputSchema 分别处理。annotations 来自服务，不是本地授权依据。 |
| [分页](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/pagination) | 游标是不透明字符串；分页不能假定固定页大小。本节额外限制页数、工具数并识别循环游标。 |
| [取消](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation) | 取消可能晚于效果，服务也可能忽略；本节停止且核对未知效果。协议禁止取消 initialize，SDK 的取消通知在此阶段改为关闭连接。 |
| [SDK 1.26.0 发布](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v1.26.0) | 使用固定 release 的 Client、JSON-RPC 和工具结果 Schema；检查实际安装产物的 LATEST_PROTOCOL_VERSION 为 2025-11-25。 |

协议允许比本节更多的功能和 Schema。本产品首版支持文本/JSON、JSON Schema 2020-12 有界子集，不支持外部/内部引用、pattern、format、未知关键字和其他方言；拒绝发现而非删掉约束。仅本地 stdio 工具，远程传输、OAuth、Prompts/Resources、Sampling/Elicitation、Tasks 与多媒体后续再做。

`issue-server.mjs` 是仓库内固定 JSON-RPC 教学服务：两页工具目录、固定 issue、长日志、效果计数。故障模式只操作隔离的本地测试目录，不连接业务系统。它独立于 Client 实现，回归使用真实子进程与管道。

## 运行

```bash
pnpm install --frozen-lockfile
pnpm build
node researches/mcp/demo.mjs
# 配置当前模型服务后，可显式运行同一组冻结输入：
node researches/mcp/demo.mjs --live
```

运行会建立新的 `tmp/e05-s003/{offline,live}-*`。源与运行产物副本、原始请求/响应、协议事件、快照、效果与测试记录都在该忽略目录。成功/失败均保留，脚本不会自动重跑。每例最多 8 请求、12 工具、120 秒；请求配置名与服务报告名分别记录。

可运行 `node researches/mcp/probe-stdio.mjs`，通过透明本地 shim 保存双向原始协议字节、实际 SDK 工具表并核对服务后代 PID 退出；不发模型请求，也不调用 record_action。

跟练与独立校验见 [Story 跟练](../../specs/E05-extensibility/S003-mcp/follow-along.md)，结论与原始归档索引见 `verification.json` 和 `evidence-archive.json`。

下载独立证据附件后按 `evidence-archive.json` 的 SHA-256 校验并解压，在仓库运行 `node researches/mcp/verify-evidence.mjs /path/to/extracted`。脚本只读 manifest、源码副本与结果，不执行归档里的代码。
