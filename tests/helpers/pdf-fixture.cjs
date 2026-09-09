// 合成、可独立核对的最小 PDF；只用于测试，不属于产品生成能力。
function pdfBytes(pages = ['Project Cedar; amount 95', 'Delivery Friday'], unicode = false) {
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  if (unicode) {
    objects[3] = '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>';
    objects.push('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 5 0 R /DW 1000 >>',
      '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >>');
  }
  const kids = [];
  for (const text of pages) {
    const page = objects.length, content = page + 1;
    kids.push(`${page} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`);
    const lines = text.split('\n').map(line => unicode ? `<${Buffer.from(line, 'utf16le').swap16().toString('hex')}>` : `(${line.replace(/[\\()]/g, '\\$&')})`);
    const stream = `BT /F1 14 Tf 50 720 Td ${lines.join(' Tj 0 -26 Td ')} Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let result = '%PDF-1.7\n', offsets = [0];
  for (let index = 1; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(result)); result += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}
module.exports = { pdfBytes };
