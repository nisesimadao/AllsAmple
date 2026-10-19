const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LocalFolders } = require('../src/main/providers/local.cjs');
const { cleanState } = require('../src/main/ui-state.cjs');
const { wav } = require('../scripts/audio-fixture.cjs');
test('local WAV mixes Japanese/English matches, restores metadata and tracks changed/deleted files', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-local-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, '素材'); await fs.mkdir(root);
  const file = path.join(root, 'rain_loop_120bpm_Am.wav'); await fs.writeFile(file, wav({ seconds: 2, channels: 2 })); await fs.writeFile(path.join(root, 'broken.wav'), 'not audio');
  const provider = new LocalFolders(dir); await provider.add([root]);
  const items = await Array.fromAsync(provider.search('雨')); assert.equal(items.length, 1); const sample = items[0];
  assert.equal(sample.duration, 2); assert.equal(sample.channels, 2); assert.equal(sample.bpm, 120); assert.equal(sample.key, 'Am'); assert.equal(sample.loop, true); assert.equal(sample.isPreview, false); assert.equal(sample.license.commercial, null);
  assert.equal(await provider.file(sample), await fs.realpath(file));
  const restored = new LocalFolders(dir); await restored.restore(); assert.deepEqual(restored.folders, [await fs.realpath(root)]); assert.equal(restored.catalog.get(sample.id).duration, 2);
  await fs.writeFile(file, wav({ seconds: 4 })); const changed = await Array.fromAsync(restored.search('rain')); assert.equal(changed[0].duration, 4); assert.equal(changed[0].channels, 1);
  await fs.unlink(file); assert.equal((await Array.fromAsync(restored.search('雨'))).length, 0);
});
test('registering a parent deduplicates roots and removed folders cannot be read', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-roots-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, '音源'), child = path.join(root, '雨'); await fs.mkdir(child, { recursive: true }); await fs.writeFile(path.join(child, 'rain.wav'), wav());
  const provider = new LocalFolders(dir); await provider.add([child]); await provider.add([root]); assert.deepEqual(provider.folders, [await fs.realpath(root)]); assert.equal(provider.catalog.size, 1);
  const sample = [...provider.catalog.values()][0]; await provider.remove(await fs.realpath(root)); await assert.rejects(provider.file(sample), /登録されていません/); assert.equal(provider.catalog.size, 0);
});
test('atomic replacement with unchanged byte length and mtime reparses channels/duration while keeping the project ID', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-local-replace-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, '素材'); await fs.mkdir(root);
  const file = path.join(root, 'rain.wav'); await fs.writeFile(file, wav({ seconds: 2, channels: 1 })); await fs.utimes(file, 1690000000, 1690000000);
  const provider = new LocalFolders(dir); await provider.add([root]); const before = [...provider.catalog.values()][0];
  await fs.writeFile(file + '.new', wav({ seconds: 1, channels: 2 })); await fs.utimes(file + '.new', 1690000000, 1690000000); await fs.rename(file + '.new', file);
  const after = (await Array.fromAsync(provider.search('雨')))[0];
  assert.equal(after.id, before.id); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.duration, 1); assert.equal(after.channels, 2);
});
test('saved projects preserve separate usage and comparison is capped at four distinct IDs', () => {
  const ids = [0, 1, 2, 3, 4].map(i => `local-${String(i).repeat(20)}`);
  const state = cleanState({ projects: [{ id: 'film', name: '映画', usedIds: [ids[0]] }, { id: 'album', name: 'アルバム', usedIds: [ids[1]] }], currentProject: 'album', compareIds: [ids[0], ...ids], blind: true });
  assert.deepEqual(state.projects.map(project => project.usedIds), [[ids[0]], [ids[1]]]); assert.equal(state.currentProject, 'album'); assert.deepEqual(state.compareIds, ids.slice(0, 4)); assert.equal(state.blind, true);
});
