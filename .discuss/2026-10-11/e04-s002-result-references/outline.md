# E04-S002：复用已有落盘，补齐读取契约

用户提出终端已有大内容输出，担心重复。核对确认 E02-S003 负责终端流式落盘，E03 负责上下文压力下临时缩短。用户随后授权「完整推进 e04-S002」。

决定做统一来源引用、有界回读、容量与生命周期，并实测跨进程恢复；不重复讲一遍落盘。实现基线 origin/main 772ab67。工程契约见 specs/E04-reliability-and-context/S002-result-references/details/01-technical-design.md。
