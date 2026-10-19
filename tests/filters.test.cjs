const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matches, normalizedKey } = require('../src/renderer/filters.js');
const sample = { kind: 'ループ', duration: 8, bpm: 120, key: 'Db minor', loop: true, channels: 2, price: 'free', license: { attribution: false, commercial: true, redistribution: false, contentId: null, adult: true, modification: true } };
test('license filters require an explicit permission and do not infer rights from free pricing', () => {
  assert(matches(sample, { noCredit: true, commercial: true, adult: true, modification: true, free: true }));
  assert(!matches(sample, { redistribution: true })); assert(!matches(sample, { contentId: true }));
  assert(!matches({ ...sample, license: { attribution: null, commercial: null } }, { noCredit: true }));
  assert(!matches({ ...sample, license: { commercial: null } }, { commercial: true }));
});
test('duration and BPM boundaries are inclusive and active ranges exclude missing metadata', () => {
  assert(matches(sample, { minDuration: 8, maxDuration: 8, minBpm: 120, maxBpm: 120 }));
  assert(!matches(sample, { maxDuration: 7 })); assert(!matches(sample, { minBpm: 121 }));
  assert(!matches({ ...sample, duration: null }, { maxDuration: 20 }));
  assert(!matches({ ...sample, bpm: null }, { maxBpm: 200 }));
  assert(matches({ ...sample, duration: null, channels: null }, {}, {}));
  assert(matches({ ...sample, duration: null, channels: null }, { maxDuration: 10, channels: 1 }, { duration: 5, channels: 1 }));
});
test('musically equivalent sharp/flat keys match while major and minor remain distinct', () => {
  assert.equal(normalizedKey('C♯ minor'), normalizedKey('Dbm')); assert.equal(normalizedKey('A# major'), normalizedKey('B♭'));
  assert.equal(normalizedKey('CM'), normalizedKey('C major')); assert.notEqual(normalizedKey('Am'), normalizedKey('A major'));
  assert(matches(sample, { key: 'C#m' })); assert(!matches(sample, { key: 'C#' }));
});
test('loop and channel filters preserve explicit false and exclude unknown values', () => {
  assert(matches(sample, { loop: true, channels: 2 })); assert(!matches(sample, { loop: false }));
  assert(matches({ ...sample, loop: false }, { loop: false })); assert(!matches({ ...sample, loop: null }, { loop: false }));
  assert(!matches({ ...sample, channels: null }, { channels: 1 })); assert(!matches(sample, { kind: 'BGM' }));
});
