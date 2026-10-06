# 在线图解教程

在线课程的全部运行文件位于 site/，与 Agent 代码一起维护。站点有课程总览、按阶段分组的章节目录、本章目录、全文搜索、连续阅读、图解放大、文字内容和阅读进度。每个章节及小节都有可分享的地址，浏览器前进和后退可以切换阅读位置。

阅读进度和主题保存在当前浏览器，首次访问从课程总览进入；再次访问可选择“继续阅读”。“标记本章已读完”记录完成状态。课程文件通过 iframe 保留原图解排版，文字内容适合窄屏阅读。

## 本地查看

在仓库根目录执行：

    python3 -m http.server 8788 --directory site

然后在浏览器打开 http://localhost:8788/。需要通过 HTTP 查看，以便加载课程目录。

## 维护课程

- site/chapters/ 下每个目录对应一个 Story，保留正式编号 HTML、引用的 CSS 和有序的 pages.json（如有）。
- 站点不包含导出的截图、图片包和素材制作工具。ReAct 流程图在 HTML 内用 SVG 绘制。
- 修改正文后，运行 node scripts/build-site-catalog.mjs，更新导航标题、全文搜索和文字内容。
- 新增章节时，在 scripts/build-site-catalog.mjs 的 definitions 中加入章节元信息。在该章节的 pages.json 中维护小节顺序与标题；旧章节的缺省标题在 earlyTitles 中维护。
- sourceURL 应指向该章实际可访问的设计文档。尚未合入 main 的内容，应指向对应分支。

## Nginx 部署

将 site/ 的内容同步到服务器目录；运行时不需要 Node 服务，也不用构建 packages/。

    rsync -av site/ deploy@your-server:/var/www/zero2agent/

部署用户需要能够写入目标目录，Nginx 进程需要能够读取目录中的文件。参考 deploy/nginx-site.conf 配置域名和静态目录；将 server 块加入 Nginx 的 http 上下文。

    sudo nginx -t
    sudo nginx -s reload

之后仅更新站点文件时，重新同步即可。域名的 HTTPS 使用现有 Nginx 证书配置。

站点内的文件引用都是相对路径，章节导航使用 URL hash。它也可以放在已有站点的子目录中；Nginx 只要按目录提供静态文件即可，不需要 SPA 回退到首页。
