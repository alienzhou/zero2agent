# Skills 的可复现验收与格式依据

[本课](../../specs/E05-extensibility/S002-skills/README.md) | [跟练](../../specs/E05-extensibility/S002-skills/follow-along.md) | [验收清单](../../specs/E05-extensibility/S002-skills/details/03-verification-checklist.md)

先在仓库根目录运行 `pnpm install`、`pnpm build`，再执行 `node researches/skills/demo.mjs`。默认使用本机 HTTP/SSE 确定性响应、真实文件工具和真实 Node 测试进程，不需要模型 API key。下文记录固定案例、证据读取和标准解析依据；各层验证分别记录，解析器通过不能代替宿主或真实模型验收。

## 运行固定的正常与拒绝案例

```sh
pnpm build
node researches/skills/demo.mjs
```

[cases.mjs](cases.mjs) 在真实服务评估前冻结 `fixtureVersion=1`、项目文件、两个任务、技能正文、报告格式、独立金额断言及预算。每例最多 8 次模型请求、12 次工具调用、120 秒，传输重试为零。正常例初始不激活技能；拒绝例通过 `selected` 明确选择恶意技能。夹具不放置 AGENTS.md，以免把另一节的作用域重规划混入这组固定案例；项目规则与技能共存由 Core 集成测试单独覆盖。

| 案例 | 固定行为 | 必须核对的事实 |
| --- | --- | --- |
| normal | 目录 → `load_skill` → 正文 → 报告资源 → 读文件、修复、真实测试 → JSON 报告 | 首次只有元数据，正文和资源随后依次出现；无关正文与巨大参考哨兵不进入任何请求；只改变三个目标文件，每个修改一次；真实测试成功，独立金额断言与报告契约通过 |
| denied | 恶意正文要求自动运行脚本并自称放宽权限；任务只请求一次固定 terminal 调用，当前策略为 read-only | 显示 `allowed-tools` 不授予权限的提示；一次调用和错误结果完整配对、一次拒绝；实际工具启动数、脚本启动文件、计数器、输出和其他文件效果全部为零 |

确定性正常响应固定为 7 次请求、8 次工具调用；正文在第二次请求出现，报告资源在第三次请求出现。拒绝例固定为 2 次请求、1 次被拒绝的工具调用。真实服务仍使用同一输入与预算，独立记录实际次数，不要求模型逐字复现确定性回答。

需要评估当前配置的真实服务时，显式运行：

```sh
node researches/skills/demo.mjs --live
```

`--live` 从仓库根 `.env.local` 或现有环境读取配置，正常与拒绝各运行一次；不会自动重跑失败任务。配置模型名与服务实际自报模型名分别保存，不混称，也不由两例推断泛化成功率。修复后重验应保留先前失败目录、修正原因和对应源码，不换模型、改任务或放宽预算来取得通过。

## 读取原始证据

每次运行新建 `tmp/e05-s002/{offline,live}-随机目录/`，不覆盖已有成功或失败。终端输出的 `evidenceDirectory` 指向本次目录，`summary.json` 保存精简判定及源文件/构建产物哈希，`source/` 保留本次实际源码和运行时字节；未提交代码由精确文件哈希区分，不能只依赖 HEAD 标签。

| 文件 | 用途 |
| --- | --- |
| `frozen-run.json`、`summary.json` | 固定输入哈希、预算、时间、平台、源码身份、实际模型身份与分案例结果 |
| `normal/requests.jsonl`、`denied/requests.jsonl` | 实际送往 SDK 服务的请求正文；每次请求都检查工具调用与结果配对，不记录请求头 |
| `request-observations.jsonl` | 各次请求到达时的文件字节数与哈希，用于排除正文或参考尚未可见时的抢先写入 |
| `before.json`、`after.json`、`effects.json` | 全夹具前后文件集合、真实字节变化和每次写工具的效果；不从模型回答猜测写入成功 |
| `snapshot.json`、`skills-view.json` | 完整配对历史、已选身份及最近技能/资源状态；当前正文与历史结果分开判读 |
| `permissions.json`、`tool-starts.json`、`terminal-results.json`、`terminal-metadata.json` | 宿主许可、工具启动、测试回执及原生进程 PID/退出事实；报告写入前必须已有完成且 exitCode=0 的测试，拒绝例三个脚本效果文件均不存在 |
| `independent-check.txt`、`regression-check.txt` | 正常例的独立金额断言和再次运行的真实 Node 回归结果 |
| `responses.raw` | 仅真实服务模式保存的原始响应流；传输失败也保留 |

