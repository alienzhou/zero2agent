# 固定集评测与证据获取

8 类合成历史，比较 0/1/3 次实际采用的压缩；0 次各一次，1/3 次各三次，每轮 56 个独立工作区。最终核对真实 report.json、精确事实、来源必需键、禁止行为和运行终态。关键项全过、普通事实至少 95%、任务不低于基线，不能用结构合法代替事实正确。

## 已完成结果

原协议基线 41/56；八轮候选为 40、49、47、52、49、49、48、52/56。获批显式契约后，成对 v1 为 53→54/56，补充相同字段含义的 v2 为 54→55/56，均未达到关键项全过。读取纠错版沿用 v2 相同调用方输入，完整任务/关键项 56/56、普通事实 63/63，严格门槛通过。原协议、两组成对及最后完整一轮共 784 份，全部保留在归档。

[results.json](results.json) 汇总各轮成绩、最终输入和源码哈希、分组结果及成对轮次成本。完整逐例文件与中间报告在 [Release 归档](https://github.com/alienzhou/zero2agent/releases/tag/E04-S003-summary-quality) 的 `snapshot/researches/summary-quality/evaluation/`，获取与校验见[归档入口](../README.md)。

54/55 的比较对象是历史运行，非重新同期成对试验；最后一轮没有触发结构修复或读取纠错，不能将全部分数变化归因于状态机。当前服务回执自报 MiniMax-M3，请求名保持 claude-sonnet-4-20250514，不认证底层权重。固定合成集合通过不保证任意任务无损。

## 不调用外部服务的检查

构建后运行：

```bash
node --test researches/summary-quality/evaluation/scorer.test.mjs researches/summary-quality/evaluation/source-map-audit.test.mjs researches/summary-quality/evaluation/artifact-contract.test.mjs researches/summary-quality/evaluation/contract-pair-v1/inputs.test.mjs researches/summary-quality/evaluation/contract-pair-v2/inputs.test.mjs researches/summary-quality/evaluation/contract-pair-v2/failure-regression.test.mjs
node researches/summary-quality/offline-demo.mjs
node researches/summary-quality/contract-demo.mjs
node researches/summary-quality/read-recovery-demo.mjs
```

唯一保留的原始 gzip 是 `contract-pair-v2/candidate/result-recall-0-0.json.gz`，三个失败回归直接使用它；它证明结构修复通过仍可事实失败，并验证无效 tail/offset 拒绝及合法尾页读取。

## 完整重评分与新运行

从归档解压后，`snapshot/` 中保留全部原始脚本、输入、manifest 和旧评分结果。可以用当前 `analyze-read-recovery.mjs` 对归档中的完整目录做内存重评分，不覆盖原文件：

```bash
node --input-type=module -e 'import { analyzeContractDirectory } from "./researches/summary-quality/evaluation/analyze-read-recovery.mjs"; const a = await analyzeContractDirectory(process.argv[1]); console.log(a.totals)' /absolute/path/to/archive/snapshot/researches/summary-quality/evaluation/read-recovery-v1/candidate
```

`run-read-recovery.mjs` 使用保留的逐字输入和原预算；需要当前服务凭据、冻结的 Core dist 与 runtime-hashes.json。它会产生真实请求，输出应放在被忽略的 `tmp/` 下并使用新目录，不覆盖正式成绩。完整冻结与校验步骤保存在归档原文中。
