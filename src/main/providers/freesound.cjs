const { load } = require('cheerio');
const { createHash } = require('node:crypto');
const { PriorityQueue } = require('../priority-queue.cjs');
const { expandQuery } = require('./soundeffect-lab.cjs');
const ORIGIN = 'https://freesound.org';
const FIELDS = 'id,url,name,tags,description,username,license,duration,channels,samplerate,previews,bpm,loopable';
function english(query) { return expandQuery(query).find(term => /^[\x00-\x7f]+$/.test(term)) || query.trim(); }
function pageUrl(value, id) {
  try {
    const url = new URL(value, ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol) || !['freesound.org', 'www.freesound.org'].includes(url.hostname) || url.port || url.username || url.password || !new RegExp(`^/people/[^/]+/sounds/${id}/$`).test(url.pathname)) return null;
    url.protocol = 'https:'; url.hostname = 'freesound.org'; url.search = ''; url.hash = ''; return url.href;
  } catch { return null; }
}
function validMedia(value, id) {
  try {
    const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || !['freesound.org', 'cdn.freesound.org'].includes(url.hostname)) return false;
    return new RegExp(`^/(?:data/)?previews/[0-9]+/${id}_[0-9]+-(?:hq|lq)\\.mp3$`).test(url.pathname);
  } catch { return false; }
}
function licenseFor(value, { title, author, url }) {
  const text = String(value || '').trim(); let uri = null;
  try { const parsed = new URL(text); if (['creativecommons.org', 'www.creativecommons.org'].includes(parsed.hostname) && ['http:', 'https:'].includes(parsed.protocol)) { parsed.protocol = 'https:'; uri = parsed.href; } } catch {}
  const zero = /^(?:creative commons 0|cc0)$/i.test(text) || /\/publicdomain\/zero\/1\.0\//.test(uri || '');
  const by = /^attribution$/i.test(text) || /\/licenses\/by\/(?:[1-4]\.0)\//.test(uri || '');
  const nc = /^attribution noncommercial$/i.test(text) || /\/licenses\/by-nc\/(?:[1-4]\.0)\//.test(uri || '');
  const sampling = /sampling\+/i.test(text);
  const version = uri?.match(/\/(\d\.\d)\//)?.[1];
  const name = zero ? 'CC0 1.0' : by ? `CC BY${version ? ' ' + version : '（版は配布ページで確認）'}` : nc ? `CC BY-NC${version ? ' ' + version : '（版は配布ページで確認）'}` : sampling ? 'Sampling+（条件を確認）' : '利用条件不明';
  return { category: zero ? 'green' : by ? 'yellow' : nc || sampling ? 'orange' : 'red', commercial: zero || by ? true : nc ? false : null, attribution: zero ? false : by || nc || sampling ? true : null, redistribution: zero || by || nc ? true : null, contentId: null, adult: null, modification: zero || by || nc ? true : null, termsUrl: uri || (zero ? 'https://creativecommons.org/publicdomain/zero/1.0/' : url), credit: `${title} — ${author}\n${url}\n${name}`, name, note: `${name}。${by || nc ? '作者・素材・ライセンスの表記が必要です。' : ''}${nc ? '商用利用はできません。' : ''}${by || nc ? '再配布・改変にもライセンス条件が付きます。' : ''}保存するのは試聴用MP3です。Content ID・アダルト利用など、この表示で確認できない条件は未確認として扱います。` };
}
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const number = Number(raw.id); if (!Number.isSafeInteger(number) || number <= 0 || typeof raw.name !== 'string' || !raw.name.trim() || typeof raw.username !== 'string' || !raw.username.trim()) return null;
  const remoteId = String(number), url = pageUrl(raw.url, remoteId); if (!url) return null;
  const tags = Array.isArray(raw.tags) ? raw.tags.filter(tag => typeof tag === 'string') : [];
  const oneShot = tags.some(tag => /^(?:one-shot|oneshot)$/.test(tag));
  const loop = tags.includes('loop') ? true : oneShot ? false : typeof raw.loopable === 'boolean' ? raw.loopable : null;
  // A non-loopable recording is not necessarily a one-shot. Keep the source's
  // musical/field-recording tags separate from its seam-loopability descriptor.
  const kind = tags.some(tag => /^(voice|vocal|speech|speaking)$/.test(tag)) ? 'ボイス' : tags.some(tag => /^(music|bgm|soundtrack)$/.test(tag)) ? 'BGM' : tags.some(tag => /^(jingle|sting)$/.test(tag)) ? 'ジングル' : tags.some(tag => /^(ambience|ambiance|field-recording|nature)$/.test(tag)) ? 'アンビエンス' : tags.includes('loop') ? 'ループ' : oneShot ? 'ワンショット' : '効果音';
  const audioUrl = [raw.previews?.['preview-hq-mp3'], raw.previews?.['preview-lq-mp3']].find(value => validMedia(value, remoteId)) || null;
  const sample = { id: `freesound-${createHash('sha256').update(remoteId).digest('hex').slice(0, 20)}`, remoteId, site: 'freesound', siteName: 'Freesound', title: raw.name.trim(), description: load(typeof raw.description === 'string' ? raw.description : '').text().trim(), author: raw.username, kind, duration: Number.isFinite(Number(raw.duration)) && raw.duration != null ? Number(raw.duration) : null, bpm: Number.isFinite(Number(raw.bpm)) && Number(raw.bpm) > 0 ? Number(raw.bpm) : Number(raw.name.match(/(?:^|[ _-])(\d{2,3})\s?bpm(?:[ _.-]|$)/i)?.[1]) || null, key: raw.name.match(/(?:^|[ _-])([A-G](?:[#b](?:m|maj|min)?|(?:m|maj|min)))(?:[ _.-]|$)/)?.[1] || null, loop, channels: Number(raw.channels) || null, originalSampleRate: Number(raw.samplerate) || null, sampleRate: null, price: 'free', pageUrl: url, audioUrl, format: 'MP3', isPreview: true, previewResolved: /-hq\.mp3(?:\?|$)/.test(audioUrl || '') };
  sample.license = licenseFor(raw.license, { title: sample.title, author: sample.author, url }); return sample;
}
function parsePublic(html) {
  const $ = load(html), rows = [];
  $('.bw-search__result').each((_, element) => {
    const card = $(element), player = card.find('.bw-player[data-sound-id]').first(), id = player.attr('data-sound-id'); if (!id) return;
    const url = card.find('a[href]').map((_, anchor) => $(anchor).attr('href')).get().map(value => pageUrl(value, id)).find(Boolean);
    const sample = normalize({ id, name: player.attr('data-title'), username: player.attr('data-username'), url, duration: player.attr('data-duration'), samplerate: player.attr('data-samplerate'), description: card.find('[class*="max-h-"]').first().text(), tags: card.find('a[href^="/browse/tags/"]').map((_, anchor) => $(anchor).text().trim()).get(), license: card.find('[title^="License:"]').first().attr('title')?.replace(/^License:\s*/, ''), previews: { 'preview-lq-mp3': player.attr('data-mp3') } });
    if (sample) rows.push(sample);
  }); return rows;
}
class Freesound {
  id = 'freesound'; name = 'Freesound'; catalog = new Map(); queryCache = new Map(); transfers = new Map(); priorities = new Map();
  constructor({ getKey = () => null, fetcher = (...args) => fetch(...args), idleTimeout = 30000 } = {}) { this.getKey = getKey; this.fetcher = fetcher; this.idleTimeout = idleTimeout; this.queue = new PriorityQueue({ concurrency: 3, backgroundConcurrency: 1 }); }
  async restore() {}
  invalidate() { this.queryCache.clear(); }
  reuseKnown(sample, previous) {
    if (!previous || sample.pageUrl !== previous.pageUrl) return;
    if (!sample.previewResolved && previous.previewResolved && validMedia(previous.audioUrl, sample.remoteId)) { sample.audioUrl = previous.audioUrl; sample.previewResolved = true; }
    // Public result cards omit the CC version. Do not replace a previously
    // observed license URL with that less specific label on the next search.
    if (sample.license.termsUrl === sample.pageUrl && sample.license.category === previous.license?.category && ['commercial', 'attribution', 'redistribution', 'modification'].every(key => sample.license[key] === previous.license[key]) && /^https:\/\/creativecommons\.org\//.test(previous.license.termsUrl || '')) {
      sample.license = licenseFor(previous.license.termsUrl, { title: sample.title, author: sample.author, url: sample.pageUrl });
    }
  }
  promote(sample, priority) { this.priorities.set(sample.id, Math.max(this.priorities.get(sample.id) ?? -Infinity, priority)); this.transfers.get(sample.id)?.promote(priority); }
  async read(value, { key, audio = false, priority = audio ? 100 : 10, signal, sampleId, onHeaders, onChunk } = {}) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['freesound.org', 'cdn.freesound.org'].includes(url.hostname) || url.username || url.password) throw new Error('Freesound以外の取得先です');
    if (key && (url.origin !== ORIGIN || !url.pathname.startsWith('/apiv2/'))) throw new Error('APIキーの送信先が不正です');
    const ticket = this.queue.submit(async () => {
      const headers = { 'User-Agent': 'AllsAmple/0.1 (+https://github.com/nisesimadao/AllsAmple)' }; if (key) headers.Authorization = `Token ${key}`;
      // Long ambience previews can exceed 30 seconds of transfer time. Time out
      // stalled I/O instead of killing a healthy transfer at an absolute deadline.
      const idle = new AbortController(); let timer;
      const pulse = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new Error('Freesoundの応答が止まりました')), this.idleTimeout); timer.unref?.(); }; pulse();
      try {
        const response = await this.fetcher(url.href, { headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, idle.signal]) : idle.signal }); pulse();
        const message = [401, 403].includes(response.status) && key ? 'APIキーを確認してください。設定から変更・解除できます' : response.status === 429 ? 'Freesoundの取得回数制限に達しました。少し時間を置いて再検索してください' : !response.ok ? `Freesoundから取得できませんでした（HTTP ${response.status}）` : audio && !/audio|octet-stream/i.test(response.headers.get('content-type') || '') ? '音声以外の応答を受信しました' : null;
        if (message) { await response.body?.cancel().catch(() => {}); throw new Error(message); }
        if (!response.body) throw new Error('Freesoundの応答が空でした');
        const streaming = audio && onHeaders && onChunk;
        if (streaming) await onHeaders({ size: response.headers.get('content-encoding') ? null : Number(response.headers.get('content-length')) });
        const reader = response.body.getReader(), chunks = []; let bytes = 0;
        try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; pulse(); bytes += chunk.value.length; if (bytes > (audio ? 80 : 5) * 1024 ** 2) throw new Error('Freesoundの応答が大きすぎます'); if (streaming) await onChunk(chunk.value); else chunks.push(Buffer.from(chunk.value)); } } finally { await reader.cancel().catch(() => {}); }
        return streaming ? null : Buffer.concat(chunks);
      } finally { clearTimeout(timer); }
    }, { priority, signal });
    if (sampleId) this.transfers.set(sampleId, ticket);
    try { return await ticket.promise; } finally { if (sampleId && this.transfers.get(sampleId) === ticket) this.transfers.delete(sampleId); }
  }
  apiUrl(query, page = 1, fields = FIELDS) { const url = new URL('/apiv2/search/', ORIGIN); url.search = new URLSearchParams({ query: english(query), fields, page: String(page), page_size: fields === 'id' ? '1' : '30' }); return url.href; }
  async verifyKey(key) {
    const data = JSON.parse((await this.read(this.apiUrl('rain', 1, 'id'), { key, priority: 100 })).toString());
    if (!Array.isArray(data.results)) throw new Error('Freesound APIの応答を確認できませんでした');
  }
  async *search(query, { signal } = {}) {
    const key = await this.getKey(), cacheKey = `${key ? 'api' : 'public'}:${english(query)}`, cached = this.queryCache.get(cacheKey);
    if (cached && Date.now() - cached.time < 60000) { for (const sample of cached.items) { if (signal?.aborted) return; yield sample; } return; }
    const found = [], seen = new Set();
    for (let page = 1; page <= (key ? 2 : 1); page++) {
      if (signal?.aborted) return;
      let samples, next = false;
      if (key) {
        const data = JSON.parse((await this.read(this.apiUrl(query, page), { key, signal })).toString());
        if (!Array.isArray(data.results)) throw new Error('Freesound APIの応答を確認できませんでした');
        samples = data.results.map(normalize).filter(Boolean); next = typeof data.next === 'string';
      } else {
        const url = new URL('/search/', ORIGIN); url.searchParams.set('q', english(query));
        const html = (await this.read(url.href, { signal })).toString(); samples = parsePublic(html);
        if (!samples.length && !/no sounds found|no results|0 sounds/i.test(html)) throw new Error('Freesoundの検索結果を読み取れませんでした');
      }
      for (const sample of samples) { if (signal?.aborted) return; if (seen.has(sample.id)) continue; seen.add(sample.id); this.catalog.set(sample.id, sample); found.push(sample); yield sample; }
      if (!next) break;
    }
    if (!signal?.aborted) { this.queryCache.set(cacheKey, { time: Date.now(), items: found }); if (this.queryCache.size > 20) this.queryCache.delete(this.queryCache.keys().next().value); }
  }
  async download(sample, { priority = 100, onHeaders, onChunk } = {}) {
    this.priorities.set(sample.id, Math.max(this.priorities.get(sample.id) ?? -Infinity, priority));
    try {
      if (!sample.previewResolved || !validMedia(sample.audioUrl, sample.remoteId)) {
        if (!pageUrl(sample.pageUrl, sample.remoteId)) throw new Error('Freesoundの素材ページを確認できません');
        const $ = load((await this.read(sample.pageUrl, { priority: this.priorities.get(sample.id), sampleId: sample.id })).toString());
        const player = $(`.bw-player[data-sound-id="${sample.remoteId}"]`).first(); if (!player.length) throw new Error('対象のFreesound素材を確認できませんでした');
        // The detail page publishes an HQ share URL. Use that observed URL rather
        // than inventing one by changing the LQ filename or waveform URL.
        const urls = $('[data-static-file-url]').map((_, element) => $(element).attr('data-static-file-url')).get().filter(value => validMedia(value, sample.remoteId));
        if (validMedia(player.attr('data-mp3'), sample.remoteId)) urls.push(player.attr('data-mp3'));
        const resolved = urls.find(value => /-hq\.mp3(?:\?|$)/.test(value)) || urls[0]; if (!resolved) throw new Error('対象の試聴MP3が見つかりませんでした');
        sample.audioUrl = resolved; sample.previewResolved = true;
        const licenseUrl = $('a[href]').map((_, element) => $(element).attr('href')).get().find(value => /^https?:\/\/(?:www\.)?creativecommons\.org\/(?:licenses|publicdomain)\//.test(value));
        if (licenseUrl) sample.license = licenseFor(licenseUrl, { title: sample.title, author: sample.author, url: sample.pageUrl });
      }
      if (!validMedia(sample.audioUrl, sample.remoteId)) throw new Error('Freesoundの音声URLを確認できません');
      return await this.read(sample.audioUrl, { audio: true, priority: this.priorities.get(sample.id), sampleId: sample.id, onHeaders, onChunk });
    } finally { this.priorities.delete(sample.id); }
  }
}
module.exports = { Freesound, normalize, licenseFor, parsePublic, validMedia, english };
