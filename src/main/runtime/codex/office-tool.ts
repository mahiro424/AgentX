import path from 'node:path';
import { statSync } from 'node:fs';

export function officeToolInstructions(): string {
  const cli = __filename.endsWith('.ts') ? path.join(__dirname, '../../tools/office-cli.cjs') : path.join(__dirname, 'office-cli.js');
  if (!statSync(cli).isFile()) throw new Error('随包表格工具缺失，未开始表格任务');
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const command = `& ${[process.execPath, '--max-old-space-size=192', cli].map(quote).join(' ')}`;
  return '\n\n可用的本机表格工具（通过既有命令工具调用，沿用审批、超时和任务停止；不另行安装依赖）：\n' +
    `PowerShell 中先设置 [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $env:ELECTRON_RUN_AS_NODE='1'。\n` +
    `读取：${command} read '材料绝对路径' '清单中的SHA-256' '新的读取.json' | Out-String\n` +
    `生成：${command} write '内容JSON路径' '新文件.xlsx' | Out-String\n` +
    '每次调用检查 $LASTEXITCODE；非 0 为失败，不能把没有输出当成功。输出 JSON 回执包含实际路径和指纹。仅在当前工作目录新建文件，同名会失败，不删除或覆盖旧文件，续改请生成新版本名。\n' +
    '读取 JSON 保留 sheets[].name/rowCount/columnCount/rows；每个单元格含 type/value/formula/cached，合并从属格仅含 mergedInto 引用。CSV 数值默认是原始文本，需显式核对再转换。\n' +
    '请从实际读取的数据用本地脚本清洗、计算和验证，不能凭推测填写统计。生成内容是 UTF-8 JSON：{"sheets":[{"name":"汇总","rows":[["金额",75],["公式",{"formula":"SUM(B1:B1)","result":75}]]}]}。\n' +
    '单元格允许字符串、数值、布尔、null、{"date":"ISO日期"} 或 {"formula":"公式文本","result":可选缓存值}。仅 CSV/XLSX；CSV 只一张表，公式和公式样式文本应改用 XLSX；不会静默转义或丢表。\n' +
    '工具只验证可解析结构，公式未重算，缓存不等于重新计算结果。必须重新读取生成文件并核对行数/表头/数值/公式，明确无法验证的部分，并核对原件哈希。限 8 MiB、16 表、每表 2000 行/100 列、总 100000 格；30 秒超时。失败或中断留下的文件只是未验证部分产物。';
}
