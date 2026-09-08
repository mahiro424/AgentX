# AgentX 状态流转与恢复契约 v0.2

日期：2026-09-07。状态：V1 状态契约与 M1 分期已确认；产品状态实现尚未交付。G1 已实测有限轮次关联、同线程续轮、文本轮中断及执行后历史读取，不代表本文所有转换已经验证。

本文件是状态转换的唯一维护位置。产品语义见 [PRD](../prd/AgentX_Desktop_PRD.md)，进程与数据归属见[整体架构](AgentX_Architecture.md)。下文产品英文标识是拟定内部值，不冒充 Codex 协议字段。

## 1. 不使用一个“大任务状态”

| 维度 | 维护者 | 最小取值或对象 | 持久化规则 |
| --- | --- | --- | --- |
| 任务组织 | 产品 | open / archived | 保存；归档不是执行终态 |
| 执行投影 | 引擎事实 + 产品观测 | idle / submitting / running / waitingApproval / waitingInput / stopping / reconciling / unconfirmed / completed / failed / interrupted | 保存必要观测与关联，但重启须核对；unconfirmed 不是引擎终态 |
| 引擎连接 | 产品 | stopped / starting / initializing / ready / reconnecting / failed / stopping | 运行期状态，不直接当作任务状态 |
| 模型或工具能力 | 产品验证结果 | unconfigured / checking / available / unavailable / needsRevalidation | 保存版本与检查依据，不能永久沿用旧检查 |
| 窗口 | 产品 | visible / tray / exiting | 与任务执行正交 |
| 发送意图 | 产品 | prepared / sent / acknowledged / unknown / rejected | 保留未决意图用于恢复，不保证上游幂等 |

终态只结束本轮执行；同一任务可以开始新轮。归档不得自动终止执行；首版有活动或仍在核对的执行时禁止归档，并引导先停止或核对。unconfirmed 表示已确认无残留执行、但结果无法恢复且用户已知悉的产品收尾状态；可以归档，不能显示成功或伪造引擎终态。

## 2. 执行状态机

~~~mermaid
stateDiagram-v2
    [*] --> idle
    idle --> submitting: 用户提交且前置检查通过
    submitting --> running: 取得匹配的有效轮次事实
    submitting --> failed: 明确拒绝且确认未启动
    submitting --> reconciling: 发送后应答丢失或状态不明
    running --> waitingApproval: 存在待处理审批
    running --> waitingInput: 存在用户输入请求
    waitingApproval --> running: 请求已解决且执行仍活动
    waitingInput --> running: 请求已解决且执行仍活动
    waitingApproval --> waitingInput: 剩余输入等待
    waitingInput --> waitingApproval: 剩余审批等待
    running --> stopping: 用户请求停止
    waitingApproval --> stopping: 用户请求停止
    waitingInput --> stopping: 用户请求停止
    running --> completed: 匹配的权威完成终态
    running --> failed: 匹配的权威失败终态
    running --> interrupted: 匹配的权威中断终态
    stopping --> interrupted: 权威中断终态
    stopping --> completed: 停止前执行已完成
    stopping --> failed: 权威失败终态
    running --> reconciling: 连接或执行事实丢失
    waitingApproval --> reconciling: 连接丢失
    waitingInput --> reconciling: 连接丢失
    stopping --> reconciling: 停止结果未知
    reconciling --> running: 核对确认仍活动
    reconciling --> waitingApproval: 核对确认有效待审批
    reconciling --> waitingInput: 核对确认有效待输入
    reconciling --> completed: 读取到权威完成终态
    reconciling --> failed: 读取到权威失败终态
    reconciling --> interrupted: 读取到权威中断终态
    reconciling --> unconfirmed: 确认无残留但历史不可恢复且用户知悉
    unconfirmed --> submitting: 原会话可用且用户明确开始新轮
    completed --> submitting: 用户开始新轮
    failed --> submitting: 用户确认重试为新轮
    interrupted --> submitting: 用户确认继续为新轮
~~~

