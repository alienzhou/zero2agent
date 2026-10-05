# 工具权限与 Approval：四个 Coding Agent 的设计依据

资料核对日期：2026-10-05。研究问题是“模型提出工具调用后，宿主如何决定能否执行，并完成审批闭环”。范围覆盖规则、模式、授权范围、宿主接口、失败语义、执行边界。只使用官方文档和公开源码；Codex 另有本机 0.160.0 CLI 帮助取证。没有把文档阅读冒充四款产品的实机操作。

## 对照结果

| 产品 | 决策与优先级 | 授权范围与宿主行为 | 本课采用的判断 |
|---|---|---|---|
| Claude Code | allow / ask / deny；显式 deny、ask、allow 依次判定 | 权限由宿主强制执行；一次与扩大的授权有不同范围 | 规则先于默认模式；deny 优先，不允许用 Prompt 代替闸门 |
| Codex | approval_policy 与 sandbox_mode 是两个配置维度；命令规则可允许、询问或禁止 | on-request 与 never 控制是否提示，执行边界仍由 sandbox 决定 | 拒绝提示不等于授予权限；批准也不等于增加系统隔离 |
| Gemini CLI | 三态，按规则优先级判定 | 非交互环境中的 ask_user 按拒绝处理 | 没有审批宿主时拒绝；不要无限等待 |
| OpenCode（本次核对的 v1 文档及兼容源码） | allow / ask / deny；最后匹配规则获胜 | once、always、reject；源码将请求挂起并由请求 ID 结算 | 请求与响应关联；本课只做 once，避免把“同工具”当成“同操作” |

以上是各产品机制，不是统一标准。本课采用 deny > ask > allow 的显式规则优先级；不照搬 Gemini 的管理层级和 OpenCode 的最后匹配语义。

## 原始证据

- [Claude Code permissions](https://code.claude.com/docs/en/permissions)：宿主规则、优先级、单次与持久授权。闭源实现不作源码推断。
- [Codex sandbox 与 approval](https://learn.chatgpt.com/docs/sandboxing)、[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)：两个维度；旧 untrusted 已退出可选配置，避免沿用旧教程。本机 `codex --version` 为 0.160.0，`codex --help` 显示 on-request / never 与三个 sandbox 选项。
- [Gemini policy engine](https://geminicli.com/docs/reference/policy-engine/)：优先级、模式、无交互 ask。文档中层级公式与例子的 base 数字存在不一致；本课仅采用定性“高优先级先匹配”，不引用矛盾数字。
- [OpenCode v1 permissions](https://opencode.ai/docs/permissions/)：最后匹配、once / always / reject。v2 文档存在不同配置及持久范围，不混用。版本迁移时重新核对。
- 三个公开源码的固定提交和入口见 [source-pins.json](./source-pins.json)。Codex `exec_policy.rs` 可定位 Prompt / Forbidden / Never 冲突；Gemini `PolicyEngine.check` 按 priority 排序；OpenCode `evaluate` 使用 findLast，挂起表通过 requestID 结算。

## 场景矩阵与设计推导

| 场景 | 需要证明的行为 | E03-S002 的选择 |
|---|---|---|
| 读工作区源码 | 无询问直接读，不按工具名字盲信自定义工具 | 宿主声明工具 effect，缺少声明视为 unknown |
| 改文件 | 用户看到原始参数和工作目录后批准 | 冻结快照；批准不修改参数；执行前重查路径 |
| 运行命令 | 同命令可重复询问，批准一次不扩大范围 | 只做单次审批；规则只支持精确工具名和顶层标量参数 |
| allow 与 deny 同时命中 | 没有不确定的优先级 | deny > ask > allow；硬边界先于规则 |
| 越界读 / 写 | 路径规则与 shell 隔离分开 | 外部读需显式规则或询问；外部写硬拒绝；解析软链接已有祖先 |
| 拒绝、宿主异常、EOF、超时 | 副作用不发生，调用有配对结果 | is_error 工具回执；等待可取消；过期回答无效 |
| 人工终端 | 通用工具审批不替代人工接管确认 | 先通用权限，再保留已有终端交接流程 |
| 多轮与压缩 | 拒绝结果仍可进入下一请求 | 使用现有 Session 消息配对和上下文管理 |

## 排除方案与实验

不采用简单 shell 前缀白名单：`git status` 与 `git status; other-command` 是不同输入。精确参数匹配也不是命令安全分析，只表示宿主已授权这个原始参数。系统隔离、完整 shell AST、多级企业策略、跨会话持久授权留作后续。

可运行验证将分别覆盖纯规则、文件与软链接边界、审批生命周期、Loop 消息配对、真实 CLI + 本地 SSE。竞争产品未安装或未执行的交互不标为测试通过。每项取舍和证据链进入本期 Spec 与验收清单。
