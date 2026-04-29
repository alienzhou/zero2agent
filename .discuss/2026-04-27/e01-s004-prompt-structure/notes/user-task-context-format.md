# UserTaskContext 格式设计

> 本笔记回答：Runtime Context 放入 UserTaskContext 后，具体用 Markdown section、XML-like tags，还是其它格式？

## 1. 目标

UserTaskContext 需要同时满足四个目标：

| 目标 | 说明 |
|------|------|
| 可读 | 课程读者能一眼看懂上下文里有什么 |
| 可分隔 | 模型能区分系统注入的 context 和用户原文 |
| 可扩展 | 后续可加入 mode、focused files、conversation summary |
| 不污染 System | 动态事实不进入 Default System |

## 2. 候选格式

### A. Markdown section

```markdown
## Runtime Context

- cwd: /repo
- date: 2026-04-29

## User Task

用户原始输入...
```

优点：教学友好、人工可读。

缺点：用户原文也可能包含 Markdown 标题，边界不够强。

### B. XML-like tags

```xml
<user_task_context>
  <runtime_context>
    <cwd>/repo</cwd>
    <date>2026-04-29</date>
  </runtime_context>
</user_task_context>

<user_task>
用户原始输入...
</user_task>
```

优点：边界清晰，适合区分机器注入上下文和用户原文；也更接近 OpenCode `<env>`、Codex `system_reminder` 等竞品里常见的上下文分隔方式。

缺点：比 Markdown 稍微不自然，需要在课程里解释约定。

### C. JSON/YAML block

```yaml
runtime_context:
  cwd: /repo
  date: 2026-04-29
user_task: |
  用户原始输入...
```

优点：结构化强。

缺点：转义和多行文本更麻烦；对 prompt 阅读体验不如 XML-like tags。

## 3. 推荐

推荐 S004 采用 **XML-like tags**：

```xml
<user_task_context>
  <runtime_context>
    <cwd>{cwd}</cwd>
    <date>{date}</date>
  </runtime_context>
</user_task_context>

<user_task>
{rawUserMessage}
</user_task>
```

理由：

- Runtime Context 是机器注入内容，应该和用户原文有强边界。
- 用户原文可能包含 Markdown 标题，用 Markdown section 容易混淆。
- XML-like tags 后续可以自然扩展：

```xml
<user_task_context>
  <runtime_context>...</runtime_context>
  <task_mode>default</task_mode>
  <focused_files>...</focused_files>
  <conversation_summary>...</conversation_summary>
</user_task_context>
```

## 4. S004 最小实现建议

S004 如果实现 UserTask builder，可以先只支持：

```xml
<user_task_context>
  <runtime_context>
    <cwd>{cwd}</cwd>
    <date>{date}</date>
  </runtime_context>
</user_task_context>

<user_task>
{rawUserMessage}
</user_task>
```

如果 S004 暂不实现 UserTask builder，也应在 spec 中固定这个目标格式，避免后续各处自由拼接。

## 5. 待确认

最终需要用户拍板：

```text
UserTaskContext 是否采用 XML-like tags 作为标准格式？
```
