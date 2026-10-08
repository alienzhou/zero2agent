# E03-S006 图解来源

| ID | 来源 | 用途 |
| --- | --- | --- |
| S01 | packages/core/src/file-mutations.ts、loop.ts、tools/{write-file,replace-in-file,delete}.ts | 权限后控制接口与路径声明 |
| S02 | packages/tui/src/checkpoint-store.ts | CDC、CAS、预算、清单、锁与恢复协议 |
| S03 | packages/tui/src/{checkpoint-view,conversations,cli,runtime-tui}.ts | 文本差异、文件事实通知、键盘焦点与管理命令 |
| T01 | packages/core/src/__tests__/file-mutations.test.ts | 控制顺序、失败和取消 |
| T02 | e2e/src/checkpoint-store.test.ts | 文件字节、并发、预算、真实 SIGKILL 与中断恢复 |
| T03 | e2e/src/checkpoint-runtime.test.ts、checkpoint-live.test.ts、researches/file-checkpoints/acceptance/screens | 生产 SDK、真实 PTY、实际文件、真实服务分层证据 |
| B01 | researches/file-checkpoints/acceptance/benchmark-first.json | P17 第一轮固定语料数值；最后一轮另存 benchmark.json |
| R01 | researches/file-checkpoints/gemini-cli.md | 固定 ef59c532 源码；非二进制实测 |
| R02 | researches/file-checkpoints/opencode.md | 固定 ecc4916b 源码；非二进制实测 |
| R03 | researches/file-checkpoints/claude-code.md | 官方范围说明；不推测存储实现 |
| D01 | specs/E03-product-foundations/S006-file-checkpoints/details/01-technical-design.md | 本课合同与保证限制 |
| D02 | scripts/e03-s006-checkpoint-demo.mjs、课程 follow-along.md | 离线跟练 |
| D03 | docs/roadmap/README.md、课程 deep-dive | 下一阶段和延伸边界 |

18 页（含封面）图解为教学重排，字母块与终端框示意不冒充真实分块、产品截图或竞品实测。封面遵守从零到一做 Agent 系列身份。数据来自实际报告，耗时比较明确说明基线没有同等持久性协议。
