const mammoth = require('mammoth');
const { Open } = require('unzipper');
const { Document, Paragraph, Packer } = require('docx');

async function readDocument(bytes, extension) {
  if (extension !== '.docx') throw new Error('文档格式尚未开放');
  if (bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) throw new Error('加密或旧版 Office 文件暂不支持');
  const archive = await Open.buffer(bytes);
  if (!archive.files.some(file => file.path === 'word/document.xml')) throw new Error('不是有效 DOCX 文档');
  if (archive.files.length > 2000) throw new Error('DOCX 压缩条目超限');
  let expanded = 0;
  for (const file of archive.files) {
    if (file.flags & 1) throw new Error('加密 DOCX 暂不支持');
    if (/vbaProject\.bin$/i.test(file.path)) throw new Error('包含宏的文档暂不支持');
    if (file.uncompressedSize > 32 * 1024 * 1024) throw new Error('DOCX 解压内容最多 32 MiB');
    for await (const chunk of file.stream()) {
      expanded += chunk.length;
      if (expanded > 32 * 1024 * 1024) throw new Error('DOCX 解压内容最多 32 MiB');
    }
  }
  // 仅使用公开纯文本接口，不把文档内 HTML、超链接或外部引用变成可执行内容。
  const result = await mammoth.extractRawText({ buffer: bytes });
  if (!result.value.trim()) throw new Error('DOCX 没有可提取文字；可能为空文档或仅含图片，本阶段不执行 OCR');
  if (Buffer.byteLength(result.value) > 1024 * 1024) throw new Error('DOCX 提取文字最多 1 MiB，未返回截断内容');
  const paragraphs = result.value.endsWith('\n\n') ? result.value.slice(0, -2).split('\n\n') : result.value ? [result.value] : [];
  if (paragraphs.length > 5000) throw new Error('DOCX 最多 5000 个文本段落');
  return { format: 'docx', parserPid: process.pid, paragraphs,
    messages: ['仅提取文字和段落，不保留软换行、列表编号、表格布局或 Word 分页。', ...result.messages.map(message => `${message.type}：${message.message}`)] };
}

async function writeDocument(spec, extension) {
  if (extension !== '.docx') throw new Error('文档工具仅生成 DOCX，不生成 PDF');
  if (!spec || Object.keys(spec).length !== 1 || !Array.isArray(spec.paragraphs) || !spec.paragraphs.length || spec.paragraphs.length > 5000 ||
    spec.paragraphs.some(value => typeof value !== 'string' || /[\u0000-\u0008\u000a-\u001f]/u.test(value))) throw new Error('DOCX 内容需为至多 5000 个纯文字段落；换行请拆成多个段落');
  if (!spec.paragraphs.some(value => value.trim()) || Buffer.byteLength(spec.paragraphs.join('\n\n')) > 1024 * 1024) throw new Error('DOCX 必须含文字，文字内容最多 1 MiB');
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: spec.paragraphs.map(text => new Paragraph({ text })) }] }));
  if (bytes.length > 8 * 1024 * 1024) throw new Error('生成文档超过 8 MiB');
  const validated = await readDocument(bytes, extension);
  if (JSON.stringify(validated.paragraphs) !== JSON.stringify(spec.paragraphs)) throw new Error('生成文档回读与指定段落不一致，未保存文件');
  return { bytes, paragraphCount: validated.paragraphs.length };
}

module.exports = { readDocument, writeDocument };
