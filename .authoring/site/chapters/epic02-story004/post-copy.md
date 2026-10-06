# 发布文案｜情景教学版，本地成稿

## 标题

Agent 会跑命令，我来接着操作

## 正文

Agent 已经能执行命令，需要人连续输入时，键盘怎么接过去？这期用 Node 算出 42，再退出回到 Agent。

跟着按键走一遍 PTY，看懂两条桥接代码；用 Ctrl-C、两条退出路径和 Node／less 跟练，把输入、输出和恢复连起来。也说清模型能看到什么、哪些进程能清理。

## 标签

#Agent开发 #CodingAgent #终端交互 #开源项目 #Zero2Agent

## 编辑检查（不放入发布正文）

本版共 13 页，技术依据和操作记录见 sources.md、experiments-v2.md。两个仓库的脱敏发布分支均已合入 main，社交平台内容仍未发布。main 已包含本课，固定提交方式用于保证复现。固定实现 b200c9f 的[公开获取与跟练说明](https://github.com/alienzhou/zero2agent/blob/bd05019edefbbab454d05f5a65a7684aa9efac98/specs/E02-act-and-execute/S004-interactive-commands/follow-along.md)已核验可访问。原有功能试用反馈不扩展为用户对所有图文细节的认可。
