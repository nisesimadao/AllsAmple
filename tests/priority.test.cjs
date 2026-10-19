const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PriorityQueue } = require('../src/main/priority-queue.cjs');
const { AudioCache } = require('../src/main/library.cjs');
const { BrowserCatalog, searchUrl } = require('../src/main/providers/browser-catalog.cjs');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
test('foreground audio starts while a slow prefetch is still running', async () => {
  const queue = new PriorityQueue({ concurrency: 3, backgroundConcurrency: 1 }); const held = gate(); const order = [];
  const first = queue.submit(async () => { order.push('prefetch-1'); await held.promise; }); await tick();
  const second = queue.submit(() => { order.push('prefetch-2'); });
  const audio = queue.submit(() => { order.push('play'); }, { priority: 100 });
  await audio.promise; assert.deepEqual(order, ['prefetch-1', 'play']);
  held.release(); await Promise.all([first.promise, second.promise]); assert.equal(order.at(-1), 'prefetch-2');
});
test('queued downloads outrank earlier background work and duplicate prefetch can be promoted', async () => {
  const queue = new PriorityQueue({ concurrency: 1, backgroundConcurrency: 1 }); const held = gate(); const order = [];
  const running = queue.submit(() => held.promise); await tick();
  const low = queue.submit(() => order.push('low')); const promoted = queue.submit(() => order.push('promoted'));
  promoted.promote(100); held.release(); await Promise.all([running.promise, low.promise, promoted.promise]); assert.deepEqual(order, ['promoted', 'low']);
});
test('audio cache promotes the same pending file without downloading it twice', { timeout: 2000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-priority-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const held = gate(), started = gate(); const requests = [];
  const cache = new AudioCache({ request: async (_, { sample }) => { requests.push(sample.id); if (sample.id === 'held') { started.release(); await held.promise; } return Buffer.from('audio'); } }, dir);
  const running = cache.get({ id: 'held' }, { priority: 0 }); await started.promise;
  const background = cache.get({ id: 'promoted' }, { priority: 0 });
  while (!cache.pending.has('promoted')) await tick();
  const foreground = cache.get({ id: 'promoted' }, { priority: 100 });
  await foreground; assert.deepEqual(requests, ['held', 'promoted']);
  held.release(); await Promise.all([running, background]); assert.equal(requests.filter(id => id === 'promoted').length, 1);
});
test('browser search releases the page at a yielded row so playback is not blocked by later batches', { timeout: 2000 }, async () => {
  const raw = { remoteId: '30218', slug: 'rain', title: 'Rain', pageUrl: 'https://samplefocus.com/samples/rain' };
  const bridge = { rows: () => [raw], resolve: async () => ({ url: 'https://d9olupt5igjta.cloudfront.net/rain.mp3' }), download: async () => Buffer.from('real test audio').toString('base64') };
  const locator = { first() { return this; }, count: async () => 1, scrollIntoViewIfNeeded: async () => {}, hover: async () => {} };
  const page = { url: () => searchUrl('samplefocus', 'rain'), evaluate: (fn, input) => vm.runInNewContext(`(${fn.toString()})(input)`, { window: { __allsampleCatalog: bridge }, input }), locator: () => locator };
  const provider = new BrowserCatalog('samplefocus', {}); provider.page = async () => page;
  const iterator = provider.search('rain'); const { value } = await iterator.next();
  assert.equal((await provider.download(value)).toString(), 'real test audio'); await iterator.return();
});
