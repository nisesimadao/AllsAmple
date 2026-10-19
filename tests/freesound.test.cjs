const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Freesound, normalize, licenseFor, parsePublic, validMedia } = require('../src/main/providers/freesound.cjs');
const raw = { id: 11, name: 'rain_loop_120bpm_Am.wav', username: 'recordist', url: 'https://freesound.org/people/recordist/sounds/11/', license: 'https://creativecommons.org/licenses/by/4.0/', duration: 3, channels: 1, samplerate: 48000, tags: ['loop'], previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/0/11_2-hq.mp3' } };
const context = { title: 'Rain', author: 'recordist', url: raw.url };
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
test('Freesound licenses are per item and preserve attribution and noncommercial restrictions', () => {
  const zero = licenseFor('Creative Commons 0', context), by = licenseFor(raw.license, context), nc = licenseFor('https://creativecommons.org/licenses/by-nc/4.0/', context), unknown = licenseFor('unknown', context);
  assert.equal(zero.category, 'green'); assert.equal(zero.attribution, false); assert.equal(zero.commercial, true);
  assert.equal(by.category, 'yellow'); assert.equal(by.attribution, true); assert.equal(by.redistribution, true); assert(by.credit.includes('CC BY 4.0')); assert(by.credit.includes('recordist'));
  assert.equal(nc.category, 'orange'); assert.equal(nc.commercial, false); assert.equal(nc.attribution, true);
  assert.equal(unknown.category, 'red'); assert.equal(unknown.commercial, null); assert.equal(unknown.modification, null);
  assert.equal(licenseFor('Attribution', context).termsUrl, raw.url);
  assert.equal(licenseFor('Sampling+', context).commercial, null); assert.equal(by.contentId, null); assert.equal(zero.adult, null);
});
test('normalization preserves preview provenance and rejects row-mismatched media URLs', () => {
  const sample = normalize(raw); assert.equal(sample.isPreview, true); assert.equal(sample.format, 'MP3'); assert.equal(sample.originalSampleRate, 48000); assert.equal(sample.sampleRate, null); assert.equal(sample.bpm, 120); assert.equal(sample.key, 'Am'); assert.equal(sample.kind, 'ループ');
  assert(!validMedia('https://cdn.freesound.org/previews/0/12_2-hq.mp3', '11')); assert(!validMedia('https://attacker.example/previews/0/11_2-hq.mp3', '11'));
  assert.equal(normalize({ ...raw, url: 'https://attacker.example/sounds/11/' }), null); assert.equal(normalize(null), null);
  assert.equal(normalize({ ...raw, name: 'A Rainy Morning' }).key, null);
  assert.equal(normalize({ ...raw, url: 'http://www.freesound.org/people/recordist/sounds/11/' }).pageUrl, raw.url);
  assert.equal(normalize({ ...raw, tags: ['field-recording'], loopable: false }).kind, 'アンビエンス');
  assert.equal(normalize({ ...raw, tags: [], loopable: false }).kind, '効果音');
});
test('Japanese music and film vocabulary expands to English without conflating rain and train', () => {
  const { english } = require('../src/main/providers/freesound.cjs');
  assert.equal(english('スネア'), 'snare'); assert.equal(english('爆発音'), 'explosion'); assert.equal(english('鳥の声'), 'bird'); assert.equal(english('電車'), 'train'); assert.equal(english('雨音'), 'rain');
});
test('a new public search retains an observed HQ URL and license version without masking a changed license class', () => {
  const provider = new Freesound(), previous = normalize(raw), publicRow = normalize({ ...raw, license: 'Attribution', previews: { 'preview-lq-mp3': 'https://cdn.freesound.org/previews/0/11_2-lq.mp3' } });
  provider.reuseKnown(publicRow, previous); assert.equal(publicRow.audioUrl, previous.audioUrl); assert.equal(publicRow.previewResolved, true); assert.equal(publicRow.license.name, 'CC BY 4.0');
  const restricted = normalize({ ...raw, license: 'Attribution NonCommercial' }); provider.reuseKnown(restricted, previous); assert.equal(restricted.license.commercial, false); assert.equal(restricted.license.category, 'orange');
  const legacy = normalize({ ...raw, license: 'Sampling+' }); provider.reuseKnown(legacy, normalize({ ...raw, license: 'https://creativecommons.org/licenses/by-nc/4.0/' })); assert.equal(legacy.license.modification, null); assert.equal(legacy.license.commercial, null);
});
test('official API uses current documented search, requests metadata once, and never sends the key to the CDN', async () => {
  const requests = [], token = 'private_test_token_0123456789';
  const provider = new Freesound({ getKey: () => token, fetcher: async (url, options) => { requests.push({ url, options }); return new URL(url).hostname === 'freesound.org' ? json({ results: [raw], next: null }) : new Response('audio', { headers: { 'content-type': 'audio/mpeg' } }); } });
  const results = await Array.fromAsync(provider.search('雨')); assert.equal(results.length, 1);
  const url = new URL(requests[0].url); assert.equal(url.pathname, '/apiv2/search/'); assert.equal(url.searchParams.get('query'), 'rain'); assert(url.searchParams.get('fields').includes('previews')); assert(!url.href.includes(token)); assert.equal(requests[0].options.headers.Authorization, `Token ${token}`);
  assert.equal((await provider.download(results[0])).toString(), 'audio'); assert.equal(requests[1].options.headers.Authorization, undefined); assert.equal(requests.length, 2);
  await assert.rejects(provider.read(raw.previews['preview-hq-mp3'], { key: token }), /送信先/);
});
test('public HTML uses the observed HQ share URL and exact license from the matching detail page', async () => {
  const search = `<div class="bw-search__result"><div class="bw-player" data-sound-id="11" data-title="rain" data-username="recordist" data-duration="3" data-mp3="https://cdn.freesound.org/previews/0/11_2-lq.mp3"></div><a href="/people/recordist/sounds/11/">rain</a><div title="License: Attribution"></div><a href="/browse/tags/rain/">rain</a></div>`;
  const detail = `<div class="bw-player" data-sound-id="11" data-mp3="https://cdn.freesound.org/previews/0/11_2-lq.mp3"></div><div data-static-file-url="https://cdn.freesound.org/previews/0/12_2-hq.mp3"></div><div data-static-file-url="https://cdn.freesound.org/previews/0/11_2-hq.mp3"></div><a href="http://creativecommons.org/licenses/by/3.0/">Attribution</a>`;
  assert.equal(parsePublic(search).length, 1);
  const requests = []; const provider = new Freesound({ fetcher: async url => { requests.push(url); return url.includes('/search/') ? new Response(search) : url.includes('/people/') ? new Response(detail) : new Response('real audio', { headers: { 'content-type': 'audio/mpeg' } }); } });
  const [sample] = await Array.fromAsync(provider.search('雨')); await provider.download(sample);
  assert(requests.at(-1).endsWith('11_2-hq.mp3')); assert.equal(sample.license.name, 'CC BY 3.0'); assert(sample.license.credit.includes('CC BY 3.0'));
});
test('an audio prefetch can be promoted while an unrelated metadata request is stalled', { timeout: 2000 }, async () => {
  const entered = gate(), proceed = gate();
  const provider = new Freesound({ fetcher: async url => { if (url.includes('/search/')) { entered.release(); await proceed.promise; return json({ results: [], next: null }); } return new Response('audio', { headers: { 'content-type': 'audio/mpeg' } }); } });
  const held = provider.read(provider.apiUrl('rain'), { priority: 0 }); await entered.promise;
  const sample = normalize(raw), downloading = provider.download(sample, { priority: 0 });
  while (!provider.transfers.has(sample.id)) await new Promise(resolve => setImmediate(resolve));
  provider.promote(sample, 100); assert.equal((await downloading).toString(), 'audio'); proceed.release(); await held;
});
test('API key errors and rate limits remain site errors without retrying public search', async () => {
  for (const status of [401, 429]) {
    const calls = []; const provider = new Freesound({ getKey: () => 'test_test_test_test', fetcher: async url => { calls.push(url); return new Response('', { status }); } });
    await assert.rejects(Array.fromAsync(provider.search('rain')), status === 401 ? /APIキー/ : /回数制限/); assert.equal(calls.length, 1);
  }
});
test('a healthy streamed response may take longer than the idle timeout in total', async () => {
  let count = 0;
  const provider = new Freesound({ idleTimeout: 50, fetcher: async (_, options) => new Response(new ReadableStream({
    start(controller) { options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true }); },
    async pull(controller) { await new Promise(resolve => setTimeout(resolve, 10)); if (count++ < 10) controller.enqueue(new Uint8Array([42])); else controller.close(); }
  }), { headers: { 'content-type': 'audio/mpeg' } }) });
  assert.equal((await provider.read(raw.previews['preview-hq-mp3'], { audio: true })).length, 10);
});
test('an idle response is aborted instead of holding an audio slot indefinitely', async () => {
  const provider = new Freesound({ idleTimeout: 20, fetcher: async (_, options) => new Response(new ReadableStream({ start(controller) { options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true }); } }), { headers: { 'content-type': 'audio/mpeg' } }) });
  const rejected = assert.rejects(provider.read(raw.previews['preview-hq-mp3'], { audio: true }), /応答が止まり/);
  await new Promise(resolve => setTimeout(resolve, 40)); await rejected;
});
