# M2-04 文档工作台实施记录

正式 [Issue #24](https://github.com/mahiro424/AgentX/issues/24)，分支 `m2-04`，PR 仅以 `m2` 为目标。本记录持续追加证据，不代表文档/PDF 整个工单已经完成。

## 门禁与实施计划

- #23 已关闭，[PR #33](https://github.com/mahiro424/AgentX/pull/33) 已合入 m2，基线 `f8839cc6edcec36415a48c909bc97e681c429c11`。#30 / PR #31 同样已合入。#24 原样七项必读简报已发布，enhancement + ready-for-agent。
- 已完整打开父 PRD #1 和绑定段落。七项摘要：① workbench 贯穿材料到新文件与续改，复用唯一加号和右侧标签；② 状态策略要求错误、旧内容和未决状态可见，不自动重发；③ US-14/16/20/21/30 要求真实文档/PDF、原件保留、续改及键盘可达；④ 复用现有 Windows 外框与紧凑变体；⑤ DESIGN 的字体、Token、页签/按钮/焦点原语不改；⑥ 单端，无 platforms.md；⑦ 已查看默认稿及 08-document-results、12-pdf-image-preview、10-failed-output、24-dark-compact-corrected，示意分页不能冒充 Word 实际分页。
- 功能三项摘要：既有 MaterialService/FilePreview/执行和结果引用是公开接缝；独立数据、真实文件、恢复与按格式完整链路为测试依据；同一组用户故事贯穿原件、产物和后续轮次。
- 顺序：逐行为 RED→GREEN→REFACTOR，先 DOCX 有界子进程读取与授权预览，再新文件生成、真实结果和续改；随后文本 PDF 逐页提取、Chromium 分页预览和本地图片预览，最后全矩阵回归与现场验收。不是先堆齐解析器再接 UI。
- 修改范围：既有材料/结果契约与服务、办公工具、只读预览、相应测试及打包依赖；不改 Codex 黑盒、规划循环、历史 owner 或全局设计。
- 验证：公开接口测试、真实 Electron、深浅色/两种尺寸/键盘及版本切换、无密钥 Windows CI，合成 DOCX/PDF 的 Flash 任务和独立回读；功能可用后保护性更新原 out 包。
- 风险：DOCX 文字抽取不是 Word 排版复现；压缩包实际解压上限、无文本 PDF 与扫描件、资源/worker 离线打包、超时与旧预览串线。错误保持可见；不偷偷安装系统工具或放宽权限。

## 已核验选型

保留 ExcelJS 4.4.0。DOCX 读取采用 mammoth 1.12.2 的公开 `extractRawText({ buffer })`，不渲染其 HTML、不开放外部文件读取；生成采用 docx 9.7.1 的 `Document` / `Paragraph` / `Packer.toBuffer`。许可原文继续随锁定生产依赖打包。

PDF 拟采用 pdfjs-dist 6.3.289：有界解析进程提取文字，Chromium 绘制页面；仅静态源码已核验，尚不能宣称无 native 依赖的实包路径通过。后续需实际验证 worker/字体资源及依赖体积。不包含 OCR、PDF 生成或专业 Office 编辑。

## 行为与证据

- 001/002：从公开 inspectMaterialFile 读取合成 DOCX，RED 为格式未开放；GREEN 保留中文段落、原件哈希，并确认解析 PID 与 Main 不同且退出。
- 003/004：DOCX 草稿授权和持久化 RED 为旧 kind 白名单拒绝；接通材料存储、有限预览和本机打开后通过。未授权 ID、外部变化、旧版本发送和打开均被阻断。
- 005/006：无文字 DOCX 初始被标 ready；修正为明确“没有可提取文字”，同版本字节核验不把解析失败改写为就绪。该批 12/13，唯一失败是新依赖许可收集，不是解析功能失败。
- 007/010：dingbat-to-unicode 1.0.1 发布包与版本标签无独立 LICENSE，明确保存原 package.json、作者/SPDX 声明与对应标准条款，不补造上游版权年份；hash.js 的完整 MIT 在其 README，继续打包。007 原“正文不含 ts-node”断言误匹配包元数据里的开发脚本，改为核对实际依赖标题，不排除原始声明；010 许可收集通过。
- 008/009：CLI 生成 DOCX 的 RED 为仅开放表格；接通 docx 生成、mammoth 回读及同名保护后通过。独立读取 ZIP 内 document.xml 核对中文及转义文本；错误材料哈希不落输出，同名为实际 EEXIST，不把任意异常算保护成功。
- 011/012：文档产物 RED 为没有结果引用；接通实际 DOCX 文件指纹、结果 ID、来源轮次及有限预览后通过。损坏新字节保留旧版本引用，不当成空文档成功。
- 013/014：DOCX 首发未注入随包工具说明，RED；随后首发、补充、续轮通过同一公开文本输入与实际材料版本关联。此项使用合成引擎边界，不冒充真实模型执行。
- 015/017：首次真实打包失败于 docx CJS 发布物内嵌 JSZip 的动态 require；经官方 exports 与 Context7 核验，Webpack 仅将 docx 精确映射到同版本公开 ESM 入口，没有修改上游文件或忽略编译错误。017 Windows 包成功。
- 016：DOCX 损坏、旧 Office/加密、宏、压缩解压超限和外部超链接文字回归通过，4/4。独立审查提及原始 FILE_ENDED 的测试疑虑，经公开服务包装及实际测试核对并未复现断言失败；界面保留中文错误前缀和底层诊断。
- 018：材料、授权、原件、读写、产物与执行版本的定向集成 26/26；类型检查通过。
- 019/020/023：真实 Electron 的 DOCX article 初始缺失，RED；沿用现有右侧标签接通只读段落、缩放、限制说明与旧内容保留后重新打包，桌面及文本/表格回归 12/12。材料类型显示 DOCX，不添加新页面或完整 Word 控件。
- 021/022：默认镜像的安全审计接口返回 404，未当成通过；显式使用 npm 官方 registry 后生产依赖审计为 0 条已报告漏洞。这不代表不存在未知缺陷。
- 024：随包 Electron（无 PATH Node）实际读/生成/回读 DOCX，中文段落、新版本和实际 EEXIST 核验 1/1，原件不改。
- 025：真实 Electron 深浅色、1280×820/960×640、键盘焦点、段落滚动与故障旧视图已留图并查看，见 [几何记录](images/m2-04/document-geometry.json)。紧凑布局复用原有覆盖式右侧面板，Word 内容是只读段落，不虚构页码。该组无模型调用。

截图：[浅色常规](images/m2-04/document-light-1280.png)、[浅色紧凑](images/m2-04/document-light-960.png)、[深色常规](images/m2-04/document-dark-1280.png)、[深色紧凑](images/m2-04/document-dark-960.png)、[损坏与保留旧视图](images/m2-04/document-stale-dark-960.png)。

- 026：完整本地无密钥回归 297/297，通过，零失败/取消/跳过，约 372 秒；类型检查、43 份文档/303 个链接、UTF-8 无 BOM 和暂存密钥格式扫描通过。独立集成审查没有已确认 P1/P2，旧响应/材料授权/工具契约与 DOCX ESM 实包路径一致；完整 PDF 与真实 Flash 文档现场仍单独验收。

当前已打通 DOCX 产品读取/生成与预览路径；原目录包更新另行记录。尚未完成 DOCX/PDF 真实模型任务、PDF/图片页面预览或 #24 全矩阵，不以依赖安装或单测代替现场验收，不关闭本工单。
