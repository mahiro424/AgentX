# M1-06 窗口生命周期验证记录（进行中）

日期：2026-09-08。工单 [#11](https://github.com/mahiro424/AgentX/issues/11)，分支 `m1-06`；依赖 #9 / PR #17、#10 / PR #18 均已合入 `m1`。本记录是切片内增量，不代表 M1-06 或完整 M1 已完成，不作为关闭工单的凭据。

最新进展（2026-09-09）：只读异常核对、真实 Flash 生命周期和崩溃验收已通过，指定运行包已更新；当前等待本切片最终 PR/CI 集成。以下增量按发生顺序保留，当时的「未完成」不覆盖后文新证据。

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

1. 进程归属/回收事实持久化已接入本切片增量，详见下节；重开后的实际进程及公开历史核对尚未闭环。
2. 崩溃、断线及未决意图的公开历史只读核对与 UI 事实展示；不自动重发、清锁或按进程名批量结束程序。
3. 真实 Flash 运行中的切页、托盘恢复与停止后退出验收，以及最终全量回归、PR、CI 和仅合入 `m1`。
4. M1 最终可解压包及整条验收链归档。

本增量没有新增模型调用。后续仅 `deepseek-v4-flash` 与合成项目，已按用户授权取消固定五轮上限；仍保留实际调用记录，重复失败先诊断，CI 不调用模型。

## 本增量的最终本地回归

- `24-damaged-fixture-cleanup.log`：3/3，故障测试能保留保护行为并自行清理合成实例。
- `25-exit-full-tests.log`：**170/170**，247713.6087 ms，无人工介入清理，无模型调用；这是有效的全量回归，不用前次被介入的 `23` 替代。
- `17-exit-ui-typecheck.log` 类型检查通过，`18-exit-validation-package.log` 打包通过；已更新 `E:\AgentX\desktop\out\AgentX-win32-x64`，全量测试使用该真实包。
- `git diff --check` 通过。此处仅确认上述增量；#11 仍开放，持久化归属、异常历史核对和真实运行中退出未完成，尚不发起该切片合并。

首次远程 CI `34231885786` 失败：4 个新退出服务用例的 fixture 假设本机已有 `.local-validation/m1-06`，干净检出中 `mkdtemp` 返回 ENOENT，并非实际退出行为失败。`28-clean-fixture-red.log` 在全新工作目录复现 0/4；补齐 fixture 的父目录创建后，`29-clean-fixture-green.log` 同环境 4/4。不改生产代码、不上传本地缓存来掩盖问题，修正后重新运行远程完整门禁。

## 进程归属持久化增量（仍非切片完成）

上一增量修正后的远程 CI `34232389554` 已成功，提交 `31075f4d569f031f2e4e464c86945b429fac279e`，170/170。

- `lifecycle/process-identity.ts` 使用 Windows `Win32_Process` 只读查询 PID、父 PID、完整创建时间和映像路径；固定脚本、数值参数校验、隐藏窗口、超时与输出上限。查询失败不返回伪造的“进程不存在”。不读取 CommandLine、环境变量或 Key，不提供任意 PID 结束能力。创建时间保留操作系统精度，不降为 JS 毫秒；[Microsoft 文档](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process)说明 PID 可复用。
- `openExecutionCodex` 在配置核验后捕获实际子进程身份，要求父 PID 属于本 Main、映像为固定校验资源，失败回收拥有的子进程；没有模型调用。只读历史连接不派发任务，不登记执行归属。
- SQLite schema 9 的 `runtime_leases` 在任何任务派发前记录产品实例、任务、操作、项目及进程身份。迁移先留 `before-v9` 一致性快照，不伪造旧版本的历史归属；已有迁移用例仍检验原始版本和数据。
- 正常退出和续轮替换共用已结束轮次/后台回收/本实例根进程关闭核验。裸关闭只记根进程结束，未释放记录跨重开继续阻止新任务及无确认退出；不解密模型 Key、不自动清锁。
- 归属写入失败不派发任务，关闭刚启动的引擎；准备失败且没有发送意图时可以回收/重试，不永久占槽。旧后台归属不明时保留旧连接，不先关掉再启动替换引擎。

| 行为 | RED | GREEN / 回归 |
| --- | --- | --- |
| 实际 Windows 子进程身份、退出后消失及 PID 重用比较 | `32-process-identity-red.log`：接缝未实现 | `33-process-identity-green.log` 1/1 |
| 固定真实执行引擎启动时捕获身份 | `34-runtime-identity-red.log`：没有身份 | `35-runtime-identity-green.log` 1/1，无模型调用 |
| 根进程关闭与后台回收分别落盘 | `36-runtime-lease-red.log`：存储未实现 | `37-runtime-lease-green.log` 1/1 |
| 执行服务保存并在完整退出后释放归属 | `38-execution-lease-red.log`：没有归属记录 | `39-execution-lease-green.log` 4/4 |
| 重开不能遗忘已结束轮次的未决后台 | `40-runtime-reopen-red.log`：漏过退出确认 | `41-runtime-reopen-green.log` 5/5 |
| 续轮先回收旧引擎，再关联新操作 | `42-runtime-replacement-red.log`：旧归属未释放 | `43-runtime-replacement-green.log` 12/12 |
| 无意图的准备失败可再次回收退出 | `46-prepare-close-red.log`：误报存在未决轮次 | `47-prepare-close-green.log` 1/1 |

`45-runtime-lease-unit.log` 83/83，之后增加的准备失败回收用例由 `47` 单独验证。独立只读审查未发现具体阻断缺陷；主线程另补充了上述准备失败回收 RED/GREEN。原始失败日志全部保留，没有更改 Codex 上游。

指定交付目录中的用户应用仍在运行，覆盖前检查主动停止打包步骤，没有结束该应用。使用 Forge 已有 `api.package({outDir})` 和测试已有 `AGENTX_TEST_PACKAGE_DIR` 接缝，在 `.local-validation/m1-06/package-lease/AgentX-win32-x64` 构建独立验证包；没有修改构建配置或增加生产旁路。`48-runtime-lease-typecheck.log` 通过，独立打包命令退出 0（`49-runtime-lease-isolated-package.log`）。指定 `out` 目录更新仍须等用户退出应用，不能把独立包当成已经覆盖交付目录。

完整回归：

- `50-runtime-lease-isolated-full.log`：176/177，一条旧迁移失败测试仍匹配 `before-v8` 文件名，实际已正确生成 `before-v9`，原库版本及数据回滚断言通过。修正遗漏的版本断言，不修改生产迁移逻辑；原始失败保留。
- `51-lease-desktop-migration.log`：2/2，修正后的迁移失败测试与新增真实 Electron 重开保护均通过。后者使用合成归属记录，实际重开产品，再经有限 IPC 尝试发送/退出，验证错误可见、记录不变且没有创建引擎目录；不把它冒称真实遗留进程回收验收。
- `52-runtime-lease-isolated-full.log`：**178/178**，265787.3342 ms，真实独立打包 Electron + 无密钥自动测试，没有人为介入清理。
- `53-runtime-lease-docs.log`：32 份文档、185 个仓库内引用、72 个 M1 场景，错误 0；`git diff --check` 通过。

本增量仍无模型调用。完整 #11 的 PR/合并及最终 M1 验收留待剩余范围通过，不提前关闭。

## 状态核对与真实生命周期验收

进程归属增量的远程 CI `34236905747` 已成功，提交 `97d35b89918322b3b13b9b3a42418adf02ed2b4d`，178/178。

新增 `getReconciliation({taskId})` 有限 IPC，沿用主 frame/原窗口/参数数量校验。核对产品发送意图、完整 Windows 进程身份和固定版本公开历史，不调用模型、不解密 Key、不重发、不自动清锁。没有精确意图/turn 绑定时只展示历史，不认领最后一轮；根进程消失、PID 复用或查询失败均不等于后台清空。读取期间记录发生变化明确提示过期，失败保留上一份事实和草稿。

| 行为 | RED | GREEN / 回归 |
| --- | --- | --- |
| 异常核对接缝、实际进程与精确历史归属 | `56-reconciliation-red.log`：服务入口不存在 | `58-reconciliation-green.log` 1/1；`65-reconciliation-regression.log` 8/8 |
| 核对 UI 与失败保留草稿 | `59-reconciliation-ui-red.log`：没有诊断入口 | `62-reconciliation-ui-green.log` 1/1 |
| 重开后发现终态任务的未释放引擎 | `63-pending-discovery-red.log`：没有待核对任务标识 | `64-pending-discovery-green.log` 1/1 |
| 孤立准备记录在其他会话中仍有诊断入口 | `66-orphan-ui-red.log`：诊断按钮数为 0 | `69-reconciliation-green.log` 5/5，包含实际 Electron 的 PID 复用说明 |
| 晚到响应不串任务、归属错误/过期事实可见 | 已有防旧响应行为，新增回归，不伪记新 RED | `71-diagnostic-ui-regression.log` 3/3 |

`57-reconciliation-green.log` 的首次 UUID 正则遗漏一段失败保留，修正输入校验后 `58` 通过。独立只读审查覆盖后端归属/只读/回收接缝与 UI/IPC；指出孤立 lease 在其他会话没有入口，按 `66 → 69` 修复。没有引入取消请求框架、自动恢复或未知进程清理。

### 固定引擎的真实公开历史

`70-real-history-reconciliation.log` 使用既有合成项目真实历史、固定 `0.153.4` 二进制；实际 RPC 只有 `initialize` 和 `thread/read`，读到已完成的 3 轮，精确绑定轮次 completed，产品任务/意图/归属语义记录前后不变。凭据读取 0、模型调用 0；不是 PassThrough 或历史响应替身。此历史随后通过本次真实续轮增加到 4 轮，不能将三轮断言当作永远不变的 fixture。

### 真实 Flash 正常停止后退出

`74-live-lifecycle.log` 与[脱敏汇总](m1-06/live-lifecycle-summary.json)：在既有合成项目/同一 thread 新增一轮，执行每 500 ms 写心跳的有限时探针。切设置、浏览新会话草稿、最小化、关闭到托盘、真实第二次启动恢复原窗口、取消真正退出，各步骤均保持原 task/thread/turn 和完整引擎身份，心跳从 6 增至 24。

真实点击「停止后退出」后：轮次 interrupted、发送意图 settled、根引擎与探针进程均不再存在、心跳在 25 停止且后续未增加、lease 的根关闭及释放时间落盘；应用退出码 0。冷读取公开历史得到第 4 轮 interrupted，原 5 个源文件/测试/人工文件摘要不变。

恢复窗口使用实际第二实例启动，未伪造 `second-instance` 事件；不把此结果描述为自动点击系统托盘图标。原始记录的 `mainPid` 字段实际上取自 Playwright 启动包装进程，因此不用于证明 Main 身份；测试另通过 Main 中的 `process.pid` 与窗口 ID 前后比较，执行引擎身份则由产品校验并落盘。原始字段不静默改写。

### 真实崩溃后只读核对、不重复执行

`78-real-crash-reconciliation.log` 与同一脱敏汇总：全新隔离数据/项目，重新经产品入口系统加密凭据、实际拉取模型目录，仅选择 Flash。唯一真实轮次启动探针后，仅对本脚本拥有的 Main 注入异常退出，再打开真实交付目录中的应用。

- 产品任务投影 reconciling；真实诊断得到根进程 notFound、公开精确轮次 interrupted、后台 unverified，未自动清锁。
- UI 诊断可读、草稿保留、发送按钮禁用；有限 startExecution 也拒绝新发送。
- 两次核对前后产品意图及 lease 未改变；只保存一个发送意图，探针启动文件最终仍为一行 `START`，没有第二次副作用。
- 故障实例仅用测试专属异常退出清理，探针按自身至多 30 秒期限结束；这不是产品正常回收通过的证据，正常回收由上一段单独证明。

失败保留：`76-real-crash-reconciliation.log` 的首次准备尝试把既有验收密文复制到新数据根，解密失败，`sent:false`、任务 0、lease 0，没有模型轮次。没有降低系统加密或推断复制一定可移植；改为原隔离档案受控读取、内存传递到新档案的正常 Key 保存入口，再实际拉取目录。明文未入文件、报告或日志。清理前核对了该失败测试的父子链、映像和创建时间，只结束其尚未派发工作的 Main，未操作用户应用。

### 界面、构建与全量回归

- 实际截图：[浅色诊断](m1-06/reconciliation-light.png)、[深色详情](m1-06/reconciliation-details-dark.png)、[紧凑详情](m1-06/reconciliation-details-compact.png)、[真实退出确认](m1-06/live-exit-confirm.png)、[真实崩溃核对](m1-06/real-crash-reconciliation.png)。前 3 张为合成未知记录，后 2 张为上述实际 Flash 运行，不混称。
- `73-reconciliation-qa.log`：1280×820 深浅色、960×640 浅色，没有横向页面溢出；诊断位于既有记录滚动区，长详情可滚动，输入区仍可见；键盘能展开/重新核对。实际系统 DPI/中文 IME 沿用用户已确认记录，不重复冒称人工检查。
- `67-reconciliation-typecheck.log` 通过，`68-reconciliation-package.log` 独立真实包成功；`72-reconciliation-full.log` **184/184**，298006.6878 ms，自动测试无 Key/模型调用，无人工介入清理。
- 用户原应用退出后再次检查目标占用，`75-reconciliation-delivery-package.log` 成功更新 `E:\AgentX\desktop\out\AgentX-win32-x64`；没有结束用户应用。`77-package-code-identity.log` 比对 ASAR 中 Main/Renderer/Preload/CSS/HTML 五项内容，全部与全量测试包相同。
- 指定包 `resources/app.asar` SHA-256：`dc0481130016ead74e624d7805d9ee4185acb81bae560ae88550ba31cf409531`。真实崩溃验收使用的正是此指定目录包。

当前只剩本切片最终审查、PR/CI 集成与整套 M1 交付归档；没有新增安装器、更新器、通用恢复/清锁或上游补丁。现场新增 2 个 Flash 顶层轮次，首次密文准备失败未发送轮次；各失败和成功均保留。
