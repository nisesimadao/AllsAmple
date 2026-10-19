const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { Pixabay, normalize, validMedia, searchUrl } = require('../src/main/providers/pixabay.cjs');
const raw = (type = 'sound-effects') => ({ id: 379215, name: 'Real Rain Sound', mediaType: 'audio', mediaDescriptiveType: type === 'music' ? 'music' : 'sound_effect', href: `/${type}/nature-real-rain-sound-379215/`, sources: { src: 'https://cdn.pixabay.com/audio/2025/07/23/audio_63d9f37e74.mp3' }, user: { username: 'test' }, duration: 21, tagList: [['Rain', '/sound-effects/search/rain/']], hasYoutubeContentId: false });
test('Pixabay uses observed category paths and published row media, preserving preview and license restrictions', () => {
  assert.equal(searchUrl('sound-effects', '雨'), 'https://pixabay.com/sound-effects/search/rain/');
  assert.equal(searchUrl('music', '雨'), 'https://pixabay.com/music/search/rain/');
  const sample = normalize(raw(), 'sound-effects'); assert.equal(sample.isPreview, true); assert.equal(sample.kind, 'アンビエンス'); assert.equal(sample.license.commercial, true); assert.equal(sample.license.attribution, false); assert.equal(sample.license.adult, false); assert.equal(sample.license.redistribution, false); assert.equal(sample.license.contentId, null);
  const music = normalize({ ...raw('music'), hasYoutubeContentId: true, isAiGenerated: true }, 'music');
  assert.equal(music.kind, 'BGM'); assert.equal(music.license.category, 'orange'); assert.match(music.license.note, /Content ID登録あり/); assert.match(music.description, /AI生成/); assert.notEqual(music.id, sample.id);
  assert.equal(normalize({ ...raw(), href: '/sound-effects/other-999/' }, 'sound-effects'), null);
  assert.equal(normalize({ ...raw(), mediaType: 'image' }, 'sound-effects'), null);
  assert.equal(normalize(raw(), 'music'), null);
  assert.equal(validMedia('https://evil.test/audio/2025/07/23/audio_63d9f37e74.mp3'), false);
  assert.equal(validMedia('https://cdn.pixabay.com/audio/2025/07/23/waveform.png'), false);
});
test('Pixabay music and SFX resolve independently, stream the first results, cache queries and keep errors isolated', async () => {
  let release; const held = new Promise(resolve => { release = resolve; }); let visits = 0;
  const automation = { create: async id => ({ window: { isDestroyed: () => false }, page: {
    goto: async () => { visits++; if (id.endsWith('music')) await held; }, waitForFunction: async () => {},
    evaluate: fn => vm.runInNewContext(`(${fn.toString()})()`, { window: { __BOOTSTRAP__: { page: { results: [raw(id.endsWith('music') ? 'music' : 'sound-effects')] } } } })
  } }) };
  const provider = new Pixabay(automation), iterator = provider.search('雨');
  const first = await iterator.next(); assert.equal(first.value.kind, 'アンビエンス');
  release(); const second = await iterator.next(); assert.equal(second.value.kind, 'BGM'); assert.equal((await iterator.next()).done, true);
  for await (const item of provider.search('雨')) assert(item.site === 'pixabay'); assert.equal(visits, 2);
  provider.queries.clear(); provider.workers.get('music').page.goto = async () => { throw new Error('site failed'); };
  const received = []; await assert.rejects(async () => { for await (const item of provider.search('雨')) received.push(item); }, /音楽：検索ページに接続/); assert.equal(received.length, 1);
});
test('Pixabay transfers the observed MP3 with streaming callbacks and rejects HTML, redirects and external media', async () => {
  const sample = normalize(raw(), 'sound-effects'); let calls = 0;
  const provider = new Pixabay(null, { fetcher: async (url, options) => { calls++; assert.equal(url, sample.audioUrl); assert.equal(options.redirect, 'error'); return new Response('audio', { headers: { 'content-type': 'audio/mpeg', 'content-length': '5' } }); } });
  let size; const chunks = [];
  assert.equal(await provider.download(sample, { onHeaders: headers => { size = headers.size; }, onChunk: chunk => { chunks.push(Buffer.from(chunk)); } }), null);
  assert.equal(size, 5); assert.equal(Buffer.concat(chunks).toString(), 'audio');
  await assert.rejects(provider.download({ ...sample, audioUrl: 'https://evil.test/audio.mp3' }), /URL/); assert.equal(calls, 1);
  provider.fetcher = async () => new Response('confirmation page', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(provider.download(sample), /取得できません/);
});
