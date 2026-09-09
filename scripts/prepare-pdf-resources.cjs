const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules/pdfjs-dist');

async function pdfResources(browser = false) {
  const metadata = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  if (metadata.version !== '6.3.289') throw new Error('PDF.js 资源版本与锁定协议不符');
  const names = browser ? ['build/pdf.worker.mjs', 'LICENSE'] : ['legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs', 'LICENSE'];
  for (const folder of browser ? ['cmaps', 'standard_fonts', 'wasm', 'iccs'] : ['cmaps', 'standard_fonts']) {
    for (const file of await fs.readdir(path.join(source, folder), { withFileTypes: true })) {
      if (!file.isFile()) throw new Error(`PDF.js 资源包含非普通文件：${folder}/${file.name}`);
      names.push(`${folder}/${file.name}`);
    }
  }
  return Promise.all(names.map(async name => ({ name, bytes: await fs.readFile(path.join(source, name)) })));
}

async function preparePdfResources(destination = path.join(root, '.cache/pdfjs')) {
  const resources = await pdfResources();
  for (const { name, bytes } of resources) {
    const target = path.join(destination, name);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
  }
  return destination;
}

module.exports = { pdfResources, preparePdfResources };
