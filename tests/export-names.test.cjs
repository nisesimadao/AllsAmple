const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { safeName, exportFilename, copyUnique } = require('../src/main/library.cjs');
test('export names avoid Windows devices even with extensions, spaces and superscript port numbers', () => {
  for (const title of ['CON', 'prn', 'AuX', 'NUL', 'COM1', 'LPT9', 'COM¹', 'LPT²', 'CON .mix', 'NUL.mix', 'CONIN$', 'CONOUT$']) {
    assert.equal(safeName(title), `_${title}`);
    assert.equal(exportFilename({ title: `${title}.wav`, localPath: '/sounds/original.wav' }), `_${title}.wav`);
  }
  assert.equal(safeName('CONCERT'), 'CONCERT'); assert.equal(safeName('LPT10'), 'LPT10');
  assert.equal(safeName('name.  '), 'name'); assert.equal(safeName('.  '), 'sample');
});
test('long Japanese and emoji names remain valid on byte-limited filesystems and preserve bytes on duplicate exports', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-export-names-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.mp3'), bytes = Buffer.from('unchanged audio'); await fs.writeFile(source, bytes);
  for (const title of ['雨'.repeat(200), '🎵'.repeat(200), 'a'.repeat(99) + '🎵']) {
    const name = exportFilename({ title, audioUrl: 'https://example.test/audio.mp3' });
    assert(Buffer.byteLength(name) < 255); assert(!/[\uD800-\uDBFF]$/.test(path.basename(name, '.mp3')));
    const one = await copyUnique(source, path.join(dir, 'out'), name), two = await copyUnique(source, path.join(dir, 'out'), name);
    assert.notEqual(one, two); assert.deepEqual(await fs.readFile(one), bytes); assert.deepEqual(await fs.readFile(two), bytes);
  }
});
