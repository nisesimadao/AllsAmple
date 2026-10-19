const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-streaming-'));
  // A test-only, self-generated MP3; ffmpeg is never used by the application.
  const fixture = path.join(dir, 'tone.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30', '-c:a', 'libmp3lame', '-b:a', '192k', fixture]);
  const bytes = await fs.readFile(fixture), env = { ...process.env, ALLSAMPLE_DATA_DIR: path.join(dir, 'data') }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page; const errors = [];
  try {
    app = await electron.launch({ env, ...(process.argv[2] ? { executablePath: path.resolve(process.argv[2]), args: [] } : { args: [path.join(__dirname, '..')] }) });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => state.ready);
    await app.evaluate((_, { bytes }) => {
      const original = globalThis.fetch, audio = Buffer.from(bytes);
      globalThis.__streamCalls = 0; globalThis.__streamFinished = false;
      const gate = new Promise(resolve => { globalThis.__releaseStream = resolve; });
      globalThis.fetch = async (url, options) => {
        const parsed = new URL(url);
        if (parsed.hostname === 'freesound.org' && parsed.pathname === '/search/' && parsed.searchParams.get('q') === 'streaming_verification') {
          return new Response('<div class="bw-search__result"><div class="bw-player" data-sound-id="999999" data-title="Streaming test" data-username="test" data-duration="30" data-mp3="https://cdn.freesound.org/previews/999/999999_1-lq.mp3"></div><a href="/people/test/sounds/999999/">test</a><span title="License: Creative Commons 0"></span></div>');
        }
        if (parsed.pathname === '/people/test/sounds/999999/') return new Response('<div class="bw-player" data-sound-id="999999"></div><div data-static-file-url="https://cdn.freesound.org/previews/999/999999_1-hq.mp3"></div>');
        if (parsed.hostname === 'cdn.freesound.org' && parsed.pathname.includes('999999_1-')) {
          globalThis.__streamCalls++; let sent = false;
          return new Response(new ReadableStream({ async pull(controller) {
            if (!sent) { sent = true; controller.enqueue(audio.subarray(0, 128 * 1024)); return; }
            await gate; controller.enqueue(audio.subarray(128 * 1024)); controller.close(); globalThis.__streamFinished = true;
          } }), { headers: { 'content-type': 'audio/mpeg', 'content-length': String(audio.length) } });
        }
        return original(url, options);
      };
    }, { bytes: [...bytes] });
    await page.evaluate(() => { document.querySelectorAll('[data-site]').forEach(input => { input.checked = input.dataset.site === 'freesound'; }); document.querySelector('#query').value = 'streaming_verification'; document.querySelector('#search-form').requestSubmit(); });
    const row = page.locator('.sample-row[data-id^="freesound-"]'); await row.waitFor();
    await row.locator('[data-play]').click();
    await page.waitForFunction(() => state.playing && !audio.paused && audio.currentTime > .3, undefined, { timeout: 15000 });
    await page.waitForFunction(() => {
      const analyser = audioGraph.analyser; if (!analyser) return false;
      const bins = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(bins);
      let peak = 1; for (let i = 2; i < bins.length; i++) if (bins[i] > bins[peak]) peak = i;
      return bins[peak] > -50 && Math.abs(peak * audioGraph.context.sampleRate / analyser.fftSize - 440) < 12;
    });
    assert.equal(await app.evaluate(() => globalThis.__streamFinished), false);
    assert.equal(await page.evaluate(() => state.info.size), 0);
    console.log('PASS: native Electron produces 440 Hz audio while the remaining network response is deliberately held; waveform decoding does not block it');
    const saved = path.join(dir, 'saved.mp3'); await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, saved);
    await page.evaluate(() => { window.__savedStream = false; window.__savePromise = api.save(state.selected.id).then(() => { window.__savedStream = true; }); });
    assert.equal(await page.evaluate(() => window.__savedStream), false);
    assert.equal(await fs.stat(saved).catch(() => null), null);
    await app.evaluate(() => globalThis.__releaseStream());
    await page.evaluate(() => window.__savePromise);
    await page.waitForFunction(() => state.info.size === 1);
    assert.deepEqual(await fs.readFile(saved), bytes);
    assert.equal(await app.evaluate(() => globalThis.__streamCalls), 1);
    const range = await page.evaluate(async () => { const response = await fetch(`allsample://app/audio/${state.selected.id}`, { headers: { Range: 'bytes=100-199' } }); return { status: response.status, bytes: [...new Uint8Array(await response.arrayBuffer())] }; });
    assert.equal(range.status, 206); assert.deepEqual(Buffer.from(range.bytes), bytes.subarray(100, 200));
    assert.deepEqual(errors, []);
    console.log('PASS: save waits for the complete unchanged MP3; playback, waveform and export share one download; completed cache supports byte seeking');
  } finally {
    if (app) { await app.evaluate(() => globalThis.__releaseStream?.()).catch(() => {}); await app.close(); }
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
