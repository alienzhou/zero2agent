# 课程制作在 Zero2Agent 内闭环

用户确认课程过去集中在 content-generator，希望判断是否应该在 Zero2Agent 中闭环。检查发现：站点 HTML 与 CSS 已迁入，但 E03-S002 的 author.cjs、内容计划、来源审阅与发布文案仍留在旧目录；课程元信息嵌入构建脚本。

决定将 Zero2Agent 作为课程的维护源：

- .authoring/site/course.json 维护章节元信息。
- .authoring/site/chapters/ 维护生成源、制作计划、来源、审阅与文案。
- site/chapters/ 维护源 HTML／样式及有序清单；有生成源的章节由构建生成 HTML。
- site:build、site:check、site:preview 在仓库内完成生成、检查和预览，运行时不读取旧仓库。
- site/ 是唯一的服务器部署目录；制作资料不部署。

content-generator 中的原始 HTML、PNG 和制作记录保留为历史材料，不删除，也不继续作为新课程维护位置。通用内容制作工具仍可在原仓库用于其他系列。
