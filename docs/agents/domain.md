# 领域文档

## 固定布局

- CONTEXT.md：领域术语、业务含义和不变量。
- docs/adr/：重要架构决策及理由。
- docs/prd/：用户故事、功能规格、页面状态和验收标准。
- docs/design/DESIGN.md：品牌、设计 Token 和公共 UI 原语。
- docs/design/platforms.md：多端项目的平台与组件映射。
- docs/design/references/：仅 mockup-driven 模式使用默认态 PNG。

功能页布局和状态规格的真相源是 PRD，不是 DESIGN.md。

## 阅读规则

探索业务前读取 CONTEXT.md 及相关 ADR。
实现前读取完整父 PRD，并逐项打开 Issue 指定的必读位置。

UI 模式在需求确认阶段选择：
headless、spec-driven 或 mockup-driven。

模式判定依次查看 PRD 的“本计划 UI 模式”摘要、
DESIGN.md 的“UI 模式”声明；冲突时先澄清，不自行猜测。

spec-driven 需要设计规范和 PRD 页面规格，不要求 PNG。
mockup-driven 还需要默认态 PNG 与人工评审。
多端项目额外读取 platforms.md。

## 维护规则

术语和架构决策由 grill-with-docs 在确认后按需建立。
初始化不创建空白领域文档或虚构决策。
缺少开工必需的输入时，报告缺口，不宣称已满足门禁。

统一使用 CONTEXT.md 中的术语。
与 ADR 冲突时明确指出原因，不静默覆盖既有决策。
