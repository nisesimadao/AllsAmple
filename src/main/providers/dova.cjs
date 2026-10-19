const { createHash } = require('node:crypto');
const { load } = require('cheerio');
const { PriorityQueue } = require('../priority-queue.cjs');
const { expandQuery } = require('../../shared/query.js');
const ORIGIN = 'https://opentracks.com'; // DOVA-SYNDROME moved here on 2026-09-15.
const MEDIA = 'https://dova-worker.tracks-cid.workers.dev';
const TERMS = `${ORIGIN}/help/articles/license/`;
const TYPES = ['bgm', 'se'];
const text = value => String(value || '').replace(/\s+/g, ' ').trim();
function pageInfo(value) {
  try { const url = new URL(value, ORIGIN), match = /^\/(bgm|se)\/detail\/(\d+)(?:\/track\/(\d+))?$/.exec(url.pathname); return url.origin === ORIGIN && !url.username && !url.password && match ? { type: match[1], id: match[2], track: match[3] || '1', url: url.href } : null; }
  catch { return null; }
}
function validMedia(value, type) {
  try { const url = new URL(value); return url.origin === MEDIA && !url.username && !url.password && ['/', '/download'].includes(url.pathname) && new RegExp(`^${type}/audio/[a-f0-9-]{36}\\.mp3$`).test(url.searchParams.get('filepath') || '') && /^[a-f0-9]{64}$/.test(url.searchParams.get('token') || '') && /^\d+$/.test(url.searchParams.get('expires') || ''); }
  catch { return false; }
}
function freshMedia(sample) { return validMedia(sample.audioUrl, sample.remoteType) && Number(new URL(sample.audioUrl).searchParams.get('expires')) * 1000 > Date.now() + 15000; }
function licenseFor({ title, author, pageUrl, standard = false, creatorUrl }) {
  return { category: standard ? 'green' : 'orange', commercial: standard ? true : null, attribution: false, redistribution: false, contentId: false, adult: null, modification: standard ? true : null,
    termsUrl: !standard && creatorUrl ? creatorUrl : TERMS, credit: `${title} — ${author} / OpenTracks（旧DOVA-SYNDROME）\n${pageUrl}`,
    note: `OpenTracks音源利用ライセンス。クレジット表記は任意、素材単体の再配布・Content ID登録は不可。${standard ? '商用の背景音楽利用・加工が可能。' : '作者独自の利用条件は配布ページで確認してください。'}音楽作品への利用は創作性の追加とYouTube等のUGCサービスでの公開に限定され、Spotify等への楽曲配信には使えません。` };
}
function normalize({ pageUrl, title, author, kind, duration, loop, description, tags }) {
  const page = pageInfo(pageUrl); if (!page || !title) return null;
  const id = `dova-${createHash('sha256').update(`${page.type}:${page.id}:${page.track}`).digest('hex').slice(0, 20)}`;
  const sample = { id, site: 'dova', siteName: 'DOVA-SYNDROME', remoteId: page.id, remoteType: page.type, track: page.track,
    title, author: author || 'OpenTracks', kind: kind || (page.type === 'se' ? '効果音' : 'BGM'), duration: duration ?? null, bpm: null, key: null, loop: loop ?? null, channels: null,
    price: 'free', pageUrl: page.url, audioUrl: null, format: 'MP3', isPreview: true, description: description || '', tags: tags || [] };
  sample.license = licenseFor(sample); return sample;
}
function seconds(value) { const match = /^(\d+):(\d{2})$/.exec(text(value)); return match ? Number(match[1]) * 60 + Number(match[2]) : null; }
function parseList(html, url) {
  const $ = load(html), items = [];
  $('.bgmlist-main').each((_, element) => {
    const row = $(element), link = row.find('.bgmlist-tracktitle > a').first();
    const page = pageInfo(link.attr('href')); if (!page) return;
    const kind = page.type === 'se' ? '効果音' : row.find('.bgmlist-icobgm').text().includes('ジングル') ? 'ジングル' : 'BGM';
    const sample = normalize({ pageUrl: page.url, title: text(link.text()), author: text(row.find('.bgmlist-tracktitle span a').text()), kind,
      duration: seconds(row.find('.bgmlist-icotime').text()), loop: row.find('[class$="loop_yes"]').length ? true : row.find('[class$="loop_no"]').length ? false : null,
      description: text(row.find('.bgmlist-trackdetail').text()), tags: row.find('.bgmlist-icotags span').map((_, tag) => text($(tag).text())).get().filter(tag => tag !== '...') });
    if (sample) items.push(sample);
  });
  let next = null; const href = $('.paging-forward a[href]').first().attr('href');
  if (href) { const target = new URL(href, url), base = new URL(url); if (target.origin === ORIGIN && target.pathname === base.pathname && target.searchParams.get('keywords') === base.searchParams.get('keywords')) next = target.href; }
  return { items, next, empty: /該当する.*(?:ありません|見つかりません)|検索結果.*0\s*件|0\s*件/.test(text($('body').text())) };
}
function parseDetail(html, pageUrl) {
  const page = pageInfo(pageUrl); if (!page) throw new Error('DOVAの素材ページを確認できません');
  const $ = load(html); let data;
  try { data = JSON.parse($(`#dova-${page.type}-detail-jsonld`).text()); } catch { throw new Error('DOVAの素材情報を読み取れませんでした'); }
  // Read the selected track's source only; related music and pack demos are excluded.
  const url = $('audio source[src], audio[src]').first().attr('src');
  if (!validMedia(url, page.type) || data.url && pageInfo(data.url)?.id !== page.id) throw new Error('対象トラックの音声URLを確認できません');
  const author = text((data.byArtist || data.author)?.name), creator = $('.trialL-subm_composerName a[href]').first().attr('href');
  const creatorUrl = creator && /^\/creator\/detail\/\d+$/.test(creator) ? new URL(creator, ORIGIN).href : null;
  const duration = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(data.duration || '');
  const typeText = text($('.trialL-detail').text());
  const result = { title: text(data.name), author, duration: duration ? Number(duration[1] || 0) * 3600 + Number(duration[2] || 0) * 60 + Number(duration[3] || 0) : null,
    description: text(data.description), tags: Array.isArray(data.keywords) ? data.keywords : [], audioUrl: url,
    loop: $('[class$="loop_yes"]').length ? true : $('[class$="loop_no"]').length ? false : null,
    kind: page.type === 'se' ? '効果音' : typeText.includes('ジングル') ? 'ジングル' : 'BGM' };
  const bpm = /BPM\s*[:：=]?\s*(\d+(?:\.\d+)?)/i.exec(result.description); result.bpm = bpm ? Number(bpm[1]) : null;
  result.license = licenseFor({ ...result, pageUrl, creatorUrl, standard: text($('.trialL-subm_composerLicense').first().text()) === 'サイト準拠' });
  return result;
}
function searchUrl(type, query) {
  if (!TYPES.includes(type)) throw new Error('DOVAの検索種別が不正です');
  const term = expandQuery(query).find(value => /[^\x00-\x7f]/.test(value)) || query.trim();
  const url = new URL(`/${type}`, ORIGIN); if (term) url.searchParams.set('keywords', term); return url.href;
}
class Dova {
  id = 'dova'; name = 'DOVA / OpenTracks'; catalog = new Map(); queries = new Map(); transfers = new Map();
  constructor({ fetcher = (...args) => fetch(...args), idleTimeout = 30000 } = {}) { this.fetcher = fetcher; this.idleTimeout = idleTimeout; this.queue = new PriorityQueue({ concurrency: 3, backgroundConcurrency: 2 }); }
  async restore() {}
  promote(sample, priority) { this.transfers.get(sample.id)?.promote(priority); }
  async response(url, options = {}) {
    const target = new URL(url);
    if (![ORIGIN, MEDIA].includes(target.origin) || target.username || target.password) throw new Error('DOVA以外の取得先です');
    return this.fetcher(url, { ...options, redirect: 'manual', headers: { 'User-Agent': 'AllsAmple/0.1 (+https://github.com/nisesimadao/AllsAmple)', ...options.headers } });
  }
  async read(url, { signal } = {}) {
    const response = await this.response(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
    if (!response.ok || !response.body) { await response.body?.cancel().catch(() => {}); throw new Error(`DOVAから取得できませんでした（HTTP ${response.status}）`); }
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 5 * 1024 ** 2) throw new Error('DOVAのページが大きすぎます'); chunks.push(Buffer.from(value)); } } finally { await reader.cancel().catch(() => {}); }
    return { html: Buffer.concat(chunks).toString('utf8'), cookies: response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ') };
  }
  async batch(url, signal) {
    const cached = this.queries.get(url); if (cached && Date.now() - cached.time < 60000) return cached.value;
    const value = await this.queue.submit(async () => { signal?.throwIfAborted(); const { html } = await this.read(url, { signal }); const result = parseList(html, url); if (!result.items.length && !result.empty) throw new Error('DOVAの検索結果を読み取れませんでした'); return result; }, { priority: 0, signal }).promise;
    this.queries.set(url, { time: Date.now(), value }); if (this.queries.size > 40) this.queries.delete(this.queries.keys().next().value); return value;
  }
  async *search(query, { signal } = {}) {
    const pending = new Map(), errors = [], seen = new Set();
    const schedule = (type, url, page) => pending.set(type, this.batch(url, signal).then(result => ({ type, page, ...result }), error => ({ type, error })));
    for (const type of TYPES) schedule(type, searchUrl(type, query), 1);
    while (pending.size) {
      const result = await Promise.race(pending.values()); pending.delete(result.type); if (signal?.aborted) return;
      if (result.error) { errors.push(result.error.message); continue; }
      for (const sample of result.items) { if (signal?.aborted) return; if (seen.has(sample.id)) continue; seen.add(sample.id); this.catalog.set(sample.id, sample); yield sample; }
      if (result.next && result.page < 2) schedule(result.type, result.next, result.page + 1);
    }
    if (errors.length) throw new Error(errors.join(' / '));
  }
  reuseKnown(sample, previous) { if (previous?.pageUrl === sample.pageUrl && validMedia(previous.audioUrl, sample.remoteType)) Object.assign(sample, { audioUrl: previous.audioUrl, isPreview: previous.isPreview, license: previous.license }); }
  async resolve(sample, signal) {
    if (freshMedia(sample)) return;
    const page = pageInfo(sample.pageUrl); if (!page) throw new Error('素材ページを確認してください');
    const detail = parseDetail((await this.read(sample.pageUrl, { signal })).html, sample.pageUrl);
    Object.assign(sample, detail, { isPreview: true });
    // Prefer the site's actual download, submitting its own CSRF/track form once.
    // If temporarily rate limited, the separately published HTML5 preview remains usable.
    const downloadPage = `${ORIGIN}/${page.type}/detail/${page.id}/download`;
    try {
      const { html, cookies } = await this.read(downloadPage, { signal }), $ = load(html);
      const token = $('form[method="post"] input[name="csrfmiddlewaretoken"]').val();
      if (!token || !$(`select[name="track"] option[value="${page.track}"]`).length) return;
      const response = await this.response(downloadPage, { method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN, Referer: downloadPage, Cookie: cookies }, body: new URLSearchParams({ csrfmiddlewaretoken: token, track: page.track }) });
      const url = response.headers.get('location'); await response.body?.cancel().catch(() => {});
      if ([302, 303].includes(response.status) && validMedia(url, page.type)) { sample.audioUrl = url; sample.isPreview = false; }
    } catch (error) { if (signal?.aborted) throw error; /* A published preview is a fallback, never mislabeled as the original download. */ }
  }
  async download(sample, { priority = 100, onHeaders, onChunk } = {}) {
    const ticket = this.queue.submit(async () => {
      await this.resolve(sample);
      const idle = new AbortController(); let timer;
      const pulse = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new Error('DOVAの音声応答が止まりました')), this.idleTimeout); timer.unref?.(); }; pulse();
      try {
        const response = await this.response(sample.audioUrl, { signal: idle.signal, headers: { Referer: sample.pageUrl } }); pulse();
        if (!response.ok || !/audio|octet-stream/i.test(response.headers.get('content-type') || '') || !response.body) { await response.body?.cancel().catch(() => {}); sample.audioUrl = null; throw new Error(`DOVAの音声を取得できませんでした（HTTP ${response.status}）`); }
        const streaming = onHeaders && onChunk;
        if (streaming) await onHeaders({ size: response.headers.get('content-encoding') ? null : Number(response.headers.get('content-length')), type: 'audio/mpeg' });
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try { for (;;) { const { done, value } = await reader.read(); if (done) break; pulse(); size += value.length; if (size > 80 * 1024 ** 2) throw new Error('DOVAの音声が大きすぎます'); if (streaming) await onChunk(value); else chunks.push(Buffer.from(value)); } } finally { await reader.cancel().catch(() => {}); }
        if (!size) throw new Error('音声が空です'); return streaming ? null : Buffer.concat(chunks);
      } finally { clearTimeout(timer); }
    }, { priority });
    this.transfers.set(sample.id, ticket);
    try { return await ticket.promise; } finally { if (this.transfers.get(sample.id) === ticket) this.transfers.delete(sample.id); }
  }
}
module.exports = { Dova, parseList, parseDetail, normalize, licenseFor, validMedia, searchUrl };
