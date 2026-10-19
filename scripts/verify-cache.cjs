const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { wav } = require('./audio-fixture.cjs');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-cache-ui-'));
  const root = path.join(dir, 'originals'), data = path.join(dir, 'data'), downloads = path.join(dir, 'Downloads'); await fs.mkdir(root); await fs.mkdir(downloads);
  const original = wav(), localFile = path.join(root, 'rain.wav'); await fs.writeFile(localFile, original);
  const env = { ...process.env, ALLSAMPLE_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ env, ...(process.argv[2] ? { executablePath: path.resolve(process.argv[2]), args: [] } : { args: [path.join(__dirname, '..')] }) });
  let app, page; const errors = [];
  try {
    app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => state.ready);
    await app.evaluate(({ app, dialog }, { downloads, root }) => { app.setPath('downloads', downloads); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, { downloads, root });
    await page.evaluate(() => { document.querySelectorAll('[data-site]').forEach(input => { input.checked = ['soundeffect-lab', 'local'].includes(input.dataset.site); }); });
    await page.locator('#add-folder').click();
    await page.waitForFunction(() => state.results.filter(sample => sample.site === 'soundeffect-lab').length >= 3 && state.results.some(sample => sample.site === 'local'), undefined, { timeout: 60000 });
    const ids = await page.evaluate(() => state.results.filter(sample => sample.site === 'soundeffect-lab').slice(0, 3).map(sample => sample.id));
    await page.evaluate(async ids => { for (const id of ids) await window.allsample.prepare(id); }, ids);
    const cacheFile = id => path.join(data, 'audio', `${id}.mp3`);
    const [exported] = await page.evaluate(id => window.allsample.batch([id]), ids[2]);
    const exportBytes = await fs.readFile(exported);
    await page.evaluate(id => prepare(state.known.get(id)), ids[2]);
    await page.locator(`[data-id="${ids[0]}"] [data-play]`).click(); await page.waitForFunction(id => state.playing === id && !audio.paused, ids[0]);
    await page.locator(`[data-id="${ids[1]}"]`).click(); await page.locator('#add-compare').click(); await page.evaluate(() => libraryUI.persist());
    await page.locator('#open-settings').click();
    await page.waitForFunction(() => document.querySelector('#cache-usage').textContent.includes('GB'));
    await page.locator('#cache-limit').selectOption('268435456'); await page.waitForFunction(() => !document.querySelector('#cache-limit').disabled);
    // Complete hovered rows' decode/metadata reads before testing explicit deletion.
    await page.evaluate(() => Promise.allSettled([...state.prepared.values()]));
    await page.locator('#clear-cache').click(); await page.getByRole('status').filter({ hasText: /未使用の音声を\d+件削除しました/ }).waitFor();
    await fs.access(cacheFile(ids[0])); await fs.access(cacheFile(ids[1])); await assert.rejects(fs.stat(cacheFile(ids[2])), { code: 'ENOENT' });
    await page.waitForFunction(id => !state.audioLoads.has(id), ids[2]);
    assert.equal(await page.evaluate(() => !audio.paused), true);
    assert.deepEqual(await fs.readFile(exported), exportBytes); assert.deepEqual(await fs.readFile(localFile), original);
    console.log('PASS: clearing cache preserves playing audio, comparison candidates, exported MP3 and original local WAV');
    await page.setViewportSize({ width: 320, height: 740 });
    assert(await page.locator('#settings').evaluate(dialog => { const bounds = dialog.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight; }));
    await fs.mkdir(path.join(__dirname, '../output/playwright'), { recursive: true }); await page.screenshot({ path: 'output/playwright/cache-320.png' });
    await page.locator('#close-settings').click(); await page.setViewportSize({ width: 1360, height: 880 });
    await page.locator(`[data-id="${ids[2]}"]`).hover();
    await page.waitForFunction(id => state.audioLoads.has(id), ids[2]); await page.evaluate(id => state.audioLoads.get(id).promise, ids[2]);
    assert.equal(await page.evaluate(() => state.playing), ids[0]); assert.deepEqual(await fs.readFile(cacheFile(ids[2])), exportBytes);
    await page.locator(`[data-id="${ids[2]}"] [data-play]`).click(); await page.waitForFunction(id => state.playing === id && !audio.paused, ids[2], { timeout: 60000 });
    assert.deepEqual(await fs.readFile(cacheFile(ids[2])), exportBytes);
    const inode = (await fs.stat(cacheFile(ids[2]))).ino;
    console.log('PASS: an evicted preview can be fetched and played again without changing the exported file');
    await page.waitForFunction(id => state.history[0] === id, ids[2]);
    await page.evaluate(() => libraryUI.persist()); await app.close(); app = null;
    app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => state.ready);
    assert.equal(await page.evaluate(async () => (await window.allsample.cacheStats()).maxBytes), 268435456);
    await page.locator('[data-view="history"]').click(); await page.locator(`[data-id="${ids[2]}"] [data-play]`).click(); await page.waitForFunction(id => state.playing === id && !audio.paused, ids[2]);
    assert.equal((await fs.stat(cacheFile(ids[2]))).ino, inode);
    assert.deepEqual(await fs.readFile(cacheFile(ids[2])), exportBytes);
    console.log('PASS: capacity persists and existing preview bytes are reused after an actual app restart');
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page && !page.isClosed()) { console.log(await page.evaluate(() => document.body.innerText.slice(-1400))); await page.screenshot({ path: 'output/playwright/cache-failure.png' }); }
    throw error;
  } finally { if (app) await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
