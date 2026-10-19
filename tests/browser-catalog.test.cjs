const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchUrl, normalize, licenseFor, validMedia } = require('../src/main/providers/browser-catalog.cjs');
const { exportFilename } = require('../src/main/library.cjs');
test('Japanese rain reaches each site through its observed search parameter', () => {
  const names = { samplefocus: 'search', landr: 'textsearch', splice: 'filepath', noiiz: 'q' };
  for (const [site, parameter] of Object.entries(names)) { const url = new URL(searchUrl(site, '雨')); assert.equal(url.searchParams.get(parameter), 'rain'); assert.equal([...url.searchParams].length, 1); }
});
test('browser catalog preserves row identity, timing and preview provenance', () => {
  const row = { remoteId: 'abc123', title: 'rain.wav', description: 'rainfall', pageUrl: 'https://splice.com/sounds/sample/abc123', duration: 6.5, bpm: 120, key: 'C minor', loop: true };
  const sample = normalize('splice', row, searchUrl('splice', 'rain'));
  assert.equal(sample.isPreview, true); assert.equal(sample.audioUrl, null); assert.equal(sample.remoteId, row.remoteId); assert.equal(sample.duration, 6.5); assert.equal(sample.kind, 'ループ');
  assert.equal(exportFilename(sample), 'rain.mp3'); assert.notEqual(normalize('landr', row, '').id, sample.id);
});
test('preview availability does not grant a paid commercial license', () => {
  assert.equal(licenseFor('samplefocus').commercial, true);
  assert.equal(licenseFor('splice').commercial, false);
  assert.equal(licenseFor('splice').modification, false);
  for (const site of ['landr', 'splice', 'noiiz']) { assert.equal(licenseFor(site).category, 'gray'); assert.notEqual(licenseFor(site).commercial, true); }
});
test('resolved audio URLs must use each site’s expected HTTPS media origin', () => {
  assert(validMedia('landr', 'https://assets.landr.com/samples/secure/streams/valid/stream.mp3?Policy=test'));
  assert(!validMedia('landr', 'https://evil.example/samples/secure/streams/valid/stream.mp3'));
  assert(!validMedia('landr', 'https://assets.landr.com/samples/public/waveforms/valid/waveform.json'));
  assert(validMedia('splice', 'https://spliceproduction.s3.us-west-1.amazonaws.com/audio_samples/valid/valid.mp3'));
  assert(!validMedia('splice', 'https://spliceproduction.s3.us-west-1.amazonaws.com.evil.example/valid.mp3'));
  assert(validMedia('noiiz', 'https://d7d3471nr939s.cloudfront.net/pack/file.mp3'));
  assert(!validMedia('samplefocus', 'http://d9olupt5igjta.cloudfront.net/preview.mp3'));
});
