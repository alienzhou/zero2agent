# E05-S001：让 Agent 先读懂项目约定

[首页](../../../README.md) · [E05 四课](../README.md) · [跟练](follow-along.md) · [验收](details/03-verification-checklist.md)

状态：实现、定向回归、离线案例及两例真实服务通过，课程 10 页通过双端检查；完整工程回归与最终自查通过。最终 AI 复核通过，按用户授权由 [PR #27](https://github.com/alienzhou/zero2agent/pull/27) 合入 main（`df7ef00`）；课程网站已于 2026-10-18 上线；社交平台图文发布另行记录。

修复一个金额计算函数，先让 Agent 读到根目录与 api 的开发约定，再执行文件工具。你会看到一次首次进入新目录的工具批次如何被标为“未执行”，以及下一请求如何带上正确规则。

本节按 [AGENTS.md 开放格式](https://agents.md/) 支持普通 Markdown 和目录嵌套，不要求私有字段。根、启动目录与工具目标的祖先链按需发现；明确用户要求可覆盖项目约定，文件正文不能授予工具权限。

```sh
pnpm build
node packages/tui/dist/cli.js --instructions
node researches/project-instructions/demo.mjs
```

查看与默认跟练均不需要模型密钥。交互入口是 `/instructions`、`/instructions refresh`、`/instructions off`、`/instructions on`；单次关闭用 `--no-instructions`。从子目录读取上层项目约定时，显式指定 `--instructions-root`，不自动向上搜索。

- [范围与代码导航](details/00-overview.md)
- [技术设计、API 与标准兼容](details/01-technical-design.md)
- [开发清单](details/02-task-list.md)
- [逐项证据与限制](details/03-verification-checklist.md)
- [后续事项](details/04-backlog.md)
- [复盘：不要把卸载规则误当成新规则](../../../retros/E05-S001-project-instructions.md)

固定交付版本：[E05-S001-project-instructions](https://github.com/alienzhou/zero2agent/tree/E05-S001-project-instructions)。原 review Tag 和历史证据保留。

课程生成源和 HTML 在本仓库维护；原始请求、截图与失败记录在独立校验归档中，Git 只保留必要夹具、复现脚本和精简结果。
