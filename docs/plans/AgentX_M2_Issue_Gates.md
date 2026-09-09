# AgentX M2 工单门禁

日期：2026-09-09。用户已批准完整 M2 闭环及按格式贯穿工作链路的分期，正式工单已发布；以下为本次修订快照，不能代替后续实际检查。各切片 PR 只合入 m2，master 保持不变。

## 正式链路

父 PRD 继续使用 [#1](https://github.com/mahiro424/AgentX/issues/1)，覆盖完整 V1，不能随 M2 子集关闭。复用已闭环设计 [#2](https://github.com/mahiro424/AgentX/issues/2)、[#3](https://github.com/mahiro424/AgentX/issues/3)、[#4](https://github.com/mahiro424/AgentX/issues/4)，不重画、不重复创建设计工单。

| 标识 | 正式工单 | page-id | 依赖 | 当前门禁 |
| --- | --- | --- | --- | --- |
| M2-00 | [#20](https://github.com/mahiro424/AgentX/issues/20) | headless | M1 PR #19 | 已关闭；[PR #26](https://github.com/mahiro424/AgentX/pull/26) 已合入 m2 |
| M2-01 | [#21](https://github.com/mahiro424/AgentX/issues/21) 会话组织与可定位的标题正文搜索 | app-shell | #20 合入 m2 | 已关闭；[PR #29](https://github.com/mahiro424/AgentX/pull/29) 已通过检查并合入 m2 |
| M2-R1 | [#30](https://github.com/mahiro424/AgentX/issues/30) 按完整工作链路调整材料、表格与文档切片 | headless | #20 已合入 m2 | 已关闭；[PR #31](https://github.com/mahiro424/AgentX/pull/31) 已合入 m2 |
| M2-02 | [#22](https://github.com/mahiro424/AgentX/issues/22) 非项目材料与文本预览续改闭环 | workbench | #21、#30 合入 m2 | 已关闭；[PR #32](https://github.com/mahiro424/AgentX/pull/32) 已通过检查并合入 m2 |
| M2-03 | [#23](https://github.com/mahiro424/AgentX/issues/23) 表格处理、预览与续改闭环 | workbench | #22 合入 m2 | ready-for-agent；七项必读简报已发布，m2-03 实施中，不能仅以解析/预览关闭工单 |
| M2-04 | [#24](https://github.com/mahiro424/AgentX/issues/24) 文档与文本 PDF 的结果检查续改闭环 | workbench | #23 合入 m2 | ready-for-human：等待依赖，不要求重复视觉确认 |
| M2-05 | [#25](https://github.com/mahiro424/AgentX/issues/25) 异常核对、所属残留停止与安全收尾 | app-shell | #24 合入 m2 | ready-for-human：等待依赖，不要求重复视觉确认 |

## 领取与验收

- 规格见 [PRD](../prd/AgentX_Desktop_PRD.md) 的 MILESTONE-M2-DAILY-WORK、UI-M2-SHELL、UI-M2-WORKBENCH、IMPL-M2-PUBLIC-SEAMS、TEST-M2-VERTICAL-SLICES、ACCEPTANCE-M2；实施方案与风险见 [M2 计划](AgentX_M2_Implementation_Plan.md)。
- UI 工单完整七项必读、逐状态/来源矩阵、功能/UI 行为/设计 QA；功能 seam 另有三项必读及每条验收依据。每项恰好一个类别与状态标签。
- 依赖 PR 实际合入 m2 且检查通过后，发布原样必读清单的 Agent 简报，再将工单转 ready-for-agent。ready-for-human 在本批仅记录等待依赖，不向用户重复索取已授权视觉确认。
- 状态切片均有用户批准；app-shell 与 workbench 沿用原布局，不宣称全部 V1 已完成。未实现功能不提供假入口。
- M2-02/03/04 分别覆盖文本、表格、文档的材料到续改全链路；PRD 共 48 条 M2 场景，文本预览/续改和表格预览不再全部挂在 M2-04。正式工单矩阵须逐项匹配 PRD，M2-R1 合入后才解锁 #22；历史原分期不改写为已交付。
- 每个行为留 RED/GREEN/回归证据，真实窗口和必要 Flash 现场验收与无密钥 CI 分开；测试通过还要核验设计和结果。
- 本地旧稿/原始证据/WIP 保留；只显式提交相关源码、采用图与脱敏记录。分支 m2-docs、m2-01 至 m2-05 保留，不强制推送或覆盖用户数据。
- 每个功能完成后打包到原 out/AgentX-win32-x64。目标被用户窗口占用时不擅自终止，先在独立包验证。最终解压包、截图、逐项验收和已合并 PR/已关闭子工单缺一不可。