图示主路径；任一等待状态仍可直接收到 completed、failed 或 interrupted 终态，不要求先人为切回 running。无法确认是否仍有执行的 reconciling 保持可见，不按超时猜成失败、成功或可自动重试。只有已经确认没有残留执行、检查已知文件变化且用户明确知悉历史缺失，才可转为 unconfirmed 并释放资源。

waitingApproval、waitingInput 是活动执行的阻塞视图，底层保存请求集合；同一时刻可有多个请求，两类均存在时都展示。摘要优先显示待审批，解决一项不意味着全部解决。

### 2.1 转换表

| 当前状态 / 事件 | 条件 | 动作与下一状态 | 禁止行为 |
| --- | --- | --- | --- |
| idle / 提交 | 引擎、模型、目录、权限可用；无其他活动任务 | 保存 prepared 意图，再发送；submitting | 未存意图就执行后假装可恢复 |
| submitting / 轮次事实 | threadId、turnId 与请求绑定可确认 | acknowledged；running 或对应实际状态 | 将任何到达事件绑定当前页面 |
| submitting / 超时或断线 | 不能证明请求未执行 | unknown；reconciling | 自动重复 turn/start |
| running / 用户补充 | 已知 active turnId | 调用 turn/steer；成功后更新接收提示 | 偷改当前轮的模型、目录或沙箱 |
| 补充被拒绝 | expectedTurnId 过时或已结束 | 保留输入草稿，用户可发起新轮 | 悄悄改为 turn/start |
| 活动状态 / 停止 | 目标轮次可确认 | stopping；发 interrupt | 应答到达即显示“已停止” |
| 任一非终态 / 匹配终态 | 来自当前绑定轮次的权威事实 | 保存结果与核对标记；释放可确认资源 | 用其他轮次终态结束当前轮 |
| 非终态 / 连接丢失 | 不再能确认执行 | reconciling；停用重复提交与旧审批按钮 | 将连接失败直接等同执行失败 |
| reconciling / 人工核对收尾 | 已确认无残留执行；历史不可恢复；用户知悉已知副作用及缺失 | 保存操作级核对结论；unconfirmed；释放资源 | 用户单击按钮就冒充无残留证据 |
| unconfirmed / 用户继续 | 原 thread 仍可用且用户明确新目标 | 新发送意图；submitting；旧结果保持未确认 | 声称继承不可恢复的历史 |
| 终态 / 新消息 | 用户明确继续 | 建立新的发送意图与轮次 | 改写上一轮历史 |

### 2.2 引擎事实映射

| 上游接口或事件 | 事实含义 | 产品处理 |
| --- | --- | --- |
| thread/status/changed | loaded thread 的状态变化；可有 notLoaded、idle、systemError、active | 维护连接中的会话投影，不直接表示用户目标已满足 |
| activeFlags | 活动状态附加标记，例如 waitingOnApproval | 保留原值；只映射目标 schema 已知含义，不能猜测其他字符串 |
| turn/start 与 turn/started | 可提供 inProgress 轮次 | 绑定 ID；应答与通知可不同顺序，幂等合并 |
| turn/completed | completed / interrupted / failed | 当前轮权威终态；失败保留 error |
| turn/plan/updated | 引擎共享或更新计划 | 没有事件就不伪造计划；计划子项完成不等于轮次完成 |
| turn/diff/updated | 聚合差异更新 | 用于预览；结合文件项和真实文件核对 |
| item/completed | 单个项的最终结果 | 工具成功、失败或拒绝独立展示 |
| serverRequest/resolved | 服务端请求不再待答 | 关闭对应交互；不解释为操作已成功或一定已批准 |
| thread/read | 读取持久化会话 | 恢复核对，不把读取当订阅 |
| thread/resume | 重新打开指定会话 | 核对后恢复交互；不等于自动重放中断工作 |
| thread/closed 或 notLoaded | 会话未加载或关闭运行期状态 | 历史仍可存在，不等于删除任务 |

以上事实依据[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)。具体字段需对目标二进制生成 schema 验证，网页更新不自动改变本产品已锁定的契约。

## 3. 审批生命周期

