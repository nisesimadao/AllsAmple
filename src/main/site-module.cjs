const { SoundEffectLab } = require('./providers/soundeffect-lab.cjs');
const { Maou } = require('./providers/maou.cjs');
const { Dova } = require('./providers/dova.cjs');
const { Onjin } = require('./providers/onjin.cjs');
const { Freesound } = require('./providers/freesound.cjs');
const { Pixabay } = require('./providers/pixabay.cjs');
const { BrowserCatalog } = require('./providers/browser-catalog.cjs');

// This entry and its source files form the separately downloadable site module.
// Audio playback, files, local folders and the Electron shell stay in the app.
module.exports = {
  api: 2,
  version: '2.0.0',
  create({ createNetwork, dataDir, automation, getFreesoundKey }) {
    return [
      new SoundEffectLab(createNetwork(), dataDir), new Maou(createNetwork()),
      new Onjin(createNetwork(), dataDir), new Dova(), new Freesound({ getKey: getFreesoundKey }),
      new Pixabay(automation),
      ...['samplefocus', 'landr', 'splice', 'noiiz'].map(id => new BrowserCatalog(id, automation))
    ];
  }
};
