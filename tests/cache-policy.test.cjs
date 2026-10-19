const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CachePolicy } = require('../src/main/cache-policy.cjs');
const { AudioCache } = require('../src/main/library.cjs');
const { mediaResponse } = require('../src/main/media-response.cjs');
const id = n => `lab-${n.toString(16).padStart(20, '0')}`;
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
async function folder(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-cache-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
async function file(dir, n, secondsAgo) { const name = path.join(dir, `${id(n)}.mp3`); await fs.writeFile(name, Buffer.alloc(4, n)); const time = new Date(Date.now() - secondsAgo * 1000); await fs.utimes(name, time, time); return name; }
test('capacity uses least recently read files across a fresh policy instance', async t => {
  const dir = await folder(t); const oldest = await file(dir, 1, 30), middle = await file(dir, 2, 20), newest = await file(dir, 3, 10);
  const first = new CachePolicy(dir, { maxBytes: 8, recentMs: 0 }); await first.touch(id(1), oldest);
  const evicted = []; const restored = new CachePolicy(dir, { maxBytes: 8, recentMs: 0, onEvicted: id => evicted.push(id) }); const stats = await restored.prune();
  assert.equal(stats.bytes, 8); assert.equal(stats.removedFiles, 1); await assert.rejects(fs.stat(middle), { code: 'ENOENT' }); await fs.access(oldest); await fs.access(newest);
  assert.deepEqual(evicted, [id(2)]);
});
test('comparison pins and read leases survive eviction and explicit clear', async t => {
  const dir = await folder(t); const a = await file(dir, 1, 30), b = await file(dir, 2, 20), c = await file(dir, 3, 10);
  const policy = new CachePolicy(dir, { maxBytes: 4, recentMs: 0 }); policy.setPins([id(1)]); const release = policy.hold(id(2));
  const stats = await policy.prune({ clear: true }); assert.equal(stats.bytes, 8); assert.equal(stats.inUse, 2); await fs.access(a); await fs.access(b); await assert.rejects(fs.stat(c), { code: 'ENOENT' });
  release(); release(); policy.setPins([]); await policy.prune(); assert.equal((await policy.stats()).bytes, 4);
});
test('a read starting during unlink waits for maintenance and downloads the evicted file again', async t => {
  const dir = await folder(t); await file(dir, 1, 30); const entered = gate(), proceed = gate();
  const unlink = fs.unlink; t.mock.method(fs, 'unlink', async name => { if (name.endsWith(`${id(1)}.mp3`)) { entered.release(); await proceed.promise; } return unlink(name); });
  let downloads = 0; const cache = new AudioCache({ request: async () => { downloads++; return Buffer.from('replacement'); } }, dir);
  const prune = cache.policy.prune({ clear: true }); await entered.promise;
  let acquired = false; const reading = cache.acquire({ id: id(1) }).then(lease => { acquired = true; return lease; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(acquired, false); proceed.release(); await prune;
  const lease = await reading; assert.equal(downloads, 1); assert.equal((await fs.readFile(lease.file)).toString(), 'replacement'); lease.release();
});
test('an active transfer and its partial file remain protected until the reader releases them', async t => {
  const dir = await folder(t), waiting = gate(), entered = gate();
  const cache = new AudioCache({ request: async () => { entered.release(); await waiting.promise; return Buffer.from('complete audio'); } }, dir);
  const acquiring = cache.acquire({ id: id(1) }); await entered.promise;
  const part = path.join(dir, `${id(1)}.mp3.part`); await fs.writeFile(part, 'partial'); const old = new Date(Date.now() - 2 * 86400000); await fs.utimes(part, old, old);
  await cache.policy.prune({ clear: true }); await fs.access(part); waiting.release(); const lease = await acquiring;
  await cache.policy.prune({ clear: true }); await fs.access(lease.file); lease.release(); await cache.policy.prune({ clear: true }); await assert.rejects(fs.stat(lease.file), { code: 'ENOENT' });
});
test('an unrelated cache hit is available while another file deletion is stalled', { timeout: 2000 }, async t => {
  const dir = await folder(t); await file(dir, 1, 30); const kept = await file(dir, 2, 20), entered = gate(), proceed = gate();
  const unlink = fs.unlink; t.mock.method(fs, 'unlink', async name => { if (name.endsWith(`${id(1)}.mp3`)) { entered.release(); await proceed.promise; } return unlink(name); });
  const cache = new AudioCache({ request: async () => { throw new Error('cached audio must not be downloaded'); } }, dir);
  const prune = cache.policy.prune({ clear: true }); await entered.promise;
  const lease = await cache.acquire({ id: id(2) }); assert.equal(lease.file, kept); assert.deepEqual(await fs.readFile(lease.file), Buffer.alloc(4, 2));
  proceed.release(); await prune; await fs.access(kept); lease.release();
});
test('manual cleanup removes only owned cache files and stale abandoned parts', async t => {
  const dir = await folder(t), outside = path.join(await folder(t), 'original.wav'); await fs.writeFile(outside, 'original');
  const owned = await file(dir, 1, 10); await fs.symlink(outside, path.join(dir, `${id(2)}.wav`)); await fs.writeFile(path.join(dir, 'personal.wav'), 'leave me');
  const stale = path.join(dir, `${id(3)}.mp3.part`), fresh = path.join(dir, `${id(4)}.mp3.part`); await fs.writeFile(stale, 'old'); await fs.writeFile(fresh, 'new'); const old = new Date(Date.now() - 2 * 86400000); await fs.utimes(stale, old, old);
  const policy = new CachePolicy(dir); await policy.prune({ clear: true }); await assert.rejects(fs.stat(owned), { code: 'ENOENT' }); await assert.rejects(fs.stat(stale), { code: 'ENOENT' });
  assert.equal(await fs.readFile(outside, 'utf8'), 'original'); assert.equal(await fs.readFile(path.join(dir, 'personal.wav'), 'utf8'), 'leave me'); await fs.access(fresh); assert((await fs.lstat(path.join(dir, `${id(2)}.wav`))).isSymbolicLink());
});
test('stream completion, cancellation and invalid ranges release read leases', async t => {
  const dir = await folder(t); const cache = new AudioCache({ request: async () => Buffer.alloc(1024 * 1024, 42) }, dir);
  for (const range of [undefined, 'bytes=100-199', 'bytes=99999999-']) {
    const lease = await cache.acquire({ id: id(1) }); const closed = gate();
    const response = await mediaResponse(lease.file, range, () => { lease.release(); closed.release(); });
    await response.arrayBuffer(); await closed.promise; assert.equal(cache.policy.held.has(id(1)), false);
  }
  const lease = await cache.acquire({ id: id(1) }); const closed = gate(); const response = await mediaResponse(lease.file, undefined, () => { lease.release(); closed.release(); });
  await response.body.cancel(); await closed.promise; assert.equal(cache.policy.held.has(id(1)), false);
});
test('a disk-full write leaves no partial audio or stuck read lease and can be retried', async t => {
  const dir = await folder(t), writeFile = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (name, bytes) => { if (String(name).endsWith('.part')) { await writeFile(name, bytes.subarray(0, 3)); throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } return writeFile(name, bytes); });
  const cache = new AudioCache({ request: async () => Buffer.from('complete audio') }, dir);
  await assert.rejects(cache.get({ id: id(1) }), { code: 'ENOSPC' });
  assert.deepEqual(await fs.readdir(dir), []); assert.equal(cache.policy.held.size, 0); assert.equal(cache.pending.size, 0);
  t.mock.restoreAll(); const name = await cache.get({ id: id(1) }); assert.equal(await fs.readFile(name, 'utf8'), 'complete audio');
});
test('brief prefetch retention expires and automatic cleanup then enforces the limit', async t => {
  const dir = await folder(t); const cache = new AudioCache({ request: async () => Buffer.alloc(8) }, dir, { maxBytes: 4, recentMs: 40 });
  const name = await cache.get({ id: id(1) }); assert.equal((await cache.policy.prune()).bytes, 8);
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) { if (!(await fs.stat(name).catch(() => null))) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  await assert.rejects(fs.stat(name), { code: 'ENOENT' });
});
