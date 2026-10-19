const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
(async () => {
  if (process.platform !== 'win32') throw new Error('Windows実機またはWindows VMのNode.jsで実行してください。Wine・パッケージの静的照合は実機検証に含めません。');
  const root = path.join(__dirname, '..'), exe = path.resolve(process.argv[2] || path.join(root, 'dist/win-unpacked/AllsAmple.exe'));
  await fs.access(exe);
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' });
  if (ffmpeg.error || ffmpeg.status !== 0) throw new Error('検証用のffmpegをPATHへ追加してください。アプリ本体には不要ですが、受信途中の実再生を合成MP3で検証するために使います。');
  const output = path.join(root, 'output/research/windows-runtime-verification.json');
  const report = { startedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, executable: exe, siteModules: 'Node integration checks exercise the real module bundle; the app does not replace its own binary', complete: false, checks: [] };
  await fs.mkdir(path.dirname(output), { recursive: true });
  for (const script of ['verify-desktop.cjs', 'verify-library.cjs', 'verify-actions.cjs', 'verify-audio-filters.cjs', 'verify-cache.cjs', 'verify-workflows.cjs', 'verify-streaming.cjs', 'verify-updates.cjs', 'verify-freesound.cjs', 'verify-pixabay.cjs']) {
    console.log(`Running ${script}`);
    const child = spawnSync(process.execPath, [path.join(__dirname, script), exe], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: false });
    report.checks.push({ script, passed: !child.error && child.status === 0, exitCode: child.status, error: child.error?.message });
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    if (child.error || child.status !== 0) throw new Error(`${script}が失敗しました。Windows実機での確認は未完了です。`);
  }
  report.complete = true; report.finishedAt = new Date().toISOString(); await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log('PASS: packaged Windows application completed the desktop, library, audio, cache, workflow, streaming and live-source checks');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
