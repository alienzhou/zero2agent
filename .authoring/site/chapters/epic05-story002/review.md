# 课程审阅记录

2026-10-17 初稿：按本节新增的学习任务拆为 11 页（含封面）。沿目录摘要、激活正文、相对资源展开，并用选择汇合、整批未执行、路径边界、脚本授权与版本历史解释实现。未设置固定页数目标，容量与完整故障矩阵下沉详细资料。

生成源、CSS 源、HTML 与 manifest 已生成。站点构建通过；最后一次 `pnpm site:check` 检查 20 章、294 张图解及本地依赖通过。课程源码已对照标准、解析器、当前加载器、Agent/Loop、会话与 CLI/view 的拼写和机制；运行时验收由本节独立记录，课程浏览器检查不能代替它。

真实浏览器检查使用 `scripts/e05-s002-course-check.mjs`，按实际 pages.json 的 11 页核对页面数量、1080×1440 画布、SVG 文字/几何范围、终端内部文字、pre 溢出与文字重叠，同时捕获 pageerror、requestfailed 和 HTTP 资源错误。最后结果为零问题；PC 1440×1000 与 H5 390×844 的文字展开、图解放大、目录导航和页面横向溢出检查均通过。精简结果见 verification/checks.json；原始 PNG 与日志只保存在忽略目录 `tmp/e05-s002/course-yfr0RW`，不进入 Git。

作者查看了两组实际 HTML 联系表、完整第 3/6 页及 PC/H5 放大阅读器。第一轮 `course-E0a5aQ` 的外层检查虽通过，实际看图发现第 3 页 YAML 结束线贴近终端底边、第 6 页箭头穿过标签；随后增加终端内文字边界检查、增大背景并移动箭头。第二轮 `course-yfr0RW` 重验通过；保留首轮记录，不把它冒充修订后的证据。

运行命令：`COURSE_URL=http://127.0.0.1:8900 PLAYWRIGHT_MODULE=<本机已安装的 playwright 模块> node scripts/e05-s002-course-check.mjs`。原始目录包含检查时 author.cjs、CSS、manifest、逐页 HTML 和检查脚本的 SHA-256，可核对正在查看的产物版本。浏览器版本由 checks.json 实际记录；这不是规范仓库或 CLI 的版本证明。

本记录由 AI 作者自查，不替代独立人工审阅。课程和站点未发布。
