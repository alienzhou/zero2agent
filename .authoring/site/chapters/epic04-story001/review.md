# E04-S001 课程审阅 · 2026-10-08

18页包括封面，初稿保存于7a881ef。收到用户“内容太单调”的反馈后，按一次写入后请求失败的案例重写叙事和图形：时间线、恢复对比、决策表、点阵乘法、日志、SSE片段、对话、回执单、预算数字与预测实验。

最终自动检查见[verification-final/checks.json](./verification-final/checks.json)：18页无画布越界、SVG文本越界/重叠或pre横向溢出。PC1440×1000与H5390×844均有18节，文字展开、图解放大/收起、目录定位、无横向溢出与资源/脚本错误全部通过；浏览器Chrome154.0.8037.98。

AI作者实际查看两张最终9页contact图及P09、封面和密集页，检查标题层级、缩略辨认、箭头分支、字号和事实。P10完整与中断路径不再混连；P16输入占用箭头不穿过下一轮标签；P13数字与说明留出足够间距。该记录是作者自查，不能代替人工审查。

内容核对：P02的4次HTTP/1条写入Checkpoint来自离线真实效果；P05的9次为假设；P06 UUID缩写和等待为教学重排；P09源自实际PTY屏幕，P17为字段示例；probe仅是测试工具；预算数字是默认上限而非测量用量。数据源及完整哈希见[sources](./sources.md)。

实际交互证据：[PTY](../../../../researches/failure-recovery/acceptance/screens/capture.json)、[终端恢复](../../../../researches/failure-recovery/acceptance/terminal-restore.json)；实际文件与服务证据见Story验收页。截图在researches，课程保持可选中文字与SVG，没有放宽部署格式检查。

阶段失败保留在verification-v2、verification-v2-repaired、verification-v2-final和verification-release；verification-final才对应最终作者/样式/屏幕输入哈希。旧图片只说明相应版本，不代替当前验收。最终课程未部署，人工审查待PR。