~~~mermaid
stateDiagram-v2
    [*] --> pending
    pending --> responding: 用户提交决定
    responding --> resolved: 收到对应解决事实
    pending --> resolved: 引擎因轮次结束等原因清理
    pending --> stale: 原连接失效
    responding --> unknown: 响应发送后连接失效
    stale --> [*]
    unknown --> [*]: 核对后只关闭旧请求记录
    resolved --> [*]
~~~

- 请求关联键是 connectionEpoch + requestId，并保存 threadId、turnId 与已知 itemId；不假定 requestId 跨连接唯一。
- 审批响应必须回原连接。按钮提交后防重复，只有确定未发送才允许同请求重试。
- serverRequest/resolved 也可能表示请求被清理，不代表用户选了批准。实际操作结论由工具项或文件事实提供。
- 连接变化后旧按钮禁用；只有新连接提供了有效待答请求才显示新的交互，不复用旧 requestId。
- 关闭审批面板、超时、模型拒绝或 UI 崩溃均不能自动批准。人工审批与工具自身授权分别标记来源。
- 已有活动轮不随权限设置修改而自动扩大范围；新模式在明确生效点应用，必要时先停止并新开一轮。

## 4. 结果检查与会话组织

不建立 notReviewed、accepted、changesRequested 等验收状态或记录。用户查看文件、差异和输出后，以自然语言继续提出要求；这只会在适当条件下发起补充或新轮。失败、中断和未确认的部分产物都可查看，但不得因用户打开文件、关闭结果面板或表示满意而修改引擎终态。

任务 open 与 archived 独立。归档只整理列表，不删除历史或原文件；恢复归档回到 open，不重新执行。有活动或状态未决执行时禁用归档，先停止或核对；项目批量归档包含此类会话时拒绝整项并说明，不能静默只完成一部分。

lastActivityAt 取会话创建、用户消息被接受以及收到轮次终态的实际时间；查看、重命名、索引重建不刷新最近活动。执行中用旋转标记；等待用户用等待标记而非假装仍在运算；非活动显示相对时间，失败或历史缺失另保留明确标记。正文流式更新不使列表持续重排。

### 4.1 输入主动作映射

| 观测状态 | 主控件 | 输入与补充 |
| --- | --- | --- |
| idle / 已核实终态 | 向上箭头；前置条件不满足则禁用并说明 | 可提交新轮 |
| submitting | 禁用并显示提交中 | 保留草稿，不重复提交 |
| running / waitingApproval / waitingInput | 同一位置的停止方块 | 可写草稿；已知活动 turnId 时，有内容可用文字动作“补充要求” |
| stopping | 同一位置显示停止中，禁用 | 保留草稿；等待真实终态 |
| reconciling | 禁止重复发送；显示核对提示 | 保留草稿，不擅自补发 |
| unconfirmed | 明示历史缺失；仅满足恢复条件后允许新轮 | 不声称自动续跑旧执行 |

停止应答不解锁新发送。补充使用 expectedTurnId；轮次已结束或补充拒绝时保留草稿，不悄悄新开轮。当前轮模型与权限冻结为实际生效快照。输入法组合输入不触发提交，默认 Enter 按当前可用动作提交或补充、Ctrl+Enter 换行。

## 5. 连接、能力与窗口

### 5.1 引擎连接

~~~mermaid
stateDiagram-v2
    [*] --> stopped
    stopped --> starting: 启动专属进程
    starting --> initializing: 进程与管道建立
    initializing --> ready: 握手和必需能力检查通过
    starting --> failed: 启动失败
    initializing --> failed: 协议不兼容
    ready --> reconnecting: 管道或进程异常
    reconnecting --> initializing: 安全建立新连接
    reconnecting --> failed: 无法恢复连接
    ready --> stopping: 明确退出
    failed --> starting: 用户触发修复后重试
    stopping --> stopped: 确认拥有的进程已结束
~~~

ready 只代表引擎通信可用，不代表 DeepSeek Key、模型图像输入、Windows 沙箱或工具已通过测试。安全建立连接前先核对遗留进程；管道型连接丢失不能假装总能接回同一进程。

### 5.2 模型与工具能力

