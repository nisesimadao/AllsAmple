const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-freesound-'));
  const env = { ...process.env, ALLSAMPLE_DATA_DIR: dir }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ env, ...(process.argv[2] ? { executablePath: path.resolve(process.argv[2]), args: [] } : { args: [path.join(__dirname, '..')] }) });
  let app, page; const errors = [];
  try {
    app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => state.ready);
    await page.evaluate(() => { document.querySelectorAll('[data-site]').forEach(input => { input.checked = ['freesound', 'soundeffect-lab'].includes(input.dataset.site); }); document.querySelector('#search-form').requestSubmit(); });
    await page.waitForFunction(() => state.results.some(sample => sample.site === 'soundeffect-lab') && state.results.filter(sample => sample.site === 'freesound').length >= 2, undefined, { timeout: 60000 });
    const item = await page.evaluate(() => state.results.find(sample => sample.site === 'freesound' && sample.license.attribution === true && sample.duration < 15)); assert(item);
    const row = page.locator(`[data-id="${item.id}"]`); await row.locator('[data-play]').click();
    await page.waitForFunction(id => state.playing === id && !audio.paused, item.id, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#detail-format').textContent.includes('kHz'));
    assert.equal(await page.evaluate(id => state.known.get(id).isPreview, item.id), true);
    const updated = await page.evaluate(id => state.known.get(id), item.id); assert(/-hq\.mp3(?:\?|$)/.test(updated.audioUrl)); assert(updated.license.name.includes('CC BY'));
    const saved = path.join(dir, 'freesound.mp3'); await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, saved);
    await page.locator('#save').click(); await page.getByRole('status').filter({ hasText: /^保存しました$/ }).waitFor(); assert((await fs.stat(saved)).size > 1000);
    console.log('PASS: live public rain search mixes with other sites; the matching HQ preview plays and saves without an API key');
    await page.locator('#use-sample').click();
    const credits = path.join(dir, 'クレジット.txt'); await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, credits);
    await page.locator('#export-credits').click(); await page.getByRole('status').filter({ hasText: 'クレジット.txt を保存しました' }).waitFor();
    const text = await fs.readFile(credits, 'utf8'); assert(text.includes(updated.author)); assert(text.includes(updated.license.name)); assert(text.includes(updated.pageUrl));
    await page.locator('#no-credit').check(); assert.equal(await page.locator(`[data-id="${item.id}"]`).count(), 0); assert(await page.locator('.sample-row[data-id^="lab-"]').count() > 0); await page.locator('#no-credit').uncheck();
    console.log('PASS: per-item attribution filtering and credits include the real author, asset URL and observed license version');

    // No real API key is available in this environment. Exercise the official API
    // branch with a controlled HTTP response; public search/download above is live.
    const token = 'test_private_token_0123456789';
    await app.evaluate((_, { token, item }) => {
      const original = globalThis.fetch; globalThis.__freesoundApiCalls = [];
      globalThis.fetch = async (url, options) => {
        const parsed = new URL(url);
        if (parsed.origin === 'https://freesound.org' && parsed.pathname === '/apiv2/search/') {
          globalThis.__freesoundApiCalls.push({ url: parsed.href, authenticated: options.headers.Authorization === `Token ${token}` });
          if (options.headers.Authorization !== `Token ${token}`) return new Response('{}', { status: 401 });
          return new Response(JSON.stringify({ count: 1, next: null, results: [{ id: Number(item.remoteId), url: item.pageUrl, name: item.title, username: item.author, license: item.license.termsUrl, duration: item.duration, channels: item.channels, tags: ['rain'], previews: { 'preview-hq-mp3': item.audioUrl } }] }), { headers: { 'content-type': 'application/json' } });
        }
        return original(url, options);
      };
    }, { token, item: updated });
    await page.locator('#open-settings').click(); await page.waitForFunction(() => document.querySelector('#freesound-key').placeholder !== '');
    await page.locator('.api-settings > summary').click();
    await page.locator('#remember-key').uncheck();
    await page.locator('#freesound-key').fill('invalid_test_key_0123456789'); await page.locator('#save-freesound-key').click();
    await page.getByRole('status').filter({ hasText: /APIキーを確認/ }).waitFor(); assert.equal(await page.evaluate(async () => (await window.allsample.apiKeyStatus()).configured), false);
    await page.locator('#freesound-key').fill(token); await page.locator('#save-freesound-key').click(); await page.getByRole('status').filter({ hasText: 'APIキーを設定しました' }).waitFor();
    await page.waitForFunction(() => state.results.filter(sample => sample.site === 'freesound').length === 1);
    assert.equal(await page.locator('#freesound-key').inputValue(), '');
    const state = await page.evaluate(() => window.allsample.apiKeyStatus()); assert.equal(state.configured, true); assert.equal(state.saved, false);
    assert(!JSON.stringify(state).includes(token)); assert(!JSON.stringify(JSON.parse(await fs.readFile(path.join(dir, 'api-keys.json'), 'utf8'))).includes(token));
    const calls = await app.evaluate(() => globalThis.__freesoundApiCalls); assert(calls.some(call => call.authenticated)); assert(calls.every(call => !call.url.includes(token)));
    await page.setViewportSize({ width: 320, height: 740 });
    assert(await page.locator('#settings').evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight; }));
    await fs.mkdir(path.join(__dirname, '../output/playwright'), { recursive: true }); await page.screenshot({ path: 'output/playwright/freesound-settings-320.png' });
    await page.locator('#close-settings').click(); await page.evaluate(() => libraryUI.persist()); await app.close(); app = null;
    app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => state.ready);
    assert.equal(await page.evaluate(async () => (await window.allsample.apiKeyStatus()).configured), false);
    await page.waitForFunction(() => state.results.filter(sample => sample.site === 'freesound').length >= 2, undefined, { timeout: 60000 });
    const restored = await page.evaluate(id => state.known.get(id), item.id); assert.equal(restored.license.name, updated.license.name); assert.equal(restored.audioUrl, updated.audioUrl);
    console.log('PASS: controlled API responses verify key validation, header-only authentication, session-only key handling and return to live public search after restart');
    assert.deepEqual(errors, []);
    const research = path.join(__dirname, '../output/research'); await fs.mkdir(research, { recursive: true });
    await fs.writeFile(path.join(research, 'freesound-verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), publicSearch: 'live', query: '雨', sample: { remoteId: updated.remoteId, pageUrl: updated.pageUrl, audioUrl: updated.audioUrl, license: updated.license.name, author: updated.author, bytes: (await fs.stat(saved)).size }, officialApi: 'controlled HTTP response; no live API key available', nativeKeychain: 'not exercised by this test; encrypted persistence is unit-tested with a supplied protector' }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) { console.log(await page.evaluate(() => document.body.innerText.slice(-1400))); await page.screenshot({ path: 'output/playwright/freesound-failure.png' }); }
    throw error;
  } finally { if (app) await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
