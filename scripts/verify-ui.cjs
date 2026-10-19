// Renderer-only fixtures in headless Chromium. Never starts Electron, sound, or native dialogs.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '../src/renderer');
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1360, height: 880 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://allsample-ui.test') return route.abort();
      const file = url.pathname === '/query.js' ? path.resolve(root, '../shared/query.js') : path.resolve(root, '.' + url.pathname);
      if (url.pathname !== '/query.js' && !file.startsWith(root + path.sep)) return route.abort();
      await route.fulfill({ path: file });
    });
    await context.addInitScript(() => {
      let receive, updateReceiver;
      let moduleState = { version: '1.0.0', phase: 'idle', enabled: true, nextVersion: null, message: '' };
      window.fixturePrepareFails = false;
      window.fixtureSaved = null; window.fixtureSearches = [];
      const titles = ['雨の降る住宅街 — 遠くを走る車と軒下のしずく', '雨音・窓ガラス', 'Rainfall / open field', '雨上がりの森', 'Rain texture 120 BPM', '小雨と遠雷'];
      const samples = titles.map((title, index) => ({
        id: `fixture-${index}`, title, site: index % 2 ? 'maou' : 'soundeffect-lab', siteName: index % 2 ? '魔王魂' : '効果音ラボ',
        kind: 'アンビエンス', duration: 35 + index * 11, format: 'MP3', description: index ? '' : title,
        isPreview: index === 2, bpm: null, key: null,
        license: { category: index % 2 ? 'yellow' : 'green', commercial: true, attribution: Boolean(index % 2), modification: true, redistribution: false, contentId: false, adult: null, note: '' }
      }));
      window.allsample = {
        bootstrap: async () => ({ samples: [], folders: [], ui: null }),
        saveState: async () => {}, cachePins: async () => {}, onError() {}, onCacheEvicted() {}, onUpdate(callback) { updateReceiver = callback; },
        onSearch(callback) { receive = callback; },
        search: async ({ requestId, enabledSites }) => { window.fixtureSearches.push(enabledSites); for (const sample of samples.filter(sample => enabledSites.includes(sample.site))) receive({ requestId, sample }); receive({ requestId, done: true }); },
        prepare: async () => { if (window.fixturePrepareFails) throw new Error('fixture prefetch failed'); return new Promise(() => {}); },
        save: async id => { window.fixtureSaved = id; return '/fixture/saved.mp3'; },
        copyPath: async () => {}, copyCredit: async () => {},
        apiKeyStatus: async () => ({ configured: false, saved: false, canPersist: true }),
        cacheStats: async () => ({ bytes: 0, maxBytes: 2147483648, files: 0, inUse: 0 }),
        updateStatus: async () => moduleState,
        checkUpdate: async () => { moduleState = { ...moduleState, phase: 'available', nextVersion: '1.1.0' }; updateReceiver(moduleState); return moduleState; },
        downloadUpdate: async () => { moduleState = { ...moduleState, phase: 'ready', message: '取得しました。次回起動時に読み込みます。' }; updateReceiver(moduleState); return moduleState; }
      };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://allsample-ui.test/index.html');
    await page.waitForFunction(() => state.ready && !state.busy && document.querySelectorAll('.sample-row').length === 6);
    await page.evaluate(() => {
      const enabled = [...document.querySelectorAll('[data-site]:checked')].map(input => input.dataset.site);
      const known = [...document.querySelectorAll('[data-site]')].map(input => input.dataset.site);
      AllsampleRestoreSites(['soundeffect-lab'], null);
      if (!document.querySelector('[data-site=dova]').checked || document.querySelector('[data-site=maou]').checked) throw new Error('new-source migration changed existing exclusions');
      document.querySelector('[data-site=dova]').checked = false;
      const profile = captureProfile(); AllsampleRestoreSites(profile.sites, profile.knownSites);
      if (document.querySelector('[data-site=dova]').checked) throw new Error('explicit DOVA exclusion was not retained');
      AllsampleRestoreSites(enabled, known);
      for (const sample of state.results) state.info.set(sample.id, { duration: sample.duration, sampleRate: 44100, channels: 2, peaks: Array.from({ length: 240 }, (_, i) => .15 + Math.abs(Math.sin(i * .3) * Math.cos(i * .07)) * .8) });
      renderResults();
      for (const row of document.querySelectorAll('.sample-row')) {
        row.querySelector('.wave-wrap').innerHTML = `<canvas class="wave-canvas" data-wave="${row.dataset.id}" aria-label="音声の波形"></canvas>`;
      }
      renderResults();
    });
    await page.locator('[data-id="fixture-0"] .sample-title').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.icon')].filter(icon => icon.getBoundingClientRect().width > 0).every(icon => icon.getBBox().width > 0));
    assert.equal(await page.locator('.detail-description').count(), 0);
    assert.equal(await page.locator('.site-dot, .source-count, .license-key, .key-hints').count(), 0);
    assert.equal(await page.locator('#tempo').isVisible(), false);
    await page.locator('#adjust').click();
    await page.locator('#tempo').fill('1.25');
    assert.equal(await page.evaluate(() => state.tempo), 1.25);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#tempo').isVisible(), false);
    assert.equal(await page.locator('#adjust').getAttribute('aria-expanded'), 'false');
    await page.locator('#adjust').click();
    await page.locator('#query').click();
    assert.equal(await page.locator('#tempo').isVisible(), false);
    await page.locator('#query').blur();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => state.selected.id), 'fixture-1');
    await page.keyboard.press('b');
    for (const id of ['fixture-2', 'fixture-3', 'fixture-4']) {
      await page.locator(`[data-id="${id}"] .sample-title`).click();
      await page.locator('#add-compare').click();
    }
    assert.equal(await page.locator('.compare-slot').count(), 4);
    await fs.mkdir(path.resolve(__dirname, '../output/playwright'), { recursive: true });
    await page.screenshot({ path: 'output/playwright/ui-desktop.png' });
    await page.locator('#blind').check();
    assert.equal(await page.locator('#results').innerText().then(text => /魔王魂|効果音ラボ/.test(text)), false);
    await page.locator('#blind').uncheck();
    await page.locator('#no-credit').check();
    assert.equal(await page.locator('.sample-row').count(), 3);
    assert(!await page.locator('#results').innerText().then(text => text.includes('魔王魂')));
    await page.locator('#no-credit').uncheck();
    await page.evaluate(() => { state.audioLoads.clear(); state.prepared.clear(); window.fixturePrepareFails = true; });
    await page.locator('[data-id="fixture-5"] .sample-title').hover();
    await page.waitForFunction(() => state.audioLoads.size === 0 && state.prepared.size === 0);
    assert.equal(await page.locator('#toast').isVisible(), false);
    await page.evaluate(() => { window.fixturePrepareFails = false; });
    await page.locator('[data-id="fixture-5"] .sample-title').click();
    await page.locator('#save').click();
    await page.waitForFunction(() => window.fixtureSaved === 'fixture-5');
    await page.locator('#open-settings').click();
    await page.locator('#check-update').click();
    await page.locator('#download-update').waitFor({ state: 'visible' });
    await page.locator('#download-update').click();
    await page.waitForFunction(() => document.querySelector('#update-message').textContent.includes('次回起動時'));
    assert.equal(await page.locator('#install-update').count(), 0);
    assert.equal(await page.locator('#freesound-key').isVisible(), false);
    await page.locator('.api-settings > summary').click();
    assert.equal(await page.locator('#freesound-key').isVisible(), true);
    await page.locator('.shortcut-settings > summary').click();
    assert.equal(await page.locator('.shortcut-settings dl').isVisible(), true);
    await page.locator('#close-settings').click();
    await page.evaluate(() => {
      const train = { ...state.known.get('fixture-0'), id: 'fixture-train', title: 'Train rhythm', description: '', kind: 'ループ' };
      state.known.set(train.id, train);
      state.favoriteIds = new Set(['fixture-0', 'fixture-2', train.id]);
      state.history = ['fixture-2', train.id, 'fixture-0'];
      state.usedIds = new Set(['fixture-0', train.id]);
    });
    await page.locator('#query').fill('雨');
    await page.locator('[data-view="favorites"]').click();
    await page.waitForFunction(() => !state.busy);
    assert.deepEqual(await page.locator('.sample-row').evaluateAll(rows => rows.map(row => row.dataset.id)), ['fixture-0', 'fixture-2']);
    assert.deepEqual(await page.evaluate(() => window.fixtureSearches.at(-1)), []);
    await page.locator('#query').fill('ｒａｉｎ'); await page.locator('#query').press('Enter');
    await page.waitForFunction(() => !state.busy);
    assert.equal(await page.locator('.sample-row').count(), 2);
    await page.locator('[data-site="soundeffect-lab"]').uncheck();
    assert.equal(await page.locator('.sample-row').count(), 0);
    await page.locator('[data-site="soundeffect-lab"]').check();
    await page.locator('[data-view="history"]').click();
    assert.deepEqual(await page.locator('.sample-row').evaluateAll(rows => rows.map(row => row.dataset.id)), ['fixture-2', 'fixture-0']);
    await page.locator('[data-view="used"]').click();
    assert.deepEqual(await page.locator('.sample-row').evaluateAll(rows => rows.map(row => row.dataset.id)), ['fixture-0']);
    await page.locator('#query').fill(''); await page.locator('#query').press('Enter');
    assert.equal(await page.locator('.sample-row').count(), 2);
    await page.locator('#query').fill('雨');
    await page.locator('[data-view="all"]').click();
    await page.waitForFunction(() => !state.busy && document.querySelectorAll('.sample-row').length === 6);
    assert((await page.evaluate(() => window.fixtureSearches.at(-1))).length > 0);
    for (const width of [920, 760, 520, 320]) {
      await page.setViewportSize({ width, height: 740 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
      await page.locator('[data-id="fixture-2"] .sample-title').click();
      await page.locator('#close-detail').click();
      await page.locator('#adjust').click();
      const bounds = await page.locator('#playback-settings').boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width, `playback controls overflow at ${width}`);
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => { document.querySelector('#toast').hidden = true; });
    await page.screenshot({ path: 'output/playwright/ui-320.png' });
    assert.deepEqual(errors, []);
    console.log('PASS: headless renderer: controls, keyboard selection, license filter, saved-view query/synonyms/source filters with no online requests, recent-first history, 4-slot blind tray, silent prefetch failure, save dispatch, settings and 320–1360px layout. IPC/audio/native dialogs are fixtures, not verified here.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
