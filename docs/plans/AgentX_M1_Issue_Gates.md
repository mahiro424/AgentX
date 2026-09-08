# AgentX M1 工单门禁

日期：2026-09-08。当前：11 个正式 Issue 与分拣简报已发布，类别和状态标签已补齐；文档/全局设计已通过 [PR #12](https://github.com/mahiro424/AgentX/pull/12) 合入 m1，三个页面设计已通过 [PR #13](https://github.com/mahiro424/AgentX/pull/13) 合入 m1。M1-01 已由 PR #14 合入 m1，用户已确认外框 UI。M1-02 已由 PR #15 合入 m1，本地 36/36 桌面测试、Windows/文档 CI 及用户本页视觉确认通过。M1-03 已由 PR #16 合入 m1，55/55 本地桌面回归、Windows/文档 CI 与本切片视觉确认通过；M1-04 已就绪并在独立分支 m1-04 预检。合并仅限 m1，master 不动。

## 发布与执行顺序

下列保留计划标识，并绑定实际工单。父 PRD 只维护需求基线，子工单绑定而不重复整份 PRD。发布正文已替换真实依赖和固定提交引用；分拣简报保留原文必读清单。

| 标识 | 标题 | 类别 | 依赖 | 远程状态 |
| --- | --- | --- | --- | --- |
| [PRD-M1](https://github.com/mahiro424/AgentX/issues/1) | AgentX_Desktop_PRD：V1 基线与 M1 首个真实任务闭环 | enhancement | 用户已确认的 PRD/M1 计划 | ready-for-agent |
| [D-global](https://github.com/mahiro424/AgentX/issues/2) | 验收并入库 AgentX 全局设计基线 | design-input | 无开发依赖 | 已关闭；PR #12 已合入 m1 |
| [D-app-shell](https://github.com/mahiro424/AgentX/issues/3) | 验收并入库 AgentX 外框默认设计 | design-input | D-global 合并 | 已关闭；PR #13 已合入 m1 |
| [D-workbench](https://github.com/mahiro424/AgentX/issues/4) | 验收并入库 AgentX 工作台默认设计 | design-input | D-global 合并 | 已关闭；PR #13 已合入 m1 |
| [D-settings](https://github.com/mahiro424/AgentX/issues/5) | 验收并入库 AgentX 设置默认设计 | design-input | D-global 合并 | 已关闭；PR #13 已合入 m1 |
| [M1-01](https://github.com/mahiro424/AgentX/issues/6) | 桌面基础外框与真实打包启动 | enhancement | D-global、D-app-shell 合并 | 已关闭；PR #14 已合入 m1，用户已确认 UI |
| [M1-02](https://github.com/mahiro424/AgentX/issues/7) | DeepSeek 模型设置与系统凭据保护 | enhancement | M1-01、D-settings 合并 | 已关闭；PR #15 已合入 m1，用户已确认 UI |
| [M1-03](https://github.com/mahiro424/AgentX/issues/8) | 本地项目关联与真实会话入口 | enhancement | M1-01 合并 | 已关闭；PR #16 已合入 m1，用户已确认本切片视觉 |
| [M1-04](https://github.com/mahiro424/AgentX/issues/9) | 首次真实执行与原生审批控制 | enhancement | M1-02、M1-03、D-workbench 合并 | ready-for-agent；独立分支 m1-04 预检 |
| [M1-05](https://github.com/mahiro424/AgentX/issues/10) | 检查实际结果、续轮与已结束历史恢复 | enhancement | M1-04 合并；外框基础为传递依赖 | ready-for-human |
| [M1-06](https://github.com/mahiro424/AgentX/issues/11) | 任务存活、托盘与退出核对 | enhancement | M1-04、M1-05 合并 | ready-for-human |

M1-06 是在已合并外框上的生命周期补全，不把“全部 app-shell V1 功能完成”反过来设成工作台的前置条件；功能页依赖的是 M1-01 外框基础，避免循环依赖。

## 就绪规则

- 类别/状态采用 [既有标签词汇](../agents/triage-labels.md)，复用同名标签，缺少的标签获授权后创建。
- 父 PRD 发布按 to-prd 处理；D-global 验收输入已齐时可分拣为 ready-for-agent，但不授权任何业务实现或自动合并。
- D-page 依赖 D-global 的实际合并；已有 PNG 和用户确认不等于设计工单已合并。
- 开发工单依赖未合并时不标成可领取；可用 ready-for-human 明确等待门禁。每个已分拣工单恰好一个类别与一个状态标签。
- 真正分拣时核对完整父 PRD；Agent brief 原样复制必读清单，不写“已读”来替代原文路由。远程评论及标签操作也属于授权范围。
- 六个开发工单均是单一 page-id 的连续状态切片；UI 七项必读与逐状态矩阵完整，功能接缝另列三项必读和验收依据。未覆盖状态保留在 PRD 分期表中。
- 不用本文件、本地 AX-001、类型检查或图稿替代真实 Issue、CI、设计 QA 和合并。

## 文档与设计入库边界

保留 master 且不向其合并；用户已授权独立 m1 集成分支，以及临时切片分支的 PR 在检查通过后仅合入 m1。分支使用 m1、m1-01 至 m1-06；准备分支为 m1-docs、m1-design，不带产品名前缀。先发布父 PRD/工单与标签，再分步将文档/全局设计和页面验收合入 m1；开发只依赖 m1 中已经合并的基线。

文档基线提交只含明确选定的协作/领域/ADR、PRD、架构/状态、M1/验证计划、设计系统/采用图及脱敏摘要。只取 v0.3 清单中的采用版本，corrected 优先；旧 v0.2、未采用图、生成缓存、原始运行目录、凭据和 Electron/Codex 下载缓存不入库。与基线无关的产品源码 WIP 不混进文档 PR。

GitHub 可读的文档引用应使用仓库内相对路径或已存在的固定提交链接；报告里的本机原始证据仅作为本地留档，不能伪装成远程可访问文件。原始失败记录不删、不重写为通过。

## 合并与交付检查点

2026-09-08 用户补充：后续不再逐页询问“是否符合已确认设计”，由实施方按已确认 UI 与产品方案自行完成设计 QA 并留证。此授权不允许自行改版；实质偏离原方案仍需确认，真实中文输入法/系统 DPI 等未自动覆盖项如实记录，最终真实任务验收不由截图代替。M1-01～03 已有的用户视觉确认保留。

1. 文档/设计输入逐项校验并合并后，将实际 Issue、PR、提交和依赖写回本索引；没有事实就保持未完成。
2. M1-01 真实启动、打包数据探针和测试完成后给用户看窗口与截图，人工 QA 不自动勾选。
3. 每个切片分别交付测试结果、剩余状态和 PR；按已获授权仅合入 m1，之后才进入依赖它的切片。后续设计 QA 按上述授权自行对照留证，不再重复请求逐页确认；最终现场人工检查单独保留。
4. 最后按 PRD `ACCEPTANCE-M1` 现场验收，不将无密钥自动测试或历史 G1 当成 M1 已通过。

文档 CI 首个输入快照已通过：[2460496 的检查](https://github.com/mahiro424/AgentX/actions/runs/34137999287)。后续 PR 必须检查当前 head 对应的结果；本地检查不代替远程 CI。Windows 产品 CI 已随 M1-01 建立；M1-02 沿用并把模型桌面测试纳入 npm test。

全局设计输入核对见 [D-global 记录](../design/M1_Global_Review.md)。设计输入入库不代表产品实现或真实 UI 验收完成。

## 页面设计核验记录

[app-shell](../design/M1_app-shell_Review.md)、[workbench](../design/M1_workbench_Review.md)、[settings](../design/M1_settings_Review.md) 已随 PR #13 合入 m1，合并提交为 `babe8c267bd688fa52f943a5e6a166a6107abf7f`。M1-01 的就绪简报已引用实际依赖证据。
