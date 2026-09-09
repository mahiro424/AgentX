# AgentX 文档入口

更新日期：2026-09-09。M1 六个切片已交付，外框、模型、项目、真实执行、结果、历史及生命周期均已接通，最终 [PR #19](https://github.com/mahiro424/AgentX/pull/19) 已合入 `m1`。M2-01 会话组织与搜索已经 [PR #29](https://github.com/mahiro424/AgentX/pull/29) 合入 `m2`。启动入口、压缩包、M1 证据及 V1 后续清单见 [M1 交付说明](validation/AgentX_M1_Delivery.md)。`master` 不变。

## 阅读顺序与唯一权威来源

M2 已获实施及仅合入 `m2` 的授权。后续按文本、表格、文档分别贯穿“材料 → 产物 → 预览 → 续改”，最后完善异常收尾；这些后续能力尚未实现。见 [M2 实施计划](plans/AgentX_M2_Implementation_Plan.md)和[M2 工单门禁](plans/AgentX_M2_Issue_Gates.md)。原 M1 及 M2-01 失败记录保留，不以新分期改写历史证据。

| 顺序 | 文档 | 回答的问题 |
| --- | --- | --- |
| 1 | [AgentX_Desktop_PRD](prd/AgentX_Desktop_PRD.md) | 为谁做、做什么、页面怎样交互、怎样验收 |
| 2 | [整体架构](architecture/AgentX_Architecture.md) | 进程、模块、调用链、源码目录、存储及权限边界 |
| 3 | [状态流转](architecture/AgentX_State_Machines.md) | 状态归属、事件映射、中断、断线和恢复 |
| 4 | [架构决策 0001](adr/0001-product-runtime-boundary.md) | 为什么采用桌面模块化单体与黑盒引擎 |
| 5 | [架构决策 0002](adr/0002-local-data-and-credentials.md) | 为什么分离产品数据、引擎状态和凭据 |
| 6 | [架构决策 0003](adr/0003-upstream-and-patch-queue.md) | 如何跟随上游并维护最小补丁 |
| 7 | [设计系统](design/DESIGN.md) | 品牌、颜色、字体与公共组件 |
| 8 | [兼容性验证计划](plans/AgentX_Compatibility_Validation_Plan.md) | 已测证据的边界及各功能切片需验证的链路 |
| 9 | [M1 实施计划](plans/AgentX_M1_Implementation_Plan.md) | 首个真实代码任务闭环的六个切片、范围、验证与授权 |
| 10 | [M1 工单门禁](plans/AgentX_M1_Issue_Gates.md) | 父 PRD、Design、开发工单的发布顺序和真实进度；不是本地 ready 凭证 |
| 11 | [M1 交付说明](validation/AgentX_M1_Delivery.md) | 如何启动、已测能力、验收证据、包体校验与后续范围 |
| 12 | [M2 实施计划](plans/AgentX_M2_Implementation_Plan.md) | 日常材料、表格、文档到结果续改的分期与技术边界 |
| 13 | [M2 工单门禁](plans/AgentX_M2_Issue_Gates.md) | 已合入切片、下一切片依赖及正式验收入口 |

[CONTEXT.md](../CONTEXT.md) 作为领域词汇表，与本轮取消产品验收状态的决定同步。PRD 不定义协议字段；架构文档不重复定义页面；状态文档是状态转换表的唯一维护位置；ADR 记录决定与理由，不复制架构全文。

## 状态说明

- 已确认：通用桌面工作台范围、Windows 首版、本地档案、DeepSeek、Codex App Server 黑盒、默认零补丁、mockup-driven UI；工作台与设置两个主要界面，共用 app-shell。
- 当前产品结果：[M1 交付说明](validation/AgentX_M1_Delivery.md)。[G1 核心兼容报告](validation/AgentX_Compatibility_Evidence.md#evidence-g1)与[首轮 G0 报告](validation/AgentX_Compatibility_Evidence.md#evidence-g0-first)仅保留前置验证及历史失败，不替代产品验收。
- 图稿状态：用户已确认 V1，三个默认 [references](design/references/README.md) 已固化；25 张关键状态采用图已入库。各 M1 切片已有真实 Electron 截图与逐状态检查，不把设计图确认当作实现验收。
- 产品已验证部分：固定官方 0.153.4、真实双文件修复与独立测试、同线程续轮、原生审批允许/拒绝、轮次和后台终止、退出保活及崩溃后不重放。共享技能严格隔离仍是已知来源问题；完整 V1 权限、通用恢复、办公/桌面控制等后续范围未完成。
- 已批准 M1/M2 实施和正式产品默认 `.AgentX` 数据设计；自动测试使用独立临时目录，不读取正式凭据或真实项目。远程工单/标签及 Git/PR 操作已获授权，本轮检查通过后仅可合入 m2，master 不动；真实模型验收仅用 Flash 与合成材料，CI 不调用模型。未授权其他模型调用、全局配置修改、上游补丁、发布或自动迁移。
- 历史 [AX-001](plans/AX-001_Desktop_Foundation.md) 保留已发生的准备工作，不再作为正式 Issue 或 ready-for-agent 凭证。M1 的阶段覆盖在 PRD 中，不能把有限通过或本地草稿当作整页完成与远程门禁完成。

技术实现按验证门禁推进，不能把本文档存在视为功能已实现。后续目录按需要创建，不根据架构树一次性建立空模块。
