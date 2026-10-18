# 主线课程完结

2026-10-18，Zero2Agent 的 E01–E05 五阶段主线正式完结：实现、测试、设计文档、跟练与图解课程均已交付，E05 四种扩展的组合验收完成。全部 22 节、317 页图解已在[课程网站](https://vibe-x.fun/zero2agent/)上线。

## 完结范围

| 阶段 | 主题 | 课数 | 图解页数 |
| --- | --- | --- | --- |
| [E01](../specs/E01-read-and-search/README.md) | 最小循环、搜索与 Prompt 结构 | 4 | 50 |
| [E02](../specs/E02-act-and-execute/README.md) | 文件修改、命令执行与人工终端 | 4 | 51 |
| [E03](../specs/E03-product-foundations/README.md) | 多轮、权限、TUI、恢复、日志与 Checkpoint | 6 | 110 |
| [E04](../specs/E04-reliability-and-context/README.md) | 失败恢复、结果读取、摘要与安全续跑 | 4 | 62 |
| [E05](../specs/E05-extensibility/README.md) | 项目指令、Skills、MCP、Hooks 与组合验收 | 4 | 44 |
| 合计 | 五阶段主线 | 22 | 317 |

课数、页数与顺序以本次完结时的 [course.json](../site/course.json) 为快照。E04 当前四课为 18 / 15 / 15 / 14 页，E05 为 10 / 11 / 11 / 12 页；旧验收中的页数仍描述当时版本。

E05 的交付分别为 PR #27、#29、#30、#31；四种扩展的当前门槛、真实模型观察和平台边界见[组合验收](../specs/E05-extensibility/acceptance.md)。各课保留原验证版本、失败记录和能力限制，本次收官不把历史成绩改写成对所有版本的一次统一验收。

## E02-S004 的固定课程版本

补发课程 Tag `E02-S004-human-terminal`，固定到 PR #13 已合入的最终脱敏交付提交 `68e2c876be83f857cfc4696078be61f48d65b33a`。

它与原工程验收基线 `b200c9fc9390be59ec52f2e48fa8e8bf9fa7c770` 的 `packages/`、`e2e/`、`scripts/`、`package.json` 和 `pnpm-lock.yaml` 完全一致，增加的仅为跟练、入口和交付说明。标签不指向 E05 主干，也不移动其他课程的既有标签；原工程证据继续对应原源码。

```sh
git fetch origin tag E02-S004-human-terminal
git show --no-patch E02-S004-human-terminal
```

操作步骤见[固定版本跟练](../specs/E02-act-and-execute/S004-interactive-commands/follow-along.md)。想使用五阶段的完整能力时使用 `main`；想复现单节课时使用该课的固定 Tag。

## 完结后的维护

- 当前状态以本页、课程目录和各课入口为准。Changelog、带日期的审阅与复盘保留当时的交付、部署和验证事实；历史中的“未部署”不能用来判断当前站点。
- 课程网站已上线。小红书等平台的图文分发另行记录，网站上线不表示已经完成社交平台发布。
- Agent Teams、Plan、Task List、Long Running 是远期选题，不属于本次主线的未完成课程，也没有排定 E06。
- 后续维护继续修复已发现的问题并补回归。临时 worktree 在交付合入、代码与本地材料保全后及时清理，按 [AGENTS.md](../AGENTS.md) 执行。
