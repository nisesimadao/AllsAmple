const { PriorityQueue } = require('../priority-queue.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { expandQuery } = require('./soundeffect-lab.cjs');
const CONFIG = {
  samplefocus: { name: 'SampleFocus', host: 'samplefocus.com', url: 'https://samplefocus.com/samples', parameter: 'search', selector: '.sample-card', terms: 'https://samplefocus.com/license' },
  landr: { name: 'LANDR', host: 'samples.landr.com', url: 'https://samples.landr.com/browse', parameter: 'textsearch', selector: '[data-isdownloaded]', terms: 'https://www.landr.com/terms-of-service' },
  splice: { name: 'Splice', host: 'splice.com', url: 'https://splice.com/sounds/search/samples', parameter: 'filepath', selector: '[data-qa="sampleAssetRow"]', terms: 'https://splice.com/terms' },
  noiiz: { name: 'Noiiz', host: 'www.noiiz.com', url: 'https://www.noiiz.com/sounds/samples', parameter: 'q', selector: '.nz-table tbody > tr', terms: 'https://www.noiiz.com/terms-and-conditions' }
};
function searchUrl(site, query) {
  const config = CONFIG[site]; const terms = expandQuery(query);
  const english = terms.find(term => /^[\x00-\x7f]+$/.test(term)) || query;
  const url = new URL(config.url); if (english.trim()) url.searchParams.set(config.parameter, english.trim()); return url.href;
}
function licenseFor(site) {
  if (site === 'samplefocus') return { category: 'green', commercial: true, attribution: false, redistribution: false, contentId: null, adult: null, modification: true, credit: 'SampleFocus https://samplefocus.com/', termsUrl: CONFIG[site].terms, note: 'Standard License。素材単体の再配布・独占権の主張は不可。取得するファイルは試聴用MP3です。' };
  return { category: 'gray', commercial: site === 'splice' ? false : null, attribution: null, redistribution: false, contentId: null, adult: null, modification: site === 'splice' ? false : null, credit: `${CONFIG[site].name}（試聴用。制作利用のライセンスは別途確認）`, termsUrl: CONFIG[site].terms, note: site === 'splice' ? 'このファイルは試聴専用です。プレビューに商用利用の許諾はありません。制作にはサイトで正規のライセンスを取得してください。' : 'このファイルは試聴用MP3です。保存しても元音源の利用ライセンスは取得されません。制作利用にはサイトで条件を確認してください。' };
}
function normalize(site, row, originUrl) {
  const description = row.description || '';
  const kind = row.loop === true ? 'ループ' : /vocal|voice/i.test(description) ? 'ボイス' : /ambien|environment/i.test(description) ? 'アンビエンス' : row.loop === false ? 'ワンショット' : '効果音';
  return { id: `${site}-${createHash('sha256').update(row.remoteId).digest('hex').slice(0, 20)}`, site, siteName: CONFIG[site].name, title: row.title, description, kind, duration: row.duration, bpm: row.bpm, key: row.key, loop: row.loop, channels: null, price: site === 'samplefocus' ? 'free' : 'paid', pageUrl: row.pageUrl, audioUrl: null, format: 'MP3', isPreview: true, remoteId: row.remoteId, searchUrl: originUrl, license: licenseFor(site) };
}
function validMedia(site, value) {
  try {
    const url = new URL(value); if (url.protocol !== 'https:' || !/\.mp3$/i.test(url.pathname)) return false;
    if (site === 'samplefocus') return url.hostname.endsWith('.cloudfront.net') || url.hostname === 'samplefocus.com';
    if (site === 'landr') return url.hostname === 'assets.landr.com' && url.pathname.startsWith('/samples/secure/streams/');
    if (site === 'splice') return /^(spliceproduction\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com|spliceblob\.splice\.com)$/.test(url.hostname);
    return site === 'noiiz' && url.hostname.endsWith('.cloudfront.net');
  } catch { return false; }
}
class BrowserCatalog {
  catalog = new Map(); worker = null; queue = new PriorityQueue({ concurrency: 1, backgroundConcurrency: 1 }); downloads = new Map(); queryCache = new Map();
  constructor(id, automation) { this.id = id; this.config = CONFIG[id]; this.name = this.config.name; this.automation = automation; }
  async restore() {}
  async page() {
    if (!this.worker || this.worker.window.isDestroyed()) {
      this.worker = await this.automation.create(this.id, this.config.host);
      const hook = await fs.readFile(path.join(__dirname, '../../../vendor/sampletap/hook.js'), 'utf8');
      const bridge = await fs.readFile(path.join(__dirname, '../automation/catalog-page.js'), 'utf8');
      await this.worker.page.addInitScript({ content: `if (location.hostname === ${JSON.stringify(this.config.host)}) {\n${hook}\n${bridge}\n}` });
    }
    return this.worker.page;
  }
  async navigate(url) {
    const page = await this.page();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    try { await page.waitForFunction(() => window.__allsampleCatalog?.rows().length > 0, undefined, { timeout: 20000 }); }
    catch { const title = await page.title(); const text = (await page.locator('body').innerText()).slice(0, 3000); if (/no (?:results|samples|sounds)|0 results/i.test(text)) return page; throw new Error(/just a moment|verify|captcha/i.test(title + text) ? 'サイトの確認画面が表示されています。時間を置いて再検索してください。' : '検索結果を取得できませんでした'); }
    return page;
  }
  async *search(query, { signal } = {}) {
    const url = searchUrl(this.id, query); const seen = new Set(); const found = [];
    const cached = this.queryCache.get(url);
    if (cached && Date.now() - cached.time < 60000) { for (const sample of cached.items) { if (signal?.aborted) return; yield sample; } return; }
    for (let batch = 0; batch < 3; batch++) {
      if (signal?.aborted) return;
      // Yield the browser between result batches, so requested audio gets the next turn.
      const rows = await this.queue.submit(async () => {
        if (signal?.aborted) return [];
        let page = await this.page();
        if (page.url() !== url) page = await this.navigate(url);
        if (batch > 0) {
          await page.locator(this.config.selector).last().scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
          await page.mouse.wheel(0, 1100);
          await page.waitForFunction(ids => window.__allsampleCatalog?.rows().some(row => !ids.includes(row.remoteId)), [...seen], { timeout: 350 }).catch(() => {});
        }
        return page.evaluate(() => window.__allsampleCatalog?.rows() || []);
      }, { priority: 0, signal }).promise;
      let added = 0;
      for (const row of rows) { if (seen.has(row.remoteId)) continue; const sample = normalize(this.id, row, url); seen.add(row.remoteId); this.catalog.set(sample.id, sample); found.push(sample); added++; yield sample; }
      if (!rows.length || (batch > 0 && !added) || seen.size >= 100) break;
    }
    if (!signal?.aborted) { this.queryCache.set(url, { time: Date.now(), items: found }); if (this.queryCache.size > 20) this.queryCache.delete(this.queryCache.keys().next().value); }
  }
  promote(sample, priority) { this.downloads.get(sample.id)?.promote(priority); }
  async download(sample, { priority = 100 } = {}) {
    const ticket = this.queue.submit(async () => {
      let page = await this.page();
      let present = await page.evaluate(id => Boolean(window.__allsampleCatalog?.rows().some(row => row.remoteId === id)), sample.remoteId);
      if (!present) { page = await this.navigate(sample.searchUrl); present = await page.evaluate(id => window.__allsampleCatalog.rows().some(row => row.remoteId === id), sample.remoteId); }
      if (!present) { page = await this.navigate(sample.pageUrl); }
      const row = page.locator(`[data-allsample-key="${sample.remoteId}"]`);
      if (await row.count()) { await row.first().scrollIntoViewIfNeeded(); await row.first().hover(); }
      // LANDR initializes its per-row player lazily when hovered. Wait for that exact
      // row's button, then let the original GUID-matching hook request its signed URL.
      if (this.id === 'landr') await row.locator('button[aria-label="Play"]').waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});
      for (let attempt = 0; attempt < 2; attempt++) {
        const resolved = await page.evaluate(id => window.__allsampleCatalog.resolve(id), sample.remoteId);
        if (resolved && validMedia(this.id, resolved.url)) {
          try { const encoded = await page.evaluate(url => window.__allsampleCatalog.download(url), resolved.url); sample.audioUrl = resolved.url; return Buffer.from(encoded, 'base64'); }
          catch (error) { if (attempt) throw error; }
        }
        // Refresh the page's own signed-URL traffic; never reuse an expired signature
        // or infer MP3 URLs from waveform hashes.
        await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__allsampleCatalog?.rows().length > 0);
        const retryRow = page.locator(`[data-allsample-key="${sample.remoteId}"]`).first(); await retryRow.hover().catch(() => {});
      }
      throw new Error('この行の試聴URLを解決できませんでした。再検索してください。');
    }, { priority });
    this.downloads.set(sample.id, ticket);
    try { return await ticket.promise; } finally { if (this.downloads.get(sample.id) === ticket) this.downloads.delete(sample.id); }
  }
}
module.exports = { BrowserCatalog, CONFIG, searchUrl, licenseFor, normalize, validMedia };