unconfigured → checking → available / unavailable。版本、凭据、权限或关键配置变化后变为 needsRevalidation，再次检查。检查失败保留原因；旧检查结果可展示为历史，不能当作当前可用。

连接检查可能消耗模型额度；产品应明确提示，并由用户主动触发。检查接口认证成功不等于工具链验收成功。

### 5.3 配置保存与模型测试

- 配置编辑与运行生效分开：draft → saving → saved / saveFailed。saved 带 configRevision；active turn 固定 effectiveRevision。保存失败不显示更换完成，拉取或测试必须等待保存成功。
- provider.enabled、selectedModelIds 和 activeModelId 是用户选择；catalog 的 fetching / loaded / fetchFailed、测试的 untested / testing / passed / failed / expired 及 Agent 能力门禁是不同维度，不能共用一个绿色状态。
- 候选模型刷新失败保留旧列表并标记其更新时间；不清空已选模型、不假称已拉取成功。厂商明确移除的 ID 标记不可用，用户重新选择，不自动替换。
- 测试请求绑定模型和配置修订；凭据或关键配置变化后旧测试 expired。旧响应可作为历史记录，但不能恢复当前绿色状态。可用性门禁必须匹配当前生效修订。
- 活动轮期间关闭连接、替换 Key 或修改模型选择，仅影响后续轮；UI 显示当前轮仍用旧配置。明确要立即停止使用时，先走停止流程，不承诺撤销已在服务端发生的调用。
- 下一轮前应用新配置失败则阻止提交，展示错误；不静默使用旧凭据或另一个模型。

### 5.4 人工接管

接管中 → 用户控制，需要相关自动动作停止的可核对事实；状态未知则继续显示“接管等待确认”，不得同时让双方驱动键鼠。用户控制时不执行 Agent 桌面动作；用户明确继续后，以新轮重新观察目标和状态再获取资源。这里不引入通用 paused 或断点续跑承诺。

### 5.5 窗口与进程

visible → tray 不改变轮次。visible/tray → exiting 时，存在活动或未知执行则先提示；用户可取消退出回到原状态。确认退出后先停止、等待与核对，无法确认停止时不得展示“所有工作已停止”；如用户明确选择强制退出，显示可能留下的外部动作并记录恢复核对需要。

电脑睡眠、锁屏或应用失去必要桌面访问能力时，相关操作显示不可用或等待恢复，不能在后台凭旧截图持续点击。

## 6. 中断与断线恢复时序

~~~mermaid
sequenceDiagram
    participant UI as 界面
    participant P as 产品服务
    participant C as 引擎
    participant DB as 产品存储
    UI->>P: 停止当前轮
    P->>DB: 记录停止意图
    P->>C: turn/interrupt
    C-->>P: 请求应答
    P-->>UI: 停止中，尚非终态
    alt 收到权威终态
        C-->>P: turn/completed
        P->>DB: 保存真实终态投影
        P-->>UI: 显示真实结束方式
    else 连接丢失
        P->>DB: 停止结果未知
        P-->>UI: 状态核对中
        P->>C: 安全重建连接后读取历史
        C-->>P: 已持久化轮次或未能确认
        P-->>UI: 确认后的状态或继续标记未知
    end
~~~

### 6.1 恢复算法约束

1. 读取未决发送意图、产品 thread 绑定及上次观测时间，不先重新发送目标。
2. 核对应用和子进程归属，避免启动第二个执行同一工作的实例。
3. 建立新 connectionEpoch，旧连接的响应回调和审批交互失效。
4. 根据已知 threadId 读取持久化轮次与文件结果；如 thread 创建成功但 ID 应答丢失，可只读查找候选，不能根据标题相同就自动认领。
5. 找到权威终态则恢复结果；确证仍活动则恢复对应视图；无法确认是否仍有执行则保持 reconciling。已经确认没有残留执行但历史不可恢复时，展示缺失和已知文件变化，经用户知悉后转 unconfirmed，保存核对依据并释放资源。
6. 原 thread 可用时，用户可以明确发起新轮；原 thread 不可用时，只允许用户显式新建任务，原任务保留缺失标记，不能暗换 threadId 或声称继承缺失历史。无 turnId 时保存 clientOperationId 级核对结论，不制造假的轮次记录。
7. 恢复不重放表单提交、发送消息、文件覆盖或审批响应；unconfirmed 允许重新开始工作，不代表旧操作从未发生。

