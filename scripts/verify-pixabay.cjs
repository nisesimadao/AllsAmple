const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-pixabay-'));
  const env = { ...process.env, ALLSAMPLE_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ env, ...(process.argv[2] ? { executablePath: path.resolve(process.argv[2]), args: [] } : { args: [path.join(__dirname, '..')] }) });
  let app, page; const errors = [];
  try {
    app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => state.ready);
    await page.evaluate(() => { document.querySelectorAll('[data-site]').forEach(input => { input.checked = ['pixabay', 'soundeffect-lab'].includes(input.dataset.site); }); document.querySelector('#query').value = '雨'; document.querySelector('#search-form').requestSubmit(); });
    await page.waitForFunction(() => state.results.some(sample => sample.site === 'soundeffect-lab') && state.results.some(sample => sample.site === 'pixabay' && sample.kind === 'BGM') && state.results.some(sample => sample.site === 'pixabay' && sample.kind !== 'BGM'), undefined, { timeout: 90000 });
    const items = await page.evaluate(() => [state.results.filter(sample => sample.site === 'pixabay' && sample.kind !== 'BGM').sort((a, b) => a.duration - b.duration)[0], state.results.filter(sample => sample.site === 'pixabay' && sample.kind === 'BGM').sort((a, b) => a.duration - b.duration)[0]]);
    const verified = [];
    for (const item of items) {
      const row = page.locator(`[data-id="${item.id}"]`); await row.locator('[data-play]').click();
      await page.waitForFunction(id => state.playing === id && !audio.paused && audio.currentTime > .1, item.id, { timeout: 60000 });
      await page.waitForFunction(id => state.info.has(id), item.id, { timeout: 60000 });
      assert((await page.locator('#detail').innerText()).includes('試聴用音源'));
      const saved = path.join(dir, `${item.id}.mp3`); await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, saved);
      await page.locator('#save').click(); await page.getByRole('status').filter({ hasText: /^保存しました$/ }).waitFor();
      const cached = path.join(dir, 'audio', `${item.id}.mp3`), bytes = await fs.readFile(saved);
      assert(bytes.length > 1000); assert.deepEqual(bytes, await fs.readFile(cached));
      await page.locator('#no-credit').check(); assert.equal(await row.count(), 1); await page.locator('#no-credit').uncheck();
      verified.push({ id: item.id, remoteId: item.remoteId, pageUrl: item.pageUrl, audioUrl: item.audioUrl, kind: item.kind, duration: item.duration, bytes: bytes.length, hasYoutubeContentId: item.hasYoutubeContentId });
    }
    console.log('PASS: live rain search mixes Pixabay music, sound effects and another site; both kinds play, save unchanged MP3s and remain in the no-credit filter');
    await page.keyboard.press('Space');
    await page.locator(`[data-id="${items[0].id}"] [data-favorite]`).click();
    await page.evaluate(() => libraryUI.persist()); await app.close(); app = null;
    app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => state.ready);
    assert.equal(await page.evaluate(id => state.favoriteIds.has(id) && state.known.get(id)?.site === 'pixabay', items[0].id), true);
    assert.equal(await fs.readFile(path.join(dir, 'audio', `${items[0].id}.mp3`)).then(bytes => bytes.length), verified[0].bytes);
    await page.waitForFunction(() => !state.busy && state.results.some(sample => sample.site === 'pixabay'), undefined, { timeout: 90000 });
    await app.evaluate(({ session }) => {
      for (const type of ['music', 'sound-effects']) session.fromPartition(`persist:allsample-pixabay-${type}`).webRequest.onBeforeRequest((_, callback) => callback({ cancel: true }));
    });
    // A different keyword avoids the successful rain query's 60-second cache.
    await page.evaluate(() => { document.querySelector('#query').value = '雷'; document.querySelector('#search-form').requestSubmit(); });
    await page.waitForFunction(() => !state.busy && state.results.some(sample => sample.site === 'soundeffect-lab') && document.querySelector('#search-error').textContent.includes('Pixabay'));
    assert.equal(await page.locator('.sample-row[data-id^="pixabay-"]').count(), 0);
    await fs.mkdir(path.join(__dirname, '../output/research'), { recursive: true });
    await fs.writeFile(path.join(__dirname, '../output/research/pixabay-verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), source: 'live Pixabay bootstrap data through Electron Chromium; public CDN preview MP3s', query: '雨', samples: verified, originalDownload: 'observed guest download route returned a CAPTCHA form; not automated', favoritesAndCacheAfterRestart: true, injectedProviderFailure: 'Pixabay browser network blocked; SoundEffectLab results remain available and search finishes' }, null, 2));
    assert.deepEqual(errors, []);
    console.log('PASS: Pixabay favorite provenance and MP3 cache survive an actual restart');
    console.log('PASS: an injected Pixabay provider failure is displayed without suppressing another site or leaving search busy');
  } catch (error) {
    if (page && !page.isClosed()) console.log(await page.evaluate(() => ({ errors: document.querySelector('#search-error').textContent, sources: [...new Set(state.results.map(sample => sample.site))], results: state.results.filter(sample => sample.site === 'pixabay').length })));
    throw error;
  } finally { if (app) await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
