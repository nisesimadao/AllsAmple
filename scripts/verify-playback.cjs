// Real renderer + HTMLAudioElement/Web Audio in headless Chromium. No desktop windows.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { wav } = require('./audio-fixture.cjs');
const { unwrapPreview } = require('../src/main/preview-audio.cjs');
const os = require('node:os');
const { AudioCache } = require('../src/main/library.cjs');
const { SiteNetwork } = require('../src/main/network.cjs');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
(async () => {
  const root = path.resolve(__dirname, '../src/renderer'), tone = wav({ seconds: 8, frequency: 440 });
  const worklets = path.dirname(require.resolve('@soundtouchjs/audio-worklet'));
  const mp3 = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'mp3', '-b:a', '192k', 'pipe:1'], { input: tone });
  const requests = [], errors = [], reports = [];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-playback-'));
  let releaseStream, streamFinished = false;
  const held = new Promise(resolve => { releaseStream = resolve; });
  const network = new SiteNetwork({ fetcher: async () => {
    let first = true;
    return new Response(new ReadableStream({ async pull(controller) {
      if (first) { first = false; controller.enqueue(mp3.subarray(0, 64 * 1024)); return; }
      await held; controller.enqueue(mp3.subarray(64 * 1024)); controller.close(); streamFinished = true;
    } }), { headers: { 'content-type': 'audio/mpeg', 'content-length': String(mp3.length) } });
  } });
  const cache = new AudioCache(network, dir), streamSample = { id: 'maou-streaming', site: 'maou', audioUrl: 'https://maou.audio/sound/test.mp3' };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); requests.push(req.url);
    try {
      if (url.pathname === '/prepare-stream') { await cache.prepare(streamSample); res.end(); return; }
      if (url.pathname === '/audio/streaming') {
        const response = await cache.response(streamSample, req.headers.range, { complete: url.searchParams.has('waveform') });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        const body = Readable.fromWeb(response.body); res.on('close', () => body.destroy()); body.on('error', () => res.destroy()); body.pipe(res); return;
      }
      if (url.pathname.startsWith('/audio/')) {
        if (url.pathname.endsWith('/bad-wave') && url.searchParams.has('waveform')) { res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end('not audio'); return; }
        const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/), start = Number(range?.[1] || 0), end = range?.[2] ? Number(range[2]) : tone.length - 1;
        res.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${tone.length}` } : {}) }); res.end(tone.subarray(start, end + 1)); return;
      }
      if (url.pathname === '/real-splice.mp3') {
        const dir = path.join(os.homedir(), 'Library/Application Support/AllsAmple/audio');
        const files = (await fs.readdir(dir)).filter(name => name.startsWith('splice-') && name.endsWith('.mp3'));
        // Decode every cached preview without changing the user's cache or playing sound.
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(await Promise.all(files.map(async name => ({ name, bytes: [...unwrapPreview(await fs.readFile(path.join(dir, name)))] }))))); return;
      }
      const file = url.pathname.startsWith('/soundtouch/') ? path.join(worklets, path.basename(url.pathname)) : url.pathname === '/query.js' ? path.resolve(root, '../shared/query.js') : path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
      const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.prepareCalls = []; window.dragCalls = []; window.gates = new Map();
      window.hold = id => { let release, reject; const promise = new Promise((yes, no) => { release = yes; reject = no; }); window.gates.set(id, { promise, release, reject }); };
      let receive;
      const samples = ['first', 'second', 'bad-wave', 'held', 'rejected', 'streaming'].map(id => ({ id, title: id, site: 'soundeffect-lab', siteName: '効果音ラボ', format: 'WAV', kind: '効果音', duration: 8, isPreview: false, license: { category: 'green', attribution: false, commercial: true } }));
      window.allsample = {
        bootstrap: async () => ({ samples: [], folders: [], ui: null }), saveState: async () => {}, cachePins: async () => {}, onError() {}, onCacheEvicted() {}, onUpdate() {},
        onSearch(callback) { receive = callback; }, search: async ({ requestId }) => { for (const sample of samples) receive({ requestId, sample }); receive({ requestId, done: true }); },
        prepare: async (id, intent) => { window.prepareCalls.push({ id, intent }); if (id === 'streaming') await fetch('/prepare-stream'); if (window.gates.has(id)) await window.gates.get(id).promise; return location.origin + '/audio/' + id; },
        metadata: async (_, measured) => measured,
        prepareDrag: async id => { if (window.gates.has(id)) await window.gates.get(id).promise; return true; }, startDrag: id => window.dragCalls.push(id),
        apiKeyStatus: async () => ({}), cacheStats: async () => ({ maxBytes: 2147483648 }), updateStatus: async () => ({ version: '1.0.0', phase: 'idle', enabled: true })
      };
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/index.html'); await page.waitForFunction(() => state.ready && !state.busy);
    await page.locator('[data-id=first] .sample-title').hover();
    await page.waitForFunction(() => window.prepareCalls.length > 0);
    assert.equal(requests.some(url => url.includes('waveform')), false);
    assert.equal(await page.evaluate(() => audio.paused), true);
    reports.push('Hover warms audio/drag only, with no waveform fetch or playback.');

    await page.evaluate(() => { hold('held'); window.oldPlay = play(sampleById('held')); });
    assert.equal(await page.evaluate(() => state.pendingPlay), 'held');
    const before = Date.now(); await page.evaluate(() => play(sampleById('second')));
    await page.waitForFunction(() => state.playing === 'second' && !state.pendingPlay && audio.currentTime > .05);
    reports.push(`Fixture cached audio started in ${Date.now() - before} ms (local test, not a site latency claim).`);
    await page.evaluate(async () => { gates.get('held').release(); await oldPlay; });
    assert.equal(await page.evaluate(() => state.playing), 'second');
    assert.equal(await page.locator('#toast').isVisible(), false);
    assert.equal(await page.evaluate(() => audioGraph.node == null), true);

    await page.evaluate(() => { hold('rejected'); window.obsolete = action(() => play(sampleById('rejected'))); });
    await page.evaluate(() => play(sampleById('first')));
    await page.evaluate(async () => { gates.get('rejected').reject(new Error('obsolete transfer')); await obsolete; });
    assert.equal(await page.evaluate(() => state.playing === 'first' && !audio.paused), true);
    assert.equal(await page.locator('#toast').isVisible(), false);
    reports.push('A late success or failure from an old selection cannot start/stop the new audio or raise an error.');

    await page.evaluate(() => { state.audioLoads.delete('held'); hold('held'); window.cancelled = play(sampleById('held')); stop(); });
    await page.evaluate(async () => { gates.get('held').release(); await cancelled; });
    assert.equal(await page.evaluate(() => audio.paused && !state.auditioning && state.pendingPlay === null), true);
    await page.evaluate(() => play(sampleById('held'))); await page.waitForFunction(() => !audio.paused && !state.pendingPlay);
    reports.push('Stop during preparation remains stopped after completion; the next play succeeds.');

    await page.evaluate(async () => { selectSample(sampleById('bad-wave')); await play(sampleById('bad-wave')); });
    await page.waitForFunction(() => state.playing === 'bad-wave' && !audio.paused && !state.prepared.has('bad-wave'));
    assert.equal(await page.locator('#toast').isVisible(), false);
    reports.push('A waveform decode failure does not stop playable audio or display Unable to decode audio data.');

    await page.evaluate(() => { state.selected = sampleById('first'); });
    await page.evaluate(async () => { await warmDrag(sampleById('first')); });
    assert.equal(await page.locator('[data-id=first]').getAttribute('draggable'), 'true');
    await page.locator('[data-id=first] .sample-title').dispatchEvent('dragstart');
    assert.deepEqual(await page.evaluate(() => window.dragCalls), ['first']);
    assert.equal(await page.evaluate(() => audio.paused && !state.auditioning), true);
    reports.push('A row can dispatch native drag without decoded waveform metadata; drag stops audition.');

    await page.evaluate(async () => { await play(sampleById('first')); audioGraph.set(1.2, 3); await audioGraph.ensureEffects(); });
    await page.waitForFunction(() => Boolean(audioGraph.node));
    await page.evaluate(() => { audioGraph.set(1, 0); });
    assert.equal(await page.evaluate(() => audioGraph.node == null), true);
    reports.push('Pitch/tempo processing loads on demand, then returns to the direct route at normal speed.');

    await page.evaluate(() => { selectSample(sampleById('streaming')); window.streamPlay = play(sampleById('streaming')); });
    await page.waitForFunction(() => audio.currentTime > .15 && state.playing === 'streaming' && !state.pendingPlay, undefined, { timeout: 10000 });
    assert.equal(streamFinished, false); assert.equal(await page.evaluate(() => state.info.has('streaming')), false);
    let saved = false; const saving = cache.get(streamSample).then(file => { saved = true; return file; });
    assert.equal(saved, false);
    await page.evaluate(() => seekPlayback(sampleById('streaming'), .8));
    releaseStream(); await page.waitForFunction(() => audio.currentTime > 6.4 && !audio.paused && state.info.has('streaming'));
    assert.deepEqual(await fs.readFile(await saving), mp3);
    reports.push('Real cache/network pipeline starts MP3 audio while its tail is held; seek into the unfetched tail recovers, waveform/save wait for complete identical bytes.');

    if (process.argv.includes('--cached-splice')) {
      const decoded = await page.evaluate(async () => {
        stop(); const packets = await (await fetch('/real-splice.mp3')).json(); const results = [];
        const context = new AudioContext();
        try { for (const packet of packets) { const decoded = await context.decodeAudioData(new Uint8Array(packet.bytes).buffer); results.push({ name: packet.name, duration: decoded.duration }); } }
        finally { await context.close(); }
        return results;
      });
      assert(decoded.length > 0); reports.push(`${decoded.length} real previously cached Splice previews decoded successfully; no user cache changed.`);
    }
    assert.deepEqual(errors, []);
    await fs.mkdir(path.resolve(__dirname, '../output/research'), { recursive: true });
    await fs.writeFile(path.resolve(__dirname, '../output/research/playback-verification.json'), JSON.stringify({ reports, errors, windowsOpened: false }, null, 2));
    for (const report of reports) console.log('PASS:', report);
  } finally { releaseStream(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
