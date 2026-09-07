# AgentX 文档入口

更新日期：2026-09-07。V1 范围、视觉基线与 M1 实施计划已批准；原版 Codex App Server + DeepSeek Flash 已有有限真实工作证据。当前已有部分 Electron/React 脚手架，Renderer 仍为空，尚未交付可用桌面应用。当前从文档和正式 Issue 门禁推进，不直接继续写 Renderer。

## 阅读顺序与唯一权威来源

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

[CONTEXT.md](../CONTEXT.md) 作为领域词汇表，与本轮取消产品验收状态的决定同步。PRD 不定义协议字段；架构文档不重复定义页面；状态文档是状态转换表的唯一维护位置；ADR 记录决定与理由，不复制架构全文。

## 状态说明

- 已确认：通用桌面工作台范围、Windows 首版、本地档案、DeepSeek、Codex App Server 黑盒、默认零补丁、mockup-driven UI；工作台与设置两个主要界面，共用 app-shell。
- 当前结果：[G1 核心兼容报告](validation/AgentX_Compatibility_Evidence.md#evidence-g1)；[首轮 G0 报告](validation/AgentX_Compatibility_Evidence.md#evidence-g0-first)保留历史失败，不代表最新脚本的复跑预期。
- 图稿状态：用户已确认 V1，三个默认 [references](design/references/README.md) 已固化；25 张关键状态采用图与旧稿保留，尚无真实 UI 实现。
- 已验证部分：固定官方 0.153.4、公开协议、会话接口、真实双文件修改与 4 项业务断言、同线程续轮、停止终态；执行后历史接口返回 3 轮。共享技能严格隔离未满足，按用户决定作为非阻断观察；全量权限、恢复、办公、桌面控制与打包尚未完成。
- 当前已批准 M1 本地实施和正式产品默认 `.AgentX` 数据设计；自动测试使用独立临时目录，不读取正式凭据或真实项目。远程工单/标签及 Git/PR 操作已获授权，检查通过后仅可合入 m1，master 不动；真实模型验收仅人工触发、只用 Flash。未授权其他模型调用、全局配置修改、上游补丁、发布或自动迁移。
- 历史 [AX-001](plans/AX-001_Desktop_Foundation.md) 保留已发生的准备工作，不再作为正式 Issue 或 ready-for-agent 凭证。M1 的阶段覆盖在 PRD 中，不能把有限通过或本地草稿当作整页完成与远程门禁完成。

技术实现按验证门禁推进，不能把本文档存在视为功能已实现。后续目录按需要创建，不根据架构树一次性建立空模块。
