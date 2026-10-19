// Render real UI with observed public metadata and decoded source audio.
// No Electron window, playback or native dialog. Only PNGs and metadata are kept.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { SiteNetwork } = require('../src/main/network.cjs');
const { parsePage, matches } = require('../src/main/providers/soundeffect-lab.cjs');
const { parseMaou } = require('../src/main/providers/maou.cjs');
const { parseOnjin } = require('../src/main/providers/onjin.cjs');

(async () => {
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'docs/assets');
  await fs.mkdir(output, { recursive: true });
  const network = new SiteNetwork();
  const sources = [
    { url: 'https://soundeffect-lab.info/sound/environment/', parse: parsePage },
    { url: 'https://maou.audio/?s=%E9%9B%A8', parse: parseMaou },
    { url: 'https://on-jin.com/sound/kan.php', parse: parseOnjin }
  ];
  const groups = await Promise.all(sources.map(async source => {
    const html = await network.request(source.url);
    return source.parse(html.toString(), source.url).filter(sample => matches(sample, '雨') || sample.site === 'maou').slice(0, 4);
  }));
  if (groups.some(group => !group.length)) throw new Error('A live source returned no documentation examples');
  const samples = [];
  for (let index = 0; index < 4; index++) for (const group of groups) if (group[index]) samples.push(group[index]);
  const recordings = new Map();
  for (const sample of samples) {
    const bytes = await network.request(sample.audioUrl, { audio: true, pageUrl: sample.pageUrl });
    recordings.set(sample.id, bytes.toString('base64'));
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://allsample-docs.test') return route.abort();
      const base = path.join(root, 'src/renderer');
      const file = url.pathname === '/query.js' ? path.join(root, 'src/shared/query.js') : path.resolve(base, '.' + url.pathname);
      if (url.pathname !== '/query.js' && !file.startsWith(base + path.sep)) return route.abort();
      await route.fulfill({ path: file });
    });
    await context.addInitScript(({ samples }) => {
      let receive;
      window.allsample = {
        bootstrap: async () => ({ samples: [], folders: [], ui: null }), saveState: async () => {}, cachePins: async () => {},
        onError() {}, onCacheEvicted() {}, onUpdate() {}, onSearch(callback) { receive = callback; },
        search: async ({ requestId }) => { for (const sample of samples) receive({ requestId, sample }); receive({ requestId, done: true }); },
        prepare: () => new Promise(() => {}),
        apiKeyStatus: async () => ({ configured: false, saved: false, canPersist: true }),
        cacheStats: async () => ({ bytes: 0, maxBytes: 2147483648, files: 0, inUse: 0 }),
        updateStatus: async () => ({ version: '1.0.0', phase: 'idle', enabled: true, nextVersion: null, message: '' })
      };
    }, { samples });
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://allsample-docs.test/index.html'); await page.waitForFunction(() => state.ready && !state.busy);
    const measured = await page.evaluate(async recordings => {
      const context = new AudioContext(), summary = [];
      for (const [id, encoded] of recordings) {
        const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
        const buffer = await context.decodeAudioData(bytes.buffer), peaks = [];
        for (let bin = 0; bin < 240; bin++) {
          let max = 0; const start = Math.floor(bin * buffer.length / 240), end = Math.floor((bin + 1) * buffer.length / 240);
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) { const data = buffer.getChannelData(channel); for (let i = start; i < end; i += Math.max(1, Math.floor((end - start) / 200))) max = Math.max(max, Math.abs(data[i])); }
          peaks.push(max);
        }
        const peak = Math.max(...peaks, .001), sample = state.known.get(id);
        Object.assign(sample, { duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
        state.info.set(id, { duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate, peaks: peaks.map(value => value / peak) });
        summary.push({ id, duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
      }
      await context.close();
      document.querySelector('#results').replaceChildren(); renderResults();
      return summary;
    }, [...recordings]);
    await page.locator('.sample-row .sample-title').first().click();
    await page.screenshot({ path: path.join(output, 'search.png') });
    for (const sample of samples.slice(0, 4)) { await page.locator(`[data-id="${sample.id}"] .sample-title`).click(); await page.locator('#add-compare').click(); }
    await page.locator('#detail').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: path.join(output, 'compare.png') });
    const attributed = samples.find(sample => sample.site === 'maou');
    await page.locator(`[data-id="${attributed.id}"] .sample-title`).click();
    await page.locator('#detail').screenshot({ path: path.join(output, 'license.png') });
    await page.locator('#open-settings').click();
    await page.locator('#app-version').filter({ hasText: '1.0.0' }).waitFor();
    await page.locator('#settings').screenshot({ path: path.join(output, 'modules.png') });
    await page.locator('#close-settings').click();
    await page.setViewportSize({ width: 320, height: 740 }); await page.locator('#close-detail').click();
    await page.screenshot({ path: path.join(output, 'compact.png') });
    if (errors.length) throw new Error(errors.join('\n'));
    await fs.writeFile(path.join(output, 'screenshots.json'), JSON.stringify({ capturedAt: new Date().toISOString(), renderer: 'src/renderer/index.html', mode: 'headless Chromium; IPC stubbed, no playback', query: '雨', metadata: 'observed source HTML', waveforms: 'decoded actual source audio; no synthetic waveform', sources: samples.map(({ id, site, title, pageUrl, audioUrl, format }) => ({ id, site, title, pageUrl, audioUrl, format })), measured, bundledAudio: false }, null, 2) + '\n');
    console.log(`Captured actual UI with ${samples.length} live samples. PNGs and provenance only; no audio files written.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
