# AX-001：桌面基础工程与空工作台

日期：2026-09-07。性质：历史本地实施记录（未完成），不是正式 GitHub Issue；不具备 ready-for-agent 状态或开工授权效力。

> 本记录封存为历史：原“本地准备状态：ready-for-agent”使用不当，不能替代 ai-program 的正式 Issue、设计输入与已合并依赖。后续由 [M1 计划](AgentX_M1_Implementation_Plan.md) 中 M1-01 接续；下文保留当时范围与检查安排，不表示它们已完成。现有脚手架和未提交修改保留，不清除或重做。

## 授权与依赖

用户已确认本轮计划：本地工单、Electron + React 基础工程、基础外框和空工作台、真实启动截图与本地打包。不接模型、不改 Codex、不提交或推送。按本次明确批准的范围分步实现 UI，不将局部状态当作整页交付。

本轮采用已确认的本地 PRD / 图稿作为输入；这是用户批准的本地实施记录，不是假造的 GitHub Issue 或已合并 PR。远程 PRD、Design Issue、开发 Issue 和 CI/合并仍未开展，完整线上工作流不宣称完成。

设计依赖已在本地提供并由用户确认：D-global 对应 DESIGN.md；D-windows-desktop-app-shell 与 D-windows-desktop-workbench 对应 references 默认图。此次核对既有输入，不重画、不改设计、不借用其他产品源码。

## PRD 绑定与实现前必读

- 父 PRD：E:/AgentX/desktop/docs/prd/AgentX_Desktop_PRD.md（本地已确认，无远程编号）。
- page-id：app-shell；壳层内容包含已批准的 workbench 空态，不代表完整 workbench 工单。
- platform-id：windows-desktop。
- 覆盖：US-1 的免登录入口、US-29 的系统主题、US-30 的窗口和键盘基础；其余故事不标完成。
- 壳层关系：本页即 app-shell，空内容按 workbench 默认态呈现。

| 必读 | 已读摘要 |
| --- | --- |
| 1. PRD 页面清单 app-shell 全文；workbench 空态与 UI-COMPOSER | 单一外框、约 240px 侧栏、按需右栏；无假会话或重复附件按钮 |
| 2. PRD 状态策略 | 未配置模型禁止发送；空、错误、禁用状态明确，不伪造运行 |
| 3. PRD 用户故事 US-1、US-29、US-30 | 免登录进入、主题跟随、键盘及缩放可读 |
| 4. app-shell 壳层依赖 | N/A，本工单即壳层基础；不伪造已合并状态 |
| 5. DESIGN.md §2–§6 | 中性表面、蓝色焦点、系统字体、真实禁用、可访问名称 |
| 6. 多端平台 | N/A，仅 Windows |
| 7. references/windows-desktop-app-shell.png 与同构 workbench.png | 已查看，沿用构图；移除示例数据，保留空态和未接入说明 |

历史架构依据：AgentX_Architecture.md §2–§5、三个已确认 ADR；主进程拥有窗口，Preload 仅暴露有限 IPC，Renderer 无 Node 权限。原 G0/G1 报告保留。当前范围、状态与门禁以修订后的 PRD 和 M1 正式工单链路为准，本记录不再承担现状真相源。

## States 矩阵与验收

| state | PRD 来源 | 本轮可观察预期 |
| --- | --- | --- |
| default / empty | PRD 页面清单 app-shell、workbench UI 设计描述 | 实际 Electron 窗口，AgentX 品牌、空侧栏、欢迎语与同一输入组件；无假项目/历史 |
| draft / disabled | PRD UI-COMPOSER、状态策略 禁用 | 示例仅填草稿；模型、附件、项目、设置未接入清楚禁用；不能发送或伪造结果 |
| chrome-reduced | PRD app-shell 变体、DESIGN §5 分隔条 | 侧栏收起/展开；分隔条可键盘调整；右栏可开关；960×640 不裁主输入 |
| loading / error | PRD 状态策略、TEST-PRODUCT-IPC | 主进程应用信息加载可观测，桥接失败有错误与重试，不假称连接正常 |
| theme / keyboard | PRD US-29、US-30、TEST-DESKTOP-UI | 跟随系统深浅色；焦点可见、输入法不误发送、窗口控件正常 |

功能验收：Main/Preload/Renderer 真实工作，有限 IPC 可读取应用名称/版本；拒绝不可信调用与任意通道暴露；应用不启动引擎或模型请求。构建错误不吞没。

设计 QA：对齐已确认默认构图与 Token；截图来自真实 Electron 页面；示例历史不复制；当前无模型时不展示已连接 Flash。尺寸/主题截图由人检查，自动测试不冒充整页视觉批准。

## 实施与验证顺序

1. 固定本地 npm 依赖及锁文件，建立 Forge/Webpack/TypeScript 和最小窗口宿主；环境准备不冒充行为 RED。
2. 真实窗口上先写默认空态断言，观察失败，再实现基础外框。
3. 按草稿禁用、布局、IPC 错误逐项增加行为断言与实现。
4. npm run typecheck；npm run package；npm test。真实桌面测试使用 Playwright Electron，复用项目 Electron，不另下载浏览器。
5. 捕获真实窗口截图、核对打包内容、保留测试记录与未完成事项；不创建 PR/不声称远程 CI 通过。

## 范围与回滚

新增 package.json / lock、Forge/Webpack/TS 配置、src/main、src/preload、src/renderer、有限 shared contracts 和本工单所需测试；仅更新相关文档入口与 .gitignore。不是按目标目录树创建全部模块。

依赖下载仅为本地开发和打包，可能受网络影响。开发/验收数据使用独立目录，不碰用户 .codex 或正式 .AgentX。备份与初始指纹位于 .local-validation/foundation/before；原 G0/G1 脚本与引擎锁不修改。新文件可单独撤回，已有 WIP 保留。

未实现：正式档案与数据库、设置业务、项目/任务组织、搜索、附件、模型连接、真实 Agent 执行、托盘任务保活、办公/浏览器/电脑操作、安装器及发布。不是完整页面或完整产品。
