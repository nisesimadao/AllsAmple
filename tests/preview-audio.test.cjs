const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { unwrapPreview } = require('../src/main/preview-audio.cjs');
const { AudioCache } = require('../src/main/library.cjs');
function wrapped() {
  const audio = Buffer.alloc(400, 17); audio.set([255, 251, 144, 100]);
  const key = Buffer.from('0123456789abcdefgh'), header = Buffer.alloc(28); header.write('sp'); header.writeBigUInt64LE(100n, 2); key.copy(header, 10);
  const body = Buffer.from(audio);
  for (const start of [0, 200]) for (let i = 0; i < 100; i++) body[start + i] ^= key[i % key.length];
  return { audio, transport: Buffer.concat([header, body]) };
}
test('Splice preview transport is unwrapped once, preserving MP3 frames; malformed packets fail clearly', () => {
  const { audio, transport } = wrapped(); assert.deepEqual(unwrapPreview(transport), audio); assert.equal(unwrapPreview(audio), audio);
  assert.throws(() => unwrapPreview(Buffer.from('sp')), /ヘッダー/);
  const bad = Buffer.from(transport); bad.writeBigUInt64LE(999999999n, 2); assert.throws(() => unwrapPreview(bad), /サイズ/);
});
test('old cached Splice packets repair atomically for concurrent playback, waveform and export without redownloading', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-preview-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const { audio, transport } = wrapped(), sample = { id: 'splice-test', site: 'splice' }, file = path.join(dir, 'splice-test.mp3');
  await fs.writeFile(file, transport);
  const cache = new AudioCache({ request: async () => { throw new Error('unexpected network'); } }, dir);
  const [saved, playback, waveform] = await Promise.all([cache.get(sample), cache.response(sample), cache.response(sample, null, { complete: true })]);
  assert.deepEqual(await fs.readFile(saved), audio); assert.deepEqual(Buffer.from(await playback.arrayBuffer()), audio); assert.deepEqual(Buffer.from(await waveform.arrayBuffer()), audio);
  assert.deepEqual(await fs.readdir(dir), ['splice-test.mp3']);
});
test('new Splice downloads become playable files before consumers are released', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-preview-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const { audio, transport } = wrapped(); const cache = new AudioCache({ request: async () => transport }, dir);
  const sample = { id: 'splice-new', site: 'splice' }; await cache.prepare(sample);
  assert.deepEqual(await fs.readFile(await cache.get(sample)), audio);
});
