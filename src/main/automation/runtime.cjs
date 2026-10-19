const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');
class BrowserAutomation {
  windows = new Map(); connection = null;
  async connect() {
    if (!this.connection) {
      this.connection = (async () => {
        // Reuse Electron's Chromium. Playwright is the navigation/locator layer;
        // no second browser download, external Chrome profile, or audio proxy is needed.
        let failure;
        for (let attempt = 0; attempt < 40; attempt++) {
          try {
            const [port] = (await fs.readFile(path.join(app.getPath('userData'), 'DevToolsActivePort'), 'utf8')).split('\n');
            if (!/^\d+$/.test(port)) throw new Error('invalid debugging port');
            return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true, timeout: 1500 });
          } catch (error) { failure = error; await new Promise(resolve => setTimeout(resolve, 100)); }
        }
        throw new Error(`検索用ブラウザに接続できませんでした：${failure?.message}`);
      })();
      this.connection.catch(() => { this.connection = null; });
    }
    return this.connection;
  }
  async create(id, host) {
    if (this.windows.has(id)) return this.windows.get(id);
    const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { partition: `persist:allsample-${id}`, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    window.webContents.setAudioMuted(true);
    // Search workers need DOM data and audio, not artwork or webfonts. Keep Chromium's
    // script/response cache enabled instead of using Playwright routing (which disables it).
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: ['image', 'font'].includes(details.resourceType) }));
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
    window.webContents.on('will-navigate', (event, url) => { try { const target = new URL(url); if (target.protocol !== 'https:' || target.hostname !== host) event.preventDefault(); } catch { event.preventDefault(); } });
    const marker = `about:blank#allsample-${id}-${Date.now()}`;
    await window.loadURL(marker);
    try {
      const browser = await this.connect();
      let page;
      for (let attempt = 0; attempt < 40 && !page; attempt++) { page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url() === marker); if (!page) await new Promise(resolve => setTimeout(resolve, 50)); }
      if (!page) throw new Error('検索ページを作成できませんでした');
      page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(45000);
      const worker = { window, page };
      this.windows.set(id, worker); return worker;
    } catch (error) { window.destroy(); throw error; }
  }
  closeAll() {
    for (const { window } of this.windows.values()) if (!window.isDestroyed()) window.destroy();
    this.windows.clear();
    if (this.connection) void this.connection.then(browser => browser.close()).catch(() => {});
    this.connection = null;
  }
}
module.exports = { BrowserAutomation };
