// Real GitHub release -> module execution -> live source -> unchanged file export.
// Runs in Node only, with a temporary library. Never opens a desktop window.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { ModuleUpdates } = require('../src/main/module-updates.cjs');
const { SiteNetwork } = require('../src/main/network.cjs');
const { AudioCache, copyUnique } = require('../src/main/library.cjs');
const bundled = require('../src/main/site-module.cjs');
(async () => {
  const root = path.resolve(__dirname, '..'), dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-public-modules-'));
  try {
    // Model an older installed module; production uses the actual bundled version.
    const options = { appRoot: root, dataDir: dir, bundled: { ...bundled, version: '0.0.0' } };
    const manager = new ModuleUpdates(options);
    const available = await manager.check(); assert.equal(available.phase, 'available', available.message);
    const ready = await manager.download(); assert.equal(ready.phase, 'ready', ready.message);
    const fresh = new ModuleUpdates(options);
    const providers = await fresh.load({ dataDir: dir, automation: {}, createNetwork: () => new SiteNetwork(), getFreesoundKey: () => null });
    assert.equal(fresh.status().version, available.nextVersion); assert.equal(providers.length, 10);
    let sample;
    for await (const item of providers.find(provider => provider.id === 'soundeffect-lab').search('雨')) { sample = item; break; }
    assert(sample && sample.audioUrl && sample.license.attribution === false);
    const network = new SiteNetwork(), cache = new AudioCache(network, path.join(dir, 'audio'));
    const cached = await cache.get(sample), saved = await copyUnique(cached, path.join(dir, 'export'), 'rain.mp3');
    const bytes = await fs.readFile(saved); assert(bytes.length > 1000); assert.deepEqual(bytes, await fs.readFile(cached));
    const result = { verifiedAt: new Date().toISOString(), release: 'https://github.com/nisesimadao/AllsAmple/releases/tag/modules', downloadedVersion: fresh.status().version, executedProviders: providers.map(provider => provider.id), liveQuery: '雨', liveSource: { title: sample.title, pageUrl: sample.pageUrl, audioUrl: sample.audioUrl }, exportedBytes: bytes.length, exportedSha256: createHash('sha256').update(bytes).digest('hex'), byteIdentity: true, windowsOpened: false, fixtureNetwork: false };
    await fs.mkdir(path.join(root, 'output/research'), { recursive: true });
    await fs.writeFile(path.join(root, 'output/research/public-modules-verification.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(`PASS: real GitHub module ${result.downloadedVersion} executes all 10 provider constructors; live rain search exports ${bytes.length} original MP3 bytes. No window opened.`);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
