# E02-S003: 任务清单

> 开发任务拆解与进度跟踪。
> **Story 状态**：🔜 待开始（spec 已定稿，81 项决策全部收敛）

---

## 分层策略

⚠️ **任务顺序 = 教学顺序。** 每个 Step 结束时代码都能跑，对应讨论阶段的一个议题：

```
Step 1  runCommand 核心        ← 议题①：能跑了
Step 2  回执契约               ← 议题①：什么信息进上下文
Step 3  超长输出落盘           ← 议题②
Step 4  取消 / 跳过            ← 议题③
Step 5  三道防线               ← 议题④
Step 6  执行环境               ← 议题⑤
Step 7  集成与验证
```

---

## 开发任务

### Step 1: runCommand 核心（约 30 行）

- 创建 `packages/core/src/tools/terminal.ts`
- 定义 `input_schema`（`command` 必填、`workdir` 可选）
- `spawn('bash', ['-c', cmd], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })`
- stdout / stderr **合流**收集到 `bufs[]`
- `close` 事件 → `Buffer.concat` 统一 decode → resolve
- ⚠️ **不要 `child.unref()`**（会让 Node 提前退出）
- `bash` 不存在时（ENOENT）翻译成人话：`Error: bash not found; S003 assumes ...`
- 单测：正常输出、非零退出、stderr、中文/emoji 跨 chunk 不乱码

### Step 2: 回执契约

- `workdir` 解析（相对 `ctx.cwd`），越界返回 `Error: ... outside the workspace`
  - ⚠️ **不复用 `resolveInsideCwd`**（cwd 自身合法，语义不同），不改 `path-guard.ts`
- 组装回执：`Exit code:` 无条件写；`Wall time:` 仅超 3 秒；`Signal:` 如实透传
- 正文包 `<untrusted_command_output id="8hex">`，**nonce 每次调用随机**
- 错误消息不泄漏内部命令包装
- 单测：exit code 存在性断言、`Wall time` 阈值边界、**nonce 每次不同**、伪造闭合标签不越狱

### Step 3: 超长输出落盘（议题②）

- `OutputSink` 状态机：内存态 → 落盘态
- 越 800 行 / 20KB → `createWriteStream('/tmp/zero2agent-<8hex>.log')` + flush + **清空 `bufs`**
- 越界回执：`Total: N lines / N KB` + `Saved to:` **正文一行不给**
- 单测：阈值边界、越界后内存确实被清、回执不含正文、路径可被 `read_file` 读

### Step 4: 取消与跳过（议题③）

- 10 秒定时器 → 触发落盘（**共用 Step 3 的 flush 代码**，只换触发条件）
- ⚠️ **三个正交开关**：超时落盘那条路**不弃内存、正文照给**
- `packages/tui/src/cli.ts`：接管 keypress
  - Ctrl-X（全程）→ `kill(-pid, SIGTERM)` → 宽限 → `SIGKILL` → 回执 E1/E2
  - Ctrl-S（10 秒后）→ 一个信号都不发，登记进程 → 回执 D
  - Ctrl-C 语义不改
- 运行中提示走**既有 `LoopEventHandlers`**，`execute` 签名零改动
- 非 TTY：不注册按键、不弹提示，命令跑到底
- 单测：五种回执形状快照、超时落盘不弃内存、非 TTY 降级

### Step 5: 三道防线（议题④）

- 创建 `packages/core/src/tools/process-registry.ts`（只登记被 Ctrl-S 跳过的）
- **防线①**：退出钩子遍历登记表 → 列出 → `(y/N)` 询问，**默认不杀**；非 TTY 不杀
- **防线②**：`wrapCommand()` 生成 watcher 包装
  - ⚠️ watcher 子 shell **必须 `>/dev/null 2>&1`**，否则它自己挂死 loop
  - 行号偏移（`line 1` → `line 2`）在回执里替换回原命令
- **防线③**：`Promise.race(close, 2s 计时器)`，超时强行 resolve + 回执加
  `Note: a descendant process may still be holding the output pipe.`
