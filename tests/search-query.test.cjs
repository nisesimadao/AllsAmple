const { test } = require('node:test');
const assert = require('node:assert/strict');
const { expandQuery, matchesText, createMatcher } = require('../src/shared/query.js');

test('saved and online queries share Japanese synonyms, width normalization and empty-query behavior', () => {
  assert(expandQuery(' 雨 ').includes('rainfall'));
  for (const query of ['雨', '雨音', 'ＲＡＩＮ']) {
    assert(matchesText('Rainfall / open field', query));
    assert(matchesText('窓辺の雨音', query));
    assert(!matchesText('Train rhythm', query));
    assert(!matchesText('Brain pulse', query));
  }
  assert(matchesText('ＰＩＡＮＯ loop', 'ピアノ'));
  assert(matchesText('任意の音源', '  '));
});

test('query punctuation stays literal while repeated matches remain independent', () => {
  const match = createMatcher('C#');
  assert(match('C# guitar')); assert(!match('C guitar')); assert(match('C# synth'));
  assert(matchesText('tone (dry)', '(dry)'));
  assert(!matchesText('tone dry', '(dry)'));
  assert(!matchesText('', 'rain'));
});
