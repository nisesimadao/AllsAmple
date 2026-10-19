const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DragFiles } = require('../src/main/drag-files.cjs');
test('native drag exports a persistent audio file only on the drag gesture, preserves existing names and reuses the export', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-drag-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'cache.mp3'), folder = path.join(dir, 'Downloads'); await fs.writeFile(source, 'audio');
  let held = 0; const dragged = [];
  const files = new DragFiles({ acquire: async () => { held++; return { file: source, release() { held--; } }; }, folder: () => folder });
  const sample = { id: 'test', site: 'samplefocus', title: '雨.wav' };
  assert.throws(() => files.start(sample, item => dragged.push(item), 'icon'), /準備/);
  await files.prepare(sample); assert.equal(held, 0); assert.equal(await fs.stat(folder).catch(() => null), null);
  await fs.mkdir(folder); await fs.writeFile(path.join(folder, '雨.mp3'), 'existing');
  const file = files.start(sample, item => dragged.push(item), 'icon');
  assert.equal(path.basename(file), '雨 (1).mp3'); assert.deepEqual(dragged, [{ file, icon: 'icon' }]);
  assert.equal(await fs.readFile(file, 'utf8'), 'audio'); assert.equal(await fs.readFile(path.join(folder, '雨.mp3'), 'utf8'), 'existing');
  assert.equal(files.start(sample, () => {}, 'icon'), file);
  await fs.unlink(source); assert.equal(await fs.readFile(file, 'utf8'), 'audio');
});
test('local drag passes the registered original path without exporting or converting it', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-drag-local-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, '雨.wav'); await fs.writeFile(file, 'original wav');
  const files = new DragFiles({ acquire: async () => ({ file, release() {} }), folder: () => { throw new Error('unnecessary export'); } });
  const sample = { id: 'local-test', site: 'local', available: true }; await files.prepare(sample);
  let item; files.start(sample, value => { item = value; }, 'icon'); assert.equal(item.file, file);
  sample.available = false; assert.throws(() => files.start(sample, () => {}, 'icon'), /準備/);
});
