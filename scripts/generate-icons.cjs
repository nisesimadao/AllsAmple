const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runIconsTool } = require('app-builder-lib/out/toolsets/icons.js');
(async () => {
  const root = path.join(__dirname, '..'), inputFile = path.join(root, 'build/icon.svg');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-icons-'));
  try {
    // Use the builder's verified portable conversion toolset. Keep conversions
    // sequential so its SVG renderer never competes for several WASM heaps.
    await runIconsTool({ inputFile, outputFormat: 'set', outDir: dir });
    await fs.mkdir(path.join(root, 'src/assets'), { recursive: true });
    await fs.copyFile(path.join(dir, '512x512.png'), path.join(root, 'src/assets/icon.png'));
    await runIconsTool({ inputFile, outputFormat: 'icns', outDir: path.join(root, 'build') });
    await runIconsTool({ inputFile, outputFormat: 'ico', outDir: path.join(root, 'build') });
    await fs.mkdir(path.join(root, 'output/brand'), { recursive: true });
    for (const size of [16, 32, 64, 128, 256, 512]) await fs.copyFile(path.join(dir, `${size}x${size}.png`), path.join(root, `output/brand/icon-${size}.png`));
    console.log('Generated macOS ICNS, Windows ICO and runtime PNG from build/icon.svg');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
