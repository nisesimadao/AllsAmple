const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../build/release-config.cjs');
test('shell packages need no distribution URL or official signing and embed no app updater feed', () => {
  const release = config();
  assert.equal(release.publish, null); assert.equal(release.mac.identity, '-'); assert.equal(release.mac.notarize, false);
  assert.deepEqual(release.mac.target, ['dmg', 'zip']); assert.deepEqual(release.win.target, ['nsis']);
});
