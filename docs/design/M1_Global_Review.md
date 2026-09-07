# M1 全局设计输入核验

对应 [D-global #2](https://github.com/mahiro424/AgentX/issues/2)，父 [PRD #1](https://github.com/mahiro424/AgentX/issues/1)。这是既有设计输入入库，不是产品 UI 实现验收。

## 核对结果

| 核对项 | 依据 | 结果 |
| --- | --- | --- |
| 设计模式与层次 | [DESIGN](DESIGN.md) 文首、§1、§6；PRD UI 模式 | mockup-driven；页面布局和业务状态仍归 PRD，不搬进 DESIGN |
| 色彩、字体、层次 | DESIGN §2–§4 | 深浅语义 Token、系统中文字体、焦点与禁用规则完整；无新增网络字体或视觉风格 |
| 外框复用 | PRD app-shell 的 DESIGN 复用列 | 导航、列表行、图标按钮、搜索框、Loading 与字体均有定义 |
| 工作台复用 | PRD workbench 的 DESIGN 复用列 | 输入、按钮、列表、卡片、状态徽章、搜索与等宽文本均有定义 |
| 设置复用 | PRD settings 的 DESIGN 复用列 | 导航、输入、按钮、列表、状态徽章与 Loading 均有定义 |
| 平台边界 | PRD 三页清单 | 单端 windows-desktop，不新增 platforms.md 或页面 |
| 采用版本 | [默认参考索引](references/README.md)、[v0.3 采用图](review/v0.3/README.md) | 保留原采用 PNG，corrected 优先；未采用稿与生成缓存未入库 |
| 人工方向确认 | 用户“V1 版本先这样吧，接下来做什么”及已确认 M1 计划 | 只沿用既有 V1 设计确认，不代替后续真实 Electron 窗口检查 |

没有发现需要扩展公共原语或重画图稿的阻塞项。三个页面 Design Issue 仍须在本工单实际合入 `m1` 后分别核验，不能以本记录提前关闭。

## 证据与未覆盖边界

- 输入快照：[2460496](https://github.com/mahiro424/AgentX/tree/246049603299d37c9d4fc8f68e856ad1a1c1630a)；[首次文档 CI](https://github.com/mahiro424/AgentX/actions/runs/34137999287) 已通过。后续提交仍须检查其自身 CI。
- 本地及独立核验检查 UTF-8、仓库内引用和 72 条 M1 场景；采用图版本检查不代表真实界面已实现。
- 凭据模式扫描不是所有秘密格式的完备审计；本次使用精确文件白名单，不提交原始运行目录、原始报告、引擎缓存或真实凭据。
- 本记录不验收深浅色实际对比度、Windows 缩放、键盘、中文输入法、产品状态和任务执行；这些仍属于开发切片与用户检查。
- PR 仅合入 `m1`，不改变 `master`。实际合并链接记录在 [M1 工单门禁](../plans/AgentX_M1_Issue_Gates.md)。
