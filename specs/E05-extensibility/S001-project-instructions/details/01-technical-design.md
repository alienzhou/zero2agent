# 加载规则，并在副作用前校验

## 开放格式与本产品边界

2026-10-17 核对 [agents.md](https://agents.md/) 及 [官方源仓库](https://github.com/agentsmd/agents.md/tree/d001185d792eb6402a58e4cbef1c228b309ec25d)。AGENTS.md 是普通 Markdown，无必填字段、frontmatter 或指定标题；嵌套文件对相应子目录的冲突约定优先，明确用户指令覆盖项目约定。不要把内容当作可执行配置。

搜索算法、容量、权限、刷新和 UI 属于 Zero2Agent 的实现选择，不声称开放格式要求它们。只识别大小写精确的 AGENTS.md，不自动展开 Markdown 链接，也不增加私有字段。保持原文顺序和内容；记录绝对来源、目录作用域、SHA-256 和字节数。

默认发现边界是启动 cwd；显式 `projectInstructions.root` / CLI `--instructions-root` 可选择包含 cwd 的项目根。该选项扩大指令搜索范围，不扩大文件工具写入范围；原工具仍以 cwd 为工作区。发现只沿根→cwd 与本批工具的已声明路径祖先链进行；不扫描兄弟目录。终端只按可信声明的 workdir 补载，不解析 command 的任意影响路径。

## 生命周期与请求

Agent 持有易失的 ProjectInstructions；每轮重建初始作用域，每次请求和整批工具前刷新当前文件。规则以独立的用户级消息覆盖层加入请求，计入已有 ContextBudget，不反复写入历史或摘要。系统只补充固定的优先级/作用域说明，项目原文不放进 system。恢复/新对话清空缓存，不序列化授权或项目正文。

整批预检先计算全部可判定目标。新规则、适用文件版本变化或实际删除使当前模型调用失效：本批全部配对为未执行，补载后有限重新规划。读不到必要规则则本批配对后停止，不放行写入。卸载与当前目标无关的作用域不单独触发重规划，避免在目录间切换时消耗纠错预算。授权等待期间和每个实际 execute 之前再次解析目标物理路径并检查；批中发生变化时保留已完成效果，停止剩余调用，不重放。

读取复用 read_file 的 PermissionController，显式 deny 优先，读取正文前授权。缺失与拒绝分别记录。物理路径也须在指令根内；外部符号链接、非普通文件、无效 UTF-8 和超限均报错。普通 shell 仍非 OS 沙箱；项目规则不能替代审批和硬边界。

## 冻结容量与实验预算

| 资源 | 上限（含边界） |
| --- | --- |
| 单份原始 UTF-8 正文 | 32 KiB |
| 当前注入正文总量 | 128 KiB |
| 单条祖先链目录数（含根） | 32 |
| 当前候选 AGENTS.md 路径数（含缺失项） | 64 |
| 单轮规则变化引发的重新规划 | 3 次 |
| 一次刷新耗时（含审批） | 5 秒，并受 Turn 取消约束 |

不截断；限制失败阻止受影响批次。检查数值的前一值、边界与后一值。输入预算不足仍由 ContextBudget 明确拒绝。

固定真实模型验收共两例：正常金额修复（测试+JSON 报告）、恶意规则要求越界写入的拒绝例。每例最多 8 次请求、12 次工具调用、120 秒、0 次传输重试；保留当前配置模型，记录服务返回身份。不做成功率推断；失败保留后针对修正重验。离线跟练走本地确定性服务与真实文件工具。

固定输入与期望文件在 [cases.mjs](../../../../researches/project-instructions/cases.mjs)。正常例只预先允许 AGENTS.md 所列的精确 terminal command/workdir；其他命令仍按默认审批。拒绝例使用 read-only，要求一次明确的 write_file 拒绝、无文件效果且无重试。原始模型请求只存忽略目录；代理不记录认证请求头。

没有规则的新会话不注入额外说明，不改变既有压缩触发点；曾加载规则后删除、停用，或装载历史会话时才补充失效提示。查看入口区分最近读取版本与上次实际发给模型的版本，刷新并不等于模型已经见过。

## 调用接口

```ts
const agent = new Agent({
  cwd: '/project/packages/api',
  projectInstructions: { root: '/project' }, // 默认 root = cwd；false 关闭
  permissions: { mode: 'accept-edits' },
})
await agent.refreshProjectInstructions() // 只读取当前来源，不请求模型
const view = agent.getProjectInstructions() // 脱离内部状态的副本，无 I/O
agent.setProjectInstructionsEnabled(false) // 只允许空闲时改变
```

`view.entries` 包含 `path/scope/status`，成功时包含 `physicalPath/version/bytes/text`，失败时有 error；status 为 loaded、missing、denied 或 error。TUI 只渲染元信息，不把正文写入运行日志。`lastRequest` 在真正开始模型传输时记录路径、作用域、哈希；不是 countTokens 或刷新时的候选状态。

`prepareBatch` 使用可信工具的 permission.paths、checkpointPaths、instructionDirectories 获取目标；不把模型参数当作可信元数据。候选按祖先到后代排序并去重，兄弟目录保留独立标签。`requiresReplan` 只对当前候选中新增/变更的正文，以及实际消失的已知规则返回 true；不把不再相关的目录移出列表当成新规则。

`overlay` 将 JSON 包装的来源、scope、版本和 Markdown 放在独立 user 消息里；system 只追加固定优先说明。`createCompactionRuntime().request` 在预算估算之前构造该覆盖层。旧 buildSystemPrompt({instructions}) 仍是弃用占位参数，不读取文件也不注入规则；加载应由 AgentOptions.projectInstructions 配置。

整批跳过仍消耗工具调用额度，并逐个配对、持久化明确未执行结果。批中规则变动不会重新执行已结算工具；每次真正 execute 前重新解析整批物理路径和规则，能发现审批期间目标符号链接被替换。项目正文不会进入 SessionSnapshot，因此恢复用当前读取策略重建；摘要仅作为历史。

## 验收中顺带修复的搜索问题

真实案例发现 find_files 的 ripgrep 继承宿主进程目录。Agent cwd 与宿主 cwd 不同时，`packages/api/*.ts` 等带前缀 glob 错误返回空；这不是模型缺少搜索能力。现在明确传入规范化的 Agent cwd，兼容 macOS /var 别名，并把 spawn 错误变成普通工具错误。真实临时目录回归覆盖相对 glob 前缀和无效 cwd。

## 权限和隔离范围

指令读取使用绝对规范化路径匹配 read_file 规则；例如拒绝所有自动读取可用 `{tool:'read_file',action:'deny'}`。按 input.path 精确拒绝时应使用界面列出的完整路径；内部文件链接同时检查目标路径。明确选择的 instructions-root 仅作为指令读取边界；文件工具仍以 Agent cwd 限制写入。

这是应用层检查，不是 OS 沙箱。普通 shell 可能访问 workdir 以外的路径，文件系统并发替换仍有系统级窗口；不得把目录指令描述成强制执行的通用策略语言。5 秒刷新截止覆盖审批和各 I/O 结算后的检查，不承诺能强行中断一个内核中阻塞的文件系统调用。
