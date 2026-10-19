const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { build } = require('../scripts/build-modules.cjs');
const { ModuleUpdates, BASE, newer } = require('../src/main/module-updates.cjs');
const bundled = require('../src/main/site-module.cjs');
const root = path.resolve(__dirname, '..');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-modules-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const built = await build({ output: path.join(dir, 'release'), version: '1.1.0' });
  const bundle = JSON.parse(built.bytes);
  bundle.files['src/main/providers/soundeffect-lab.cjs'] = bundle.files['src/main/providers/soundeffect-lab.cjs'].replace("name = '効果音ラボ'", "name = '更新版ラボ'");
  let payload = Buffer.from(JSON.stringify(bundle)), manifest;
  const refresh = () => { manifest = { ...built.manifest, bytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex') }; }; refresh();
  const requests = [];
  const fetcher = async url => { requests.push(url); return new Response(url.endsWith('allsample-modules.json') ? JSON.stringify(manifest) : payload); };
  const context = { dataDir: path.join(dir, 'data'), automation: {}, getFreesoundKey: () => null, createNetwork: () => ({ request: async url => Buffer.from(url.endsWith('/sitemap.xml') ? '<urlset><url><loc>https://soundeffect-lab.info/sound/environment/</loc></url></urlset>' : '<ul><li><span>雨の録音</span>窓辺<a download href="rain.mp3">保存</a></li></ul>') }) };
  const create = (overrides = {}) => new ModuleUpdates({ dataDir: context.dataDir, appRoot: root, bundled, fetcher, ...overrides });
  return { dir, bundle, context, create, requests, manifest: () => manifest, change(fn) { fn(bundle); payload = Buffer.from(JSON.stringify(bundle)); refresh(); }, corrupt() { payload = Buffer.from('broken download'); }, payload: () => payload };
}

test('real site module downloads, persists and runs updated search code after a fresh loader starts', async t => {
  const f = await fixture(t), first = f.create();
  const initial = await first.load(f.context); assert.equal(initial.length, 9); assert.equal(initial[0].name, '効果音ラボ');
  assert.equal((await first.check()).phase, 'available'); assert.equal(f.requests.length, 1);
  assert.equal((await first.download()).phase, 'ready'); assert.equal(first.status().version, bundled.version);
  assert.equal(initial[0].name, '効果音ラボ'); // Current instances keep running.
  const second = f.create(), providers = await second.load(f.context);
  assert.equal(second.status().version, '1.1.0'); assert.equal(providers[0].name, '更新版ラボ');
  const results = await Array.fromAsync(providers[0].search('rain'));
  assert.equal(results.length, 1); assert.equal(results[0].title, '雨の録音'); assert.equal(results[0].audioUrl, 'https://soundeffect-lab.info/sound/environment/rain.mp3');
  assert(f.requests.every(url => url.startsWith(BASE)));
  const installed = path.join(f.context.dataDir, 'site-modules', `1.1.0-${f.manifest().sha256.slice(0, 12)}`);
  assert.deepEqual(await fs.readFile(path.join(installed, 'vendor/sampletap/hook.js')), await fs.readFile(path.join(root, 'vendor/sampletap/hook.js')));
});

test('integrity failures and missing payloads leave the installed module intact and permit a retry', async t => {
  const f = await fixture(t), manager = f.create(); await manager.check();
  const bytes = f.payload(); f.corrupt();
  assert.equal((await manager.download()).phase, 'error');
  await assert.rejects(fs.access(manager.store.file), { code: 'ENOENT' });
  const retry = f.create({ fetcher: async url => new Response(url.endsWith('allsample-modules.json') ? JSON.stringify(f.manifest()) : bytes) });
  await retry.check(); assert.equal((await retry.download()).phase, 'ready');
  const state = await fs.readFile(retry.store.file, 'utf8');
  const failed = f.create({ fetcher: async url => url.endsWith('allsample-modules.json') ? new Response(JSON.stringify({ ...f.manifest(), version: '1.2.0', asset: 'allsample-sites-1.2.0.json' })) : new Response('', { status: 404 }) });
  await failed.check(); assert.equal((await failed.download()).phase, 'error');
  assert.equal(await fs.readFile(retry.store.file, 'utf8'), state);
});

test('downloaded code is not executed until loading, and a broken factory falls back to the bundled sites', async t => {
  const f = await fixture(t);
  f.change(bundle => { bundle.files['src/main/site-module.cjs'] = 'throw new Error("broken module factory");'; });
  const manager = f.create(); await manager.check(); assert.equal((await manager.download()).phase, 'ready');
  const fresh = f.create(), providers = await fresh.load(f.context);
  assert.equal(providers.length, 9); assert.equal(providers[0].name, '効果音ラボ');
  assert.equal(fresh.status().version, bundled.version); assert.match(fresh.status().message, /同梱版/);
});

test('unsupported APIs, foreign assets and malformed source files are not installed', async t => {
  const f = await fixture(t);
  for (const change of [{ api: 2 }, { asset: 'https://elsewhere.test/code.js' }, { version: '../code' }, { bytes: 10 ** 8 }]) {
    const manager = f.create({ fetcher: async () => new Response(JSON.stringify({ ...f.manifest(), ...change })) });
    assert.equal((await manager.check()).phase, 'error'); await assert.rejects(fs.access(manager.store.file), { code: 'ENOENT' });
  }
  f.change(bundle => { bundle.files['src/main/site-module.cjs'] = 'function {'; });
  const manager = f.create(); await manager.check(); assert.equal((await manager.download()).phase, 'error');
  await assert.rejects(fs.access(manager.store.file), { code: 'ENOENT' });
});

test('a missing release or a network failure never prevents bundled search', async t => {
  const f = await fixture(t);
  for (const fetcher of [async () => new Response('', { status: 404 }), async () => { throw new Error('offline'); }]) {
    const manager = f.create({ fetcher }); await manager.check();
    const providers = await manager.load(f.context); assert.equal(providers.length, 9);
    assert.equal((await Array.fromAsync(providers[0].search('雨'))).length, 1);
  }
});

test('concurrent checks/download clicks share transfers and versions never downgrade', async t => {
  const f = await fixture(t), manager = f.create();
  await Promise.all([manager.check(), manager.check()]); assert.equal(f.requests.length, 1);
  await Promise.all([manager.download(), manager.download()]); assert.equal(f.requests.length, 2);
  const fresh = f.create(); await fresh.load(f.context); assert.equal((await fresh.check()).phase, 'current');
  assert(!newer('1.0.0', '1.1.0')); assert(newer('1.10.0', '1.9.0')); assert(!newer('1.0.0', '1.0.0.0'));
});

test('truncated or externally corrupted installed modules fall back without losing local files', async t => {
  const f = await fixture(t), manager = f.create(); await manager.check(); await manager.download();
  const original = path.join(f.context.dataDir, 'original.wav'); await fs.writeFile(original, 'original bytes');
  const folder = path.join(manager.folder, `1.1.0-${f.manifest().sha256.slice(0, 12)}`);
  await fs.writeFile(path.join(folder, 'bundle.json'), '{}');
  const fresh = f.create(); assert.equal((await fresh.load(f.context))[0].name, '効果音ラボ');
  assert.equal(await fs.readFile(original, 'utf8'), 'original bytes');
});

test('background checks wait until startup settles, repeat while idle, and stop on quit', async t => {
  const f = await fixture(t); t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const manager = f.create({ fetcher: async url => { f.requests.push(url); return new Response('', { status: 404 }); } });
  manager.start(); assert.equal(f.requests.length, 0);
  t.mock.timers.tick(30000); await manager.pending; assert.equal(f.requests.length, 1);
  t.mock.timers.tick(6 * 60 * 60 * 1000); await manager.pending; assert.equal(f.requests.length, 2);
  manager.stop(); t.mock.timers.tick(6 * 60 * 60 * 1000); assert.equal(f.requests.length, 2);
});


test('a newer installed shell does not load an older downloaded site module', async t => {
  const f = await fixture(t), first = f.create(); await first.check(); await first.download();
  const fresh = f.create({ bundled: { ...bundled, version: '2.0.0' } });
  const providers = await fresh.load(f.context);
  assert.equal(providers[0].name, '効果音ラボ'); assert.equal(fresh.status().version, '2.0.0');
});
