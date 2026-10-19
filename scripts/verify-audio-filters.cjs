const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { wav } = require('./audio-fixture.cjs');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-audio-'));
  const root = path.join(dir, '調整用'); await fs.mkdir(root);
  const tonePath = path.join(root, 'rain_loop_120bpm_Am.wav'); const originalBytes = wav({ seconds: 12, frequency: 440 });
  await fs.writeFile(tonePath, originalBytes);
  await fs.writeFile(path.join(root, 'rain_loop_140bpm_Dm.wav'), wav({ seconds: 6, frequency: 880, channels: 2, sampleRate: 22050 }));
  await fs.writeFile(path.join(root, 'rain_loop_90bpm_Dbm.wav'), wav({ seconds: 2, frequency: 220, channels: 2 }));
  const env = { ...process.env, ALLSAMPLE_DATA_DIR: path.join(dir, 'data') }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ env, ...(process.argv[2] ? { executablePath: path.resolve(process.argv[2]), args: [] } : { args: [path.join(__dirname, '..')] }) });
  let app, page; const errors = [];
  async function count(number) { await page.waitForFunction(number => document.querySelectorAll('.sample-row').length === number, number); }
  async function spectrum(expected) {
    await page.waitForFunction(expected => {
      const analyser = audioGraph.analyser; if (!analyser) return false;
      const data = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(data);
      let peak = 1; for (let i = 2; i < data.length; i++) if (data[i] > data[peak]) peak = i;
      return data[peak] > -50 && Math.abs(peak * audioGraph.context.sampleRate / analyser.fftSize - expected) < 12;
    }, expected, { timeout: 15000 });
  }
  async function rate(expected) {
    const measured = await page.evaluate(async () => { const start = audio.currentTime, clock = performance.now(); await new Promise(resolve => setTimeout(resolve, 600)); return (audio.currentTime - start) / ((performance.now() - clock) / 1000); });
    assert(Math.abs(measured - expected) < .18, `expected rate ${expected}, measured ${measured}`);
  }
  try {
    app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => state.ready);
    await page.evaluate(() => { document.querySelectorAll('[data-site]').forEach(input => { input.checked = input.dataset.site === 'local'; }); });
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, root);
    await page.locator('#add-folder').click(); await count(3);
    await page.locator('#advanced summary').click();
    await page.locator('#min-bpm').fill('130'); await count(1); assert((await page.locator('.sample-title').innerText()).includes('140bpm'));
    await page.locator('#min-bpm').fill(''); await page.locator('#key').selectOption('C#m'); await count(1); assert((await page.locator('.sample-title').innerText()).includes('Dbm'));
    await page.locator('#key').selectOption(''); await page.locator('#channels').selectOption('1'); await count(1); assert((await page.locator('.sample-title').innerText()).includes('120bpm'));
    await page.locator('#channels').selectOption('');
    await page.locator('#duration-slider').focus(); await page.keyboard.press('Home'); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight'); await count(1); assert((await page.locator('.sample-title').innerText()).includes('90bpm'));
    await page.locator('#max-duration').fill('8'); await page.locator('#min-duration').fill('3'); await count(1); assert((await page.locator('.sample-title').innerText()).includes('140bpm'));
    await page.locator('#clear-filters').click(); await count(3);
    for (const id of ['redistribution', 'contentId', 'adult', 'modification']) { await page.locator(`#${id}`).check(); await count(0); await page.locator(`#${id}`).uncheck(); await count(3); }
    console.log('PASS: real WAV metadata drives BPM, enharmonic key, channel and duration filters; unknown permissions stay excluded');
    const toneId = await page.evaluate(() => state.results.find(sample => sample.bpm === 120).id);
    await page.locator(`[data-id="${toneId}"] [data-play]`).click(); await spectrum(440); await rate(1);
    await page.locator('#add-compare').click();
    const otherId = await page.evaluate(() => state.results.find(sample => sample.bpm === 140).id);
    await page.locator(`[data-id="${otherId}"]`).click(); await page.locator('#add-compare').click();
    await page.waitForFunction(() => document.querySelector('#detail-format').textContent.includes('22.05 kHz'));
    assert.notEqual(await page.evaluate(() => state.info.get(state.selected.id).sampleRate), await page.evaluate(() => audioContext.sampleRate));
    for (const [key, expected] of [['1', 440], ['2', 880], ['1', 440]]) { await page.keyboard.press(key); await spectrum(expected); }
    await page.locator('#adjust').click();
    await page.locator('#tempo').fill('1.5'); await spectrum(440); await rate(1.5);
    await page.locator('#pitch').fill('12'); await spectrum(880); await rate(1.5);
    await page.locator('#tempo').fill('0.75'); await page.locator('#pitch').fill('-12'); await spectrum(220); await rate(.75);
    console.log('PASS: output spectrum is 440Hz at 1.5×, 880Hz at +12 and 220Hz at −12; measured playback speed is independent');
    await page.locator('#player-play').click();
    await page.waitForFunction(() => { const data = new Float32Array(audioGraph.analyser.fftSize); audioGraph.analyser.getFloatTimeDomainData(data); return audio.paused && data.every(value => Math.abs(value) < .0001); });
    await page.waitForFunction(() => audioGraph.context.state === 'suspended');
    await page.locator('#player-play').click(); await spectrum(220);
    await page.locator('#reset-playback').click(); await spectrum(440);
    const canvas = page.locator('#detail-wave');
    const bounds = await canvas.boundingBox(); await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height / 2); await page.mouse.up();
    assert(await page.evaluate(() => audio.currentTime > 6.9 && audio.currentTime < 8)); await spectrum(440);
    const rowWave = page.locator(`[data-id="${toneId}"] [data-wave]`); await rowWave.scrollIntoViewIfNeeded();
    const rowBounds = await rowWave.boundingBox(); await page.mouse.move(rowBounds.x + rowBounds.width * .5, rowBounds.y + rowBounds.height / 2); await page.mouse.down(); await page.mouse.move(rowBounds.x + rowBounds.width * .25, rowBounds.y + rowBounds.height / 2); await page.mouse.up();
    assert(await page.evaluate(() => audio.currentTime > 2.8 && audio.currentTime < 3.8)); await spectrum(440);
    const saved = path.join(dir, 'saved.wav'); await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, saved);
    await page.locator('#save').click(); await page.getByRole('status').filter({ hasText: /^保存しました$/ }).waitFor(); assert.deepEqual(await fs.readFile(saved), originalBytes);
    console.log('PASS: pause mutes the actual output, resume and waveform dragging work, exports preserve original WAV bytes');
    await page.locator('#adjust').click();
    await page.locator('#tempo').fill('1.25'); await page.locator('#pitch').fill('3'); await page.locator('#min-bpm').fill('115');
    await page.locator('#workflow').selectOption('music'); await page.locator('#min-bpm').fill('135'); await page.locator('#workflow').selectOption('all');
    assert.equal(await page.locator('#min-bpm').inputValue(), '115');
    await page.evaluate(() => libraryUI.persist()); await app.close(); app = null;
    app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForFunction(() => state.ready);
    assert.equal(await page.locator('#tempo').inputValue(), '1.25'); assert.equal(await page.locator('#pitch').inputValue(), '3'); assert.equal(await page.locator('#min-bpm').inputValue(), '115');
    await page.setViewportSize({ width: 320, height: 740 });
    await page.locator('#advanced summary').click();
    await page.locator('#adjust').click(); assert.equal(await page.locator('#tempo').isVisible(), true);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await fs.mkdir(path.join(__dirname, '../output/playwright'), { recursive: true }); await page.screenshot({ path: 'output/playwright/filters-320.png' });
    console.log('PASS: per-workflow advanced filters and playback settings survive restart; 320px controls fit');
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page && !page.isClosed()) { console.log(await page.evaluate(() => ({ text: document.body.innerText.slice(-1000), graph: { ready: !!audioGraph.node, context: audioGraph.context?.state, tempo: audioGraph.tempo, pitch: audioGraph.pitch }, audio: { paused: audio.paused, time: audio.currentTime, rate: audio.playbackRate } }))); await page.screenshot({ path: 'output/playwright/audio-failure.png' }); }
    throw error;
  } finally { if (app) await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
