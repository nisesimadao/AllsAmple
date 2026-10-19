// Live DOVA pages/audio + real renderer in headless Chromium. No Electron windows.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { Readable } = require('node:stream');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Dova } = require('../src/main/providers/dova.cjs');
const { AudioCache } = require('../src/main/library.cjs');
const { DragFiles } = require('../src/main/drag-files.cjs');
(async () => {
  await fs.mkdir('output/research/dova', { recursive: true });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-dova-live-')), root = path.resolve(__dirname, '../src/renderer');
  const provider = new Dova(), start = performance.now(), rows = []; let firstMs;
  for await (const sample of provider.search('雨')) { firstMs ??= Math.round(performance.now() - start); rows.push(sample); }
  assert(rows.some(row => row.remoteType === 'bgm')); assert(rows.some(row => row.remoteType === 'se'));
  const initial = JSON.parse(JSON.stringify(rows)), samples = new Map(rows.map(sample => [sample.id, sample]));
  const cache = new AudioCache({ request: (_, options) => provider.download(options.sample, options), promote: (sample, priority) => provider.promote(sample, priority) }, path.join(dir, 'audio'));
  const dragFiles = new DragFiles({ acquire: (sample, options) => cache.acquire(sample, options), folder: () => path.join(dir, 'Downloads', 'DOVA-SYNDROME') });
  const drops = [], errors = [], measured = [];
  const soundtouch = path.dirname(require.resolve('@soundtouchjs/audio-worklet'));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'), [, action, id] = url.pathname.split('/'), sample = samples.get(id);
      if (sample && action === 'prepare') { await cache.prepare(sample, { priority: url.searchParams.get('intent') === 'prefetch' ? 0 : 100 }); res.end(); return; }
      if (sample && action === 'drag') { await dragFiles.prepare(sample); res.end(); return; }
      if (sample && action === 'drop') { dragFiles.start(sample, item => drops.push(item), 'fixture-native-icon'); res.end(); return; }
      if (sample && action === 'metadata') {
        const { parseFile } = await import('music-metadata'), lease = await cache.acquire(sample);
        try { const { format } = await parseFile(lease.file, { skipCovers: true, duration: true }); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...sample, duration: format.duration, channels: format.numberOfChannels, sampleRate: format.sampleRate })); }
        finally { lease.release(); } return;
      }
      if (sample && action === 'audio') {
        const response = await cache.response(sample, req.headers.range, { complete: url.searchParams.has('waveform') });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        const stream = Readable.fromWeb(response.body); res.on('close', () => stream.destroy()); stream.on('error', () => res.destroy()); stream.pipe(res); return;
      }
      const file = url.pathname.startsWith('/soundtouch/') ? path.join(soundtouch, path.basename(url.pathname)) : url.pathname === '/query.js' ? path.resolve(root, '../shared/query.js') : path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
      const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(await fs.readFile(file));
    } catch (error) { if (res.headersSent) res.destroy(error); else { res.writeHead(500); res.end(error.message); } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1360, height: 880 } });
    await context.addInitScript(({ rows }) => {
      let receive;
      const call = async url => { const response = await fetch(url); if (!response.ok) throw new Error(await response.text()); return response; };
      window.allsample = {
        bootstrap: async () => ({ samples: [], folders: [], ui: null }), saveState: async () => {}, cachePins: async () => {}, onError() {}, onCacheEvicted() {}, onUpdate() {}, onSearch(callback) { receive = callback; },
        search: async ({ requestId }) => { for (const sample of rows) receive({ requestId, sample }); receive({ requestId, done: true }); },
        prepare: async (id, intent) => { await call(`/prepare/${id}?intent=${intent || ''}`); return location.origin + `/audio/${id}`; },
        metadata: async id => (await call(`/metadata/${id}`)).json(), prepareDrag: async id => { await call(`/drag/${id}`); return true; }, startDrag: id => { void call(`/drop/${id}`); },
        apiKeyStatus: async () => ({}), cacheStats: async () => ({ maxBytes: 2147483648 }), updateStatus: async () => ({ phase: 'idle', version: '2.0.0', enabled: true })
      };
    }, { rows: initial });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/index.html'); await page.waitForFunction(() => state.ready && !state.busy);
    assert.equal(await page.locator('[data-site=dova]').count(), 1);
    await page.evaluate(() => { document.querySelectorAll('[data-site]').forEach(input => { input.checked = input.dataset.site === 'dova'; }); document.querySelector('#query').value = '雨'; renderResults(); });
    for (const type of ['bgm', 'se']) {
      const sample = rows.filter(sample => sample.remoteType === type)[1] || rows.find(sample => sample.remoteType === type);
      const row = page.locator(`[data-id="${sample.id}"]`); const began = performance.now();
      await row.locator('[data-play]').click();
      await page.waitForFunction(id => state.playing === id && !state.pendingPlay && !audio.paused && audio.currentTime > .05, sample.id, { timeout: 30000 });
      const firstAudioMs = Math.round(performance.now() - began);
      await page.waitForFunction(id => state.info.has(id), sample.id, { timeout: 30000 });
      const shown = await page.evaluate(id => ({ sample: state.known.get(id), footer: document.querySelector('#player-source').textContent, detail: document.querySelector('.file-note').textContent }), sample.id);
      assert.equal(shown.sample.isPreview, sample.isPreview); assert.equal(shown.sample.license.category, sample.license.category);
      assert.equal(await row.locator('.license-badge').getAttribute('class'), `license-badge ${sample.license.category}`);
      assert.equal(shown.footer.includes('試聴用'), sample.isPreview);
      if (!sample.isPreview) assert(shown.detail.includes('配布元のMP3'));
      await page.evaluate(id => warmDrag(sampleById(id)), sample.id);
      await row.locator('.sample-title').dispatchEvent('dragstart');
      await page.waitForFunction(() => !state.auditioning);
      const deadline = Date.now() + 3000; while (drops.length < measured.length + 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      const dropped = drops.at(-1), file = await cache.get(sample); assert(dropped?.file);
      const original = await fs.readFile(file); assert.deepEqual(await fs.readFile(dropped.file), original);
      measured.push({ type, title: sample.title, pageUrl: sample.pageUrl, bytes: original.length, sha256: createHash('sha256').update(original).digest('hex'), originalDownload: !sample.isPreview, license: sample.license.category, firstAudioMs, playbackAndWaveformMs: Math.round(performance.now() - began), rendererWaveform: true, unchangedExport: true });
    }
    await page.screenshot({ path: 'output/research/dova/renderer.png' });
    await page.setViewportSize({ width: 320, height: 740 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    const report = { verifiedAt: new Date().toISOString(), query: '雨', count: rows.length, firstResultMs: firstMs, measured, windowsOpened: false, nativeOSDrop: 'not tested; real file preparation/export verified with a captured startDrag call', ipc: 'test bridge; production renderer, provider, cache and export code', errors };
    await fs.writeFile('output/research/dova/verification.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await Promise.all([...cache.pending.values()].map(entry => entry.ticket.promise.catch(() => {}))); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