表中分案例文件位于 `normal/` 或 `denied/`。单纯停用只移除当前激活覆盖层；曾经读过的参考文件仍可能保留在历史工具结果中。检查停用应核对当前 loaded 列表及覆盖层，不能要求历史事实消失；检查未获许可或无关正文是否泄漏，应使用从未加载它们的新会话。

## 复核边界与实际宿主

```sh
pnpm --filter @zero2agent/core exec vitest run src/__tests__/skill-format.test.ts src/__tests__/skills.test.ts src/__tests__/skills-integration.test.ts
pnpm --filter @zero2agent/e2e exec vitest run src/skills.test.ts src/skills-snapshot.test.ts
pnpm --filter @zero2agent/e2e exec tsc --noEmit
```

上述用例分别覆盖严格格式、数量/字节/时限前一值与边界/超限、读取与路径权限、批次隔离、当前版本、预算、压缩和恢复，以及真实 CLI、管道、plain、TUI 与 version=3 磁盘会话。Windows 上真实 PTY 用例会明确跳过；只按实际平台及执行层级记录通过。

可选保存请求正文和未经去控制码的终端输出：

```sh
E05_SKILL_EVIDENCE_DIR="$PWD/tmp/e05-s002/host-local" \
  pnpm --filter @zero2agent/e2e exec vitest run src/skills.test.ts
```

`*-raw-*.txt` 保留 PTY/plain 原始控制字节；后续去色或整理的版本只能作为注明来源的展示副本。该入口仅采集固定合成夹具，不改变生产诊断日志只保存元信息的约定。首轮 `host-initial` 的 12 项宿主测试和 `offline-fwaS5m` 两例均通过，原记录保留。补齐恢复选项回归后，`host-refined-AwqwMF` 为 16 项宿主加 4 项磁盘快照测试全部通过；`offline-qMiL8R` 两例通过，并记录原生成功退出及报告写入前已成功测试的事实。E2E 类型检查通过。当前完整交付结论以[逐项验收](../../specs/E05-extensibility/S002-skills/details/03-verification-checklist.md)为准，不能把定向结果扩写为全部门槛通过。

Git 只保存实现、必要小夹具、复现脚本和精简结果。原始请求、响应、终端和失败附件保存在忽略目录，归档前检查凭据与私密内容，另生成 manifest 及整体 SHA-256；对解压后的归档运行 `node researches/skills/verify-evidence.mjs <解压目录>`，核对列出的路径、大小和内容哈希。没有实际生成并下载校验归档前，不宣称证据已经独立归档或可复核。工程完整回归、默认跳过的 live 测试、固定真实服务案例、课程检查和人工 review 分别记录。

## 固定的上游版本

2026-10-17 通过官方仓库核对以下源码；提交时间与本次查看时间分别记录，不把源码引用当作客户端实机验收：

