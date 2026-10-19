const { load } = require('cheerio');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const ORIGIN = 'https://soundeffect-lab.info';
const license = Object.freeze({ category: 'green', commercial: true, attribution: false, redistribution: false, contentId: false, adult: false, modification: true, credit: '効果音ラボ https://soundeffect-lab.info/', termsUrl: `${ORIGIN}/agreement/` });
function parsePage(html, pageUrl) {
  const $ = load(html); const rows = [];
  $('li').each((_, element) => {
    const row = $(element); const anchor = row.find('a[download][href]').first();
    if (!anchor.length) return;
    const audio = new URL(anchor.attr('href'), pageUrl);
    if (audio.origin !== ORIGIN || !/\.mp3$/i.test(audio.pathname)) return;
    const title = row.find('span').first().text().trim(); if (!title) return;
    const description = row.clone().find('span, a, button').remove().end().text().trim();
    const category = new URL(pageUrl).pathname.split('/')[2];
    rows.push({ id: `lab-${createHash('sha256').update(audio.href).digest('hex').slice(0, 20)}`, site: 'soundeffect-lab', siteName: '効果音ラボ', title, description, kind: category === 'environment' ? 'アンビエンス' : category === 'voice' ? 'ボイス' : '効果音', duration: null, bpm: null, key: null, loop: null, channels: null, price: 'free', pageUrl, audioUrl: audio.href, format: 'MP3', isPreview: false, license });
  });
  return rows;
}
const { expandQuery } = require('../../shared/query.js');
function matches(sample, query) {
  const tokens = expandQuery(query); if (!tokens.length) return true;
  const haystack = `${sample.title} ${sample.description} ${decodeURI(sample.audioUrl)}`.toLowerCase();
  return tokens.some(token => /^[a-z]+$/.test(token) ? new RegExp(`(?:^|[^a-z])${token}(?:[^a-z]|$)`).test(haystack) : haystack.includes(token));
}
class SoundEffectLab {
  id = 'soundeffect-lab'; name = '効果音ラボ';
  constructor(network, dataDir) { this.network = network; this.dataDir = dataDir; this.catalog = new Map(); this.loaded = new Set(); }
  async restore() {
    try { const data = JSON.parse(await fs.readFile(path.join(this.dataDir, 'lab-index.json'), 'utf8')); if (Date.now() - data.updated < 86400000) { for (const item of data.items) this.catalog.set(item.id, { ...item, license }); for (const page of data.pages) this.loaded.add(page); } } catch { /* A missing or stale index is rebuilt from the source. */ }
  }
  async *search(query, { signal } = {}) {
    // NOTE: HTML contains the site's own download MP3, not a lower-quality preview.
    // No audio is bundled. The index is cached for a day to avoid repeated page crawls.
    const seen = new Set();
    for (const sample of this.catalog.values()) if (matches(sample, query)) { seen.add(sample.id); yield sample; }
    this.sitemapPromise ||= this.network.request(`${ORIGIN}/sitemap.xml`).catch(error => { this.sitemapPromise = null; throw error; });
    const sitemap = await this.sitemapPromise;
    const $ = load(sitemap.toString(), { xmlMode: true });
    const pages = $('loc').map((_, e) => $(e).text()).get().filter(url => url.startsWith(`${ORIGIN}/sound/`));
    pages.sort((a, b) => Number(!a.includes('/environment/')) - Number(!b.includes('/environment/')));
    let failures = 0;
    for (const page of pages) {
      if (signal?.aborted) return;
      if (this.loaded.has(page)) continue;
      try {
        const body = await this.network.request(page, { signal });
        for (const sample of parsePage(body.toString(), page)) { this.catalog.set(sample.id, sample); if (!seen.has(sample.id) && matches(sample, query)) { seen.add(sample.id); yield sample; } }
        this.loaded.add(page);
      } catch { failures++; }
    }
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(path.join(this.dataDir, 'lab-index.json'), JSON.stringify({ updated: Date.now(), pages: [...this.loaded], items: [...this.catalog.values()] }));
    if (failures) throw new Error(`${failures}ページを取得できませんでした。取得済みの結果を表示しています。`);
  }
}
module.exports = { SoundEffectLab, parsePage, expandQuery, matches, license };
