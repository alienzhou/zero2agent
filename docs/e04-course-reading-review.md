# E04 课程阅读审阅

2026-10-17，按“必要才精简，不统一缩短”的要求逐页检查四节课。审阅关注每页是否提供独立机制、反例或操作，是否重复其他页，以及细节是否更适合跟练/技术文档。页数不是唯一标准，也不以读完时间作未经实测的承诺。

| 课程 | 原版 → 当前稿（含封面） | 判断 |
| --- | --- | --- |
| S001 失败恢复与运行预算 | **18 → 18** | 保留全部图文。错误分类、重试所有权、半截流、权限拒绝、批次配对和晚到效果分别解决不同失败，不能只为减页把它们合在一起。 |
| S002 大工具结果按需读取 | **18 → 15** | 正文去重和完整存储配额下沉技术设计，实际验收成绩留在验收文档；跟练保留核对请求、哈希和源调用次数的方法。 |
| S003 摘要质量与事实保留 | **18 → 15** | 前课衔接合入请求结构说明；快照校验细目与历史实验成绩下沉。局部纠正、时间顺序、递归错误、回查与完成判断继续分别讲。 |
| S004 中断后的安全续跑 | **18 → 14** | 衔接与总结不再单独占页；完整快照结构下沉；真实进程实验并入可运行跟练，继续明确 SIGKILL 与观察点。 |

合计 **72 → 62 页**。没有缩小字号、改变画布或压缩留白；保留的页面 URL 不变。文件名前缀是稳定标识，网站显示页码和阅读顺序以 pages.json 为准。

## 哪些内容移到哪里

| 原页面 | 处理及阅读入口 |
| --- | --- |
| S002 P11 正文去重、P16 存储容量 | 主图去掉；循环页保留调用来源与正文身份区别，保存失败页保留不静默丢弃的原则。完整哈希去重、输出预留、背压与配额见 [技术设计](../specs/E04-reliability-and-context/S002-result-references/details/01-technical-design.md) 和 [跟练](../specs/E04-reliability-and-context/S002-result-references/follow-along.md)。 |
| S002 P17 验收成绩 | 不是读者必须逐页记忆的机制。成绩及实际证据见 [验收清单](../specs/E04-reliability-and-context/S002-result-references/details/03-verification-checklist.md)，跟练仍教如何判断真实效果。 |
| S003 P03 能力阶梯、P13 恢复细目 | 衔接并入请求结构页，新读取使用当前权限保留在回查页；版本/原史/来源绑定/配对及失败处理见 [技术设计](../specs/E04-reliability-and-context/S003-summary-quality/details/01-technical-design.md)。 |
| S003 P16 实验成绩表 | 保留公平比较与完整分母的教学原则，54/55/56 次数、历史失败和成本仍在 [验收清单](../specs/E04-reliability-and-context/S003-summary-quality/details/03-verification-checklist.md) 与 [研究资料](../researches/summary-quality/README.md)。原成绩未改。 |
| S004 P03 衔接、P08 完整快照 | 场景页说明本课新增范围，回执页保留同版本发布原则；完整字段与独占发布见 [技术设计](../specs/E04-reliability-and-context/S004-safe-resume/details/01-technical-design.md)。 |
| S004 P15 进程实验、P18 路线总结 | SIGKILL、另启进程、各写一次并入离线跟练；故障注入位置和局限见 [跟练](../specs/E04-reliability-and-context/S004-safe-resume/follow-along.md)。四课路线由 [Epic 导航](../specs/E04-reliability-and-context/README.md) 承担。 |

## 为什么 S001 保留 18 页

P02/P03 分别提供具体故障现场和恢复边界；P04–P08 依次解释哪些错误可重试、谁拥有重试、如何关联尝试、等待多久、何时超时。P09 是实际操作，P10/P11/P12 分别处理半截流、参数修正和审批拒绝。P13/P14 区分预算计数与批次配对，P15/P16 区分原生退出结果与取消后的晚到效果。P17/P18 分别让读者配置限制和验证结果。这些页面篇幅虽长，但学习任务各自成立，未发现需要删掉整页的重复主线。

四个生成器均取消“必须恰好 18 页”的断言，仅保留有效课程与发布上限检查。S001 的 18 页是这次判断的结果，其他课程也不以 15 或 14 页为模板。

## 验证范围

本轮只修改课程编辑源、生成产物、检查脚本和配套文档；运行时实现、工程测试及原真实服务验收保持原版本。重新验证实际 HTML、目录/搜索一致性、PC/H5 导航、文字展开、图解放大和逐页可读性。当前摘要见 [课程检查索引](../.authoring/site/reviews/e04-reading-verification.json)，原始截图保存在[独立外部归档草稿](https://github.com/alienzhou/zero2agent/releases/tag/untagged-aa5fec976a9b5bbe43aa)（访问需相应仓库权限），不提交 Git；[下载与校验索引](../.authoring/site/reviews/e04-reading-evidence.json)记录源码版本、附件哈希和回下载验证。原交付文档中的 18 页描述是当时的验收历史。

本轮提供 PR review，未合并，也未部署课程。
