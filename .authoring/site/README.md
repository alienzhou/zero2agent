# 在线课程制作

Zero2Agent 的课程 HTML、图内文案和制作资料，从本仓库维护。content-generator/zero2agent-xhs 保留为迁移前的历史材料，后续不要在那里修改课程，再复制回本仓库。

## 内容放在哪里

| 内容 | 位置 | 编辑方式 |
| --- | --- | --- |
| 章节顺序、标题、简介与源码入口 | course.json | 修改章节元信息 |
| HTML、CSS 与小节顺序 | ../../site/chapters/epicNN-storyXXX/ | 修改源 HTML、样式与 pages.json |
| 图解生成源、内容计划、来源与审阅记录 | chapters/epicNN-storyXXX/ | 有 author.cjs 的章节改生成源，再构建 |
| 阅读界面 | ../../site/assets/ | 维护导航与双端阅读体验 |

表中的 site 路径相对仓库根目录为 site/；在本目录访问时用 ../../site/。

## 更新已有章节

1. 根据 specs/ 中的课程文档和 packages/ 中的实现，核实内容与来源。
2. 修改对应章节的编辑源。E03-S002、S003、S004 的图解与图内文案由各自 chapters/epic03-storyXXX/author.cjs 生成；有 author.cjs 的章节不要另行修改产物 HTML，其他章节直接维护 site/chapters/ 内的 HTML。
3. 需要改标题或顺序时更新 pages.json；有生成器的章节由生成器更新标题。
4. 在仓库根目录运行 pnpm site:build，生成图解 HTML、课程目录、搜索文字并检查资源。
5. 运行 pnpm site:preview，检查 PC 三栏、手机目录、图解放大及文字内容。编辑后再运行 site:build，并刷新页面。
6. 同一个提交保存编辑源、HTML、pages.json 和生成的 site/course.json，避免部署内容与源文件脱节。

构建与预览只使用 Node 内置模块，不依赖 content-generator、不导出 PNG，也不调用 Agent 模型。

## 新增章节

1. 先完成对应 Story 的规格与教学文档。
2. 在 site/chapters/ 创建 epicNN-storyXXX 目录，参考 templates/page.html 制作第一张图解，再增加后续小节。
3. 创建 pages.json，按阅读顺序填写 file、title、number；可参考 templates/pages.json。
4. 在本目录的 course.json.chapters 中加入 id、epic、title、description、sourceURL。章节编号由数组顺序生成，不需要修改构建脚本。
5. 内容计划、来源、审阅资料放进本目录的 chapters/epicNN-storyXXX/；需要程序生成图解时，在这里放 author.cjs。生成器以对应 site/chapters/ 目录为工作目录，写入 HTML 与 pages.json。
6. 运行 site:build 和 site:preview，完成阅读检查后提交。

## 发布

构建完成后，仅同步 site/ 到 Nginx 的静态目录。编辑源与审阅资料留在 .authoring/。具体配置见 [部署说明](../../docs/site.md)。

## 图解规范

- 保留 1080 × 1440 画布。流程图使用 HTML 内的 SVG，文字保持可选中。
- 使用米白背景、深色正文和少量红色强调；内容页靠留白组织信息。
- 标题说明当前小节讲什么，正文给出事实、实例或判断依据。
- 不引用本机绝对路径、外部 CSS、图片或脚本。样式放在同一章节目录，图形内嵌在 HTML 中。
- 检查缩放后是否清楚，密集图解通过“放大图解”检查；文字内容作为窄屏阅读补充。
- sources.md 与 review.md 记录内容来源和人工审阅；迁移过来的旧审阅记录仅代表当时版本，需要重制时更新。
