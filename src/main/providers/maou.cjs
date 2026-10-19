const { load } = require('cheerio');
const { createHash } = require('node:crypto');
const { expandQuery } = require('./soundeffect-lab.cjs');
const license = { category: 'yellow', commercial: true, attribution: true, redistribution: false, contentId: false, adult: true, modification: true, credit: '音楽：魔王魂 https://maou.audio/', termsUrl: 'https://maou.audio/rule/', note: '通常の素材利用規約で表示しています。CC BY 4.0を選択することもできます。ストリーミング配信・著作管理登録は不可。' };
function parseMaou(html) {
  const $ = load(html); const items = new Map();
  $('.sound').each((_, element) => {
    const row = $(element); const heading = row.find('.title h2 a').first();
    const links = row.find('a.download_btn[href]').map((_, a) => $(a).attr('href')).get();
    // Prefer the actual WAV download when offered; never synthesize an unobserved URL.
    const audioUrl = links.find(url => url.endsWith('.wav')) || links.find(url => url.endsWith('.mp3'));
    if (!audioUrl || !heading.length || new URL(audioUrl).origin !== 'https://maou.audio') return;
    const pageUrl = heading.attr('href'); if (!pageUrl?.startsWith('https://maou.audio/')) return;
    const kind = pageUrl.includes('/se_') ? '効果音' : pageUrl.includes('/jingle_') ? 'ジングル' : 'BGM';
    const id = `maou-${createHash('sha256').update(audioUrl).digest('hex').slice(0, 20)}`;
    if (!items.has(id)) items.set(id, { id, site: 'maou', siteName: '魔王魂', title: heading.text().trim(), description: row.find('.sonog-text').first().text().trim(), kind, duration: null, bpm: null, key: null, loop: null, channels: null, price: 'free', pageUrl, audioUrl, format: audioUrl.endsWith('.wav') ? 'WAV' : 'MP3', isPreview: false, license });
  });
  return [...items.values()];
}
class Maou {
  id = 'maou'; name = '魔王魂'; catalog = new Map(); queries = new Map();
  constructor(network) { this.network = network; }
  async restore() {}
  async *search(query, { signal } = {}) {
    const terms = expandQuery(query); const translated = terms.find(term => /[^\x00-\x7f]/.test(term)) || query;
    const key = translated.trim(); const cached = this.queries.get(key);
    if (cached && Date.now() - cached.time < 86400000) { for (const id of cached.ids) yield this.catalog.get(id); return; }
    let url = key ? `https://maou.audio/?s=${encodeURIComponent(key)}` : 'https://maou.audio/category/bgm/';
    const ids = new Set();
    for (let page = 0; url && page < 5; page++) {
      if (signal?.aborted) return;
      const body = (await this.network.request(url)).toString();
      for (const sample of parseMaou(body)) { this.catalog.set(sample.id, sample); if (!ids.has(sample.id)) { ids.add(sample.id); yield sample; } }
      const $ = load(body); const next = $('a.nextpostslink, a.next.page-numbers, link[rel="next"]').first().attr('href');
      url = next?.startsWith('https://maou.audio/') ? next : null;
    }
    this.queries.set(key, { time: Date.now(), ids: [...ids] });
  }
}
module.exports = { Maou, parseMaou };
