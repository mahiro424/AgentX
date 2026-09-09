import path from 'node:path';
import { statSync } from 'node:fs';

export function officeToolInstructions(formats: ('spreadsheet' | 'document' | 'pdf')[] = ['spreadsheet']): string {
  const cli = __filename.endsWith('.ts') ? path.join(__dirname, '../../tools/office-cli.cjs') : path.join(__dirname, 'office-cli.js');
  if (!statSync(cli).isFile()) throw new Error('随包办公工具缺失，未开始办公任务');
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const command = `& ${[process.execPath, '--max-old-space-size=192', cli].map(quote).join(' ')}`;
  const common = '\n\n可用的本机办公工具（通过既有命令工具调用，沿用审批、超时和任务停止；不另行安装依赖）：\n' +
    `PowerShell 中先设置 [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $env:ELECTRON_RUN_AS_NODE='1'。\n` +
    `读取：${command} read '材料绝对路径' '清单中的SHA-256' '新的读取.json' | Out-String\n` +
    '每次调用检查 $LASTEXITCODE；非 0 为失败，不能把没有输出当成功。输出 JSON 回执包含实际路径和指纹。仅在当前工作目录新建文件，同名会失败，不删除或覆盖旧文件，续改请生成新版本名。\n';
  const spreadsheet = `生成表格：${command} write '内容JSON路径' '新文件.xlsx' | Out-String\n` +
    '读取 JSON 保留 sheets[].name/rowCount/columnCount/rows；每个单元格含 type/value/formula/cached，合并从属格仅含 mergedInto 引用。CSV 数值默认是原始文本，需显式核对再转换。\n' +
    '请从实际读取的数据用本地脚本清洗、计算和验证，不能凭推测填写统计。生成内容是 UTF-8 JSON：{"sheets":[{"name":"汇总","rows":[["金额",75],["公式",{"formula":"SUM(B1:B1)","result":75}]]}]}。\n' +
    '单元格允许字符串、数值、布尔、null、{"date":"ISO日期"} 或 {"formula":"公式文本","result":可选缓存值}。仅 CSV/XLSX；CSV 只一张表，公式和公式样式文本应改用 XLSX；不会静默转义或丢表。\n' +
    '工具只验证可解析结构，公式未重算，缓存不等于重新计算结果。必须重新读取生成文件并核对行数/表头/数值/公式，明确无法验证的部分，并核对原件哈希。限 8 MiB、16 表、每表 2000 行/100 列、总 100000 格；30 秒超时。失败或中断留下的文件只是未验证部分产物。';
  const document = `\n生成文档：${command} write '内容JSON路径' '新文件.docx' | Out-String\n` +
    'DOCX 读取 JSON 中 format=docx，paragraphs 为实际文字段落，messages 说明读取限制；不保留 Word 分页、软换行、列表编号和表格布局。不执行 OCR，不把图片当已读取文字。\n' +
    '生成输入为 UTF-8 JSON：{"paragraphs":["文档标题","第一段正文","第二段正文"]}；每段为纯文字，换行拆成新段落，不提交 HTML 或其他属性。也可用既有文件工具生成 TXT/Markdown。\n' +
    '生成 DOCX 后必须用回执中的 SHA-256 重新读取并核对实际段落和材料事实，不能以文件存在或可解析结构代替业务验证。保留原件和旧版本。最多 8 MiB、提取文字 1 MiB、5000 段，30 秒超时；失败或停止留下的文档只是未验证部分产物。';
  const pdf = '\nPDF 读取 JSON 中 format=pdf，pages[] 按真实页码保留 number/text/width/height，messages 明确空白或无法提取文字页。只处理文本 PDF，不执行 OCR，也不生成 PDF。\n' +
    '根据实际页文字整理 TXT/Markdown 或 DOCX 新文件，并独立核对材料中的事实和来源页；不能把空白或扫描页称为已经读取，不能推测复杂表格阅读顺序。最多 8 MiB、200 页、提取文字 1 MiB。';
  return common + (formats.includes('spreadsheet') ? spreadsheet : '') + (formats.includes('document') || formats.includes('pdf') ? document : '') + (formats.includes('pdf') ? pdf : '');
}
