const fs = require('node:fs/promises');
const path = require('node:path');
const lock = require('../package-lock.json');
const root = path.resolve(__dirname, '..');

async function prepareOfficeLicenses(destination = path.join(root, '.cache', 'licenses')) {
  const sections = ['第三方依赖许可证\n按锁定生产依赖收集，版权归各自作者；许可证原文保留。'];
  for (const [relative, locked] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
    if (!relative || locked.dev) continue;
    const directory = path.join(root, relative), metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    if (metadata.version !== locked.version) throw new Error(`许可收集发现依赖版本不一致：${relative}`);
    const names = (await fs.readdir(directory, { withFileTypes: true })).filter(item => item.isFile() && /^(licen[sc]e|copying|notice|copyright)/i.test(item.name)).map(item => item.name).sort();
    let files = names.map(name => path.join(directory, name));
    if (!files.length && metadata.name === 'isarray' && metadata.version === '1.0.0') files = [path.join(directory, 'README.md')];
    // 该 npm 版本未带许可文件，保留对应官方版本的完整许可原文。
    if (!files.length && metadata.name === 'saxes' && metadata.version === '5.0.1') files = [path.join(root, 'runtime', 'licenses', 'saxes-5.0.1-LICENSE')];
    if (!files.length) throw new Error(`依赖缺少可打包的许可原文：${metadata.name}@${metadata.version}`);
    sections.push(`\n${'='.repeat(72)}\n${metadata.name}@${metadata.version}\n${JSON.stringify(metadata.license ?? locked.license)}\n`);
    for (const filename of files) sections.push(`${path.basename(filename)}\n${await fs.readFile(filename, 'utf8')}`);
  }
  await fs.mkdir(destination, { recursive: true });
  const filename = path.join(destination, 'THIRD_PARTY_NOTICES.txt');
  await fs.writeFile(filename, sections.join('\n'), 'utf8');
  return filename;
}

module.exports = { prepareOfficeLicenses };
