# Issue 跟踪器：GitHub

目标仓库：https://github.com/mahiro424/AgentX
任务管理使用 GitHub Issues，通过 gh CLI 操作。

## 使用约定

- 命令显式指定 --repo mahiro424/AgentX，避免误操作其他仓库。
- 读取任务：gh issue view <编号> --repo mahiro424/AgentX --comments
- 列出任务：gh issue list --repo mahiro424/AgentX --state open
- 创建、评论、修改标签和关闭任务均属于远程写入，须先获得授权。
- 多行正文使用 UTF-8 文件配合 --body-file，避免 shell 转义问题。

## PRD 与任务

- PRD 先在 docs/prd/ 编写本地草稿。
- 用户确认内容并授权发布后，再创建对应 PRD Issue。
- 开发 Issue 绑定父 PRD 和具体章节，不重复整份 PRD。
- 发布失败时明确报告，不将本地草稿视为已发布。
- M1 的工单/标签写入和 PR 已获用户授权；PR 仅可合入 m1，master 不动。实际工单链接与状态见 M1 工单门禁索引。
