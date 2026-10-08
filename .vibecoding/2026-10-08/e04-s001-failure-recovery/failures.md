# 失败与修正

- 调研克隆 `anthropic-sdk-typescript` 的 `v0.52.0` 分支失败：远端没有该名称。安装锁定 npm 0.52.0 后确认源码布局为 src/client.ts；后续使用包版本、锁文件 integrity 与源码哈希，远端 Tag 另行查询，不伪造版本对应。
