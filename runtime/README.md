# 固定引擎资源

M1 使用未经修改的官方 Codex `0.153.4` Windows x64 二进制，默认零补丁。产品通过公开 App Server 协议接入；本目录不包含引擎业务修改。

## 构建与校验

- `codex.lock.json` 记录既有 G0 来源、官方发布地址、压缩包及二进制的长度与 SHA-256。保留其历史 `purpose`，资源打包通过不等于产品发布或 M1 验收通过。
- Forge 的 `prePackage` / `preStart` 调用 `scripts/prepare-codex.cjs`。只支持 Windows x64，不查询用户 PATH，也不跟随 `latest`。
- 缓存不存在时从锁定官方地址下载；已有缓存大小或摘要不匹配时直接失败，不静默替换。压缩包校验通过后只解出锁定二进制条目，再校验二进制。
- 下载与解压的临时文件保留在 `.cache/codex-downloads`，不会作为引擎资源打包。失败后应检查原因，不把临时文件重命名冒充成功缓存。
- 可显式复用已下载的官方 ZIP：`node scripts/prepare-codex.cjs --archive <ZIP绝对路径>`。相同校验仍然执行。
- 安装资源位于 `resources/engine/0.153.4/win32-x64/`，不在 ASAR 内；同目录携带 `LICENSE`、`NOTICE`。源许可文件位于 `runtime/licenses/`。

二进制、下载缓存和原始实验目录不提交到 Git；构建所需锁定元数据、准备脚本及许可文件应随源码保留。下载只获取固定发布文件，不发送模型请求或模型凭据。

## 固定协议类型

`generated/codex/` 按实际接入方法采用固定 `0.153.4` 的 stable TypeScript 生成文件；目前包含握手、`ThreadStartParams`、`TurnStartParams`、`ConfigReadParams`、`TurnInterruptParams`、`TurnSteerParams`、命令/文件审批响应及依赖，共 35 个文件。文件逐字节来自 G0 固定版本生成结果，没有手工改写。`manifest.json` 记录生成批次、版本和各文件 SHA-256。新增接口继续采用同版本输出，不用最新网页类型替代；不在 Renderer 消费引擎生成类型。

Main 的 `runtime/codex/initialize.ts` 使用这些类型构造请求，并在运行时核对必要返回字段、Windows 平台和预期 CODEX_HOME。目录或平台不匹配则关闭逻辑连接，不发送 `initialized`，不继续提交任务。二进制版本信任仍来自执行前的固定资源校验，不能把 `userAgent` 字符串当作二进制身份认证。

`runtime/codex/execution.ts` 构造固定 Flash、用户审批的首次 thread/turn 请求，只返回已核验的关联和指令来源列表；不会把请求应答当成轮次终态。返回类型尚未整套引入，当前检查实际消费的必要字段，不声称完整 schema 校验。项目目录的实时可用性、原子落盘、事件归属和失败核对仍由待接入的 Main 执行协调器负责。

## Flash 运行配置

`deepseek-flash.models.json` 原样采用已由 G1 核验的官方 Flash 条目（原始 SHA-256：`0421ba743355298573497d802e47681edf435bd5f8fe3da3f654f918b5ae6471`），不是用户在设置页拉取的候选列表，也不代表其他模型可调用。来源与适用方式为 [DeepSeek 官方 Codex 接入资料](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)。保留原字段，不修改其模型指令模板。

`prepareCodexConfiguration` 将固定目录内容写入产品引擎目录的 `models.json`；已有不同内容则拒绝覆盖。产品控制字段以公开 `-c` 参数传入专属进程，避免整份改写已有 `config.toml` 或丢弃用户字段；其他配置来源仍需在执行协调器中核验，不宣称实现完全隔离。

密钥只加入专属进程的 `AGENTX_API_KEY`，不进入参数或模型目录。shell 使用 G1 已验证的 `inherit="none"` 与最小环境白名单，构造白名单后才加入引擎密钥。当前真实引擎已验证配置读取和 Flash 模型目录读取，但活动 shell/MCP 的最终凭据边界仍须在任务链路验收。

## 当前验证范围

`tests/unit/engine-resources.test.cjs` 检查损坏缓存、同大小错误摘要和不完整下载均被拒绝。`tests/desktop/engine-resources.test.cjs` 打开真实打包 Electron，检查资源摘要和许可，并在摘要匹配后执行 `--version`。

这些检查只证明构建资源可用，不证明 App Server 的执行、审批、停止、历史恢复或模型兼容。后续必须通过产品链路验证；所有真实模型测试会话仅允许 `deepseek-v4-flash`。当前不以本目录或 G0 元数据充当 M1 完成凭证。
