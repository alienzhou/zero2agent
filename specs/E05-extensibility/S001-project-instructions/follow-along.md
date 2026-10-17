# 跟练：先加载 api 规则，再改金额计算

先在仓库根目录运行：

```sh
pnpm install
pnpm build
node researches/project-instructions/demo.mjs
```

默认不需要 API key。脚本创建独立双包工作区，发给本机确定性模型服务，并调用真实文件工具和 Node 测试。它验证 Harness 的执行顺序，不代表真实模型已经学会遵守所有自然语言规则。

## 看见第一次调用被拦住

结果目录位于 `tmp/e05-s001/offline-*/`。正常例的首次请求只看到根规则；模型提出 api 路径后，整批 read_file 先收到明确未执行结果。第二次请求包含根与 api 两个来源、目录作用域和内容哈希。web 的哨兵规则始终不进入请求。

继续观察 `normal/requests.jsonl`、`normal/snapshot.json`、`normal/terminal-results.json` 和工作区文件。修复与测试确实写入、Node 测试确实运行，`artifacts/change-report.json` 经过既有产物契约校验。脚本还独立检查三个金额结果，不凭报告里写了 true 判断成功。

拒绝例中的项目文件要求越界并重试；当前 read-only 权限拒绝写入，模型收到错误后停止，`forbidden.txt` 不存在。项目约定没有成为权限授予。

## 自己查看和刷新

进入脚本生成的 `normal/workspace`，使用仓库构建好的 CLI（下例先在仓库根记录入口）：

```sh
CLI="$PWD/packages/tui/dist/cli.js"
cd tmp/e05-s001/offline-具体目录/normal/workspace
node "$CLI" --instructions
cd packages/api
node "$CLI" --instructions-root ../.. --instructions
```

查看动作不要求模型密钥，也不发模型请求。默认发现根就是启动目录；从 api 启动时显式选择 `../..` 才读取根规则。该选项只改变指令搜索，不扩大工具原有写入边界。

交互 plain/TUI 使用 `/instructions` 查看缓存、`/instructions refresh` 重读、`/instructions off` 关闭、`/instructions on` 开启。最近读取的版本与上次模型请求使用的版本分开显示；单纯查看不读磁盘，不改变历史。单次关闭用 `--no-instructions` 或 `ZERO2AGENT_NO_INSTRUCTIONS=1`。

修改 AGENTS.md 后刷新，核对 SHA-256 改变；之后的新请求才会带上当前内容。恢复会话同样重读当前文件，不恢复旧许可。外部符号链接、显式拒绝、无效 UTF-8 或超限会报错；受影响批次不能继续。

## 真实服务验收

配置既有 `.env.local` 后显式运行 `node researches/project-instructions/demo.mjs --live`。每例仍固定 8 请求、12 工具、120 秒、零传输重试。它保留失败目录和模型实际自报身份；不要将一次通过解释为泛化成功率。课程与工程层验收详见 [清单](details/03-verification-checklist.md)。
