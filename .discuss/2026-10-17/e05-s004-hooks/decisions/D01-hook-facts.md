只实现 beforeTool/afterTool/beforeComplete 同步 command 检查；配置发现不执行，显式身份信任才启动；检查和工具事实分别保存，未知 Hook 的新检查必须经用户独立明确授权。

最终 ee371e1 真实服务重验 normal 因 API 作用域补载跳过整个三工具批次而撞 12 工具额度，denied 通过；70cbf2c 的早期 2/2 不冒充最终源码成绩。冻结 cases v2 的任务、文件、断言、模型、8/12/120s 与 maxRetries=0，补上显式初始目录 scopes 的宿主能力：调用方已知目标时，在首次请求前加载该目录规则；不扫描全树，也不依赖模型准确分批。CLI 为可重复 --instructions-scope（最多 8），SDK 为 projectInstructions.scopes；当前权限与物理边界仍适用，普通会话默认不变。

新增一次同源码成对 baseline/candidate 评测；只改变是否提前声明 packages/api。调用方任务、文件与预算相同，实际请求覆盖层有意不同，不能称为模型输入字节相同。保留所有失败，不改工具计费，不扩大门槛，不修改冻结 cases v2。
