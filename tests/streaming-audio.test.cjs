const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AudioCache } = require('../src/main/library.cjs');
const { Freesound, normalize } = require('../src/main/providers/freesound.cjs');
const { GrowingAudio, growingResponse } = require('../src/main/growing-audio.cjs');
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
async function setup(t, { size = 12, fail = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-stream-'));
  const held = gate(); t.after(async () => { held.release(); await cache.pending.values().next().value?.ticket.promise.catch(() => {}); await fs.rm(dir, { recursive: true, force: true }); });
  let requests = 0;
  const sample = normalize({ id: 86367, name: 'Rain', username: 'test', url: 'https://freesound.org/people/test/sounds/86367/', license: 'Creative Commons 0', previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/86/86367_14771-hq.mp3' } });
  const provider = new Freesound({ fetcher: async () => {
    requests++; let sent = false;
    return new Response(new ReadableStream({ async pull(controller) {
      if (!sent) { sent = true; controller.enqueue(Buffer.from('first!')); return; }
      await held.promise;
      if (fail) { controller.error(new Error('connection lost')); return; }
      controller.enqueue(Buffer.from('second')); controller.close();
    } }), { headers: { 'content-type': 'audio/mpeg', ...(size == null ? {} : { 'content-length': String(size) }) } });
  } });
  const cache = new AudioCache({ request: (_, options) => provider.download(sample, options), promote: (_, priority) => provider.promote(sample, priority) }, dir);
  return { cache, sample, held, dir, requests: () => requests };
}
test('audition reads before network completion; save and waveform wait and reuse the exact same transfer', { timeout: 3000 }, async t => {
  const { cache, sample, held, requests } = await setup(t);
  await cache.prepare(sample, { priority: 0 });
  let saved = false, waveform = false;
  const saving = cache.get(sample).then(file => { saved = true; return file; });
  const wave = cache.response(sample, null, { complete: true }).then(response => { waveform = true; return response; });
  const response = await cache.response(sample), reader = response.body.getReader();
  assert.equal(response.headers.get('content-length'), '12');
  assert.equal(Buffer.from((await reader.read()).value).toString(), 'first!');
  assert.equal(saved, false); assert.equal(waveform, false); assert.equal(requests(), 1);
  held.release();
  const chunks = []; for (;;) { const chunk = await reader.read(); if (chunk.done) break; chunks.push(chunk.value); }
  assert.equal(Buffer.concat(chunks).toString(), 'second');
  assert.equal(await fs.readFile(await saving, 'utf8'), 'first!second');
  assert.equal(await (await wave).text(), 'first!second');
  assert.equal(requests(), 1); assert.equal(cache.policy.held.size, 0);
});
test('range readers wait for their bytes and a cancelled reader releases its lease without stopping a save', { timeout: 3000 }, async t => {
  const { cache, sample, held } = await setup(t); await cache.prepare(sample);
  const response = await cache.response(sample, 'bytes=6-9'); assert.equal(response.status, 206);
  const cancelled = await cache.response(sample); await cancelled.body.cancel();
  const waiting = await cache.response(sample, 'bytes=10-11'); await waiting.body.cancel();
  const invalid = await cache.response(sample, 'bytes=99-'); assert.equal(invalid.status, 416);
  const suffix = await cache.response(sample, 'bytes=-2');
  const saving = cache.get(sample); held.release();
  assert.equal(await response.text(), 'seco'); assert.equal(await suffix.text(), 'nd');
  await saving; assert.equal(cache.policy.held.size, 0);
});
test('a reader survives the rename callback gap between the partial and completed cache file', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-rename-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const transfer = new GrowingAudio(path.join(dir, 'test.mp3'));
  await transfer.begin({ size: 6 }); await transfer.append(Buffer.from('sample'));
  const open = fs.open; let renamed = false, releases = 0;
  t.mock.method(fs, 'open', async (...args) => {
    if (args[0] === transfer.partial && !renamed) { renamed = true; await fs.rename(transfer.partial, transfer.file); }
    return open(...args);
  });
  const response = growingResponse(transfer, null, () => { releases++; });
  assert.equal(await response.text(), 'sample'); assert.equal(releases, 1);
});
test('broken progressive downloads error active readers, remove partial files and permit a fresh retry', { timeout: 3000 }, async t => {
  const { cache, sample, held, dir } = await setup(t, { fail: true }); await cache.prepare(sample);
  const response = await cache.response(sample), reader = response.body.getReader(); await reader.read();
  const saving = cache.get(sample); const rejected = assert.rejects(saving, /connection lost/);
  held.release(); await assert.rejects(reader.read(), /connection lost/); await rejected;
  assert.deepEqual(await fs.readdir(dir), []); assert.equal(cache.policy.held.size, 0);
  cache.network.request = async () => Buffer.from('complete retry');
  assert.equal(await fs.readFile(await cache.get(sample), 'utf8'), 'complete retry');
});
test('missing length streams immediately without inventing ranges; truncated declared length cannot become a cached file', { timeout: 3000 }, async t => {
  const unknown = await setup(t, { size: null });
  let ready = false; const preparing = unknown.cache.prepare(unknown.sample).then(() => { ready = true; });
  await preparing; assert.equal(ready, true);
  const response = await unknown.cache.response(unknown.sample, 'bytes=2-5');
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-length'), null);
  const reader = response.body.getReader(); assert.equal(Buffer.from((await reader.read()).value).toString(), 'first!');
  unknown.held.release(); assert.equal(Buffer.from((await reader.read()).value).toString(), 'second'); await reader.read();
  const truncated = await setup(t, { size: 20 }); await truncated.cache.prepare(truncated.sample);
  const saving = truncated.cache.get(truncated.sample); const rejected = assert.rejects(saving, /途中で終了/);
  truncated.held.release(); await rejected; assert.deepEqual(await fs.readdir(truncated.dir), []);
});
test('Japanese sites start MP3/WAV audition before a held transfer completes and save waits for the tail', { timeout: 3000 }, async t => {
  const { SiteNetwork } = require('../src/main/network.cjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-jp-stream-')); const held = gate();
  t.after(async () => { held.release(); await Promise.all([...cache.pending.values()].map(entry => entry.ticket.promise.catch(() => {}))); await fs.rm(dir, { recursive: true, force: true }); });
  let requests = 0;
  const network = new SiteNetwork({ interval: 0, fetcher: async () => {
    requests++; let sent = false;
    return new Response(new ReadableStream({ async pull(controller) { if (!sent) { sent = true; controller.enqueue(Buffer.from('RIFF')); return; } await held.promise; controller.enqueue(Buffer.from('tail')); controller.close(); } }), { headers: { 'content-type': 'audio/wav', 'content-length': '8' } });
  } });
  const cache = new AudioCache(network, dir), sample = { id: 'maou-stream', site: 'maou', audioUrl: 'https://maou.audio/sound/rain.wav' };
  await cache.prepare(sample, { priority: 0 }); const response = await cache.response(sample); assert.equal(response.headers.get('content-type'), 'audio/wav');
  const reader = response.body.getReader(); assert.equal(Buffer.from((await reader.read()).value).toString(), 'RIFF');
  let saved = false; const saving = cache.get(sample).then(file => { saved = true; return file; }); await new Promise(resolve => setImmediate(resolve)); assert.equal(saved, false);
  held.release(); assert.equal(Buffer.from((await reader.read()).value).toString(), 'tail'); await reader.read(); assert.equal(await fs.readFile(await saving, 'utf8'), 'RIFFtail'); assert.equal(requests, 1);
});
