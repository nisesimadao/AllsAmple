const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { wav } = require('./audio-fixture.cjs');
const { LocalFolders } = require('../src/main/providers/local.cjs');
(async () => {
  if (process.platform !== 'darwin') throw new Error('Finderの実表示検証はmacOSで実行してください。');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-reveal-')), root = path.join(dir, 'AllsAmple表示確認'), data = path.join(dir, 'data');
  const out = path.join(__dirname, '../output/research'), token = randomUUID(), ack = path.join(out, `reveal-${token}.ack`), current = path.join(out, 'reveal-current.json');
  await fs.mkdir(root); await fs.mkdir(data); await fs.mkdir(out, { recursive: true });
  const file = path.join(root, 'AllsAmple表示確認.wav'); await fs.writeFile(file, wav());
  const folders = new LocalFolders(data); await folders.add([root]);
  await fs.writeFile(path.join(data, 'ui-state.json'), JSON.stringify({ enabledSites: ['local'], query: 'AllsAmple' }));
  const env = { ...process.env, ALLSAMPLE_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ env, ...(process.argv[2] ? { executablePath: path.resolve(process.argv[2]), args: [] } : { args: [path.join(__dirname, '..')] }) });
    const page = await app.firstWindow(); await page.locator('.sample-row').waitFor(); await page.locator('.sample-row').click();
    // Invoke the real shell.showItemInFolder; no dispatch stub for this check.
    await page.locator('#reveal').click();
    const fixture = { token, file: await fs.realpath(file), folderName: path.basename(root), filename: path.basename(file), ack };
    await fs.writeFile(current, JSON.stringify(fixture, null, 2));
    console.log(JSON.stringify({ awaitingNativeFinderObservation: true, ...fixture }));
    let observed = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if ((await fs.readFile(ack, 'utf8').catch(() => '')).trim() === token) { observed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!observed) throw new Error('Finderの選択状態を実際に観測できなかったため、実表示は未確認です。');
    await fs.writeFile(path.join(out, 'reveal-verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), platform: process.platform, actualShellCall: true, filename: fixture.filename, folderName: fixture.folderName, nativeFinderSelectionObserved: true, observation: 'Computer Use accessibility/screenshot; fixture window closed after observation', explorerOnWindows: 'not verified' }, null, 2));
    console.log('PASS: real Finder selected the fixture WAV in its containing folder; native UI observation acknowledged');
  } finally { if (app) await app.close(); await fs.rm(ack, { force: true }); await fs.rm(current, { force: true }); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
