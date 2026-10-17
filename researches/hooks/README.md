# Hooks 调研与固定案例

调查日期 2026-10-17，基线 4e06bb9；本节 Hook JSON v1 是产品契约，不冒充通用开源标准。

- [Claude Code 官方 Hooks](https://code.claude.com/docs/en/hooks)：事件按阶段返回控制结论，后置反馈发生在工具后；其接口也支持输入/输出改写与更广的自动化，本节限定为 pass/block。工作区信任与非交互入口的区别说明了不能仅凭项目文件授予本地代码执行信任。
- [OpenCode 官方插件](https://opencode.ai/docs/plugins/)：before/after 回调可阻断执行或改变参数，展示事件与控制回调要分别建模。本项目使用进程 JSON 检查，保持参数/权限固定，不加载任意进程内插件。

官方页面按调查日期引用，不把网页行为称为已实测某个二进制版本。当前原生平台与固定源码、模型记录由验收索引另列。

源码调查另固定上游 OpenCode 开发树 `8c173a8f3805d8e749d44311054b07e37a1b2ce1`（2026-10-17T12:20:33Z），当时最新发布为 v1.19.3（2026-10-16）。开发树插件布局已经变化，因此网页示例只用于比较阶段控制；不把该开发树、发布标签与本机实测混称同一版本。本节未运行上游二进制，也不兼容其插件格式。

## 跟练与验收

```bash
pnpm build
node researches/hooks/demo.mjs
# 显式选择真实服务；每次新建独立目录，不覆盖旧记录：
node researches/hooks/demo.mjs --live
# 同源码基线，只取消初始 API 目录预加载：
node researches/hooks/demo.mjs --live --scope-baseline
```

默认候选由宿主声明 `projectInstructions.scopes: ['packages/api']`，在首请求前按当前权限准备已知规则。冻结 cases v2 的任务、文件、效果断言、模型与 8 请求/12 工具/120 秒不变；请求覆盖层有意不同，不声称输入字节等价。最终同源码对照正例撞预算，候选两例通过，早期失败与旧源码通过分别保留。详情见 [紧凑验收](verification.json)、[四课证据范围](../../specs/E05-extensibility/acceptance.md) 和 [完整跟练](../../specs/E05-extensibility/S004-hooks/follow-along.md)。

原始请求/回包、协议、终端、截图、源码副本和失败只放在独立 draft Release 附件。按 [归档索引](evidence-archive.json) 下载、核对 tar SHA，再解压并运行 `node researches/hooks/verify-evidence.mjs /path/to/extracted`；只核对数据，不执行归档代码。draft 附件需要维护者权限，公开发布与网站部署另行处理。
