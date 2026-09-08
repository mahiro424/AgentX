# M1-03 本地项目与会话入口验证

日期：2026-09-08。工单：[M1-03 / #8](https://github.com/mahiro424/AgentX/issues/8)。分支：`m1-03`；基线：`146fb37537c4cc3ae64fa814eef5627be3e38ba3`（M1-02 已合入 m1）。用户已回复“符合，继续”确认本切片视觉，PR 当前头部 CI 与集成仍待完成；不写入 master、不关闭未完成工单。

## 1. 完成边界

- 原生选择一个本地目录，可取消；Main 解析实际路径后关联、去重。只保存关联，不复制或改动目录文件。
- 侧栏项目名称右侧 `…` 与铅笔打开同一个名称编辑弹层，支持 Enter 保存、Escape 取消、焦点返回；只改显示名。数据库锁或损坏记录导致失败时保留输入且不提交部分修改。
- 实际产品项目/会话记录可重开读取；加载保留旧列表，读取失败显示错误，目录不存在或不可读标记为不可用。当前执行按钮仍禁用，不以按钮禁用冒充已验证 M1-04 发送前目录检查。
- 会话显示原始最近活动时间与终态；点击、重读不写入活动时间。旧非终态输出为待核对，不谎称引擎仍运行。
- 运行/等待的不同图标通过受控快照验证，生产界面不播种示例记录。真实执行生产者、流式活动、正文历史分别依赖 M1-04 / M1-05，必须在接入后回归。
- 不增加项目管理、全部任务、验收状态页面，不提前开放搜索、置顶、归档、目录重联、附件、电脑操作或任意文件系统接口。

## 2. 输入与设计对照

已读完整父 PRD #1、CONTEXT、ADR、架构/状态文档和本工单，输入来源不是工单摘要。UI 七项必读：

1. app-shell 全条：共享侧栏/工作台，项目 `+` 原生选目录；省略空分组和未实现入口。
2. 状态策略：错误不当空态，等待批准区别于运算，旧观测恢复必须核对。
3. US-3/5/27/30 与 M1 覆盖：目录、名称、会话记录与活动、错误与键盘；其他组织能力后续。
4. 本页即 app-shell，无另一外框输入。
5. DESIGN §5/6：列表 40、图标按钮 32、菜单键盘、弹层焦点、主题 Token。
6. 单端 Windows，不引入 platforms.md。
7. 已实际打开[默认采用图](../design/references/windows-desktop-app-shell.png)，并对照[侧栏操作修正版](../design/review/v0.3/02-sidebar-actions-corrected.png)和[项目编辑采用图](../design/review/v0.3/03-project-edit.png)。

功能三项必读：IMPL-M1-PUBLIC-SEAMS / DESKTOP-DATA 要求 Main 单写入者、有限接口、不移动原件；TEST-M1-PROJECT-SESSIONS / PRODUCT-IPC / DESKTOP-UI / ACCEPTANCE-M1 要求临时数据和真实 Electron；四条故事按分期验收，不用夹具替代真实活动事件。完整输入快照与逐状态来源继续以 #8 为准。

采用图中的完整 V1 菜单和目录重联不属于本切片，按已批准分期只显示可用的“编辑名称”。沿用已确认外框，不重画首页。最后的真实窗口核对发现菜单遮住项目右侧操作、不可用标记压住长名称；分别通过失败测试复现后修正为行外展开和独立标记空间。

## 3. 状态与增量验证

| state | 已验证行为 | 增量记录 |
| --- | --- | --- |
| empty | 空库返回空列表，不造会话 | RED 缺公开桥 → GREEN |
| selecting | 原生单目录选择取消不写库、不丢草稿/当前选择 | RED 缺入口 → GREEN |
| associated | 中文/空格目录持久化重开、可核对实际路径，原文件不变 | RED 缺工作目录选择 → GREEN |
| duplicate | 重复路径、大小写别名、junction 定位已有记录；不同目录保持独立 | RED 唯一约束错误 → GREEN |
| editing | 两个入口同一弹层，IME 合成事件不误提交、Enter/Escape、只改名称 | RED 缺编辑 → GREEN；焦点检查等待真实返回 |
| saveFailed | 实际 SQLite 写锁失败保留原记录和输入，手动重试 | 首次追加测试已绿，未虚构 RED |
| missingDirectory | 合成目录移走后保留记录、显示不可用与禁用原因 | RED 无目录状态 → GREEN |
| loading | 读列表保留内容；晚到旧快照不能覆盖新读取 | 已由前一行为的读取序号覆盖，首次测试已绿 |
| error | 数据库访问失败不当空列表；关联失败不被晚到列表成功抹除 | RED 假空态 / 错误被清除 → GREEN |
| active | 运行旋转、审批等待不同；观测更新不重排 | RED 缺会话 UI → GREEN；仅受控 DTO，真实事件待 M1-04 |
| inactive | Main 存储接缝写入合成记录后真实读取/重开；点击不刷新活动 | RED 缺持久化接缝 → GREEN；不是引擎历史验收 |

必要错误与设计回归：迁移失败整体回滚、损坏项目/错目录任务不静默展示、损坏记录改名报错不部分提交、紧凑新会话离开旧记录、菜单 resize 焦点返回、菜单和长名称不被遮挡。每个修复保留实际失败和后续通过记录。IPC 非法载荷、过期编辑、相同 URL 的外来窗口，以及成功迁移保留模型数据/保护标记是补充已绿回归，没有为凑流程改坏实现。

## 4. 数据与接口

- 生产默认 `.AgentX`；测试用独立 `AGENTX_DATA_DIR`，不读取正式 Key、真实项目或其他产品目录。
- `storage/database.ts` 为唯一 SQLite 迁移入口：schema 5 共用原模型表，新增 projects / tasks。旧版迁移前 `VACUUM INTO` 留一致性快照，全部迁移在一次事务；读取损坏/不支持版本不删除或清空重建。
- 项目名称更新采用 `expectedRevision` 与事务；结果解码失败时连接关闭回滚。备份已核对迁移前版本、`integrity_check` 与模型目录/测试/未决保存标记；不是只检查文件存在。
- `ProjectService` 使用原生对话框、`realpath`、`stat`、`opendir`；不简单全局小写，不用 Renderer 提交任意路径。当前只支持显式项目与单一引擎目录，严格实际路径改变时保守提示不可用，不自动重联。
- 新增 `getWorkspace`、`chooseProject`、`renameProject`、`onWorkspaceChanged`；逐项校验产品窗口、主 frame、URL 和载荷。未暴露原始 IPC、通用文件访问、命令执行或修改任务状态接口。
- `createTaskRecord` 只供 Main 执行协调层接入；完整消息/工具历史仍归引擎，文件仍为实际内容真相源。当前没有生产执行协调器，不自动重发旧记录。

## 5. 自动验证与可复查证据

环境：Windows x64，开发 Node 22.22.3；实际打包 Electron 44.2.0 / Node 24.20.0。类型检查、真实 Forge/Webpack 独立目录打包和无密钥桌面回归均为本地验证；PR CI 另验。

- [桌面测试输出](m1-03/desktop-tests.tap.txt)：55/55 通过，0 失败、0 跳过（12 条外框、24 条模型设置、19 条项目入口及相关回归）。
- [项目菜单浅色 1280×820](m1-03/projects-menu-light-1280.png)。
- [名称编辑浅色 1280×820](m1-03/project-editor-light-1280.png)。
- [名称编辑深色 1280×820](m1-03/project-editor-dark-1280.png)。
- [名称编辑深色紧凑 960×640](m1-03/project-editor-dark-960.png)。

截图来自真实打包 Electron Renderer，不是网页仿桌面、生成稿或真实模型调用；会话标题标注“合成记录”。本地也实际检查弹层 Tab/Shift+Tab 循环、Escape 返回、紧凑窗口不横溢出。截图用于本切片视觉检查，不包含系统原生标题栏按钮的像素验收。

本机既有 `out` 应用由用户打开且占用输出，未关闭或强杀；保留 EBUSY 日志，改用 Forge 自带 `api.package({outDir})` 输出至 `.local-validation/m1-03/package`。测试 helper 的 `AGENTX_TEST_PACKAGE_DIR` 只选打包目录；默认 CI 仍用标准 `npm run package` 的 out。最终分发包另在 M1 现场验收后准备。

模型显隐回归曾失败于窗口失焦：helper 提前 `show()`，晚到的产品 `ready-to-show` 又恢复窗口。现等待产品首次显示，不主动抢跑；失焦用实际原生隐藏引发 blur，并保留 `document.hasFocus()`、Main 前台检查和明文清除断言，不伪造 JS blur。本检查不证明最小化/托盘生命周期，M1-06 仍须验证。

原始 RED、EBUSY、焦点诊断和历次输出保留在本机 `.local-validation/m1-03/`，不将环境启动失败算作业务 RED，也不按日志文件名猜是否通过。远程只提交本摘要、脱敏测试输出与采用截图，不上传缓存、临时库、运行目录或凭据。

## 6. 审查与剩余门禁

独立只读审查覆盖项目存储/IPC 与 UI 交互，主代理核验并负责修改及最终运行。已修复读取假空态、半次迁移/改名、错误竞态、紧凑入口和焦点/布局问题。审查中的多写入者并发、原生 dialog 卸载猜测未证实为本切片缺陷，不因此新增框架或兜底逻辑；已有重复开关弹层实测通过。

- 用户已回复“符合，继续”确认 M1-03 项目侧栏与名称编辑视觉；此确认不替代真实任务和下列人工专项检查。
- 真实中文输入法、系统 125%/150% DPI 留最终人工 QA；自动合成 composition 和应用缩放不是其替代。
- 真正执行、允许/拒绝审批、副作用停止、同会话续轮和正文恢复按 M1-04～06 / ACCEPTANCE-M1 验收。此次没有模型网络调用。
- 回滚保留 m1-03 分支与切片 PR。若回退至只识别旧 schema 的程序，先退出本产品并保留当前数据，人工恢复匹配版本的迁移前快照；不自动降级或覆盖新数据。恢复旧快照会不包含本切片后创建的项目/会话，不能承诺“代码回退即数据无损”。

## 7. 技术资料

按 Context7 检索并核对本地与打包行为：[Electron 原生目录选择](https://github.com/electron/electron/blob/main/docs/api/dialog.md)、[Node 文件系统](https://nodejs.org/docs/latest-v24.x/api/fs.html)、[Windows 目录大小写行为](https://learn.microsoft.com/en-us/windows/wsl/case-sensitivity)。迁移前快照参考 [SQLite VACUUM INTO](https://sqlite.org/lang_vacuum.html)，实际失败回滚与快照可读性由本切片测试确认；不将官方 API 文档当作产品验收。

## 8. 集成补记

[PR #16](https://github.com/mahiro424/AgentX/pull/16) 已于 2026-09-08 合入 m1，合并提交 `692930a3653496551b477355e9e80327cb443738`；#8 已关闭，m1-03 分支保留。当前头部 `ff908c462f407a511eda02befa8ed006a3ce7f2a` 的 [Windows PR CI](https://github.com/mahiro424/AgentX/actions/runs/34185937718)、[分支 CI](https://github.com/mahiro424/AgentX/actions/runs/34185880899)、[文档 CI](https://github.com/mahiro424/AgentX/actions/runs/34185937723) 全部通过。master 仍为 `d266bf905f3e7285de4a3e9a415558cca6c0b21d`，没有修改。

前文待 CI/集成为提交时事实，本补记解除本切片门禁。M1-04 已创建独立分支并完成就绪分拣，真实执行、活动事件回归、历史及最终人工专项的剩余范围不变。
