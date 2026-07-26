# pi-mono — 写文件 / 删除文件 调研

## 基本信息

| 项目 | 值 |
|------|-----|
| 仓库地址 | 原 [badlogic/pi-mono](https://github.com/badlogic/pi-mono)，现已迁移至 [earendil-works/pi](https://github.com/earendil-works/pi)（同一项目，现称 Pi Agent Harness） |
| 调研 Commit | `65ff8e7f6db447dcddb1a9c8fd05f081c5cda76a` |
| Commit 日期 | `2026-07-23 13:45:10 +0000` |
| 调研日期 | `2026-07-24` |

> 说明：本文调研时该项目仓库名为 `badlogic/pi-mono`，npm 包为 `@mariozechner/pi-coding-agent`。之后项目迁移到 `earendil-works/pi`，npm 包改为 `@earendil-works/pi-coding-agent`（两处 git HEAD 一致，确认为同一项目）。下文保留调研当时的仓名与 commit，结论不受影响；正式文档中统一以「Pi Agent Harness（原 badlogic/pi-mono，现 earendil-works/pi）」指代。

## 调研目标

为 E02-S001 提供竞品参考：pi-mono 的 `write` 工具如何设计？它是 zero2agent 多次借鉴的「教科书级参考」（S004 prompt 结构也参考了它），本次看它的写文件范式是否同样简洁。

## 调研结论

1. **有独立 `write` 工具，没有独立 `delete` 工具。** `src/core/tools/` 下有 `write.ts`、`edit.ts`，删除交给 `bash.ts`（shell）。与 OpenCode 一致。

2. **`write` 极简：参数只有 `path` + `content`。** 描述一句话说清语义：`Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.`

3. **成功回执极简：`Successfully wrote {content.length} bytes to {path}`。** 返回写入的字节数——比 OpenCode 的 LSP 诊断轻量得多，正好是 zero2agent S001 想要的粒度。

4. **不做破坏性确认，但引入了 `file-mutation-queue`（文件级串行化锁）。** 所有写操作走 `withFileMutationQueue(absolutePath, ...)`，保证对同一文件的并发写不会交错。这是一个 OpenCode/gemini 都没显式做的工程细节。

5. **通过 `WriteOperations` 接口把文件操作抽象为可插拔**（`writeFile` / `mkdir`），默认走本地 fs，可替换为 SSH 等远程实现。这是「依赖倒置」的教学范例，但对 S001 属于过度设计。

6. **路径解析支持 `~` 展开和 macOS 文件名怪异变体处理**（NFD、窄不换行空格、弯引号），但这些是「读」路径的兜底，`write` 只用 `resolveToCwd`。

## 详细分析

### A. `write` 工具定义（`write.ts#L181-L226`）

```typescript
return {
  name: "write",
  description:
    "Write content to a file. Creates the file if it doesn't exist, " +
    "overwrites if it does. Automatically creates parent directories.",
  promptSnippet: "Create or overwrite files",
  promptGuidelines: ["Use write only for new files or complete rewrites."],
  parameters: writeSchema,  // { path, content }
  async execute(_id, { path, content }, signal) {
    const absolutePath = resolveToCwd(path, cwd);
    const dir = dirname(absolutePath);
    return withFileMutationQueue(absolutePath, async () => {
      await ops.mkdir(dir);           // 自动建父目录
      await ops.writeFile(absolutePath, content);
      return { content: [{ type: "text",
        text: `Successfully wrote ${content.length} bytes to ${path}` }] };
    });
  },
}
```

设计亮点：
- **`promptGuidelines`**：`"Use write only for new files or complete rewrites."`——和 OpenCode 一样引导「write 只做整写，局部改用 edit」，但 pi 把它做成结构化字段而非塞进描述文本。这与 zero2agent S004「工具描述走 schema、prompt 只写策略」的决策高度契合。
- **abort 处理很讲究**：不在 abort 监听里 reject（那样会在文件操作仍在飞行时释放锁），而是每个 await 后检查 `signal.aborted`，保证锁在当前操作 settle 前不释放。

### B. `file-mutation-queue`（文件级串行锁）

pi-mono 用一个 per-path 的互斥队列，保证同一文件的多次写入串行。对 zero2agent 教学项目而言，这是「并发安全」的一个知识点，但 S001 的最小闭环可以先不做（单 Agent 顺序执行时不会并发写同一文件）。

### C. `WriteOperations` 可插拔抽象

```typescript
export interface WriteOperations {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}
```

允许把写操作委托给远程系统（如 SSH）。这是漂亮的依赖倒置，但属于 YAGNI——zero2agent S001 直接用 `node:fs/promises` 即可。

## 对 zero2agent 的设计启示

| 维度 | pi-mono 做法 | zero2agent S001 建议 |
|------|-------------|---------------------|
| write 参数 | `{ path, content }` 两个字段 | ✅ 直接照搬，最简洁 |
| 语义 | 不存在则建、存在则覆盖、自动建父目录 | ✅ 完全采纳 |
| 成功回执 | `Successfully wrote N bytes to path` | ✅ **最贴合 zero2agent 现有 string 回执风格** |
| 破坏性确认 | 无 | ✅ 与"S001 先不做确认"一致 |
| prompt 引导 | promptGuidelines 结构化字段 | 参考：write 只做整写的引导 |
| mutation queue | 有 | ⏸️ S001 可暂缓（单 Agent 顺序执行） |
| 可插拔 ops | 有 | ❌ 过度设计，不做 |
| delete | 无独立工具，走 bash | 🔑 与 zero2agent 独立 delete 方向不同 |

**结论**：pi-mono 的 `write` 是 5 家里**最贴近 zero2agent 期望粒度**的参考——`{path, content}` 参数 + `Successfully wrote N bytes` 回执，几乎可以直接作为 S001 `write_file` 的蓝本；剥掉 mutation queue 和可插拔 ops 这两层工程复杂度即可。

## 关键源码引用

- `packages/coding-agent/src/core/tools/write.ts#L181-L226`：`write` 工具定义与 execute
- `packages/coding-agent/src/core/tools/write.ts#L14-L17`：`writeSchema`（path + content）
- `packages/coding-agent/src/core/tools/path-utils.ts#L48-L50`：`resolveToCwd` 路径解析
- `packages/coding-agent/src/core/tools/file-mutation-queue.ts`：文件级串行锁

## 参考资料

- [OpenCode write 调研](./opencode.md)
- [Gemini CLI write-file 调研](./gemini-cli.md)
