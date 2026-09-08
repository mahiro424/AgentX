# AgentX

本地桌面 AI 工作台，产品层使用 Electron + React + TypeScript，规划通过公开协议接入独立的 Codex App Server。

## 当前交付范围

当前为 **M1-01 外框切片**：真实桌面窗口、空工作台、侧栏、通用主题/缩放、就地错误和有限 IPC。模型连接、项目关联及 Agent 执行尚未接入，发送按钮保持禁用。工作台草稿此阶段仅在窗口内保留，不承诺关闭后的恢复。

实际测试、失败修复边界与截图见 [M1-01 验证记录](docs/validation/M1-01_Foundation_Validation.md)。

[M1 计划与工单](docs/plans/AgentX_M1_Issue_Gates.md)记录依赖与验收门禁；需求以 [PRD](docs/prd/AgentX_Desktop_PRD.md) 为准。所有切片单独分支/PR，只向 `m1` 集成，`master` 不动。完整 M1 与人工设计 QA 尚未完成。

## 本地运行

开发基线：Windows x64、Node 22.22.3；依赖使用锁文件安装。

```powershell
npm ci
npm run typecheck
npm start
```

真实打包及无密钥桌面测试：

```powershell
npm run package
npm test
```

打包结果为 `out/AgentX-win32-x64/AgentX.exe`，运行时须保留整个同级目录。当前没有安装器、签名或自动更新。

## 数据与验证边界

- 正常应用使用用户主目录下 `.AgentX`；普通主题/缩放保存到版本化的 `config.json`，不涉及在线账户。
- 测试通过 `AGENTX_DATA_DIR` 指定独立临时目录，过滤凭据环境变量，不读取正式配置或调用模型。
- `node:sqlite` 与 Electron `safeStorage` 在**打包后的 Main 进程**中以合成数据验证事务及重开解密；这不代表业务数据库或模型 Key 功能已经完成。
- 故障注入仅在测试进程内替换有限 IPC 的受控响应；生产代码没有演示数据、测试模式或假成功路径。
- 原始测试目录、缓存、引擎下载及构建包不提交。提交/PR 中的结果必须区分自动验证与尚待人工检查的 UI。
