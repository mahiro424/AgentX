# AgentX M1 交付说明

日期：2026-09-09。本轮交付是「第一个真实代码任务闭环」，不是完整 V1。功能开发、无密钥回归与下列真实 Flash 场景已有证据；最后切片集成以 [PR #19](https://github.com/mahiro424/AgentX/pull/19) 的当前检查/合并状态为准，不用本文件替代远程门禁。

## 1. 启动和使用

- 直接运行：`E:\AgentX\desktop\out\AgentX-win32-x64\AgentX.exe`。
- 可解压包：`E:\AgentX\desktop\out\AgentX-M1-win32-x64.zip`，完整解压后运行文件夹内的 `AgentX.exe`，不要只复制 exe。
- 首次打开无需 OpenAI 账户或官网账户；设置 → 模型连接，填写自己的 DeepSeek Key，拉取目录、选择 `deepseek-v4-flash`、按需测试，再回工作台选择本地文件夹。
- 输入目标，Enter 发送；Ctrl+Enter 换行，中文输入法组词期间不发送。运行时主按钮为停止，补充要求独立提交且失败保留草稿。
- 结束后查看文件改动、只读差异、命令输出和退出码；继续输入在同一会话新增轮次，不是恢复旧进程的内存断点。
- 关闭窗口保留到托盘；真正退出有活动或未知任务会先确认。「停止后退出」需等待轮次和属于本任务的后台命令回收事实，不把点击或 RPC 应答当作完成。
- 异常后的「查看诊断」展示意图、进程及公开历史。即使历史中断且根进程消失，后台未核实仍显示未知并阻止新执行；M1 没有自动清锁或通用强制恢复入口。

## 2. 包体和验证版本

| 项目 | 实际值 |
| --- | --- |
| 平台 | Windows x64 |
| 产品 | 0.1.0，M1 连续状态切片 |
| Electron / 包内 Node | 44.2.0 / 24.20.0 |
| 开发 Node | 锁定 CI 22.22.3；本地 Node 22 系列 |
| 固定引擎 | 官方 Codex 0.153.4，资源与 SHA-256 见 `runtime/codex.lock.json` |
| 上游改动 | 0 补丁；不从用户 PATH 选择引擎 |
| 实际模型 | 仅 deepseek-v4-flash |
| 产品代码验收提交 | `cfed0228049ddd90c60507055f28cc3c185c17d0`；随后交付索引更新不修改产品代码 |
| ZIP 大小 | 266101619 字节 |
| ZIP SHA-256 | `8d8f3b9aca5c6a79b680d9fb4ce04c169d4756592a62c4b545e14563659bf7a3` |
| app.asar SHA-256 | `dc0481130016ead74e624d7805d9ee4185acb81bae560ae88550ba31cf409531` |

已检查 ASAR 内容：只有打包代码、资源与 package.json，没有模型 Key、产品数据库、测试运行目录或引擎会话历史。引擎与许可位于 ASAR 外固定资源目录。压缩包不上传到 Git 仓库，也不执行公开发布。

## 3. 六项真实验收证据

| PRD 验收 | 证据 | 已验证事实 |
| --- | --- | --- |
| M1-AC-01 配置与重开 | [M1-01](M1-01_Foundation_Validation.md)、[M1-02](M1-02_Model_Settings_Validation.md)、[M1-05 现场](M1-05_Result_History_Validation.md) | 包内 SQLite 事务/重开、safeStorage 同档案加解密、真实 Flash 配置跨重开后能继续执行 |
| M1-AC-02 实际双文件修复 | [真实续轮摘要](m1-05/live-continuation-summary.json) | math.cjs、text.cjs 真正修改，运行指定 acceptance.test.cjs |
| M1-AC-03 检查结果和原改动 | [M1-05](M1-05_Result_History_Validation.md) | 产品差异/命令退出码，独立 node --test 退出 0；原测试、人工文件、审批脚本及指定目录外文件摘要不变 |
| M1-AC-04 同一会话续轮 | [真实续轮摘要](m1-05/live-continuation-summary.json) | 两轮保持同 task/thread，新 turn，重开读回 3 轮，无自动重发；后续生命周期轮增加到 4 轮 |
| M1-AC-05 审批和停止副作用 | [M1-04](M1-04_Execution_Validation.md)、[M1-06](M1-06_Lifecycle_Validation.md) | 允许后精确文件出现，拒绝后目标不出现；停止后标记不再生成；退出时探针和引擎消失、心跳停止 |
| M1-AC-06 保活及异常核对 | [生命周期摘要](m1-06/live-lifecycle-summary.json) | 切页/最小化/托盘/取消退出保持同一引擎；异常重开只读真实历史，不清锁；启动副作用与意图各一次 |

失败与成功按顺序保留。例如原停止仅中断轮次时后台仍写文件、部分 node --test 的 spawn EPERM、首次新档案直接复制密文失败。后续修复/精确审批/正常重新加密后另行验证，不将旧失败改写成通过。

## 4. 自动测试和 UI

- 本地主回归 `72-reconciliation-full.log`：**184/184**，298006.6878 ms；真实 Electron、独立临时数据，无真实 Key/模型调用。
- 类型检查、Forge 打包及固定引擎资源检查通过；交付包五项代码资源与主回归独立包内容一致，见 `77-package-code-identity.log`。
- ZIP 解压后再次验证真实窗口、SQLite/safeStorage 和固定引擎握手，日志 `81-unpacked-foundation.log` **16/16**，26153.2119 ms。不把只成功压缩文件当作应用可启动。
- [CI 检查列表](https://github.com/mahiro424/AgentX/pull/19/checks)必须对应 PR 当前 head；任何旧提交的绿灯不代替当前检查。
- 1280×820 深浅色、960×640 紧凑、键盘及错误状态截图分别入各切片目录；用户已接受实际系统 DPI/中文 IME。图稿、合成故障图、真实模型图在验证报告中明确区分。
- 真实托盘保活与再次启动恢复同一窗口已测；未自动点击系统托盘图标，不把第二实例恢复冒称物理鼠标验收。

## 5. 实现边界与数据

Renderer 只消费有限产品 DTO；Preload 不暴露任意 RPC/文件系统/命令。Main 负责配置、凭据、项目、草稿、发送意图、结果引用和生命周期；Codex App Server 保持黑盒，通过固定公开协议完成真正规划/执行，产品不再建立第二套 Agent 循环。

默认数据根是当前 Windows 用户的 `.AgentX`（本机 `C:\Users\win\.AgentX`）：`config.json` 普通偏好/连接引用，`secrets.enc` 系统密文，`agentx.db` 产品元数据，`engine/codex` 为独立引擎数据。完整历史归引擎、实际文件内容归项目。schema 9 增加引擎归属，旧库迁移前有一致性 `before-v9` 备份。

系统密文不承诺换目录、用户或机器后直接可用；不要只复制密文文件代替正式配置。业务项目没有自动回滚；开始在真实项目使用前仍由用户检查目标目录与已有改动。M1 测试只使用合成小项目，没有拿真实业务仓库试验。

## 6. 工单与回退

| 切片 | 分支 | Issue / PR |
| --- | --- | --- |
| M1-01 外框 | m1-01 | [#6](https://github.com/mahiro424/AgentX/issues/6) / [#14](https://github.com/mahiro424/AgentX/pull/14) |
| M1-02 模型 | m1-02 | [#7](https://github.com/mahiro424/AgentX/issues/7) / [#15](https://github.com/mahiro424/AgentX/pull/15) |
| M1-03 项目 | m1-03 | [#8](https://github.com/mahiro424/AgentX/issues/8) / [#16](https://github.com/mahiro424/AgentX/pull/16) |
| M1-04 执行 | m1-04 | [#9](https://github.com/mahiro424/AgentX/issues/9) / [#17](https://github.com/mahiro424/AgentX/pull/17) |
| M1-05 结果历史 | m1-05 | [#10](https://github.com/mahiro424/AgentX/issues/10) / [#18](https://github.com/mahiro424/AgentX/pull/18) |
| M1-06 生命周期 | m1-06 | [#11](https://github.com/mahiro424/AgentX/issues/11) / [#19](https://github.com/mahiro424/AgentX/pull/19) |

全部 PR 只面向 `m1`，保留每个切片分支。`master` 固定保持 `d266bf905f3e7285de4a3e9a415558cca6c0b21d`。完整 V1 的父 PRD [#1](https://github.com/mahiro424/AgentX/issues/1) 不因 M1 子集交付而冒称全 V1 完成。

回退代码使用对应 PR 的反向提交，不自动 reset/强推。已迁移 schema 的数据不能直接交给旧版运行；须配套一致性备份和版本，保留升级后新增数据，不执行无确认数据回退。

## 7. 保留的 V1 后续清单

1. 办公文档/表格、附件、图像及跨软件结果预览。
2. 浏览器/电脑操作的真实工具接入、观察/执行/停止边界。
3. 会话正文搜索、置顶/归档等完整组织动作，目录重联和移除关联。
4. 工具/技能管理、来源治理；共享技能发现不冒称严格隔离。
5. 其他厂商及模型兼容；M1 不因拉取到名字就开放调用。
6. 全量权限模式、通用异常恢复/人工清锁、备份恢复和诊断导出。
7. 安装器、签名、自动更新与公开发布。

后续仍坚持产品层优先、引擎黑盒、最小可审计 Patch Queue。上述是保留范围，不在本轮提前建空模块或假入口。
