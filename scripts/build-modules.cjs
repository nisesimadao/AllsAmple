const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const FILES = require('../src/main/module-files.cjs');
async function build({ root = path.join(__dirname, '..'), output = path.join(root, 'dist/modules'), version = require('../src/main/site-module.cjs').version } = {}) {
  if (!/^\d{1,8}(?:\.\d{1,8}){2,3}$/.test(version)) throw new Error('Module version must have three or four numeric components');
  const files = Object.fromEntries(await Promise.all(FILES.map(async file => [file, await fs.readFile(path.join(root, file), 'utf8')])));
  const bytes = Buffer.from(JSON.stringify({ api: 1, version, files }));
  const asset = `allsample-sites-${version}.json`, manifest = { api: 1, version, asset, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, asset), bytes); await fs.writeFile(path.join(output, 'allsample-modules.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, bytes, output };
}
if (require.main === module) build({ ...(process.argv[2] ? { version: process.argv[2] } : {}) }).then(({ manifest }) => console.log(JSON.stringify(manifest, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { build };