- 完成通知：搭下一次 `terminal` 回执的 `---` 尾部段
- 单测：wrapper 保真（退出码 0/42/127/3 + stdout/stderr）、`kill -9` 后孙进程被收、
  `setsid` 场景下 2 秒超时确实 resolve

### Step 6: 执行环境（议题⑤）

- 创建 `packages/core/src/tools/shell-env.ts`
- 采集：`$SHELL -lc` + `source rc < /dev/null` + 前后分隔符 + `timeout: 5000` + `killSignal: 'SIGKILL'` + `stdio[0]='ignore'`
- 模块级缓存，**不提供刷新**
- 采集失败 → 回退 `process.env` + **首次回执告知模型一次**
- 覆盖：`TERM=dumb`、`PAGER`/`GIT_PAGER=cat`、`GIT_EDITOR=true`、`GIT_TERMINAL_PROMPT=0`、`GIT_ASKPASS=''`、`SSH_ASKPASS=''`、`DISPLAY=''`
- ⚠️ **不加 `NO_COLOR`**
- 单测：分隔符能摘掉 rc 欢迎语、rc 里有 `read` 时不挂住、采集失败回退且回执带 Note、覆盖项确实生效

### Step 7: 集成与验证

- `packages/core/src/tools/index.ts` 注册 + 导出
- `packages/core/src/prompt/system.ts`：
  - `buildScopeSection()` 增加「执行 shell 命令」
  - `buildToolPolicySection()` 增加 terminal 策略，**必须写明**：
    1. 非交互环境（需 tty / 等输入的命令必然失败，用 `-y` / `--no-input`）
    2. 用 `workdir` 而非 `cd`
    3. 超长输出会落盘，用 `read_file` / `grep_search` 回读
  - `system.test.ts` **断言这三条在描述里**（描述是执行环境的一部分，要被测试守住）
- `packages/tui/src/cli.ts`：`summarizeToolOutput` 增加 terminal 分支
- 端到端手测（需 `ANTHROPIC_API_KEY`）：
  - 「跑一下测试」→ 正常回执 + 模型能读懂失败信息
  - 「列出 node_modules 所有文件」→ 越界落盘 + 模型用 `grep_search` 回读
  - 「起 dev server」→ 10 秒后按 Ctrl-S，观察回执 D 与后台登记
  - 「跑一个会失败的长命令」→ 按 Ctrl-X，观察已产生的输出被保留
  - 退出 Agent → 观察后台进程询问

---

## 进度跟踪

| Step | 状态 | 备注 |
|------|------|------|
| Step 1 | 🔜 待开始 | runCommand 核心 |
| Step 2 | 🔜 待开始 | 回执契约 + nonce |
| Step 3 | 🔜 待开始 | 超长输出落盘 |
| Step 4 | 🔜 待开始 | 取消 / 跳过 |
| Step 5 | 🔜 待开始 | 三道防线 |
| Step 6 | 🔜 待开始 | 执行环境 |
| Step 7 | 🔜 待开始 | 集成与验证 |

**状态说明**：🔜 待开始 · 🚧 进行中 · ✅ 已完成 · ⏸️ 暂停

---

## ⚠️ 实现时最容易踩的六个坑

讨论阶段实测出来的，每一条都真的踩过：

| # | 坑 | 后果 |
|---|---|---|
| 1 | 逐 chunk `toString('utf-8')` | 跨 chunk 的中文/emoji 变 `�` |
| 2 | `detached: true` 后调 `unref()` | Node 提前退出，命令没跑完 |
| 3 | watcher 子 shell 不重定向 stdout | **它自己攥着 fd 把 loop 挂死** |
| 4 | 只等 `close` 不设超时 | `setsid` 曾孙攥着 fd → Promise 永不 resolve |
| 5 | env 采集不关 stdin | rc 里的 `read` 让 Agent 启动不了 |
| 6 | 隔离标签名固定 | 命令输出伪造闭合串 → prompt 注入 |

⚠️ **3 和 4 是同一个坑的两面**，5 和「用户命令要关 stdin」也是同一条防线的两次应用。
