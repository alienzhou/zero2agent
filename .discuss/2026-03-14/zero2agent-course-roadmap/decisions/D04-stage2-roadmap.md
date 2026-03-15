# D04：Epic 2 规划

## 状态
✅ Confirmed

## 阶段目标

Epic 2 的主轴是：

> 让 Agent 从“会看 / 会查”，成长为“能动手做事”的 Coding Agent。

这一阶段优先围绕“能写 + 能执行”展开，不再让 search/read 等细碎反馈优化占据主叙事。

## Story 顺序

1. **让 Agent 能直接改动工作区**
   - `Write to File`
   - `Delete`

2. **让 Agent 能更高效地修改已有内容**
   - `Replace in File`

3. **让 Agent 能主动驱动执行环境**
   - `Terminal`（正常执行路径）

4. **让 Agent 不会被特殊命令轻易拖住**
   - 长时间不退出的命令
   - 前台阻塞进程
   - 交互式命令

## 关键判断

- Write to File 与 Delete 保持在同一个 Story，不再继续拆细。
- Epic 2 仍保持为同一个 Epic，但允许拆成更多、更短的 Story。
- 浏览器能力暂时不进入 Epic 2 主线，后续再评估。

## 理由

1. 这阶段最重要的是建立行动力，而不是扩张工具边界。
2. 文件能力与终端能力都需要按“从基础到边界”分两步讲，节奏更自然。
3. 如果继续把 Story 切成单工具粒度，容易退回工具包视角。
