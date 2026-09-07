# Repo Wiki 代码导读

## 本仓库配置

- Wiki 启用：是
- 默认语言：zh-CN
- 固定位置：docs/repo-wiki/
- 首次生成：有真实业务代码和执行链路之后。

## 定位

Wiki 供人理解代码现状，不代替需求、设计或架构决策。
工作流 Skill 默认不读取 Wiki；用户明确引用时除外。

## 固定结构

- _meta.yaml：源码 commit、分支、语言与生成时间。
- README.md：项目身份、导读入口。
- 01-execution-flow.md：主执行链路。
- 02-core-modules/：核心模块及职责。
- 03-cross-boundaries.md：跨模块、跨进程边界。
- 04-data-state-flow.md：数据与状态流。
- 05-config-boundaries.md：配置边界。
- 06-extension-points.md：扩展点。
- 07-risk-points.md：风险与技术债。
- diagrams/：可选图源。

## 维护规则

通过 repo-wiki Skill 生成和刷新，附准确的源码位置。
只保留一种语言版本。
源码 commit 变化后，旧 Wiki 可能过时，必须结合源码核验。
规范定义以 CONTEXT、ADR、PRD 和设计输入为准。
初始化只记录本说明，不生成 Wiki 正文。
