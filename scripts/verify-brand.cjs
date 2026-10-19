const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function icoImages(bytes) {
  assert.equal(bytes.readUInt16LE(0), 0); assert.equal(bytes.readUInt16LE(2), 1);
  const images = [];
  for (let i = 0; i < bytes.readUInt16LE(4); i++) {
    const at = 6 + i * 16, size = bytes.readUInt32LE(at + 8), start = bytes.readUInt32LE(at + 12);
    images.push({ width: bytes[at] || 256, height: bytes[at + 1] || 256, hash: hash(bytes.subarray(start, start + size)) });
  }
  return images;
}
function peGroups(bytes) {
  const pe = bytes.readUInt32LE(0x3c), optional = pe + 24, sectionTable = optional + bytes.readUInt16LE(pe + 20);
  const rvaOffset = rva => {
    for (let i = 0; i < bytes.readUInt16LE(pe + 6); i++) {
      const at = sectionTable + i * 40, address = bytes.readUInt32LE(at + 12), size = Math.max(bytes.readUInt32LE(at + 8), bytes.readUInt32LE(at + 16));
      if (rva >= address && rva < address + size) return bytes.readUInt32LE(at + 20) + rva - address;
    }
    throw new Error('PE resource RVA is outside the sections');
  };
  const base = rvaOffset(bytes.readUInt32LE(optional + (bytes.readUInt16LE(optional) === 0x20b ? 112 : 96) + 2 * 8));
  const entries = offset => {
    const at = base + offset, items = [];
    for (let i = 0; i < bytes.readUInt16LE(at + 12) + bytes.readUInt16LE(at + 14); i++) {
      const entry = at + 16 + i * 8, name = bytes.readUInt32LE(entry), value = bytes.readUInt32LE(entry + 4);
      items.push({ id: name & 0x80000000 ? null : name, directory: Boolean(value & 0x80000000), offset: value & 0x7fffffff });
    }
    return items;
  };
  const resources = type => {
    const found = entries(0).find(entry => entry.id === type); if (!found) return [];
    return entries(found.offset).flatMap(entry => entries(entry.offset).map(language => {
      assert.equal(language.directory, false); const at = base + language.offset, start = rvaOffset(bytes.readUInt32LE(at));
      return { id: entry.id, bytes: bytes.subarray(start, start + bytes.readUInt32LE(at + 4)) };
    }));
  };
  const images = resources(3), groups = resources(14);
  return groups.map(group => {
    const data = group.bytes, result = [];
    for (let i = 0; i < data.readUInt16LE(4); i++) {
      const at = 6 + i * 14, id = data.readUInt16LE(at + 12), image = images.find(image => image.id === id); assert(image);
      result.push({ width: data[at] || 256, height: data[at + 1] || 256, hash: hash(image.bytes) });
    }
    return result;
  });
}
(async () => {
  const root = path.join(__dirname, '..'), icns = await fs.readFile(path.join(root, 'build/icon.icns')), ico = await fs.readFile(path.join(root, 'build/icon.ico'));
  assert.equal(icns.toString('ascii', 0, 4), 'icns'); assert.equal(icns.readUInt32BE(4), icns.length);
  const expected = icoImages(ico); assert(expected.some(image => image.width === 16)); assert(expected.some(image => image.width === 256));
  const mac = path.join(root, 'dist/mac-universal/AllsAmple.app/Contents');
  const plist = await fs.readFile(path.join(mac, 'Info.plist'), 'utf8'), iconName = plist.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/)?.[1]; assert(iconName);
  assert.deepEqual(await fs.readFile(path.join(mac, 'Resources', iconName)), icns);
  const groups = peGroups(await fs.readFile(path.join(root, 'dist/win-unpacked/AllsAmple.exe')));
  assert(groups.some(group => JSON.stringify(group.map(image => image.hash).sort()) === JSON.stringify(expected.map(image => image.hash).sort())), 'Windows executable must contain the actual supplied ICO group');
  const asar = await import('@electron/asar'), runtimeIcon = await fs.readFile(path.join(root, 'src/assets/icon.png'));
  for (const archive of [path.join(mac, 'Resources/app.asar'), path.join(root, 'dist/win-unpacked/resources/app.asar')]) assert.deepEqual(asar.extractFile(archive, 'src/assets/icon.png'), runtimeIcon);
  await fs.mkdir(path.join(root, 'output/research'), { recursive: true });
  await fs.writeFile(path.join(root, 'output/research/brand-verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), source: 'build/icon.svg', macBundleIconMatches: true, windowsExecutableIconGroupMatches: true, runtimePngMatches: true, windowsSizes: expected.map(image => image.width), icnsBytes: icns.length, icoBytes: ico.length }, null, 2));
  console.log('PASS: supplied icon is embedded in the Mac bundle, Windows PE resources and both runtime ASARs; 16–256px Windows sizes are present');
})().catch(error => { console.error(error); process.exitCode = 1; });
