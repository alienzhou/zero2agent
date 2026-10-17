# 项目规则的可复现验收

运行 `pnpm build`，然后执行 `node researches/project-instructions/demo.mjs`。默认使用本机 HTTP/SSE 服务、真实文件工具和真实 Node 测试进程，无需模型密钥。`--live` 才使用当前配置服务；不自动重跑失败任务。

[cases.mjs](./cases.mjs) 冻结正常与拒绝两个任务、初始文件、产物结构和预算。正常例修复金额计算、补回归并执行指定测试，最后保存 JSON 报告。拒绝例让恶意项目文本请求越界写入，检查宿主拒绝一次且没有写入。

脚本在 `tmp/e05-s001/{offline,live}-随机目录/` 写入原始请求、响应、诊断、文件、快照和精简结果。每次独立保存，不覆盖失败。仅转发认证头给已配置模型服务，证据不记录请求头。归档前检查凭据和私密信息。

## 本次结果

[verification.json](./verification.json) 记录源码/运行时哈希、平台、命令和分层结论。完整回归 789 passed，默认 58 live skipped；本节两个固定真实服务案例单独运行并通过。正常例 7 次请求、三处文件效果、实际测试和 JSON 报告通过；拒绝例 2 次请求、一次拒绝、零效果。服务配置别名与实际响应模型分别记录，不能混称。

第一次 live 失败揭示无关作用域卸载误触发重规划，第二次揭示 find_files 的宿主 cwd 混用；两个失败与原始日志均保留。同一模型、任务、预算下修复后重验，不推断总体成功率。

CLI/PTY 的 10 项测试另支持可选保存原始终端输出与请求正文（无请求头）：

```sh
E05_INSTRUCTION_EVIDENCE_DIR="$PWD/tmp/e05-s001/host-$(date +%s)" \
  pnpm --filter @zero2agent/e2e exec vitest run src/project-instructions.test.ts
```

`*-raw-*.txt` 保留终端控制码，不是去色后的展示副本。该路径只用于固定夹具验收；生产运行日志仍不保存这些正文。

## 原始归档在 Git 之外

初版的 434 个原始证据与对应源码文件打包成约 8.1 MiB 的单个附件，保存于 draft GitHub Release，供有仓库权限的 reviewer 下载。Git 只收录脚本、精简结果与 [evidence-archive.json](./evidence-archive.json) 索引。归档已经下载回本地，核对整体 SHA-256 和 434 个文件的 manifest；该包中的 18 页课程是初版；后续 10 页修订的课程截图/源码以索引中的 courseRevision 单独归档，保留旧包不覆盖。真实服务验证的生产实现未变。

```sh
gh release download E05-S001-project-instructions-evidence \
  --repo alienzhou/zero2agent \
  --pattern e05-s001-project-instructions-evidence.tar.gz
shasum -a 256 e05-s001-project-instructions-evidence.tar.gz
# 应为 940edd40a430107681881f6b8efab3f96c7d3820802638277e79f0d8ded966b3
tar -xzf e05-s001-project-instructions-evidence.tar.gz
node researches/project-instructions/verify-evidence.mjs e05-s001-evidence
```

当前 **10 页课程**另有 `e05-s001-course-concise-evidence.tar.gz`，含 78 个截图、源码和检查文件；已下载回验整体与 manifest 哈希。使用相同 release 的 `gh release download --pattern e05-s001-course-concise-evidence.tar.gz` 下载，解压后运行 `node researches/project-instructions/verify-evidence.mjs e05-s001-course-concise`。整体 SHA-256 见索引 `courseRevision.sha256`。当前浏览器证据为 `course-JggNEW`，中间修订 `course-lkvlFm` 同时保留。

归档含 `tmp/e05-s001/`（固定案例、终端、PC/H5 图）、`tmp/e05-s001*.log`（包括初始失败）和 `source/<commit>/`。早期未提交的 demo 原型没有保留完整源字节，只保留其失败与记录哈希；三个 live 版本都有对应已提交源码。最终 demo 新增源码/运行时复制，仅影响证据采集，生产实现与固定任务哈希没有变化。

这份证据不代替人工 review，也不表示课程已经发布。应用层权限和路径检查不等于 OS 沙箱。
