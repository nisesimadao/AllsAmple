const { app } = require('electron');
const fs = require('node:fs/promises'); const syncFs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const assert = require('node:assert/strict');
const { BrowserAutomation } = require('../src/main/automation/runtime.cjs');
const { BrowserCatalog } = require('../src/main/providers/browser-catalog.cjs');
const dir = syncFs.mkdtempSync(path.join(os.tmpdir(), 'allsample-catalogs-'));
app.setPath('userData', dir); app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1'); app.commandLine.appendSwitch('remote-debugging-port', '0');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const automation = new BrowserAutomation(); const failures = [];
  try {
    for (const id of (process.env.ALLSAMPLE_SITES || 'samplefocus,landr,splice,noiiz').split(',')) {
      const provider = new BrowserCatalog(id, automation); const controller = new AbortController();
      try {
        let first; const items = [];
        for await (const sample of provider.search('雨', { signal: controller.signal })) { items.push(sample); if (!first) first = sample; if (items.length >= 5) { controller.abort(); break; } }
        assert(first, `${id}: no results`);
        const bytes = await provider.download(first); assert(bytes.length > 1000);
        const file = path.join(dir, `${id}.mp3`); await fs.writeFile(file, bytes); assert.deepEqual(await fs.readFile(file), bytes);
        console.log(JSON.stringify({ site: id, query: '雨 → rain', results: items.length, title: first.title, bytes: bytes.length, urlHost: new URL(first.audioUrl).hostname, preview: first.isPreview, savedUnchanged: true }));
      } catch (error) {
        failures.push(id); console.error(id, error.message);
        if (provider.worker) { const page = provider.worker.page; console.error(id, 'url', page.url(), 'title', await page.title().catch(() => '')); await fs.mkdir('output/research', { recursive: true }); await fs.writeFile(`output/research/${id}-failed.html`, await page.content().catch(() => '')); }
      }
    }
  } finally { automation.closeAll(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); app.exit(failures.length ? 1 : 0); }
});
