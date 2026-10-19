const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { wav } = require('./audio-fixture.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-actions-')), data = path.join(dir, 'data'), root = path.join(dir, '自作音源'), downloads = path.join(dir, 'Downloads');
  await fs.mkdir(data); await fs.mkdir(downloads); await fs.mkdir(root);
  await fs.writeFile(path.join(data, 'ui-state.json'), JSON.stringify({ query: '雨', enabledSites: ['local'] }));
  const sources = [], originals = [];
  for (let i = 0; i < 3; i++) {
    const folder = path.join(root, String(i)); await fs.mkdir(folder);
    const file = path.join(folder, i === 2 ? 'rain_loop.wav' : 'rain.wav'), bytes = wav({ seconds: 2 + i, frequency: 220 + i * 220 });
    await fs.writeFile(file, bytes); await fs.utimes(file, 1690000000 + i, 1690000000 + i); sources.push(await fs.realpath(file)); originals.push(bytes);
  }
  const env = { ...process.env, ALLSAMPLE_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ env, ...(process.argv[2] ? { executablePath: path.resolve(process.argv[2]), args: [] } : { args: [path.join(__dirname, '..')] }) });
  let app, page; const errors = [];
  const wait = () => page.waitForFunction(() => !state.busy);
  async function batch() { await page.locator('#batch').click(); await page.waitForFunction(() => !document.querySelector('#batch').disabled); return fs.readdir(path.join(downloads, 'ローカル')); }
  try {
    app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => state.ready); await wait();
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-site]:checked')].map(input => input.dataset.site)), ['local']);
    await app.evaluate(({ app, dialog }, { root, downloads }) => { app.setPath('downloads', downloads); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, { root, downloads });
    await page.locator('#add-folder').click(); await page.waitForFunction(() => !state.busy && state.results.length === 3);
    const items = await page.evaluate(() => state.results.slice());
    await page.keyboard.press('/'); assert.equal(await page.locator('#query').evaluate(element => element === document.activeElement), true);
    await page.locator('#query').fill('rain'); await page.keyboard.press('Enter'); await wait();
    await page.locator('#query').press('Tab'); await page.keyboard.press('j');
    const ordered = await page.locator('.sample-row').evaluateAll(rows => rows.map(row => row.dataset.id));
    assert.equal(await page.evaluate(() => state.selected.id), ordered[0]);
    await page.keyboard.press('j'); assert.equal(await page.evaluate(() => state.selected.id), ordered[1]);
    await page.keyboard.press('k'); assert.equal(await page.evaluate(() => state.selected.id), ordered[0]);
    assert.equal(await page.evaluate(() => audio.paused && !state.auditioning), true);
    await page.keyboard.press('Space'); await page.waitForFunction(() => !audio.paused && state.auditioning);
    const saved = path.join(dir, 'keyboard.wav');
    await app.evaluate(({ dialog }, file) => { globalThis.__keyboardSaves = 0; dialog.showSaveDialog = async () => { globalThis.__keyboardSaves++; return { canceled: false, filePath: file }; }; }, saved);
    await page.keyboard.press('Enter'); await page.getByRole('status').filter({ hasText: /^保存しました$/ }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.__keyboardSaves), 1);
    assert.deepEqual(await fs.readFile(saved), await fs.readFile(items.find(item => item.id === ordered[0]).localPath));
    await page.locator('#copy-credit').click();
    await page.getByRole('status').filter({ hasText: 'クレジット文をコピーしました' }).waitFor();
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), items.find(item => item.id === ordered[0]).license.credit);
    console.log('PASS: / focuses search, j/k select without sound, Space auditions and Enter saves unchanged WAV bytes exactly once; credit copies to native clipboard');
    const filenames = await batch(); assert.equal(filenames.length, 3);
    const exportDir = path.join(downloads, 'ローカル');
    const hashes = async names => Promise.all(names.map(async name => hash(await fs.readFile(path.join(exportDir, name)))));
    const initialHashes = await hashes(filenames);
    assert.deepEqual(initialHashes.slice().sort(), originals.map(hash).sort()); assert.equal((await batch()).length, 3);
    for (let i = 0; i < sources.length; i++) assert.deepEqual(await fs.readFile(sources[i]), originals[i]);
    console.log('PASS: batch exports three files including colliding titles, preserves all original bytes and reuses unchanged exports');
    const edited = items.find(item => item.localPath === sources[0]);
    if (await page.evaluate(() => state.auditioning)) await page.locator('#player-play').click();
    await page.locator(`[data-id="${edited.id}"] [data-play]`).click(); await page.waitForFunction(id => state.info.has(id) && state.playing === id && !audio.paused, edited.id);
    const old = await page.evaluate(id => { window.__previousLocalInfo = state.info.get(id); return { url: audio.src, revision: sampleRevision(state.known.get(id)) }; }, edited.id);
    await page.locator('#player-play').click();
    await page.evaluate(id => {
      const decode = AudioContext.prototype.decodeAudioData; let held = false;
      AudioContext.prototype.decodeAudioData = function(...args) {
        if (held) return decode.apply(this, args); held = true;
        return new Promise(resolve => { window.__releaseOldWave = resolve; }).then(() => decode.apply(this, args));
      };
      state.prepared.delete(id); state.info.delete(id); window.__oldLocalWave = prepare(sampleById(id));
    }, edited.id);
    await page.waitForFunction(() => typeof window.__releaseOldWave === 'function');
    const stat = await fs.stat(sources[0]), replacement = wav({ seconds: 2, frequency: 880 });
    await fs.writeFile(sources[0] + '.new', replacement); await fs.utimes(sources[0] + '.new', stat.atime, stat.mtime); await fs.rename(sources[0] + '.new', sources[0]);
    assert.equal((await fs.stat(sources[0])).mtimeMs, stat.mtimeMs); assert.equal(replacement.length, originals[0].length);
    if (process.env.ALLSAMPLE_ACTIONS_FOLDER_REFRESH === '1') { await page.locator('#add-folder').click(); await page.waitForFunction(() => !document.querySelector('#add-folder').disabled && !state.busy); }
    else { await page.keyboard.press('/'); await page.keyboard.press('Enter'); await wait(); }
    assert.notEqual(await page.evaluate(id => sampleRevision(state.known.get(id)), edited.id), old.revision);
    await page.locator(`[data-id="${edited.id}"] [data-play]`).click();
    await page.waitForFunction(id => state.info.has(id) && state.info.get(id) !== window.__previousLocalInfo && state.playing === id && !audio.paused, edited.id);
    assert.notEqual(await page.evaluate(() => audio.src), old.url);
    await page.waitForFunction(() => { const analyser = audioGraph.analyser, bins = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(bins); let peak = 1; for (let i = 2; i < bins.length; i++) if (bins[i] > bins[peak]) peak = i; return bins[peak] > -50 && Math.abs(peak * audioGraph.context.sampleRate / analyser.fftSize - 880) < 12; });
    assert.equal(await page.evaluate(async id => { const current = state.info.get(id); window.__releaseOldWave(); const obsolete = await window.__oldLocalWave; return obsolete === null && state.info.get(id) === current; }, edited.id), true);
    const changedNames = await batch(); assert.equal(changedNames.length, 4);
    assert.deepEqual((await hashes(changedNames)).sort(), [...initialHashes, hash(replacement)].sort());
    console.log('PASS: replacing a local WAV with identical size and mtime refreshes actual 880Hz playback/waveform, discards late old analysis and writes new bytes without overwriting earlier exports');
    await page.keyboard.press('/'); await page.locator('#query').fill('loop'); await page.keyboard.press('Enter'); await wait(); assert.equal(await page.locator('.sample-row').count(), 1);
    await page.evaluate(() => libraryUI.persist()); await app.close(); app = null;
    app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => state.ready); await wait();
    assert.equal(await page.locator('#query').inputValue(), 'loop'); assert.equal(await page.locator('.sample-row').count(), 1);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-site]:checked')].map(input => input.dataset.site)), ['local']); assert.deepEqual(errors, []);
    await fs.mkdir(path.join(__dirname, '../output/research'), { recursive: true });
    await fs.writeFile(path.join(__dirname, `../output/research/actions${process.env.ALLSAMPLE_ACTIONS_FOLDER_REFRESH === '1' ? '-folder' : ''}-verification.json`), JSON.stringify({ verifiedAt: new Date().toISOString(), keyboard: ['/', 'j', 'k', 'Space', 'Enter'], refreshRoute: process.env.ALLSAMPLE_ACTIONS_FOLDER_REFRESH === '1' ? 'folder registration' : 'search', nativeCreditClipboard: true, batch: { count: 3, duplicateTitles: true, byteIdentity: true, unchangedReused: true, editedLocalGetsNewExport: true }, replacedLocalSameSizeAndMtime: { actualPlaybackHz: 880, waveformRefreshed: true, audioUrlChanged: true }, searchAndSourcesRestored: true }, null, 2));
    console.log('PASS: search text and selected sites survive an actual restart');
  } catch (error) { if (page && !page.isClosed()) console.log(await page.evaluate(() => ({ selected: state.selected?.id, playing: state.playing, text: document.body.innerText.slice(-1000) }))); throw error; }
  finally { if (app) await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
