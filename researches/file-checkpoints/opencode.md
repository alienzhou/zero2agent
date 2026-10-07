# OpenCode：快照与选择路径恢复

## 基本信息

| 项目 | 值 |
| --- | --- |
| 仓库 | [anomalyco/opencode](https://github.com/anomalyco/opencode) |
| 固定 Commit | ecc4916b5a9608c30e6dd58a67f2137b594407ca |
| Commit 时间 | 2026-10-06T15:32:45-07:00 |
| 调研日期 | 2026-10-07 |
| 二进制验证 | 未执行 |

## 目标与结论

Snapshot 服务把 capture/files/diff/preview/restore 分开，恢复时接受“路径→目标树”的映射。相比把整个工作区直接 checkout，选择明确路径更容易控制误删范围；界面可以先 preview 再 restore。这一点适合本课借鉴。

该固定版本实现仍依赖 Git：在 global data/snapshot 下组织独立 gitDirectory，只有 Git 项目启用捕获；以当前 location 作为扫描 scope，使用源仓库的忽略规则，并限制未跟踪文件大小。捕获失败返回 undefined，不意味着每次都存在可恢复快照。

## 关键源码

[packages/core/src/snapshot.ts](https://github.com/anomalyco/opencode/blob/ecc4916b5a9608c30e6dd58a67f2137b594407ca/packages/core/src/snapshot.ts)：Interface、repository、capture、preview、restore、checkout。具体 Git 对象空间和打包性能不能从这份接口推导，本课没有运行其二进制。

本课采用“预览与恢复分开、只处理明确路径”的产品判断；存储改为 Node 原生分块 CAS，并在 baseline 保存失败时阻止受控写入。
