# M1-06 窗口生命周期验证记录（进行中）

日期：2026-09-08。工单 [#11](https://github.com/mahiro424/AgentX/issues/11)，分支 `m1-06`；依赖 #9 / PR #17、#10 / PR #18 均已合入 `m1`。本记录是切片内增量，不代表 M1-06 或完整 M1 已完成，不作为关闭工单的凭据。

## 已接通的本地控制链路

- 主窗口关闭只隐藏到托盘；保留同一窗口、Main 实例与草稿。托盘包含打开与退出；再次启动通过单实例事件恢复原窗口。托盘创建失败明确失败，不把用户留在不可恢复的隐藏窗口。
- 真正退出统一经过 Main `before-quit`。有准备中、活动或未知任务，以及尚未回收的本实例引擎时，显示采用稿中的「取消 / 保留到托盘 / 停止后退出」。取消与保留到托盘不发送中断。
- 三个有限产品接口：`getExitState`、`answerExit`、`onExitChanged`。Main 校验原窗口、主 frame、页面地址、参数数量、准确请求 ID 和选择值；过期或重复回答拒绝执行，不开放任意进程控制。
- 用户确认后执行 `ExecutionService.shutdown()`：冻结新发送，等待准备阶段退出；复用进行中的停止或发起一次停止；等待匹配的 `turn/completed`、已知后台终端回收、再次核验后台列表，最后等待本实例 `runtime.close()` 完成。应答不等于退出完成。
- 后台列表仍有未知归属项时，不终止它们，也不关闭引擎冒充完成。核对/回收失败显示错误，保留原任务记录及输入；本实例禁止新任务抢占。此次没有修改上游引擎或引入 Patch Queue 补丁。

## RED → GREEN 与回归证据

日志均在本机 `.local-validation/m1-06/`，不将原始目录、凭据或缓存入库。

| 行为 | RED | GREEN / 回归 |
| --- | --- | --- |
| 关闭到托盘并恢复同一窗口 | `02-tray-red-settled.log`：关闭导致执行上下文销毁 | `07-tray-green.log` 1/1；后续生命周期回归再次覆盖 |
| 退出协调等待权威终态再回收 | `08-exit-service-red.log`：尚无 shutdown 入口 | `09-exit-service-green.log` 1/1 |
| 未知后台归属不能漏过退出核验 | `10-exit-unowned-red.log`：错误地未拒绝退出 | `11-exit-unowned-green.log` 17/17，包含原停止、服务及后台协议回归 |
| 真实窗口的退出确认与取消 | `12-exit-confirm-red.log`：窗口被直接退出 | `15-exit-ui-green.log` 2/2 |
| 退出选择严格类型与过期 ID | `16-exit-invalid-red.log`：数组被错误接受 | `20-exit-validation-green.log` 1/1，包含失败提示与返回托盘 |
| 已有停止只发一次中断，真实关闭未完成时不结束 | 复用已经实现的控制链路，新增回归，不伪记新 RED | `21-exit-service-regression.log` 4/4，另覆盖回收失败与禁止续轮 |

保留的失败与诊断：

- `04-tray-package.log` 的 EBUSY 保留；复查目标没有运行中的用户应用后，`06-tray-package-retry.log` 打包成功。没有结束用户应用，未把该次失败归因为已确认的特定系统原因。
- `19-exit-validation-green.log` 1/2：测试用默认 rAF 轮询等待已经隐藏的页面，导致超时；改为 Main 原生 `BrowserWindow.isVisible()` 核验，未改变产品隐藏逻辑；`20` 通过。
- `23-exit-full-tests.log` 未完成：旧测试故意把数据库版本改为 999 或制造迁移冲突后直接 `app.close()`，被新的未知状态退出保护拦截。核实测试父子链、可执行路径及调试参数后，只结束本次合成测试实例/运行器；**即使局部日志输出 ok，也不把这次运行计为全量通过**。仅损坏/未决 fixture 改用显式 `crashTestApp` 清理，不为产品增加测试旁路；正常退出测试不改为强退。

## UI 检查

对照 `docs/design/review/v0.3/23-stop-reconnect-exit-corrected.png` 与 `windows-desktop-app-shell.png`，复用现有模态框、按钮、文字及颜色 Token，没有重新设计页面。

- 实际打包 Electron 截图：[浅色确认](m1-06/exit-confirm-light.png)、[深色确认](m1-06/exit-confirm-dark.png)、[紧凑确认](m1-06/exit-confirm-compact.png)、[未确认错误](m1-06/exit-unconfirmed-compact.png)。均是合成未决任务，不是实时模型执行截图。
- 1280×820 浅/深色及 960×640 浅色：按钮可达、弹窗不越界，错误不裁切；原生 dialog 保持键盘焦点，默认聚焦取消，停止中禁用重复选择。
- 用户已经确认的系统 DPI 和实际中文输入法验收保留，不将这次截图或程序化事件再次计为新的人工验收。
- 本增量独立只读审查未发现明确的弹窗/IPC/托盘正确性问题。服务审查指出退出入口必须接 shutdown、停止后仍需核验未知后台项，均已接通。中断 RPC 的超时由既有 `CodexTransport.call` 的 30 秒期限提供，并非无限等待。

## 仍需完成，不能关闭 #11

1. 进程归属/回收事实持久化，重开后发现遗留执行；本实例内存中的退出失败不能成为唯一依据。
2. 崩溃、断线及未决意图的公开历史只读核对与 UI 事实展示；不自动重发、清锁或按进程名批量结束程序。
3. 真实 Flash 运行中的切页、托盘恢复与停止后退出验收，以及最终全量回归、PR、CI 和仅合入 `m1`。
4. M1 最终可解压包及整条验收链归档。

本增量没有新增模型调用。后续仅 `deepseek-v4-flash` 与合成项目，已按用户授权取消固定五轮上限；仍保留实际调用记录，重复失败先诊断，CI 不调用模型。

## 本增量的最终本地回归

- `24-damaged-fixture-cleanup.log`：3/3，故障测试能保留保护行为并自行清理合成实例。
- `25-exit-full-tests.log`：**170/170**，247713.6087 ms，无人工介入清理，无模型调用；这是有效的全量回归，不用前次被介入的 `23` 替代。
- `17-exit-ui-typecheck.log` 类型检查通过，`18-exit-validation-package.log` 打包通过；已更新 `E:\AgentX\desktop\out\AgentX-win32-x64`，全量测试使用该真实包。
- `git diff --check` 通过。此处仅确认上述增量；#11 仍开放，持久化归属、异常历史核对和真实运行中退出未完成，尚不发起该切片合并。
