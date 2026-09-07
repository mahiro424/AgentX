# 采用模块化桌面产品与黑盒 Agent 引擎

状态：已接受方向，具体实现尚未验证。日期：2026-09-07。

AgentX 采用 Electron、React、TypeScript 组成单仓库的本地桌面产品，使用 Electron Forge 的 Webpack 与 TypeScript 路线。产品服务管理窗口、项目任务、设置与结果检查，通过受控 IPC 服务界面，通过 stdio 公开协议调用独立的 Codex App Server。引擎负责规划、上下文与执行循环，产品不建设平行的 Planner 或模型调度循环。

选择 Electron 是为了降低本地进程、托盘、文件工具及 TypeScript 集成成本，接受安装体积与基础内存开销；首版不采用需要额外 Rust 产品桥接及系统 WebView 适配的 Tauri 路线。拒绝把普通桌面功能拆为微服务，也不为未来多引擎预建通用适配框架。

工具通过公开扩展机制接入。界面隔离、引擎沙箱与外部工具权限属于不同边界，独立进程不等于安全沙箱。实验接口不得成为未经验证的首版隐含依赖。

实现结构与测试约束见[整体架构](../architecture/AgentX_Architecture.md)。官方依据：[Electron 隔离机制](https://www.electronjs.org/docs/latest/tutorial/context-isolation)、[App Server](https://learn.chatgpt.com/docs/app-server)、[Forge 模板](https://www.electronforge.io/templates/typescript-+-webpack-template)。
