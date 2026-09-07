# M1 app-shell 设计输入核验

对应 [D-app-shell #3](https://github.com/mahiro424/AgentX/issues/3)，父 [PRD #1](https://github.com/mahiro424/AgentX/issues/1)。依赖 [D-global 的 PR #12](https://github.com/mahiro424/AgentX/pull/12) 已实际合入 `m1`，合并提交 `bb6ff3cfade9f47b16c176f89da2c1935541792a`。

## 已核对输入

- 页面标识 `windows-desktop / app-shell` 与 PRD 页面清单、故事映射一致；本次仅验收既有规格与图稿，不实现产品。
- [默认参考](references/windows-desktop-app-shell.png) 已实际打开查看；与 [采用源图](review/v0.3/01-new-session.png) 字节一致。SHA-256：`8cd4608ca11e1321b74db7719f40dae677c279a395c947bbbce5bc89c74db5ee`。
- Issue 的 25 条 M1 状态逐行回查 PRD，场景键及可观察预期一致；七项必读保留于 Issue 与简报，含状态策略、故事、壳层关系、DESIGN 原语和单端 N/A。
- [设计系统](DESIGN.md) 的相关 §5 原语与 §6 宜忌已核对；不把 PNG 或本文件变成页面布局/状态真相源。
- 用户既有确认“V1 版本先这样吧，接下来做什么”见 [确认索引](references/README.md)，随后批准 M1 的连续状态切片。未重画、未变更品牌、未引入新页面。

## M1 采用边界

沿用默认构图与公共原语，但图中的示例项目/会话、模型健康和工具记录不能装进产品充当真实数据。M1 未实现的 V1 功能不显示看似可用的入口；其余状态与后续切片仍以 PRD M1-STORY-COVERAGE 为准。

工作台发送与停止共用一个主按钮，补充要求独立且失败保留草稿；只允许 Flash 的真实调用和原生请求批准。设置图中的其他模型、工具、数据等是 V1 设计示例，不意味着 M1 可以调用或管理。系统目录与字段名称以 PRD/ADR 为准，不复制栅格稿的字符瑕疵。

## 完成边界

本页设计输入核验完成，需本 PR 检查通过并实际合入 `m1` 后才关闭对应 Design Issue。真实 Electron 窗口的深浅主题、两种尺寸、Windows 缩放、键盘/中文输入法、运行/错误行为和最终任务验收仍未执行；不自动勾选人工 UI QA。
