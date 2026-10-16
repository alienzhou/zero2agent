# 来源清单

工程事实来自本仓库与实际验收；SVG 是教学示意，不冒充截图。每页的 sources 对应下表来源。E03–E16 中的原始运行产物位于 Release 归档的 snapshot/ 下，路径继续按原仓库根目录解释；当前脚本与汇总在 researches/summary-quality/。最终质量与机制分别引用 E16 和 T05；历史失败不改。

| 编号 | 来源 |
| --- | --- |
| S01 | packages/core/src/context-manager.ts、context-budget.ts |
| S02 | packages/core/src/context-summary.ts、prompt/system.ts |
| S03 | packages/core/src/history-evidence.ts、tools/read-history.ts、session-snapshot.ts、loop.ts |
| S04 | packages/core/src/result-store.ts、tools/read-tool-result.ts |
| T01 | packages/core/src/__tests__/history-evidence.test.ts、compact-loop.test.ts |
| T02 | researches/summary-quality/offline-demo.mjs、acceptance/offline-demo.txt.gz |
| T03 | e2e/src/history-references.test.ts、researches/summary-quality/acceptance/history-restart.json.gz |
| E01 | researches/summary-quality/evaluation/fixtures.mjs、run.mjs |
| E02 | researches/summary-quality/evaluation/scorer.test.mjs、analyze.mjs |
| E03 | researches/summary-quality/evaluation/baseline-v3/manifest.json、analysis.json 及 56 份原始 gzip |
| E04 | researches/summary-quality/evaluation/candidate-v2/manifest.json、analysis.json、runtime-hashes.json、56 份原始 gzip 及 comparison.md |
| E05 | researches/summary-quality/evaluation/candidate-v3/manifest.json、analysis.json、runtime-hashes.json、verification.json 与 56 份原始 gzip |
| E06 | researches/summary-quality/evaluation/candidate-v4/manifest.json、analysis.json、runtime-hashes.json、verification.json 与 56 份原始 gzip |
| E07 | researches/summary-quality/evaluation/candidate-v5/manifest.json、analysis.json、runtime-hashes.json、verification.json 与 56 份原始 gzip |
| E08 | researches/summary-quality/evaluation/candidate-v6/manifest.json、analysis.json、runtime-hashes.json、verification.json、56 份原始 gzip 及明确标注的发送视图重建 |
| E09 | researches/summary-quality/evaluation/candidate-v7/manifest.json、analysis.json、runtime-hashes.json、verification.json 与 56 份原始 gzip |
| E10 | researches/summary-quality/evaluation/candidate-v8/manifest.json、analysis.json、verification.json 与 56 份原始 gzip；另有 acceptance/v8-request-boundary.json.gz 独立诊断，不替换原成绩 |
| E11 | packages/core/src/diagnostics.ts、packages/tui/src/run-log.ts（bef6e96）；acceptance/model-identity-source-hashes.json、model-identity-live.json.gz、model-identity-verification.json 和 model-identity-*.txt.gz；生产诊断与实际 SDK 回执独立核对，不是新一轮语义评分 |
| E12 | researches/summary-quality/evaluation/source-map-audit.mjs、source-map-audit.test.mjs、source-map-contract-audit.json；全部 504 份历史记录的必需来源键补查，不改原评分，不认证来源值 |
| E13 | researches/summary-quality/evaluation/completion-review-protocol.md、completion-review-pilot-v1/README.md、verification.json 与 8 份 gzip；单次核对修复 2/4，不接入生产 |
| S05 | packages/core/src/artifact-contract.ts、artifact-completion.ts、agent.ts、loop.ts |
| T04 | packages/core/src/__tests__/artifact-completion.test.ts、e2e/src/run-log.test.ts、researches/summary-quality/contract-demo.mjs |
| E14 | researches/summary-quality/evaluation/contract-pair-v1/protocol.md、inputs.json、run-contract-pair.mjs；新成对条件，不替换原 504 份 |
| E15 | researches/summary-quality/evaluation/contract-pair-v1/candidate/README.md、entities-1-2.json.gz；contract-pair-v2/README.md、protocol.md、descriptions.json、candidate/verification.json、failure-analysis.md、failure-regression.test.mjs；字段含义说明、完整成对结果与零压缩失败 |
| S06 | packages/core/src/result-read-recovery.ts、tools/read-tool-result.ts、loop.ts、diagnostics.ts、runtime.ts；00f0e78 读取纠错状态机 |
| T05 | packages/core/src/__tests__/artifact-completion.test.ts（unresolved saved-evidence reads）、e2e/src/run-log.test.ts；实际 SDK、预算/权限/取消/恢复及元信息隐私；researches/summary-quality/read-recovery-demo.mjs 同一替身在前后运行时的对照 |
| E16 | researches/summary-quality/evaluation/read-recovery-v1/README.md、protocol.md、candidate/paired-analysis.json、candidate/verification.json 与 56 份原始 gzip；沿用 v2 相同输入的完整验证 |
| D01 | specs/E04-reliability-and-context/S003-summary-quality/README.md、follow-along.md、details/ |

[原始证据归档](https://github.com/alienzhou/zero2agent/releases/tag/E04-S003-summary-quality) · [获取及校验](../../../../researches/summary-quality/README.md)。生产代码的旧冻结 SHA 可在归档 bundle 中核实；精简重建只撤回无关格式化，实际功能代码沿用已验收实现。
