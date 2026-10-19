const { SoundEffectLab } = require('../src/main/providers/soundeffect-lab.cjs');
const { SiteNetwork } = require('../src/main/network.cjs');
const { AudioCache, copyUnique } = require('../src/main/library.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-live-'));
  try {
    const network = new SiteNetwork(); const provider = new SoundEffectLab(network, dir); const controller = new AbortController(); const found = [];
    for await (const sample of provider.search('雨', { signal: controller.signal })) { found.push(sample); if (found.length === 3) { controller.abort(); break; } }
    assert(found.length >= 3); const sample = found[1];
    const cache = new AudioCache(network, path.join(dir, 'audio')); const cached = await cache.get(sample);
    const exported = await copyUnique(cached, path.join(dir, 'Downloads', sample.siteName), `${sample.title}.mp3`);
    const a = await fs.readFile(cached), b = await fs.readFile(exported); assert(a.length > 1000); assert.deepEqual(a, b);
    console.log(JSON.stringify({ matches: found.map(item => item.title), audioUrl: sample.audioUrl, bytes: a.length, sha256: createHash('sha256').update(a).digest('hex'), preserved: true }, null, 2));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
