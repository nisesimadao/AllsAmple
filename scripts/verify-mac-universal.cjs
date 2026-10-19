const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
(async () => {
  if (process.platform !== 'darwin') throw new Error('Universal Mac版の検証はmacOSで実行してください。');
  const root = path.join(__dirname, '..'), args = process.argv.slice(2);
  const bundle = path.resolve(args.find(arg => !arg.startsWith('--')) || path.join(root, 'dist/mac-universal/AllsAmple.app'));
  const executable = path.join(bundle, 'Contents/MacOS/AllsAmple');
  const framework = path.join(bundle, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework');
  for (const file of [executable, framework]) { const architectures = execFileSync('lipo', ['-archs', file], { encoding: 'utf8' }); assert(architectures.includes('x86_64') && architectures.includes('arm64'), architectures); }
  const asar = await import('@electron/asar'), archive = path.join(bundle, 'Contents/Resources/app.asar');
  const pkg = require('../package.json'), metadata = JSON.parse(asar.extractFile(archive, 'package.json'));
  assert.equal(metadata.version, pkg.version); assert.equal(metadata.main, pkg.main); assert.deepEqual(metadata.dependencies, pkg.dependencies);
  async function compareSource(folder = 'src') {
    for (const entry of await fs.readdir(path.join(root, folder), { withFileTypes: true })) {
      const name = `${folder}/${entry.name}`;
      if (entry.isDirectory()) await compareSource(name);
      else if (entry.isFile() && entry.name !== '.DS_Store') assert.deepEqual(asar.extractFile(archive, name), await fs.readFile(path.join(root, name)), name);
    }
  }
  await compareSource();
  for (const name of ['hook.js', 'tests/hook.test.cjs']) assert.deepEqual(asar.extractFile(archive, `vendor/sampletap/${name}`), await fs.readFile(path.join(root, 'vendor/sampletap', name)));
  execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });
  const signing = spawnSync('codesign', ['--display', '--verbose=2', bundle], { encoding: 'utf8' });
  if (signing.error || signing.status !== 0) throw signing.error || new Error('Code signing details could not be inspected');
  const developerIdSigned = /Authority=Developer ID Application/.test(signing.stderr);
  const out = path.join(root, 'output/research'); await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'mac-universal-package-verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), bundle, version: pkg.version, binaryAndFrameworkHaveBothSlices: true, sourceBytesMatch: true, unmodifiedSampleTapCoreAndTests: true, codeSignatureIntegrity: true, runtime: 'not established by package inspection', developerIdSigned, notarization: 'not checked' }, null, 2));
  console.log('PASS: universal Mac binary/framework slices, current packaged source, SampleTap core/tests and local code-signature integrity. No app launched.');
  // A plain verification command must never repeatedly open desktop windows.
  // Runtime checks are separate and require an explicitly requested visible run.
  if (!args.includes('--with-runtime')) return;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-universal-'));
  try {
    const results = [];
    for (const architecture of ['arm64', 'x86_64']) {
      const wrapper = path.join(dir, `launch-${architecture}`), quote = value => `'${value.replace(/'/g, `'\''`)}'`;
      await fs.writeFile(wrapper, `#!/bin/sh\nexec /usr/bin/arch -${architecture} ${quote(executable)} "$@"\n`, { mode: 0o755 });
      const data = path.join(dir, `data-${architecture}`); await fs.mkdir(data);
      await fs.writeFile(path.join(data, 'ui-state.json'), JSON.stringify({ query: '', enabledSites: ['local'] }));
      const env = { ...process.env, ALLSAMPLE_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
      const app = await electron.launch({ executablePath: wrapper, args: [], env });
      let runtime;
      try { const page = await app.firstWindow(); await page.waitForFunction(() => state.ready); runtime = await app.evaluate(({ app }) => ({ arch: process.arch, platform: process.platform, version: app.getVersion() })); assert.equal(runtime.arch, architecture === 'x86_64' ? 'x64' : 'arm64'); }
      finally { await app.close(); }
      for (const script of ['verify-actions.cjs', 'verify-audio-filters.cjs']) {
        const child = spawnSync(process.execPath, [path.join(__dirname, script), wrapper], { cwd: root, env: process.env, stdio: 'inherit' });
        if (child.error || child.status !== 0) throw new Error(`${architecture}: ${script} failed`);
      }
      results.push({ ...runtime, requestedArchitecture: architecture, actionsAndByteExports: true, measuredPitchTempoAndSeek: true, execution: architecture === 'x86_64' && process.arch === 'arm64' ? 'Rosetta on Apple Silicon; not a physical Intel Mac' : 'native' });
      console.log(`PASS: universal bundle starts and completes actions/audio checks with ${architecture}`);
    }
    await fs.writeFile(path.join(out, 'mac-universal-verification.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), bundle, binaryAndFrameworkHaveBothSlices: true, results, developerIdSigned, notarization: 'not checked' }, null, 2));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
