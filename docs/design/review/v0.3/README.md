# AgentX UI v0.3 评审索引

日期：2026-09-07。范围：本目录保存整套 V1 采用图；用户已确认该阶段设计。后续无密钥验证结果见[G0 MVP 报告](../../../validation/AgentX_Compatibility_Evidence.md#evidence-g0-first)，不以图稿证明运行成功。

## 基准与状态

- 当前只有工作台与设置两个主要界面，加共用 app-shell；以下为 24 张主图及 1 张澄清表单补充图，均是关键使用状态和浮层，不是独立页面。
- 用户已确认 v0.3 采用图作为 V1 视觉基线；三个默认图已复制至 [references](../../references/README.md)。它们仍是设计图，不作为实现或兼容性通过证明。
- 旧 v0.2 图片与其他既有资料保持原样；本轮修改前的 8 个文档已在 `baseline`（本地留档，不上传） 中逐项复制并校验。
- PRD/架构文档与图片采用版本是不同版本序列；当前 M1 为 V1 的阶段交付，不改变已有采用图。
- 所有截图使用示例文件、项目和状态；不含真实 API Key、真实办公数据或其他产品项目内容。
- 本轮已完成：25 张采用图、8 份规格同步、文档与图片检查；用户已确认 V1 方向与采用稿。详见`verification.md`（历史检查记录仅本地留档）。
- 连续看图请打开[完整图册](gallery.md)，表格中的链接也可单张打开。

## 已同步的关键取舍

1. 项目操作收进侧栏，名称编辑有明确入口；会话置顶、归档就地操作，运行与最近活动时间互斥显示。
2. 标题与正文统一检索，不保留全部任务页；正文索引由产品通过公开历史接口建立，不依赖引擎私有库。
3. 合并发送与停止主按钮，只有一个材料添加入口；执行中补充是文字动作，当前轮模型与权限不变。
4. 结果直接检查并用自然语言继续修改，取消验收状态、按钮及数据库实体。
5. 模型列表拉取、多选、逐项测试、启停、密钥显隐与保存生效区分；不将拉取成功当成 Agent 能力通过。
6. 预览与编辑、执行输出与交互终端、自动控制与人工接管、保存与生效各自明确。
7. 六组设置：通用、模型连接、工具与技能、权限与隐私、数据、关于与诊断。
8. 未知、失败、部分产物、恢复、退出和窄窗口与正常路径同等设计；无自动重放副作用。

## 图片清单

| 编号 | 功能 | 所属规格 | 状态 |
| --- | --- | --- | --- |
| 01 | [新会话工作台](01-new-session.png) | app-shell、workbench | V1 采用稿已确认 |
| 02 | [项目菜单与会话操作](02-sidebar-actions-corrected.png) | app-shell | V1 采用稿已确认 |
| 03 | [编辑项目名称与目录重联](03-project-edit.png) | app-shell | V1 采用稿已确认 |
| 04 | [标题与正文搜索](04-search-conversations-corrected.png) | app-shell | V1 采用稿已确认 |
| 05 | [材料添加与模型选择](05-materials-model-picker.png) | workbench | V1 采用稿已确认 |
| 06 | [执行中与表格预览](06-running-spreadsheet.png) | workbench | V1 采用稿已确认 |
| 07 | [审批与补充信息](07-approval-input.png) | workbench | V1 采用稿已确认 |
| 07B | [等待回答的澄清表单](07b-clarification-form.png) | workbench | V1 采用稿已确认 |
| 08 | [文档结果检查](08-document-results.png) | workbench | V1 采用稿已确认 |
| 09 | [代码改动检查](09-code-diff.png) | workbench | V1 采用稿已确认 |
| 10 | [执行失败与只读输出](10-failed-output.png) | workbench | V1 采用稿已确认 |
| 11 | [真实交互终端](11-interactive-terminal-corrected.png) | workbench | V1 采用稿已确认 |
| 12 | [PDF 与图片预览](12-pdf-image-preview.png) | workbench | V1 采用稿已确认 |
| 13 | [浏览器工作与接管](13-browser-control.png) | workbench | V1 采用稿已确认 |
| 14 | [电脑操作与人工接管](14-desktop-takeover.png) | workbench | V1 采用稿已确认 |
| 15 | [模型连接设置](15-settings-models.png) | settings | V1 采用稿已确认 |
| 16 | [工具与授权](16-settings-tools-corrected.png) | settings | V1 采用稿已确认 |
| 17 | [技能与来源](17-settings-skills.png) | settings | V1 采用稿已确认 |
| 18 | [权限与隐私](18-settings-permissions.png) | settings | V1 采用稿已确认 |
| 19 | [本地数据与备份](19-settings-data.png) | settings | V1 采用稿已确认 |
| 20 | [通用设置与工作偏好](20-settings-general.png) | settings | V1 采用稿已确认 |
| 21 | [关于与诊断](21-settings-diagnostics.png) | settings | V1 采用稿已确认 |
| 22 | [未配置与材料失败](22-blocked-materials.png) | workbench | V1 采用稿已确认 |
| 23 | [停止、重连与退出](23-stop-reconnect-exit-corrected.png) | app-shell、workbench | V1 采用稿已确认 |
| 24 | [深色与窄窗口](24-dark-compact-corrected.png) | app-shell、workbench | V1 采用稿已确认 |

## 交付与验证边界

生成工具使用内置 imagegen，每张独立生成、逐张解释；最终采用的 PNG 复制到本目录。提示词、源路径、采用版本、核查备注见`generation-record.json`（原生成记录仅本地留档，不上传）。文件名带 corrected 的采用稿已替代同编号未修正版，不能同时作为实现基准。栅格图不能证明真实交互、无障碍、模型兼容性或文件操作正确；这些仍按 [验证计划](../../../plans/AgentX_Compatibility_Validation_Plan.md) 后续执行。

## 一手资料与采用边界

核验日期：2026-09-07。外部资料支持交互原则及公开接口事实；具体 AgentX 布局和控件选择是本产品设计，不宣称逐项复制某个现有产品。

- [Codex 项目与会话](https://learn.chatgpt.com/docs/projects)：侧栏组织、置顶与归档。
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)：公开历史、标题检索、补充、停止与终态；正文检索不冒称内置支持。
- [Codex 权限模式](https://learn.chatgpt.com/docs/permission-modes)：授权边界与审批方式分离。
- [Codex 代码检查](https://learn.chatgpt.com/docs/code-review)、[交互终端](https://learn.chatgpt.com/docs/integrated-terminal)：差异范围与真实进程。
- [Codex 浏览器](https://learn.chatgpt.com/docs/browser)、[电脑操作](https://learn.chatgpt.com/docs/computer-use)：浏览器上下文与前台控制边界。
- [DeepSeek 模型列表](https://api-docs.deepseek.com/api/list-models/)、[Codex 接入](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)：模型候选目录与引擎协议接入，仍需目标版本实测。
- [Claude Artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)：与对话分离的产物检查区域。
- [Claude 本地 MCP](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)：配置、授权及连接状态分离。
- [Windows 键盘交互](https://learn.microsoft.com/en-us/windows/apps/develop/input/keyboard-interactions)：菜单和图标操作不能只依赖悬停。

M1 入库说明：本目录只提交采用图和索引，不提交原生成记录、旧稿和文档快照。图稿中的非 Flash 模型、完整设置及其他 V1 能力仅作远期设计示例，M1 不开放；具体可执行范围以 PRD 的 M1 分期为准。
