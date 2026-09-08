# M2-00 文档与交付门禁验证

日期：2026-09-09。工单 [#20](https://github.com/mahiro424/AgentX/issues/20)。本记录只验证范围、输入和 CI 接线，不证明五个 M2 业务功能已经实现。

## 范围和输入

- M1 基线 PR #19 / `33d6f8e849a8393fd233c43876c9eb0b705400d2` 已合入；m2 从该点建立，master 远程核验值为 `d266bf905f3e7285de4a3e9a415558cca6c0b21d`，保持不变。
- 五个正式开发工单 #21–25，均为 enhancement + ready-for-human 等待真实依赖；#20 为 enhancement + ready-for-agent，仅可先做文档门禁。
- 各 UI 工单七项必读、功能 seam 三项必读、状态来源和功能/UI/设计 QA 已发布。三项指实现决策、测试决策、用户故事三类编号，不是要求仅列三个唯一标题；复核时去除了标题的重复引用。
- 原 D-global/app-shell/workbench 已关闭并继承合入；不重新创建设计工单，不修改 PNG/品牌 Token。新范围为原三页的连续状态切片，不新增页面。

## 本地检查与 RED/GREEN

| 检查 | 实际结果 |
| --- | --- |
| 原文档扫描 | 35 份文档、222 个仓库内链接、72 条 M1 场景，无 UTF-8/BOM/凭据模式/引用错误 |
| M2 状态清单 | 36 条，M2-01/02/03/04/05 分别 11/7/5/7/6，唯一且逐项有来源 |
| 新增定位词缺失 RED | 内存替换 IMPL-M2-PUBLIC-SEAMS；原门禁未拒绝，变异测试失败 |
| 定位词 GREEN / 状态 RED | 增加必要定位词后第一项通过；内存替换 matches 状态仍未被拒绝，第二项失败 |
| 状态 GREEN | 增加精确状态集合后两项均被拒绝；不修改真实 PRD 造失败 |
| 变异回归 | `python tests/unit/docs-gates.test.py` 通过，包含在文档 CI；实际文档正常扫描通过 |
| TypeScript | `npm run typecheck` 通过；业务源码无改动 |
| Diff 格式 | `git diff --cached --check` 通过 |

原始本地输出留在忽略目录 `.local-validation/m2/01-docs-red.log`、`02-locator-green-state-red.log`、`03-docs-green.log`。不上传运行目录或凭据。

检查工具自身的两次问题保留：尝试调用未安装的 js-yaml 得到 MODULE_NOT_FOUND，没有为此添加依赖；随后用直接核对分支列表及真实 GitHub CI 验证工作流。首版临时状态计数正则误把里程碑表的 workbench 行算入，得到 39；改为明确三列表后为 36。两者是验证辅助程序问题，不计作产品行为 RED。

## 审查和剩余门禁

独立只读审查发现原文档 CI 未覆盖 M2 必读定位词/36 状态，已按上述 RED/GREEN 补齐。远程工单重复标题引用已清理；办公工单补充实际库/工具版本、许可证、官方来源与 Windows 打包/停止证据要求。

Windows/文档 CI 与 PR 集成以实际远程检查为准；未通过前不关闭 #20、不解锁 #21。此切片没有可用产品功能变化，不覆盖原运行包；首个 M2 可用功能完成后按约定打包。完整五个 M2 切片仍未完成。
