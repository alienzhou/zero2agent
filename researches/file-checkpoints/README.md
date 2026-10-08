# 文件 Checkpoint：范围、成本与恢复协议

[课程](../../specs/E03-product-foundations/S006-file-checkpoints/README.md)

调研日期 2026-10-07，来源为固定源码与官方文档；没有安装或运行竞品二进制，不把源码结论写成实机验证。遵循仓库 repo-research 记录结构。

- [Gemini CLI](./gemini-cli.md)：隐藏 Git、整工作树 add 与恢复。
- [OpenCode](./opencode.md)：独立 Git 对象存储与选择路径恢复。
- [Claude Code](./claude-code.md)：受控编辑范围、恢复 UI 与限制的官方契约。

## 本课选择

受控路径 + 内容定义分块 + SHA-256 + deflate + 有界保留，不依赖隐藏 Git。空间收益主要来自作用范围和增量复用，不是把算法名字换得更复杂。

## 实测

[benchmark.json](./acceptance/benchmark.json)保存最后一轮；[benchmark-first.json](./acceptance/benchmark-first.json)保存课程 P17 引用的第一轮。macOS arm64、Node 22.15.1，固定种子 4 MiB 高熵数据，连续 20 次前部插入 30 字节，另有 1000 个无关 4 KiB 文件验证范围。

三个存储模式都只记录目标文件：前后整文件副本、整文件压缩 CAS、生产内容分块 CAS。基准确认恢复后完整哈希，不只是计时。全目录副本量仅按公式估算，未实际跑；Git pack、reflink 和其他文件系统未测。

**耗时比较限制**：两个基线缺少生产方案的锁、完整校验、冲突检查和 fsync，不能解释为同等持久保证下的算法性能排名。第一轮分块存储 6,007,126 B（约 5.7 MiB），分配 6,283,264 B（约 6.0 MiB），保存 P50 162 ms、P95 589 ms；整文件压缩对象 88,109,241 B，整文件副本 167,784,160 B。

```bash
pnpm build
node scripts/e03-s006-checkpoint-benchmark.mjs
```

基准临时数据自动清理。默认 50 条/30 天、256 MiB、单文件 32 MiB、单次 64 MiB；清理共享块需要引用集合，pending 不能回收。
