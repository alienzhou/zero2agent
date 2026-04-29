# D15：S004 返回 string，预留 SystemFragment / string[]

## 决策

S004 的实现仍可以让 `buildSystemPrompt()` 返回单个 `string`。

但设计文档中预留未来方向：

```ts
type SystemPrompt = string | SystemFragment[];
```

或在 host 层支持：

```ts
system: string | string[]
```

## 原因

当前 zero2agent 的功能很小：

- 只有一个默认只读 agent。
- 没有多模型 prompt profile。
- 没有 plan/debug/review 等 mode。
- 没有 prompt cache 实现。

直接实现 fragment registry 会让 S004 过重。

但从竞品看，多段 system 是合理演进方向：

- OpenCode 用 `string[]` 叠加 env、skills、instructions。
- Claude Code 有 section/cache 边界。
- Codex/Gemini 也把 base prompt、runtime context、instruction 分到不同构造层。

## 预留边界

S004 只要求代码结构不要堵死未来演进：

- `buildSystemPrompt()` 内部按 section 组织。
- mode-specific 内容不进入 Default System。
- Runtime Context 不塞入 Default System。
- 后续需要时再把内部 section 数组暴露成 fragment。

这能保持当前实现简单，同时避免把所有规则永久粘成一段不可拆字符串。
