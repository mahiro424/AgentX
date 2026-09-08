# M1-05 结果与历史验证记录（进行中）

日期：2026-09-08。工单 [#10](https://github.com/mahiro424/AgentX/issues/10)，分支 `m1-05`，依赖 [PR #17](https://github.com/mahiro424/AgentX/pull/17) 已合入 `m1`，基线 `4e79e93`。本记录不代表整个切片或 M1 已完成。

## 已接通：已结束会话历史

- 有限产品接口 `getTaskHistory({ taskId })`：Main 从产品记录取 thread、项目目录及最后轮次，Renderer 不能传路径或 RPC；不修改任务状态或重新发送。
- 公开 `thread/read(includeTurns:true)` 读取固定 0.153.4 历史，校验关联、完整性、重复项及终态一致性。失败、缺失或状态不一致不伪装空历史。
- 冷读取不读取或解密模型凭据，模型连接指向不可执行的本地地址；已有执行连接只复用公开读取请求，不再获取凭据。这里的“只读”指不发起 Agent 工作、不改用户项目；引擎初始化仍会管理自身目录、目录索引与本地模型目录，不承诺磁盘零写入。
- 展示用户文本、Agent 正文、命令输出/原始退出码、引擎报告的文件事件。隐藏推理正文不返回；其他未支持的执行项显式提示。引擎报告不等于实际文件变化。
- 加载与失败提示、明确重读、失败保留草稿；切换任务按请求代次隔离，不让旧返回覆盖当前选择。

## 证据与边界

| 项目 | 当前证据 |
| --- | --- |
| TDD | 公开读取与用户消息分别 RED → GREEN；无凭据配置、产品 task 绑定、轮次状态不一致分别 RED → GREEN |
| UI 状态 | loadingHistory、historyReady、historyUnavailable 各自真实 Electron RED → GREEN；模拟仅位于 UI 测试的数据应答边界 |
| 相关测试 | 本地 `21-history-slice-tests.log` 20/20；`26-history-focus-green.log` 历史与项目回归 25/25；最终 `28-history-full-tests.log` 全量 126/126，262155.8044 ms；typecheck 通过 |
| 真实固定引擎 | `07-fixed-history-read.log`：跨进程读取前一批合成验收的已结束历史；无凭据、本地 HTTP trap 请求数 0 |
| 真实产品链路 | `29-real-desktop-history.log`：重新打开打包 Electron，点选既有合成会话，经真实 Main IPC 读回 1 轮，包含实际退出码 0；不是 Renderer fixture |
| 界面 | [浅色](m1-05/history-light.png)、[深色](m1-05/history-dark.png)、[紧凑](m1-05/history-compact.png) 为真实上述会话，1280×820 与 960×640；已按采用稿检查，长标题保留完整可访问文字但视觉省略，避免挤压历史区 |
| 打包 | 已更新 `out/AgentX-win32-x64`，当前历史功能测试使用 `25-history-package.log` 对应包 |

上述原始日志与截图位于本地 `.local-validation/m1-05/`，不将这些本机路径伪装为远程可访问证据。真实 API Key、加密凭据、原始运行目录不入库。本阶段没有新增模型调用，第二批真实验收仍为已用 3/5 轮。

保留的失败：`16-history-ready-green.log` 中首个 Electron 启动出现 30 秒超时，第二个测试通过；同一代码下带启动观测的 `17-history-ready-recheck.log` 2/2，随后 `21` 相关测试通过。尚无证据确定该次启动超时根因，不把它改写为产品测试通过或已修复。

## 后续未完成

- `noChanges`、`changes`、`textDiff`、`unreadableResult`：实际工作区基线、shell/未跟踪文件核对、只读差异。
- `commandOutput` / `partialResult` 的完整结果面板验收；当前仅有历史内命令记录及未完成轮次提示。
- `nextTurn`：同 task/thread 新轮与配置修订、旧事件隔离，尚未开放。
- 其余状态实现后的最终全量回归、设计 QA、真实续轮验收、PR / CI / 合并。
- M1-06 仍未开始，完整 M1 不具备完成条件。


## 本轮回归修复与审查

`23-history-full-tests.log` 为 124/125，项目菜单键盘场景失败。已构造延迟动画帧的确定性复现（`24-history-focus-red.log`）：会话切换的迟到输入框聚焦抢走用户已移动的焦点。最小修复只在焦点仍属原控件或 body 时恢复；`26` 定向及 `28` 全量通过，不以重跑替代修复。

独立只读审查未发现该历史范围内可复现 P1/P2；对历史终态不一致的反馈已补 RED/GREEN 并拒绝错误记录。审查不代替后续完整切片验收。先前截图脚本只改 Main 偏好而未同步 Renderer，导致“浅色”文件仍为深色；最终改为实际设置按钮操作并检查主题状态后重取，上方只引用最终核验图。
