const base = require('../package.json').build;
// App packages are occasional manual downloads. Site fixes ship independently as
// the small module assets built by scripts/build-modules.cjs, with no installer feed.
module.exports = function makeReleaseConfig() {
  return {
    ...base,
    artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
    publish: null,
    mac: { ...base.mac, target: ['dmg', 'zip'], identity: '-', notarize: false },
    win: { ...base.win }
  };
};
