# D01：事件描述事实，控制改变执行

[讨论](../outline.md) | [技术设计](../../../../specs/E03-product-foundations/S003-runtime-tui/details/01-technical-design.md)

## 决策

Core 新增 onEvent，保留旧展示回调。每次 run 分配 turnId，事件携带递增 seq；工具使用模型 toolCallId。模型文字、Harness 通知、压缩与工具状态分类型。事件观察者的异常、异步拒绝和修改不改变执行。

Agent.cancelTurn() 驱动 AbortSignal，取消模型请求、权限等待、压缩及支持取消的前台工具。取消后停止调度后续工具；已完成副作用和配对结果保留。等待非协作工具实际结束，不能 Promise.race 后释放 Session 造成后台写入。

## 为什么选择原生终端

沿用现有 Node 终端依赖；当前复杂度集中在 Core/UI 契约与人工 PTY 输入交接。独立 reducer 与 renderer 使后续引入 Ink 不需要改变执行协议。依赖选择以调研报告为依据，完整组件框架留待交互规模增长后评估。

## 单一输入所有者

空闲时输入编辑器持有按键；审批时仅该 requestId 接受回答；运行中允许取消；人工 PTY 持有原始输入。交给 PTY 前退出绘制、解除输入监听；返回后恢复。审批参数完整分页，取消/超时会使旧请求失效。

## 代价

原生方案需自己验证 Unicode 宽度、控制字符、尺寸变化、绘制节奏与清理。自动化真实 PTY 覆盖这些边界；完整的跨平台终端兼容矩阵仍需各平台验收。
