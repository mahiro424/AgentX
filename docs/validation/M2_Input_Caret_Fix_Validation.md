# M2 前置修复：输入光标竞态验证

日期：2026-09-09。工单 [#27](https://github.com/mahiro424/AgentX/issues/27)，分支 m2-ci-fix；基于 m2 的 M1 起点 33d6f8e849a8393fd233c43876c9eb0b705400d2。只修既有工作台输入行为，不代表任何 M2 业务切片完成。

## 原始失败与诊断

M2 文档 PR #26 的 head 951602c 曾出现同头两次 Windows 检查不一致：
- [PR 检查成功](https://github.com/mahiro424/AgentX/actions/runs/34254346932)：184/184。
- [push 检查失败](https://github.com/mahiro424/AgentX/actions/runs/34254339417)：181/184，两个换行/后续输入内容断言失败，另一个会话点击超时。

定向复测 5/5 通过不构成修复。随后在真实打包 Electron 中只延迟 requestAnimationFrame 回调，用真实键盘输入稳定复现了两种 CI 原样错字结果：
1. 选中「前选中后」的中段，Ctrl+Enter 后立即输入 A，得到「前\n后A」，而非「前\nA后」。
2. 前一次换行后的光标回调在下一次全选与替换之间到达，会取消新选择并导致追加；可构造出 CI 的「修\n成项目\n前选中后」。

原因是受控输入先更新 value，而光标晚一帧恢复：既会让下一按键使用错误位置，也会覆盖后来的选择。不是模型、引擎或持久化格式兼容问题。

会话点击超时未确认同根因：没有删除、跳过或放宽该用例，也没有改动点击逻辑。本次完整回归包含该用例并通过；首次失败保留，不能据此宣称所有 Windows 偶发点击问题已消除。

## 最小修复

Ctrl+Enter 在同一按键事件内读取当前 textarea.value/selection，使用 React flushSync 提交换行后同步定位光标，不再保留跨帧光标写入。普通逐字输入仍走既有受控草稿、串行保存和 CAS，不对所有输入强制刷新。

Enter 发送/补充、IME 保护、单一发送/停止按钮、停止语义、布局、Token、Main/Preload 与固定 Codex 0.153.4 均不变。仅为本修复加入 m2/m2-ci-fix 的 CI 触发，不移除 M1 门禁。

技术依据由 Context7 查询 React 官方 [flushSync](https://github.com/reactjs/react.dev/blob/main/src/content/reference/react-dom/flushSync.md)：返回前 DOM 已更新；只用于需要立即 DOM 操作的事件处理，不在 effect/render 中调用，不推广为普通输入策略。

## TDD 与独立核验

| 检查 | 实际结果 |
| --- | --- |
| 首个行为 RED | 旧代码真实包：延迟帧后立即 A，内容断言失败，实际 前\n后A |
| 首个行为 GREEN | 同一公开输入行为在新包通过 |
| 选择行为的旧包对照 | 已交付 M1 ZIP 解压到隔离目录；全选、释放旧帧、再 insertText，错误追加「换行前的要求\n替换后的要求」 |
| 两个回归合跑 | 2/2，通过选择替换、独立 getDraft 读取、关闭/重开后文字保持且没有创建任务 |
| 完整 npm test | 186/186，0 fail/0 cancelled/0 skipped；292789.2159 ms |
| 类型检查与打包 | npm run typecheck、npm run package 均通过 |
| 真实窗口 | 浅/深色各 1280×820、960×640：换行后输入、焦点、主按钮可见、无横向裁切、草稿保存通过 |
| 凭据/模型 | 使用独立临时根，无正式凭据、无真实模型请求 |

两个新增回归经真实 Electron 文本框与键盘操作，不模拟 React 组件状态；只控制浏览器动画帧时序。第一个 RED 在整理测试帮助函数前生成，日志行号属于当时源码，不混作最终行号。

独立审查曾提出“旧代码无法使测试失败”和“释放帧发生在替换之后”。主代理逐语句核对与第二次独立审查确认这两点不成立：第二例实际顺序是 Ctrl+Enter → Ctrl+A → 释放旧帧 → insertText → 内容断言，旧包有实际 ERR_ASSERTION 证据。不是为消除审查意见而放宽测试。当前未发现可执行代码阻断；IME、首发、续轮、补充和停止由完整既有回归覆盖。快速输入以确定性延迟帧覆盖，不声称穷尽所有 OS 调度。

## 真实截图与设计 QA

合成未发送草稿，不含 Key、真实项目或模型运行。已逐张对照既有工作台和 DESIGN，布局与主按钮不变；未实现的 M2 搜索/材料入口不伪造。截图是实机实现证据，不替代默认设计图。

- [浅色 1280×820](images/m2-ci-fix/light-1280.png)
- [浅色 960×640](images/m2-ci-fix/light-960.png)
- [深色 1280×820](images/m2-ci-fix/dark-1280.png)
- [深色 960×640](images/m2-ci-fix/dark-960.png)

本次没有改全系统 DPI 或人工操作中文输入法候选窗口；不自动重写 M1 的既有人工作业记录。组合输入保护使用既有真实桌面事件回归。

## 包体与后续门禁

已更新 E:\AgentX\desktop\out\AgentX-win32-x64，打包前核对无目标 AgentX.exe 占用，没有终止用户窗口。
- 本次 app.asar SHA-256：6fdcca52aa2489ed65f9f875ce9592a38bb29dbe5e8ef8f23d71c12b6f789b4f。
- 旧 M1 ZIP SHA-256：8d8f3b9aca5c6a79b680d9fb4ce04c169d4756592a62c4b545e14563659bf7a3；原包未覆盖，仍是回滚基线。
- runtime、模型配置、依赖锁和用户数据未改。
- 本记录写入时远程修复 PR/CI 尚待执行；通过后只合入 m2，实际证据更新到关联 PR/Issue。master 不变。
- #20/#26 仍需同步修复后完成自己的文档门禁，之后才领取 #21，不因本修复提前宣称 M2 功能完成。
