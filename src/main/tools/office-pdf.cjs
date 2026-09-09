const path = require('node:path');
const { pathToFileURL } = require('node:url');

const pdfRoot = __filename.endsWith('.cjs') ? path.resolve(__dirname, '../../../node_modules/pdfjs-dist')
  : /[\\/]app\.asar[\\/]/.test(__filename) ? path.join(process.resourcesPath, 'pdfjs') : path.resolve(__dirname, '../../.cache/pdfjs');

async function readPdf(bytes, extension) {
  if (extension !== '.pdf' || bytes.length > 8 * 1024 * 1024) throw new Error('PDF 格式无效或超过 8 MiB');
  // 保持真正的 ESM 及配套 worker；不打入 Node canvas，也不经过 Webpack CJS 转换。
  const { getDocument } = await import(/* webpackIgnore: true */ pathToFileURL(path.join(pdfRoot, 'legacy/build/pdf.mjs')).href);
  const loading = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false,
    useWasm: false, stopAtErrors: true, cMapUrl: path.join(pdfRoot, 'cmaps').replace(/\\/g, '/') + '/', cMapPacked: true,
    standardFontDataUrl: path.join(pdfRoot, 'standard_fonts').replace(/\\/g, '/') + '/' });
  try {
    const document = await loading.promise;
    if (document.numPages > 200) throw new Error('PDF 最多 200 页，未返回截断文档');
    const pages = [], messages = ['仅提取 PDF 文字；不推断阅读顺序、还原复杂表格或执行 OCR。'];
    let total = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      try {
        const content = await page.getTextContent();
        const text = content.items.filter(item => typeof item.str === 'string').map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
        total += Buffer.byteLength(text);
        if (total > 1024 * 1024) throw new Error('PDF 提取文字最多 1 MiB，未返回截断内容');
        const viewport = page.getViewport({ scale: 1 });
        pages.push({ number, text, width: viewport.width, height: viewport.height });
        if (!text) messages.push(`第 ${number} 页没有可提取文字；可能为空白或扫描页，未执行 OCR。`);
      } finally { page.cleanup(); }
    }
    if (!pages.some(page => page.text)) throw new Error('PDF 没有可提取文字；可能为空白或扫描件，本阶段不执行 OCR');
    return { format: 'pdf', parserPid: process.pid, pages, messages };
  } catch (error) {
    if (error?.name === 'PasswordException') throw new Error('PDF 已加密，需要先另存为未加密文件；本次未读取');
    throw error;
  } finally { await loading.destroy(); }
}

module.exports = { readPdf };
