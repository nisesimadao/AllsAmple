const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function peInfo(bytes) {
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ');
  const offset = bytes.readUInt32LE(0x3c); assert.equal(bytes.toString('ascii', offset, offset + 4), 'PE\0\0');
  const optional = offset + 24, magic = bytes.readUInt16LE(optional);
  assert([0x10b, 0x20b].includes(magic));
  const certificates = optional + (magic === 0x20b ? 112 : 96) + 4 * 8;
  return { machine: bytes.readUInt16LE(offset + 4), authenticodeSignature: bytes.readUInt32LE(certificates + 4) > 0 };
}
(async () => {
  const root = path.join(__dirname, '..'), pkg = require('../package.json');
  const unpacked = path.join(root, 'dist/win-unpacked'), installer = path.resolve(process.argv[2] || path.join(root, `dist/AllsAmple Setup ${pkg.version}.exe`));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-win-package-'));
  try {
    const exe = await fs.readFile(path.join(unpacked, 'AllsAmple.exe')), info = peInfo(exe); assert.equal(info.machine, 0x8664);
    peInfo(await fs.readFile(installer));
    const asar = await import('@electron/asar'), archive = path.join(unpacked, 'resources/app.asar');
    const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString()); assert.equal(metadata.version, pkg.version); assert.equal(metadata.main, pkg.main);
    assert.deepEqual(metadata.dependencies, pkg.dependencies);
    async function compareSource(folder = 'src') {
      for (const entry of await fs.readdir(path.join(root, folder), { withFileTypes: true })) {
        const name = `${folder}/${entry.name}`;
        if (entry.isDirectory()) await compareSource(name);
        else if (entry.isFile() && entry.name !== '.DS_Store') assert.deepEqual(asar.extractFile(archive, name), await fs.readFile(path.join(root, name)), name);
      }
    }
    await compareSource();
    for (const name of ['src/main/index.cjs', 'src/main/providers/pixabay.cjs', 'src/main/providers/freesound.cjs', 'src/renderer/index.html', 'node_modules/playwright-core/package.json', 'src/main/module-updates.cjs', 'src/main/site-module.cjs', 'node_modules/@soundtouchjs/audio-worklet/package.json']) assert(asar.extractFile(archive, name).length > 0, name);
    for (const name of ['hook.js', 'tests/hook.test.cjs']) assert.deepEqual(asar.extractFile(archive, `vendor/sampletap/${name}`), await fs.readFile(path.join(root, 'vendor/sampletap', name)));
    assert.deepEqual(await fs.readFile(path.join(unpacked, 'resources/licenses/SampleTap-MIT.txt')), await fs.readFile(path.join(root, 'vendor/sampletap/LICENSE')));
    execFileSync('7z', ['t', installer], { stdio: 'pipe' });
    execFileSync('7z', ['x', installer, `-o${dir}`, '-y', '$PLUGINSDIR/app-64.7z'], { stdio: 'pipe' });
    const payload = path.join(dir, '$PLUGINSDIR/app-64.7z');
    execFileSync('7z', ['t', payload], { stdio: 'pipe' });
    const extracted = path.join(dir, 'payload');
    execFileSync('7z', ['x', payload, `-o${extracted}`, '-y', 'AllsAmple.exe', 'resources/app.asar', 'resources/licenses/*'], { stdio: 'pipe' });
    for (const name of ['AllsAmple.exe', 'resources/app.asar', 'resources/licenses/AllsAmple-MIT.txt', 'resources/licenses/SampleTap-MIT.txt', 'resources/licenses/MPL-2.0.txt', 'resources/licenses/THIRD_PARTY_NOTICES.md']) assert.deepEqual(await fs.readFile(path.join(extracted, name)), await fs.readFile(path.join(unpacked, name)), name);
    const bytes = await fs.readFile(installer), result = { verifiedAt: new Date().toISOString(), artifact: path.basename(installer), version: pkg.version, architecture: 'x64', installerBytes: bytes.length, installerSha256: digest(bytes), executable: info, checks: ['PE architecture', 'version and entry point', 'all packaged source bytes match the worktree', 'packaged providers and runtime dependencies', 'unmodified SampleTap core and 14 tests', 'installer and payload archive integrity', 'installer payload matches packaged executable, ASAR and license notices'], runtime: 'not established by this archive verification' };
    await fs.mkdir(path.join(root, 'output/research'), { recursive: true }); await fs.writeFile(path.join(root, 'output/research/windows-package-verification.json'), JSON.stringify(result, null, 2));
    console.log('PASS: x64 Windows installer contains the current executable, app code, playback/search dependencies, unmodified SampleTap core and license notices');
    console.log(JSON.stringify({ artifact: result.artifact, bytes: result.installerBytes, sha256: result.installerSha256, signed: info.authenticodeSignature }));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
