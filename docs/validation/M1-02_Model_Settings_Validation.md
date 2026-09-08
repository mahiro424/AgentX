# M1-02 模型设置验证

日期：2026-09-08。关联 [Issue #7](https://github.com/mahiro424/AgentX/issues/7)，父需求 [PRD #1](https://github.com/mahiro424/AgentX/issues/1)。分支 `m1-02`，基线为 `m1` 的 `19e5fe654fe26a5e8ff548780ff324fbb76b1d9e`。

## 1. 当前结论与完成边界

- 本切片实现模型设置的真实产品链路；没有接入任务执行，没有修改 Codex 或重做 G1。
- 本地类型检查、真实 Windows 打包及桌面回归已有通过证据；最后交付回归 36/36 通过。远程 CI、PR 和用户视觉确认仍需分别核验，不能据此关闭工单。
- 所有自动测试使用独立临时目录、公开标识的合成密钥、受控服务响应。没有读取正式 `.AgentX` 凭据，没有真实 DeepSeek 模型调用；截图中的测试成功是**自动测试夹具返回的状态**，不是实网验收。
- `pendingEffect` 随 M1-04 真实运行快照回归；没有为本页制造虚假活动任务。中文输入法、实际 Windows 125%/150% 系统缩放及最终真实 Flash 工作仍留在人工验收。

## 2. 实现与数据边界

| 层/文件 | 职责 |
| --- | --- |
| `src/renderer/pages/ModelSettings.tsx` | 采用图的模型页、复合密钥输入/眼睛、连接开关、候选多选、逐行测试、错误及过期状态 |
| `src/renderer/components/ModelPicker.tsx` | 只展示启用连接下的已选模型；未配置/未选择/失效/失败原因可见，不自动选择替代模型 |
| `src/preload/index.ts`、`src/shared/contracts/models.ts` | 有限类型化接口与无敏感载荷的失效通知；不暴露原始 RPC、通用文件系统或任意命令 |
| `src/main/services/models.ts` | 修订检查、保存与请求协调、测试操作去重、连接快照归属 |
| `src/main/security/credentials.ts` | 实际 Electron safeStorage 加密/解密、限时授权显隐、密文文件原子替换 |
| `src/main/storage/models.ts` | 内置 node:sqlite 模型目录、测试操作/结果、密钥保存未决标记；不使用 ORM/数据库服务 |
| `src/main/services/deepseek.ts` | 固定官方 HTTPS GET /models 与 Flash POST /responses；超时、响应读取上限、受控错误，不自动重试 |

### 本地落盘

- `config.json`：原有偏好加 `modelConnection`，包含 `configRevision`、`enabled`、`selectedModelIds`、`credentialRef`、`activeModelId`，不含明文 Key。
- `secrets.enc`：系统加密的凭据索引。先落新密文并保留当前引用，再原子替换配置引用；失败不破坏旧配置的可解析性。未引用的新密文不会被用于请求。
- `agentx.db`：`model_catalog`、`model_tests`、`model_key_save`；版本 1→2→3 在事务中升级，未知版本/损坏数据库明确报错，不清空重建。
- 密钥保存先写未决标记；失败或重启后仍阻止旧 Key 外发。重新提交并成功保存才清除阻断；若新引用已真正提交，仅未清理标记不否认提交事实。
- 模型测试先记录操作再发送可能计费的请求；结果写入失败或进程退出后，同一操作 ID 不能再次发送。未确认结果保留失败/中断说明，只有新的人为测试操作可重试。
- `configRevision` 是产品配置写入顺序；网络及测试有效性绑定固定地址、精确模型与凭据引用。勾选/工作台选择不改变连接，不让已完成的凭据测试无意义地过期。换 Key 后旧测试保留原修订并标过期；关闭连接阻止新请求。

## 3. 状态覆盖

具体测试见 [models.test.cjs](../../tests/desktop/models.test.cjs)，全部经过真实打包 Electron 窗口和产品桥。

| 工单状态 | 本切片证据 |
| --- | --- |
| unconfigured | 未配置提示、不可拉取、不要求账号；切回保留工作草稿 |
| editing / saving / saved | 整体值 Enter 或离开复合密钥控件保存；眼睛内部焦点移动不触发重复保存；同一点击先保存再拉取 |
| saveFailed | 加密失败、配置替换失败、未知数据库版本；保留旧引用，不使用旧 Key 冒充新配置，重开后仍阻断 |
| masked / revealed | 掩码不是值；仅显式显隐；离页/窗口失焦清理明文；前台设置以外的解密请求被拒绝 |
| disabledConnection | 关闭保留密钥与选择，重新启用不要求重填；工作台不给使用 |
| fetching / catalogLoaded | 用户点击才请求，真实返回 ID，不自动勾选；跨页完成不丢通知；晚读取不覆盖新状态 |
| catalogEmpty / fetchFailed | 空目录与失败不同；401、超时、坏响应、过大响应保留上次目录/时间/勾选 |
| noSelection / selectedMissing | 没有选择不自动默认；远端不再返回的已选模型保留失效说明 |
| unsupported | 拉取/勾选不触发其他模型调用；M1 非 Flash 测试/工作台选择禁用 |
| untested / testing | 拉取不等于测试；只点本行才请求，进行中禁重复操作，内容不含工作材料 |
| testPassed / testFailed | 最小完整 Flash 响应才成功；错误脱敏、时间/耗时与操作绑定，失败不清空选择 |
| testExpired | 换 Key 时晚到结果归属原配置，不能将当前配置标绿 |
| pendingEffect | **未验证，按工单分期留待 M1-04**；当前没有运行快照或伪活动轮 |

## 4. 自动验证与故障修复记录

- `npm run typecheck`：通过。
- `npm run package`：真实 Windows x64 打包通过。期间一次 `EBUSY` 来自预览程序占用输出目录，保留失败记录；未强杀用户程序，确认占用消失后重跑。
- `npm test`：36/36 通过（12 条外框回归 + 24 条模型设置/边界/设计检查），0 失败、0 跳过。
- 运行环境：开发 Node 22.22.3；包内 Electron 44.2.0 / Node 24.20.0。Windows 系统加密和 SQLite 均为包内真实实现。

已通过 RED→GREEN 修复的具体缺陷：
1. 禁用输入触发晚到失焦，失败后再次自动保存 → 保存中只读，失败保留聚焦草稿；密钥控件内显隐不自动提交。
2. 主进程保存失败仅留在内存 → SQLite 未决标记，重开不偷用旧 Key。
3. 切页后拉取永久停留加载 → 有限变更通知、重新读取、订阅清理。
4. 晚读取覆盖当前配置 → 读取序号与卸载作废；工作台离页清除旧候选快照。
5. 测试失败仍能选为可用模型 → Main 和 UI 均检查明确失败状态。
6. 测试结果落盘失败后重启可重复计费 → 先记录操作，再请求及完成结果。
7. 过大响应完整进入内存后才校验 → 边读边限额并取消超限响应。
8. 修改纯候选元数据让进行中目录作废 → 分离产品修订与实际连接一致性检查。

原始 RED、诊断和失败日志保留在本地 `.local-validation/m1-02/`；不把文件名含 green 的早期失败误列为通过。远程只入库脱敏摘要与采用后的截图，不上传临时数据库、密文、缓存或原始运行目录。

## 5. 设计 QA 与人工检查

实际对照 [默认设置采用图](../design/references/windows-desktop-settings.png) 与 [模型连接采用图](../design/review/v0.3/15-settings-models.png)，沿用已有外框，没有新增项目管理、全部任务或其他未接入设置入口。

- 浅/深色 1280×820、紧凑 960×640 的真实窗口已自动验证；窄窗可滚动，模型表格/输入不横向溢出，测试按钮可键盘聚焦。
- 输入框右侧眼睛、固定地址尾标、保存状态右对齐、模型表格及窄测试列、语义色和底部说明均与采用稿核对。
- 截图待用户确认；图中的候选和测试状态来自无密钥自动测试夹具，不能用作实网证据。

人工待检查：真实界面视觉、中文输入法、系统缩放；PR/CI 链路通过后才按授权仅集成至 m1，master 始终不变。

### 可复查证据

- [桌面测试完整输出（合成数据）](m1-02/desktop-tests.tap.txt)
- [未配置浅色 1280×820](m1-02/models-unconfigured-1280.png)
- [已选模型浅色 1280×820（夹具状态）](m1-02/models-selected-light-1280.png)
- [已选模型深色 1280×820（夹具状态）](m1-02/models-selected-dark-1280.png)
- [紧凑窗口滚动至模型表格 960×640（夹具状态）](m1-02/models-selected-light-960.png)

## 6. 技术资料

按 Context7 检索并对照本地依赖/真实运行确认：[Electron safeStorage](https://github.com/electron/electron/blob/main/docs/api/safe-storage.md)、[Electron IPC 安全边界](https://github.com/electron/electron/blob/main/docs/tutorial/security.md)、[DeepSeek 模型目录](https://api-docs.deepseek.com/api/list-models)、[DeepSeek Responses API](https://api-docs.deepseek.com/api/create-response)。最小测试关闭 reasoning，输出上限 32，不携带项目上下文；连接测试不等于完整 Agent 兼容性验证。
