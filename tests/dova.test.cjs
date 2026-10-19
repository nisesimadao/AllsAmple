const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Dova, parseList, parseDetail, normalize, searchUrl, validMedia } = require('../src/main/providers/dova.cjs');
const ORIGIN = 'https://opentracks.com', CDN = 'https://dova-worker.tracks-cid.workers.dev';
const media = (type = 'bgm', download = false, expires = Math.floor(Date.now() / 1000) + 600) => `${CDN}${download ? '/download' : '/'}?${new URLSearchParams({ filepath: `${type}/audio/11111111-2222-3333-4444-555555555555.mp3`, expires: String(expires), token: 'a'.repeat(64) })}`;
function list(type = 'bgm', { next = '', duration = '1:27', duplicate = false } = {}) {
  const row = `<div class="bgmlist-main"><div class="bgmlist-tracktitle"><a href="/${type}/detail/1838">雨のテスト</a><span>by<a>作者</a></span></div><div class="bgmlist-trackdetail">雨音とピアノ</div><div class="bgmlist-icobgm">${type === 'bgm' ? 'ジングル' : ''}</div><div class="bgmlist-icotime">${duration}</div><span class="bgmlist-icoloop_no"></span><div class="bgmlist-icotags"><span>雨</span><span>...</span></div></div>`;
  return row + (duplicate ? row : '') + (next ? `<div class="paging-forward"><a href="${next}">次</a></div>` : '');
}
function detail(type = 'bgm', { standard = true, source = media(type), id = '1838' } = {}) {
  return `<script type="application/ld+json" id="dova-${type}-detail-jsonld">${JSON.stringify({ name: '雨のテスト', url: `${ORIGIN}/${type}/detail/${id}`, byArtist: { name: '作者' }, duration: 'PT1M27S', description: '雨とピアノ BPM65', keywords: ['雨', 'ピアノ'] })}</script><audio><source src="${source}"></audio><div class="trialL-detail">素材種別：BGM</div><span class="trialL-detailloop_no"></span><div class="trialL-subm_composerName"><a href="/creator/detail/69">作者</a></div><span class="trialL-subm_composerLicense">${standard ? 'サイト準拠' : '独自条件'}</span><a href="/bgm/detail/9999">関連曲</a>`;
}
const form = '<form method="post"><input name="csrfmiddlewaretoken" value="public-form-token"><select name="track"><option value="1">track1</option></select></form>';
const sample = (type = 'bgm') => normalize({ pageUrl: `${ORIGIN}/${type}/detail/1838`, title: '雨のテスト', author: '作者' });
test('DOVA searches current OpenTracks endpoints in Japanese and preserves BGM/SE and selected track identities', () => {
  assert.equal(new URL(searchUrl('bgm', 'rain')).searchParams.get('keywords'), '雨');
  assert.equal(new URL(searchUrl('se', '雨')).pathname, '/se');
  const [bgm] = parseList(list(), searchUrl('bgm', '雨')).items, [se] = parseList(list('se'), searchUrl('se', '雨')).items;
  assert.equal(bgm.duration, 87); assert.equal(bgm.loop, false); assert.equal(bgm.kind, 'ジングル'); assert.equal(se.kind, '効果音'); assert.notEqual(bgm.id, se.id);
  assert.equal(bgm.license.category, 'orange'); assert.equal(bgm.license.commercial, null); assert.equal(bgm.license.attribution, false);
  assert.equal(parseList(list('bgm', { duration: '1:27~' }), searchUrl('bgm', '雨')).items[0].duration, null);
  assert.notEqual(sample().id, normalize({ pageUrl: `${ORIGIN}/bgm/detail/1838/track/2`, title: '雨のテスト' }).id);
  assert.equal(parseList(list('bgm', { next: 'https://elsewhere.test/' }), searchUrl('bgm', '雨')).next, null);
});
test('only the exact detail page audio is used and creator conditions remain distinct from the site license', () => {
  const parsed = parseDetail(detail(), sample().pageUrl);
  assert.equal(parsed.duration, 87); assert.equal(parsed.bpm, 65); assert.equal(parsed.license.category, 'green'); assert.equal(parsed.license.attribution, false); assert.equal(parsed.license.contentId, false);
  const custom = parseDetail(detail('bgm', { standard: false }), sample().pageUrl);
  assert.equal(custom.license.category, 'orange'); assert.equal(custom.license.commercial, null); assert.equal(custom.license.termsUrl, `${ORIGIN}/creator/detail/69`);
  assert.throws(() => parseDetail(detail('bgm', { id: '9999' }), sample().pageUrl), /対象トラック/);
  assert.throws(() => parseDetail(detail('bgm', { source: media('se') }), sample().pageUrl), /対象トラック/);
  assert(!validMedia('https://evil.test/file.mp3', 'bgm')); assert(!validMedia(media().replace(CDN, CDN + '.evil.test'), 'bgm'));
});
test('the original MP3 form uses its own CSRF cookie and track; waveform/play/save share a progressive transfer', async () => {
  const { AudioCache } = require('../src/main/library.cjs'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-dova-'));
  let release; const held = new Promise(resolve => { release = resolve; }), calls = [], item = sample();
  const provider = new Dova({ fetcher: async (url, options) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url === item.pageUrl) return new Response(detail());
    if (url === item.pageUrl + '/download' && !options.method) return new Response(form, { headers: { 'set-cookie': 'csrftoken=public-cookie; Path=/' } });
    if (options.method === 'POST') {
      assert.equal(options.headers.Cookie, 'csrftoken=public-cookie'); assert.equal(options.headers.Origin, ORIGIN);
      assert.equal(options.body.get('track'), '1'); assert.equal(options.body.get('csrfmiddlewaretoken'), 'public-form-token');
      return new Response(null, { status: 302, headers: { location: media('bgm', true) } });
    }
    assert.equal(new URL(url).pathname, '/download');
    let sent = false;
    return new Response(new ReadableStream({ async pull(controller) { if (!sent) { sent = true; controller.enqueue(Buffer.from('first!')); return; } await held; controller.enqueue(Buffer.from('second')); controller.close(); } }), { headers: { 'content-type': 'audio/mpeg', 'content-length': '12' } });
  } });
  const cache = new AudioCache({ request: (_, options) => provider.download(item, options), promote: (_, priority) => provider.promote(item, priority) }, dir);
  try {
    await cache.prepare(item); assert.equal(item.isPreview, false); assert.equal(item.license.category, 'green');
    const response = await cache.response(item), reader = response.body.getReader(); assert.equal(Buffer.from((await reader.read()).value).toString(), 'first!');
    let done = false; const saving = cache.get(item).then(file => { done = true; return file; }); assert.equal(done, false);
    release(); assert.equal(Buffer.from((await reader.read()).value).toString(), 'second'); await reader.read();
    assert.equal(await fs.readFile(await saving, 'utf8'), 'first!second'); assert.equal(calls.filter(call => call.method === 'POST').length, 1); assert.equal(calls.length, 4);
  } finally { release(); await Promise.all([...cache.pending.values()].map(entry => entry.ticket.promise.catch(() => {}))); await fs.rm(dir, { recursive: true, force: true }); }
});
test('a limited original download falls back to the published preview and labels it as a preview', async () => {
  const item = sample(); const provider = new Dova({ fetcher: async (url, options) => {
    if (options.method === 'POST') return new Response('', { status: 429 });
    if (url.endsWith('/download')) return new Response(form);
    if (url === item.pageUrl) return new Response(detail());
    assert.equal(new URL(url).pathname, '/'); return new Response('preview MP3', { headers: { 'content-type': 'audio/mpeg' } });
  } });
  assert.equal((await provider.download(item)).toString(), 'preview MP3'); assert.equal(item.isPreview, true);
});
test('DOVA refreshes expired signed URLs while reusing still-valid resolved originals', async () => {
  const provider = new Dova(), item = sample(), previous = { ...item, audioUrl: media('bgm', true), isPreview: false };
  provider.reuseKnown(item, previous); assert.equal(item.audioUrl, previous.audioUrl); assert.equal(item.isPreview, false);
  provider.fetcher = async () => { throw new Error('a fresh URL must not request detail'); }; await provider.resolve(item);
  const expired = { ...sample(), audioUrl: media('bgm', true, 1), isPreview: false, license: { ...item.license, category: 'green' } };
  const searchedAgain = sample(); provider.reuseKnown(searchedAgain, expired);
  assert.equal(searchedAgain.isPreview, false); assert.equal(searchedAgain.license.category, 'green');
  assert.equal(searchedAgain.audioUrl, expired.audioUrl); // cached audio keeps provenance; a download still refreshes the expired signature.
  let reads = 0; provider.fetcher = async () => { reads++; throw new Error('refreshed detail'); };
  await assert.rejects(provider.resolve(expired), /refreshed detail/); assert.equal(reads, 1);
});
test('slow BGM cannot hold SE results; duplicate rows are emitted once and pagination keeps the query', async () => {
  let release; const held = new Promise(resolve => { release = resolve; });
  const provider = new Dova({ fetcher: async url => { if (new URL(url).pathname === '/bgm') await held; return new Response(list(new URL(url).pathname === '/bgm' ? 'bgm' : 'se', { duplicate: true })); } });
  const iterator = provider.search('雨');
  try { const first = await iterator.next(); assert.equal(first.value.remoteType, 'se'); release(); assert.equal((await iterator.next()).value.remoteType, 'bgm'); assert.equal((await iterator.next()).done, true); }
  finally { release(); await iterator.return(); }
  const parsed = parseList(list('bgm', { next: '?keywords=%E9%9B%A8&page=2' }), searchUrl('bgm', '雨'));
  assert.equal(new URL(parsed.next).searchParams.get('keywords'), '雨'); assert.equal(new URL(parsed.next).searchParams.get('page'), '2');
});
test('a broken category does not discard the other category; foreign page and media URLs cannot be fetched', async () => {
  const provider = new Dova({ fetcher: async url => new URL(url).pathname === '/bgm' ? new Response('unavailable', { status: 503 }) : new Response(list('se')) });
  const found = []; await assert.rejects(async () => { for await (const item of provider.search('雨')) found.push(item); }, /HTTP 503/);
  assert.equal(found.length, 1); assert.equal(found[0].remoteType, 'se');
  await assert.rejects(provider.response('https://opentracks.com.evil.test/bgm'), /以外/);
  await assert.rejects(provider.resolve({ pageUrl: 'https://evil.test/bgm/detail/1838' }), /素材ページ/);
});