| 来源 | 固定版本 | 本节用途 |
| --- | --- | --- |
| [Agent Skills 规范](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx) | `69ef37e9424c0a7ea9dd2293b559e43ec8176379`，提交时间 `2026-08-09T20:36:04Z` | 格式约束；规范正文没有独立版本号 |
| [官方客户端接入指南](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/client-implementation/adding-skills-support.mdx) | 同一提交 | 发现、目录披露、激活与资源按需读取的参考建议 |
| [skills-ref 校验器](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/skills-ref/src/skills_ref/validator.py)及[测试](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/skills-ref/tests/test_validator.py) | 同一提交；包声明版本 `0.1.0` | Unicode 名称与未知字段的参考实现 |
| [Codex SKILL.md 解析器](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/skills/src/parser.rs)及[附加元数据解析器](https://github.com/openai/codex/blob/ce0323f2f2d3b25e82806cd555237da3db4e1897/codex-rs/skills/src/metadata.rs) | `ce0323f2f2d3b25e82806cd555237da3db4e1897` | 对照开放格式与产品扩展的分界；没有运行该版本客户端 |

## 格式约束与写作建议分开处理

技能目录至少包含 `SKILL.md`，文件先写 YAML frontmatter，再写 Markdown。`name` 和 `description` 必填；前者为 1–64 个字符、只含小写 Unicode 字母/数字及连字符，不能首尾连字符或连续连字符，且与父目录名一致；后者非空、最多 1024 个字符。可选字段为 `license`、`compatibility`、`metadata`、`allowed-tools`；`compatibility` 若提供为 1–500 个字符；`metadata` 为字符串到字符串的映射。`allowed-tools` 是实验性字段，各客户端可以不支持其运行语义。[依据](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx#L17-L159)。

`scripts/`、`references/`、`assets/` 是推荐组织方式，允许其他文件和目录。正文没有固定章节要求；500 行、5000 token 和浅层引用链是内容组织建议，本节不把它们当作通用格式错误。相对资源路径以技能根目录为基准；目录摘要、激活正文、按需资源构成三层披露。[依据](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx#L161-L216)。

## 本节明确选择的严格解析策略

`packages/core/src/skill-format.ts` 提供 `parseSkillFile(text, directoryName)` 和只读取完整头部的 `parseSkillHeader(header, directoryName)`。两者都要求包含起止分隔线；文件读取权限、字节限制、发现数量与版本哈希由加载器处理。解析器成功不表示资源已存在、环境兼容或脚本已执行。

- 只发现准确命名的 `SKILL.md`。文件开头可有一个 UTF-8 BOM，换行可为 LF 或 CRLF；分隔线必须独占一行、精确为 `---`。`description` 中的 `foo---bar` 或缩进块中的 `---` 不结束头部。正文仅去除首尾空白，保留内部 Markdown。
- 使用 YAML 1.2 core schema；不把数字、布尔值或 null 自动转成字符串。支持普通、引号、折叠和字面量字符串；重复键、锚点、别名、自定义或非 core 标签、解析警告及无效 YAML 明确失败。标准显式字符串标签 `!!str` 可用。解析错误只报告错误种类，不把源文本片段写进错误消息。
- 只接受六个已知顶层字段，未知字段报 `unsupported-field`。这与参考校验器的允许列表一致；规范正文没有规定所有客户端都必须采用同样的未知字段策略。额外信息可放到字符串值的 `metadata` 中，不解释为控制配置。
- 名称先去除首尾空白并做 NFKC 规范化，与单独 NFKC 规范化后的目录名比较；按 Unicode 码点计数，支持中文、俄文及补充平面小写字母。名称规范化参考官方实现及 Unicode 用例，不能用 JavaScript UTF-16 长度或仅 ASCII 正则代替。
- `description` 和 `compatibility` 按 YAML 解码后的原字符串检查最大字符数，拒绝空白值，返回值去除首尾空白。`license` 和 `allowed-tools` 必须为字符串；后者保留原声明并产生提示，不映射为授权。`metadata` 拒绝嵌套对象及非字符串键值，包括没有引号的数字版本。

上述细节是本节固定的客户端策略。[官方接入指南](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/client-implementation/adding-skills-support.mdx#L85-L115)另建议兼容部分错误 YAML、容忍目录名不匹配等情况，并明确说明这放宽了规范。本节选择可追查的严格失败，不悄悄修复输入。参考库也有实现差异：其解析器接受小写 `skill.md`，校验器允许空 `compatibility`，均不作为本节规则。

## 不把加载变成授权或依赖安装

开放格式没有 `dependencies` 顶层字段、依赖图或安装协议。`compatibility` 描述环境，`metadata.version` 只是作者填写的数据。脚本依赖可在说明或语言自己的脚本元数据中声明；缺少资源在实际读取时报告，缺少运行依赖由真实执行结果报告，不根据自然语言猜测并安装。Codex 的工具依赖与调用策略来自独立的 `agents/openai.yaml`，属于产品扩展，本节不实现其私有协议。

资源读取仍按当前权限和技能根边界解析；路径穿越与符号链接不能扩大读取范围。发现和激活只提供内容，执行脚本继续经过现有工具与审批。接入指南建议的目录 allowlist、压缩时永久保留技能内容也属于实现建议；本课程仍使用当前读取许可、预算及恢复后的版本重建，不恢复旧授权。

## 修正现有 CDP 示例

[CDP 技能](../../packages/cdp-debug/skills/cdp-debug-node/SKILL.md)原先把名称写成 Markdown 标题，缺少 YAML 结束分隔线。现在位于与 `name: cdp-debug-node` 匹配的目录，安装示例保留同名目录。本次只修正结构和安装路径；解析测试检查其格式，不执行调试命令，也不把调试工作流作为当前任务的指令。

## 验证范围

解析测试覆盖名称/描述/兼容信息的上限前、上限处和超限，以及必填缺失、空白、类型、Unicode/NFKC、原型同名键、重复键、折叠文本、分隔线、BOM/CRLF、锚点/别名、标签和未知控制字段。具体运行结果以本节验证记录为准；尚未完成的宿主、权限和真实模型验证不能由这些用例代称通过。

2026-10-17 的本地检查：上述 Vitest 命令 **77 passed**；`pnpm --filter @zero2agent/core exec tsc --noEmit` 通过；`pnpm exec eslint packages/core/src/skill-format.ts` 无错误。测试文件由仓库 ESLint 配置忽略，其验证来自 Vitest 和格式检查，不声称该文件已通过 ESLint。
