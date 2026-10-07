# 失败与修正

1. 首次构建：批量编辑把 fileMutations 参数也加到了 createCompactionRuntime，TS6133 阻止构建。移除无关参数。
2. 第一轮存储测试 10/11：macOS /var 与 /private/var 真实路径相同，纯词法比较漏判工作区内存储。解析所有已有祖先后再验证，原测试保留并通过。
3. 首轮 lint：控制字符正则和宽松 null 比较违反规则；改为字符码检查与严格比较。
4. 首轮完整离线：Core 413、CDP 1 通过；E2E 159 通过、1 失败、56 跳过。新 Checkpoint 成功通知错误地发往 stderr，破坏原多轮契约。修正成功通知走 stdout，失败才走 stderr；不削弱原断言。原始输出见 researches/file-checkpoints/acceptance/initial-*.txt.gz。

初始基准：4 MiB 高熵文件，20 次前部插入，CAS 存储 6007126 B、分配 6283264 B；保护保存 P50 162 ms。基线没有完整锁、校验和 fsync 协议，因此耗时不代表同保证下的算法胜负。

5. 第二轮完整离线 574 通过、56 跳过；后续旧 S003 终端恢复脚本失败，因为 HOME 与 cwd 相同，Checkpoint 打开阶段过早拒绝工作区内存储。把限制放到实际初始化写入时，只读和 --no-checkpoints 启动不再被无关存储配置阻断；真正写入仍须外部存储。原终端输出与 second-summary.json 保留。

6. 第三轮所有代码、演示、终端和课程构建门禁通过；whitespace 门禁发现已保存的原始终端错误含 CR 和尾随空白。原始字节无损 gzip 保存，不清洗证据；仅修正证据格式，随后从失败门禁继续，避免无源代码变化时重跑全部 574 项。

## 真实服务首次验收：末尾换行

6 项真实服务验证中 5 项通过，S006 在首次写入后逐字节断言失败：模型正确写入随机标记，但省略了指令要求的末尾换行，尚未进入撤销阶段。保留 `live-initial-summary.json`、`live-initial-live-results.json` 与无损 `live-initial-live.txt.gz`。将用例中的目标设为明确不带末尾换行的随机字符串，仍严格比较实际文件字节；before 保留换行，撤销和重做继续分别要求完全一致，不使用 trim 放宽恢复验证。

## 恢复意图交接的崩溃窗口

最终源码自查发现：恢复 pending tool 时，新 restore intent 已落盘而原 pending 尚未移除；若此处中断，两条 pending 会互相阻塞。增加精确持久边界故障注入，先记录失败 `handoff-initial.txt.gz`（Another checkpoint is pending），再修正恢复协议：仅允许继续恢复的 intent 清理 sourceId 指向且路径/全部目标版本匹配的旧 tool pending，其余 pending 仍拒绝。回归测试验证中断后重开存储、缺少关联时拒绝且不删记录、正确关联后恢复、反向撤销；原真实 SIGKILL 跨进程用例继续保留。本次窗口测试是故障注入，不宣称额外一次真实 SIGKILL。

## 旧 readline PTY 用例的观察竞态

修正恢复交接后的全量运行中，Core 413 / CDP 1 通过，E2E 160 通过、1 失败、56 跳过。旧剪切/粘贴用例两轮回复都叫 shortcut-answer；TUI 重画第一轮内容时第二次 waitFor 提前返回，此时请求数组仍只有第一轮。原记录见 `readline-initial-offline.txt.gz` 和 summary。用例改为逐轮不同回复，第一轮答复之后查找空闲提示，第二轮精确等待新答复并增加请求数为 2 的断言；剪切/Unicode 的实际请求内容断言保持不变，生产编辑器代码未修改。

最终新增附件暂存检查还发现 checkpoint-demo 的真实统一差异输出含一行合法的单空格上下文行。按同样规则无损 gzip，校验解压字节完全相同，并同步报告路径和复跑脚本；不删空格来伪造原始输出。新增附件暂存后再次执行 git diff --check。
