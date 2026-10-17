# 检查不能改写已经发生的事实

三个同步检查点固定为 beforeTool（权限允许后、文件 Checkpoint 和实际工具前）、afterTool（真实结果及执行进度保存后）、beforeComplete（未解决读取门槛通过后，最终产物校验前）。只有 pass/block；不改参数、批准或改写回执。后置失败停止后续工作，保留原回执及效果。

配置用绝对 command、argv 数组、显式 env、sources 脚本路径和可选精确 tool 名，禁止 shell 拼接。发现/检查不启动代码；信任绑定完整配置摘要、可执行文件物理身份与声明脚本内容/物理身份。CLI 先 --hooks 检查身份，再以 --hook-trust id:identity 启用；SDK 同样显式传入 trust。每次请求与启动前重新核对，本轮不热切换版本。当前信任不从快照恢复。本地脚本有宿主权限；未声明的依赖和外部效果不在文件审计保证内。

stdin JSON v1 只含 stage、cwd、checkId、工具名称/调用 ID/声明写入路径、回执错误标志/摘要；不默认传会话、工具正文、模型凭据和人工终端字节。stdout 必须是 {version:1,decision:"pass"|"block",reason?:string}，未知字段拒绝；stderr 仅排空与限额，不进入模型或诊断。reason 不进入日志/历史。非零退出、非法 UTF-8/JSON、超量、超时、取消、清理失败均停止。

恢复控制升级 v2、磁盘会话 v5，普通旧会话保留原格式。逐次 Hook 的意图在启动前等待保存，结果另行保存；工具状态与检查状态分开。恢复/明确继续不补跑旧 Hook。未通过项继续阻止完成；用户先核对效果，再显式 recheckHooks(note) / --recheck-hooks note 创建新检查，旧检查事实仍保留。后置检查不通过重放工具来补跑。当前配置/信任缺失不能解除旧检查。

完成前 Hook 约定只验证。对配置 watch、产物契约及本轮受控写入路径比较前后文件状态；有变化直接失败，最终原产物校验仍须通过。此审计范围不等于 OS 沙箱或任意文件/外部系统回滚。

固定容量：配置 32 KiB/8 Hook；每 Hook sources 1–8 个、单脚本 64 KiB/总脚本 256 KiB；argv 64 项；watch 32 路径。stdin 32 KiB、stdout 4 KiB、stderr 16 KiB；每次默认 5 秒/最大 10 秒、每轮最多 64 次、恢复记录最多 512 条。文件审计最多 64 路径、单文件 1 MiB、总计 8 MiB。关闭 POSIX 进程组 TERM 250ms 后 KILL 250ms，耗时也受 Turn 剩余时长约束；主动脱离组与 Windows 后代清理不作已验收保证。
