# 分离产品数据、引擎历史与模型凭据

状态：已接受方向，具体实现尚未验证。日期：2026-09-07。

M1 补充决定：SQLite 使用内置 `node:sqlite`，凭据采用 Electron `safeStorage` 系统加密；保持单一 Main 写入者，不引入 ORM、原生第三方数据库驱动或数据库服务。理由是复用当前 Electron 内置运行时与已有产品进程边界，减少分发依赖。打包后的 SQLite 读写、持久化及合成凭据加解密须在 M1-01 验证；失败明确阻断，不改明文或静默换路线。普通偏好使用版本化配置文件，真实 Key 保存由 M1-02 接入。

AgentX 首版采用免注册的本地档案，产品元数据存于本地 SQLite；默认数据根目录为 C:\Users\win\.AgentX。Codex 使用其下独立 CODEX_HOME，产品只持有 thread/turn 等关联标识，不复制维护引擎完整会话历史，不直接依赖引擎私有数据库结构。为支持标题与正文检索，允许从公开历史接口建立最小、可重建的可见文本索引，存于 cache/search.sqlite；它不是完整会话副本、推理记忆或恢复真相源。归档和恢复仅改变产品组织状态，不增加用户验收实体。

模型认证与产品档案分离。首版通过 DeepSeek 自定义 provider 接入，产品凭据使用系统加密后保存，通过公开凭据供给机制交给专属引擎，不使用 OpenAI 登录流程承载 DeepSeek Key。产品配置、诊断日志与普通备份不得包含明文 Key。设置默认只显示密文；用户显式点击眼睛时，通过受控 IPC 临时显示完整 Key，关闭眼睛、离开页面或窗口失焦即隐藏并清理临时值。该例外不向普通页面、预览或网页开放。

不设置本地用户名密码：它不能替代 Windows 用户隔离，且首版没有服务端身份需要。独立 CODEX_HOME 也不能屏蔽所有项目配置及共享技能来源，必须检查实际加载配置并显示来源。DPAPI 防护不等于同用户进程间的强隔离。

数据归属、迁移、凭据继承与备份约束见[整体架构](../architecture/AgentX_Architecture.md)。官方依据：[Codex 环境变量](https://learn.chatgpt.com/docs/config-file/environment-variables)、[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)、[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。
