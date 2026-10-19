const { load } = require('cheerio');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { matches } = require('./soundeffect-lab.cjs');
const license = { category: 'orange', commercial: null, attribution: null, redistribution: false, contentId: null, adult: null, modification: true, credit: '効果音：On-Jin ～音人～ https://on-jin.com/', termsUrl: 'https://on-jin.com/kiyaku.php', note: '個人・サークルは無料。営利事業・プロ活動は利用連絡が必要。音源が露出する配布形式ではクレジット必須。' };
function parseOnjin(html, pageUrl) {
  const $ = load(html); const items = [];
  $('.selistwida').each((_, element) => {
    const row = $(element); const anchor = row.find('a[download][href$=".mp3"]').first(); if (!anchor.length) return;
    const audioUrl = new URL(anchor.attr('href'), pageUrl).href;
    if (new URL(audioUrl).origin !== 'https://on-jin.com') return;
    const title = anchor.attr('download').replace(/\.mp3$/i, '');
    const detail = row.find('a[href^="listshow.php"]').first().attr('href');
    const description = row.find('.selist').text().replace(/備考\s*[・…]+\s*/, '').trim();
    items.push({ id: `onjin-${createHash('sha256').update(audioUrl).digest('hex').slice(0, 20)}`, site: 'onjin', siteName: 'On-Jin ～音人～', title, description, kind: pageUrl.includes('kan.php') ? 'アンビエンス' : pageUrl.includes('muci.php') ? 'ジングル' : '効果音', duration: null, bpm: null, key: null, loop: description.includes('ループ') ? true : null, channels: null, price: 'free', pageUrl: detail ? new URL(detail, pageUrl).href : pageUrl, audioUrl, format: 'MP3', isPreview: false, license });
  });
  return items;
}
class Onjin {
  id = 'onjin'; name = 'On-Jin ～音人～'; catalog = new Map(); loaded = new Set();
  constructor(network, dataDir) { this.network = network; this.dataDir = dataDir; }
  async restore() { try { const data = JSON.parse(await fs.readFile(path.join(this.dataDir, 'onjin-index.json'), 'utf8')); if (Date.now() - data.updated < 86400000) { for (const item of data.items) this.catalog.set(item.id, { ...item, license }); for (const page of data.pages) this.loaded.add(page); } } catch {} }
  promote(sample, priority) { this.network.promote?.(sample, priority); }
  async download(sample, options = {}) {
    try { return await this.network.request(sample.audioUrl, { ...options, audio: true, pageUrl: sample.pageUrl, sample }); }
    catch (error) {
      // On-Jin rotates the directory embedded in download links. A persisted
      // catalog must resolve a fresh, observed link instead of replaying a 404.
      if (!/HTTP (?:403|404|410)/.test(error.message)) throw error;
      const detail = new URL(sample.pageUrl);
      const category = detail.searchParams.get('pagename');
      if (detail.origin !== 'https://on-jin.com' || !['kan', 'sei', 'hito', 'meka', 'ani', 'nori', 'sen', 'spo', 'ta', 'muci'].includes(category)) throw error;
      const page = `https://on-jin.com/sound/${category}.php`;
      const html = (await this.network.request(page, { priority: options.priority ?? 100 })).toString();
      const filename = new URL(sample.audioUrl).pathname.split('/').pop();
      const fresh = parseOnjin(html, page).find(row => row.title === sample.title && row.pageUrl === sample.pageUrl && new URL(row.audioUrl).pathname.split('/').pop() === filename);
      if (!fresh || fresh.audioUrl === sample.audioUrl) throw error;
      sample.audioUrl = fresh.audioUrl;
      return this.network.request(sample.audioUrl, { ...options, audio: true, pageUrl: page, sample });
    }
  }
  async *search(query, { signal } = {}) {
    const seen = new Set();
    for (const sample of this.catalog.values()) if (matches(sample, query)) { seen.add(sample.id); yield sample; }
    for (const slug of ['kan', 'sei', 'hito', 'meka', 'ani', 'nori', 'sen', 'spo', 'ta', 'muci']) {
      if (signal?.aborted) return;
      const page = `https://on-jin.com/sound/${slug}.php`; if (this.loaded.has(page)) continue;
      const html = (await this.network.request(page, { signal })).toString();
      const samples = parseOnjin(html, page); if (!samples.length) throw new Error('ページ構造を確認できませんでした');
      for (const sample of samples) { this.catalog.set(sample.id, sample); if (!seen.has(sample.id) && matches(sample, query)) { seen.add(sample.id); yield sample; } }
      this.loaded.add(page);
    }
    await fs.mkdir(this.dataDir, { recursive: true }); await fs.writeFile(path.join(this.dataDir, 'onjin-index.json'), JSON.stringify({ updated: Date.now(), items: [...this.catalog.values()], pages: [...this.loaded] }));
  }
}
module.exports = { Onjin, parseOnjin };