上游历史分页 cursor 不等于事件重放游标；本设计不假定上游提供通用 exactly-once 或 idempotency key。

### 6.2 竞态与去重

| 场景 | 处理 |
| --- | --- |
| 用户双击发送 | 本地 clientOperationId 和提交占用阻止第二次发送 |
| 事件先于 RPC 应答 | 按已知关联缓冲并合并，不按时间猜绑定 |
| 旧轮次终态晚到 | 只更新旧轮记录；不结束新轮 |
| 停止请求与正常完成竞争 | 采用权威真实终态，可为 completed，不强改 interrupted |
| 刷新界面后重复渲染片段 | 从 Main 当前投影恢复；完整项替换 delta 临时内容 |
| 原始事件重复 | 已知完整 item 按 ID 更新；delta 无上游序号时不声称可任意重放去重 |
| 产品写库失败但引擎已执行 | 显示部分成功与未保存风险，停止新提交并恢复核对 |
| 外部程序修改同一文件 | 显示变化和归因不确定，不自动撤销 |

## 7. 下游测试定位词

- STATE-START-UNKNOWN：发送应答丢失不自动重发。
- STATE-INTERRUPT-ACK：interrupt 应答不构成中断终态。
- STATE-STALE-APPROVAL：旧连接审批不可响应。
- STATE-ARCHIVE-ORTHOGONAL：归档与执行状态正交，结果检查不产生验收状态。
- STATE-LATE-TERMINAL：旧轮终态不能污染新轮。
- STATE-NO-REPLAY：恢复读取不自动重放外部动作。
- STATE-MISSING-HISTORY：确认无残留后可显式收尾并重新开始，不伪造缺失历史。

- STATE-CONFIG-REVISION：配置保存、轮次生效快照和模型测试修订不能互相覆盖。
- STATE-HUMAN-TAKEOVER：确认停止后移交控制，继续时重新观察并显式发起新轮。

这些是唯一测试定位词；实际用例与证据对应[验证计划](../plans/AgentX_Compatibility_Validation_Plan.md)。G1 已测范围见[核心报告](../validation/AgentX_Compatibility_Evidence.md#evidence-g1)，产品状态回归尚未完成。G1 的中断样本没有运行中工具，不能证明完整外部进程停止。

## 8. M1 验证分期

本节只分配验证责任，不定义第二套转换。PRD 各页 UI-M1 段落中的 state 是可观察场景键，不直接当作引擎字段。

| 切片 | 本轮需要验证的转换 | 不得提前声称 |
| --- | --- | --- |
| M1-01 | 窗口初始化、错误、主题/缩放；未接模型时禁用 | 引擎可用、托盘任务保活 |
| M1-02 | 配置保存/失败、生效快照、模型拉取与测试修订 | 其他模型或权限模式兼容 |
| M1-03 | 项目存储和会话投影读取、最近活动显示 | 只靠预设记录就验证真实运行；活动事件待 M1-04 回归 |
| M1-04 | submitting/running/原生审批/补充/停止/终态/未知；STATE-START-UNKNOWN、STATE-INTERRUPT-ACK、STATE-STALE-APPROVAL | 停止应答等于已停，断线可以重发 |
| M1-05 | 已结束历史重开、续轮、STATE-LATE-TERMINAL、STATE-NO-REPLAY、缺失历史错误 | 跨进程历史恢复已经由 G1 证明 |
| M1-06 | visible/tray/exiting、遗留进程核对与未决操作；STATE-NO-REPLAY | 未核对就可再次执行、可以按进程名杀其他应用 |

归档、专用交互澄清表单、电脑接管和完整人工收尾辅助流程留待后续 V1 切片；状态契约仍保留。M1 无法确认的异常保持 reconciling 与禁止重发，不伪造 unconfirmed、成功或不存在残留执行。
