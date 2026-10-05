# 跟练：批准一次，再拒绝一次

[课程](./README.md) | [设计](./details/01-technical-design.md) | [验收](./details/03-verification-checklist.md)

需要 Node >=22、pnpm >=9。固定版本完成后用 Tag `E03-S002-permissions-approval`；当前开发分支为 `codex/e03-s002-permissions`。从工程根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/e03-s002-permission-demo.mjs
```

脚本在临时目录通过生产工具执行入口分别拒绝和批准写文件；拒绝的 fileExists=false、批准的 fileExists=true，均有 tool_use_id 配对。脚本退出清理临时文件。它不调用模型，不是界面演示。

## 从效果核对实现

```sh
pnpm --filter @zero2agent/core exec vitest run src/__tests__/permissions.test.ts
pnpm --filter @zero2agent/e2e exec vitest run src/permission-contract.test.ts
pnpm test
pnpm lint
```

第二组启动本地 HTTP/SSE 和真实 CLI/PTY，输入 y / n / 空白 / Ctrl+C / EOF，并断言文件效果与下一次请求。包含通用审批和人工终端两层交接；不是只测试字符串。系统需支持项目 node-pty 依赖；不同系统需自行复验。本期完整测试结果见验收清单，不用脚本通过推断任意平台兼容。

## 用 CLI 观察审批

配置你自己的 Anthropic 兼容模型/API；未知模型还需设置 CONTEXT_WINDOW。真实模型练习会产生 API 用量。在普通交互终端启动：

```sh
PERMISSION_MODE=default node packages/tui/dist/cli.js
```

输入“只用 write_file 创建 lesson.txt，内容为 hello；收到拒绝不要换工具重试”。审批前检查文件尚未生成，第一次回答 n，确认仍不存在；新一轮明确请求后回答 y，检查文件生成。同工具的下一次调用仍会问。

使用 read-only 可禁止写与命令；accept-edits 可授权工作区文件修改。默认是 default；bypass 是宿主明确选择跳过默认询问，不创建沙箱，也不能越过写边界或显式 deny/ask。配置错误会在启动阶段拒绝。

## SDK 接入你的宿主

```ts
const agent = new Agent({
  permissions: {
    rules: [{ tool: 'terminal', action: 'deny' }],
    requestApproval: async request => ({
      requestId: request.id,
      decision: await yourUI.confirm(request) ? 'allow' : 'deny',
    }),
  },
})
```

`yourUI` 是你实现的 UI，不是项目已有 API。处理器应监听 request.signal 结束过期交互；不能返回 always 或不同 requestId。没有处理器时 ask 会变为拒绝；onPermission 是观察结果的事件，不提供授权。`PERMISSION_RULES` 可传规则 JSON 数组；只支持顶层标量精确匹配，不支持 shell 前缀或正则。

可选真实验收：配置环境后设置 E2E_LIVE=1，再单独运行 e2e 的 `src/permission-live.test.ts`。证据目录 E2E_EVIDENCE_DIR 仅保存临时测试请求和输出，不保存密钥。不要把你的真实工作内容用于测试目录。
