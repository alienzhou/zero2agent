# Skills 格式依据与解析边界

本节按 Agent Skills 开放格式实现发现与按需加载。先运行 `pnpm install`，再执行 `pnpm --filter @zero2agent/core exec vitest run src/__tests__/skill-format.test.ts`，验证严格解析器和仓库内 CDP 示例。测试使用本地文本，不发模型请求，不运行技能脚本。发现、权限、恢复及请求正文的集成验收由本节其他测试覆盖，不能由解析器测试替代。

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
