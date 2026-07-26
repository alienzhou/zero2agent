# D01：工具拆分粒度 —— write_file 与 delete 独立成两个工具

## 状态
✅ Confirmed

## 决策

- `write_file` 与 `delete` **各自独立成一个工具**，不合并。
- `write_file` **不再按 create / overwrite 拆分**——由一个工具同时承担「不存在则建、存在则覆盖」，二者的区别通过**成功回执**告知模型（见 D06）。

## 竞品对照

调研 5 家（见 `researches/write-file/README.md`）后有一条反常识发现：

> **没有任何一家做「独立 delete 工具」。** OpenCode / pi-mono / Gemini 交给 shell `rm`；Codex 做成 `apply_patch` 里的 `*** Delete File:` hunk；Aider 靠 git 管理文件生命周期。

也就是说，zero2agent 坚持独立 `delete` 工具，是**有意偏离工业界主流**的选择。

## 理由

1. **教学直观性**：本课程的核心叙事是「一个工具 = 一种清晰的意图」。让读者看到独立的 `delete`，比把删除藏进 shell 或补丁语法里更利于理解「Agent 如何获得一种新能力」。
2. **工具层可控**：独立 delete 能在工具层做路径校验（D03）和结构化回执（D06）；若交给 shell `rm`，这些保护就完全依赖 shell 权限层，与 Epic 2 尚未引入的 terminal 能力耦合。
3. **符合上游规划**：`D04-stage2-roadmap.md` 明确「Write to File 与 Delete 同处一个 Story」，但同一 Story 内做成两个独立工具，与「行动力优先、单工具粒度但不退回工具包视角」并不冲突。

## 备注

统一补丁范式（Codex apply_patch）能在一次调用里批量「建 A / 删 B / 改 C」，具备原子性与批量性优势，但对模型格式遵循能力要求高、不适合教学主线。记入 backlog 作为未来「进阶范式对照」。
