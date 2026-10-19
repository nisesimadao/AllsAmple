const { createHash } = require('node:crypto');
const { PriorityQueue } = require('../priority-queue.cjs');
const { expandQuery } = require('./soundeffect-lab.cjs');
const TYPES = ['sound-effects', 'music'];
function searchUrl(type, query) {
  if (!TYPES.includes(type)) throw new Error('Pixabayの検索種別が不正です');
  const term = expandQuery(query).find(value => /^[\x00-\x7f]+$/.test(value)) || query.trim();
  return `https://pixabay.com/${type}/${term ? `search/${encodeURIComponent(term)}/` : ''}`;
}
function validMedia(value) {
  try { const url = new URL(value); return url.origin === 'https://cdn.pixabay.com' && !url.username && !url.password && /^\/audio\/\d{4}\/\d{2}\/\d{2}\/audio_[a-f0-9]+\.mp3$/.test(url.pathname); }
  catch { return false; }
}
function normalize(raw, type, origin) {
  if (!TYPES.includes(type) || !raw || raw.mediaType !== 'audio' || raw.mediaDescriptiveType !== (type === 'music' ? 'music' : 'sound_effect') || !Number.isSafeInteger(raw.id) || raw.id <= 0 || typeof raw.name !== 'string' || !raw.name.trim() || !validMedia(raw.sources?.src)) return null;
  let page; try { page = new URL(raw.href, 'https://pixabay.com'); } catch { return null; }
  if (page.origin !== 'https://pixabay.com' || page.username || page.password || !new RegExp(`^/${type}/[^/]+-${raw.id}/$`).test(page.pathname)) return null;
  page.search = ''; page.hash = '';
  const tags = Array.isArray(raw.tagList) ? raw.tagList.map(tag => Array.isArray(tag) && typeof tag[0] === 'string' ? tag[0] : '').filter(Boolean) : [];
  const description = typeof raw.description === 'string' ? raw.description : '';
  const loop = tags.some(tag => /^(?:loop|loops|seamless loop)$/i.test(tag)) ? true : null;
  const kind = type === 'music' ? 'BGM' : loop ? 'ループ' : tags.some(tag => /^(?:ambience|ambient|nature|field recording|rain|rain sounds)$/i.test(tag)) ? 'アンビエンス' : tags.some(tag => /^(?:voice|vocal|speech)$/i.test(tag)) ? 'ボイス' : '効果音';
  const author = typeof raw.user?.username === 'string' ? raw.user.username : 'Pixabay';
  const registered = raw.hasYoutubeContentId === true;
  const license = { category: registered ? 'orange' : 'green', commercial: true, attribution: false, redistribution: false, contentId: null, adult: false, modification: true, termsUrl: 'https://pixabay.com/service/terms/', credit: `${raw.name.trim()} — ${author} / Pixabay\n${page.href}`, name: 'Pixabay Content License', note: `Pixabay Content License。商用利用・改変は可能、表記は任意。素材単体の再配布、アダルト用途などは禁止。第三者の権利は別途確認してください。${registered ? 'YouTube Content ID登録あり。公開時に申し立てが出る場合があります。' : ''}Content ID登録の許可を意味する表示ではありません。保存するのは公開試聴用MP3です。` };
  return { id: `pixabay-${createHash('sha256').update(`${type}:${raw.id}`).digest('hex').slice(0, 20)}`, remoteId: String(raw.id), site: 'pixabay', siteName: 'Pixabay', title: raw.name.trim(), description: `${raw.isAiGenerated === true ? 'AI生成。' : ''}${description}`, author, kind, duration: Number.isFinite(raw.duration) && raw.duration > 0 ? raw.duration : null, bpm: null, key: null, loop, channels: null, price: 'free', pageUrl: page.href, audioUrl: raw.sources.src, format: 'MP3', isPreview: true, hasYoutubeContentId: registered, isAiGenerated: raw.isAiGenerated === true, searchUrl: origin, license };
}
class Pixabay {
  id = 'pixabay'; name = 'Pixabay'; catalog = new Map(); workers = new Map(); queries = new Map(); transfers = new Map();
  constructor(automation, { fetcher = (...args) => fetch(...args), idleTimeout = 30000 } = {}) {
    this.automation = automation; this.fetcher = fetcher; this.idleTimeout = idleTimeout;
    this.queues = new Map(TYPES.map(type => [type, new PriorityQueue({ concurrency: 1 })]));
    this.audioQueue = new PriorityQueue({ concurrency: 3, backgroundConcurrency: 1 });
  }
  async restore() {}
  async rows(type, url, signal) {
    const cached = this.queries.get(url);
    if (cached && Date.now() - cached.time < 60000) return cached.items;
    return this.queues.get(type).submit(async () => {
      signal?.throwIfAborted();
      let worker = this.workers.get(type);
      if (!worker || worker.window.isDestroyed()) { worker = await this.automation.create(`pixabay-${type}`, 'pixabay.com'); this.workers.set(type, worker); }
      const { page } = worker;
      try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); }
      catch { throw new Error('検索ページに接続できませんでした。時間を置いて再検索してください。'); }
      try { await page.waitForFunction(() => Array.isArray(window.__BOOTSTRAP__?.page?.results), undefined, { timeout: 20000 }); }
      catch { throw new Error(/just a moment|verify|captcha/i.test(await page.title()) ? 'サイトの確認画面が表示されています。時間を置いて再検索してください。' : '検索結果を読み取れませんでした'); }
      signal?.throwIfAborted();
      // Read only each audio row's published data, never global active-player state.
      const rows = await page.evaluate(() => window.__BOOTSTRAP__.page.results.map(row => ({ id: row.id, mediaType: row.mediaType, mediaDescriptiveType: row.mediaDescriptiveType, name: row.name, href: row.href, sources: { src: row.sources?.src }, description: row.description, duration: row.duration, tagList: row.tagList, user: { username: row.user?.username }, hasYoutubeContentId: row.hasYoutubeContentId, isAiGenerated: row.isAiGenerated })));
      const items = rows.map(row => normalize(row, type, url)).filter(Boolean);
      if (rows.length && !items.length) throw new Error('検索結果の音源データを確認できませんでした');
      this.queries.set(url, { time: Date.now(), items }); if (this.queries.size > 40) this.queries.delete(this.queries.keys().next().value);
      return items;
    }, { priority: 0, signal }).promise;
  }
  async *search(query, { signal } = {}) {
    // Music and SFX arrive independently; a slow or failed category cannot hide the other.
    const pending = new Map(TYPES.map(type => [type, this.rows(type, searchUrl(type, query), signal).then(items => ({ type, items }), error => ({ type, error }))]));
    const errors = [];
    while (pending.size) {
      const result = await Promise.race(pending.values()); pending.delete(result.type);
      if (signal?.aborted) return;
      if (result.error) { errors.push(`${result.type === 'music' ? '音楽' : '効果音'}：${result.error.message}`); continue; }
      for (const sample of result.items) { if (signal?.aborted) return; this.catalog.set(sample.id, sample); yield sample; }
    }
    if (errors.length) throw new Error(errors.join(' / '));
  }
  promote(sample, priority) { this.transfers.get(sample.id)?.promote(priority); }
  async download(sample, { priority = 100, onHeaders, onChunk } = {}) {
    if (!validMedia(sample.audioUrl)) throw new Error('Pixabayの音声URLを確認できません');
    // NOTE: The observed original-download route presents a CAPTCHA to guests.
    // Use only the separately published preview URL and label it as a preview.
    const ticket = this.audioQueue.submit(async () => {
      const idle = new AbortController(); let timer;
      const pulse = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new Error('Pixabayの応答が止まりました')), this.idleTimeout); timer.unref?.(); }; pulse();
      try {
        const response = await this.fetcher(sample.audioUrl, { redirect: 'error', signal: idle.signal }); pulse();
        if (!response.ok || !/audio|octet-stream/i.test(response.headers.get('content-type') || '') || !response.body) { await response.body?.cancel().catch(() => {}); throw new Error(`Pixabayの音声を取得できませんでした（HTTP ${response.status}）`); }
        const streaming = onHeaders && onChunk;
        if (streaming) await onHeaders({ size: response.headers.get('content-encoding') ? null : Number(response.headers.get('content-length')) });
        const reader = response.body.getReader(), chunks = []; let bytes = 0;
        try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; pulse(); bytes += chunk.value.length; if (bytes > 80 * 1024 ** 2) throw new Error('音声が大きすぎます'); if (streaming) await onChunk(chunk.value); else chunks.push(Buffer.from(chunk.value)); } } finally { await reader.cancel().catch(() => {}); }
        if (!bytes) throw new Error('音声が空です');
        return streaming ? null : Buffer.concat(chunks);
      } finally { clearTimeout(timer); }
    }, { priority });
    this.transfers.set(sample.id, ticket);
    try { return await ticket.promise; } finally { if (this.transfers.get(sample.id) === ticket) this.transfers.delete(sample.id); }
  }
}
module.exports = { Pixabay, normalize, validMedia, searchUrl };
