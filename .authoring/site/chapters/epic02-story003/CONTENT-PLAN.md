# Zero2Agent E02-S003 · 内容规划（v3 · review 修订）

> 改版缘由：上一版（10 页）过度依赖表格 / 关键词 / 代码标识符，像一叠需要口播讲解的幻灯片。
> 小红书读者是一个人滑图看的，身边没有人边讲边指——所以每一页必须**脱离讲解也能自己读懂**。
>
> 本版原则：
> - 该用文字的地方就用完整句子，不用关键词堆砌；
> - 出现的每个代码标识符，旁边都有一句人话解释；
> - 一页放不下就多放几页，宁可页数多，也不把一页压成信息墙。

> **v3 review 修订**（本次）：
> - **去掉每页底部的总结金句**（改为系列默认关闭，见 `SERIES-RULES.md` 4.1）；
> - 消除"单字换行"孤字：正文统一加 `text-wrap: pretty`，个别再改措辞；
> - 去金句后空间变多——正文字号加大、内容竖直居中，排版更饱满；
> - P04/P05 强调：demo/玩具级 agent 跳过这些细节，生产级与面试才会真正遇到；
> - P05 收尾加一句承上启下"下面五页，把这五个技术设计逐一详细展开"。
> 通用复审红线已沉淀为 `.cursor/skills/xhs-content-review` Skill。

---

## 页序（13 页）

| 页 | 文件 | 分区 | 讲什么（一句话） |
|----|------|------|------------------|
| 01 | 01-cover | 封面 | Epic.02 / Story 003 |
| 02 | 02-recap | 承上启下 | 到上一课，Agent 已经能读能改 |
| 03 | 03-why-terminal | 承上启下 | **为什么还要单独做 terminal**（着重） |
| 04 | 04-uncertainty | 前逻辑 | 交给外部程序 = 什么都不确定 |
| 05 | 05-five-map | 五个问题 | 接上执行环境冒出的五个问题（读者问句式） |
| 06 | 06-receipt-text | 回执 (1/2) | 工具只能返回一段"文字" |
| 07 | 07-receipt-endings | 回执 (2/2) | 一次执行有五种结局 |
| 08 | 08-long-output | 长输出 | 太长就不塞进上下文，落盘给路径 |
| 09 | 09-no-kill | 长命令 | 跑太久也不替你做"杀掉"的决定 |
| 10 | 10-shell-env | 执行环境 | 能力照搬、呈现刻意改 |
| 11 | 11-lifecycle | 生命周期（深色） | 转后台的进程归谁收尾 |
| 12 | 12-recap-close | 收束 | 难的不是那 20 行 spawn |
| 13 | 13-cta | CTA | Next → Story 004 交互式命令 |

叙事顺序沿用 vFinal 的「先定回执与预算（②③），再谈人怎么介入、环境、进程（①④⑤）」，
只是页码按阅读顺序线性编号，并把最密的「回执」拆成两页。

---

## 技术事实源

`zero2agent`：`packages/core/src/tools/terminal.ts`（OutputSink / formatReceipt / 800 行·20KB·3s·10s·2s）、
`shell-env.ts`、`process-registry.ts`、`packages/tui/src/setup-terminal-runtime.ts`。

## 出图

```bash
cd zero2agent-xhs/epic02-story003
node render.js          # 渲染全部 → output/*.png（用系统 Chrome）
node render.js 06 09    # 只渲染指定页
```

样式：`_base-light.css`（页骨架）+ `_prose.css`（散文段落、读者问答、示例框等组件）。
深色页（11 / 13）在各自 HTML 内联深色样式。
