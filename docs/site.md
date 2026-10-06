# 在线图解教程

在线课程的全部运行文件位于 site/，与 Agent 代码一起维护。站点有课程总览、按阶段分组的章节目录、本章目录、全文搜索、连续阅读、图解放大、文字内容和阅读进度。每个章节及小节都有可分享的地址，浏览器前进和后退可以切换阅读位置。

阅读进度和主题保存在当前浏览器，首次访问从课程总览进入；再次访问可选择“继续阅读”。“标记本章已读完”记录完成状态。课程文件通过 iframe 保留原图解排版，文字内容适合窄屏阅读。

PC 宽屏使用课程目录、正文、本章目录三栏布局；1100px 及以下收起本章目录，760px 及以下将课程目录改成抽屉。手机上的主要按钮点击区域至少 44px，图解放大后只在图解容器中横向滚动，正文仍保持屏幕宽度。展开的文字内容使用 16px 字号。搜索支持键盘快捷键，关闭目录后焦点回到打开它的按钮。

## 本地查看

在仓库根目录执行：

    pnpm site:build
    pnpm site:check
    pnpm site:preview

然后在浏览器打开 http://127.0.0.1:8788/。预览启动时会先构建并检查站点；端口占用时可运行 pnpm site:preview --port 8790。编辑后重新运行 site:build，再刷新浏览器。

## 维护课程

- site/chapters/ 下每个目录对应一个 Story，保留正式编号 HTML、引用的 CSS 和有序的 pages.json。
- 站点不包含导出的截图、图片包和素材制作工具。ReAct 流程图在 HTML 内用 SVG 绘制。
- 章节顺序、标题、简介与源码入口维护在 .authoring/site/course.json；新增章节不用修改构建脚本。
- E03-S002 的图解与图内文案编辑源在 .authoring/site/chapters/epic03-story002/author.cjs；构建时生成 HTML。其他现有章节直接编辑源 HTML。
- 内容计划、来源、审阅记录与发布文案放在 .authoring/site/chapters/，与课程代码和文档一起维护。
- 修改编辑源后运行 pnpm site:build，生成 HTML、导航标题、全文搜索和文字内容，并检查依赖、页序与部署文件。
- sourceURL 应指向该章实际可访问的设计文档。尚未合入 main 的内容，应指向对应分支。

课程制作在 zero2agent 内闭环。content-generator 中的旧课程保留作历史材料，后续课程从本仓库维护。详细流程与模板见 [在线课程制作](../.authoring/site/README.md)。

## Nginx 部署

先运行 pnpm site:build，再将 site/ 的内容同步到服务器目录；运行时不需要 Node 服务，也不用构建 packages/。.authoring/ 中的编辑源和制作资料不进入部署目录。

    rsync -av site/ deploy@your-server:/var/www/zero2agent/

部署用户需要能够写入目标目录，Nginx 进程需要能够读取目录中的文件。参考 deploy/nginx-site.conf 配置域名和静态目录；将 server 块加入 Nginx 的 http 上下文。

    sudo nginx -t
    sudo nginx -s reload

之后仅更新站点文件时，重新同步即可。域名的 HTTPS 使用现有 Nginx 证书配置。

站点内的文件引用都是相对路径，章节导航使用 URL hash。它也可以放在已有站点的子目录中；Nginx 只要按目录提供静态文件即可，不需要 SPA 回退到首页。
