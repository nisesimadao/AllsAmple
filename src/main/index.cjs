const { app, BrowserWindow, ipcMain, protocol, net, clipboard, dialog, shell, nativeImage, session, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { mediaResponse } = require('./media-response.cjs');
const { SiteNetwork } = require('./network.cjs');
const { LocalFolders } = require('./providers/local.cjs');
const { BrowserAutomation } = require('./automation/runtime.cjs');
const { AudioCache, copyUnique, extension, exportFilename } = require('./library.cjs');
const { DragFiles } = require('./drag-files.cjs');
const { JsonStore } = require('./persistence.cjs');
const { cleanState } = require('./ui-state.cjs');
const { ApiKeys, validKey } = require('./api-keys.cjs');
const { createKeyProtector } = require('./key-protector.cjs');
const { DEFAULT_LIMIT } = require('./cache-policy.cjs');
const { ModuleUpdates } = require('./module-updates.cjs');
const bundledSites = require('./site-module.cjs');
app.setName('AllsAmple');
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-debugging-port', '0');
if (process.env.ALLSAMPLE_DATA_DIR) app.setPath('userData', process.env.ALLSAMPLE_DATA_DIR);
protocol.registerSchemesAsPrivileged([{ scheme: 'allsample', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let window, searchController, flushOnQuit;
let quitting = false;
const samples = new Map(), exportsById = new Map();
const automation = new BrowserAutomation();
const rendererDir = path.join(__dirname, '../renderer');
const appIconPath = path.join(__dirname, '../assets/icon.png');
async function createWindow() {
  window = new BrowserWindow({ width: 1360, height: 880, minWidth: 320, minHeight: 560, backgroundColor: '#1a1a1c', title: 'AllsAmple', icon: appIconPath, titleBarStyle: 'hiddenInset', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', () => { searchController?.abort(); automation.closeAll(); });
  await window.loadURL('allsample://app/index.html');
}
app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.setIcon(appIconPath);
  const dataDir = app.getPath('userData');
  const catalogStore = new JsonStore(path.join(dataDir, 'library-index.json'));
  const uiStore = new JsonStore(path.join(dataDir, 'ui-state.json'));
  const cacheStore = new JsonStore(path.join(dataDir, 'cache-settings.json'));
  const cacheOptions = await cacheStore.read({ maxBytes: DEFAULT_LIMIT });
  const cacheLimits = new Set([256 * 1024 ** 2, 1024 ** 3, DEFAULT_LIMIT, 5 * 1024 ** 3]);
  const savedUi = await uiStore.read(null);
  let ui = savedUi ? cleanState(savedUi) : null;
  const apiKeys = new ApiKeys(dataDir, createKeyProtector(safeStorage));
  const keysReady = apiKeys.restore().catch(() => { apiKeys.error = '保存したAPIキーを読み出せませんでした。設定から入力し直すか解除してください'; });
  const updates = new ModuleUpdates({ dataDir, appRoot: app.getAppPath(), bundled: bundledSites,
    onChange: state => { if (window && !window.isDestroyed()) window.webContents.send('update-state', state); }
  });
  const online = await updates.load({ dataDir, automation, createNetwork: () => new SiteNetwork(), getFreesoundKey: async () => { await keysReady; return apiKeys.key; } });
  const freesound = online.find(provider => provider.id === 'freesound');
  const local = new LocalFolders(dataDir); await local.restore();
  const providers = [...online, local];
  for (const sample of await catalogStore.read([])) {
    if (/^(lab|maou|onjin|dova|samplefocus|landr|splice|noiiz|freesound|pixabay)-[a-f0-9]{20}$/.test(sample.id)) samples.set(sample.id, sample);
    // Keep project provenance after a folder is unregistered. Playback still goes
    // through LocalFolders.file(), which requires a currently registered root.
    if (/^local-[a-f0-9]{20}$/.test(sample.id) && typeof sample.localPath === 'string') samples.set(sample.id, { ...sample, available: local.catalog.has(sample.id) });
  }
  for (const provider of providers) for (const sample of provider.catalog.values()) samples.set(sample.id, sample);
  let persistTimer;
  function persistCatalog() { clearTimeout(persistTimer); return catalogStore.write([...samples.values()]); }
  function scheduleCatalog() { clearTimeout(persistTimer); persistTimer = setTimeout(() => { void persistCatalog().catch(error => console.error('Library:', error.message)); }, 250); }
  flushOnQuit = async () => {
    // Electron batches DOMStorage writes. Flush before quitting so a quick restart
    // retains workflow preferences and the renderer's favorites/history.
    session.defaultSession.flushStorageData();
    await persistCatalog(); if (ui) await uiStore.write(ui); await local.store.flush(); await cacheStore.flush(); await apiKeys.store.flush();
  };
  const staticAudio = new SiteNetwork();
  const cache = new AudioCache({ request: async (url, options) => { const provider = providers.find(provider => provider.id === options.sample?.site); return provider?.download ? provider.download(options.sample, options) : staticAudio.request(url, options); }, promote: (sample, priority) => { const provider = providers.find(provider => provider.id === sample.site); if (provider?.promote) provider.promote(sample, priority); else staticAudio.promote(sample, priority); } }, path.join(dataDir, 'audio'), { maxBytes: cacheLimits.has(cacheOptions?.maxBytes) ? cacheOptions.maxBytes : DEFAULT_LIMIT, onEvicted: id => { if (window && !window.isDestroyed()) window.webContents.send('cache-evicted', id); } });
  let playbackPins = [];
  function updateCachePins() { cache.policy.setPins([...playbackPins, ...(ui?.compareIds || [])]); }
  updateCachePins();
  const fileFor = (sample, options) => sample.site === 'local' ? local.file(sample) : cache.get(sample, options);
  const acquireFile = async (sample, options) => sample.site === 'local' ? { file: await local.file(sample), release() {} } : cache.acquire(sample, options);
  async function withFile(sample, run) { const lease = await acquireFile(sample); try { return await run(lease.file); } finally { lease.release(); } }
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  const soundtouchDir = path.dirname(require.resolve('@soundtouchjs/audio-worklet'));
  const vendorAssets = new Map(['SoundTouchNode.js', 'constants.js', 'soundtouch-processor.js'].map(name => [`/soundtouch/${name}`, path.join(soundtouchDir, name)]));
  vendorAssets.set('/query.js', path.join(__dirname, '../shared/query.js'));
  protocol.handle('allsample', async request => {
    const url = new URL(request.url);
    try {
      if (url.host !== 'app') return new Response('Not found', { status: 404 });
      if (url.pathname.startsWith('/audio/')) { const sample = samples.get(url.pathname.slice('/audio/'.length)); if (!sample) return new Response('Not found', { status: 404 }); if (sample.site !== 'local') return await cache.response(sample, request.headers.get('range'), { complete: url.searchParams.has('waveform') }); const lease = await acquireFile(sample); try { return await mediaResponse(lease.file, request.headers.get('range'), lease.release); } catch (error) { lease.release(); throw error; } }
      const assets = new Set(['/index.html', '/app.js', '/style.css', '/filters.js', '/audio-graph.js', '/library-ui.js', '/filter-controls.js', '/settings-ui.js', '/icons.js', '/icons.svg', '/palette.css', '/design-system.css']);
      const file = vendorAssets.get(url.pathname) || (assets.has(url.pathname) ? path.join(rendererDir, url.pathname) : null);
      if (!file) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).href);
    } catch (error) { console.error(error.message); return new Response('取得できませんでした', { status: 502 }); }
  });
  function trusted(event) { if (!window || event.sender !== window.webContents || event.senderFrame?.url !== 'allsample://app/index.html') throw new Error('無効な呼び出しです'); }
  function sampleFor(id) { const sample = samples.get(id); if (!sample) throw new Error('素材が見つかりません。検索し直してください。'); return sample; }
  function handle(name, fn) { ipcMain.handle(name, async (event, ...args) => { trusted(event); try { return { ok: true, value: await fn(...args) }; } catch (error) { return { ok: false, error: error.message }; } }); }
  handle('bootstrap', async () => ({ ui, samples: [...samples.values()], folders: local.folders }));
  handle('save-state', async state => { ui = cleanState(state); updateCachePins(); await uiStore.write(ui); return ui; });
  handle('cache-pins', async ids => { if (!Array.isArray(ids) || ids.length > 10 || ids.some(id => typeof id !== 'string' || !samples.has(id))) throw new Error('読み込み中の素材を確認してください'); playbackPins = [...new Set(ids)]; updateCachePins(); return null; });
  let keyRevision = 0;
  handle('api-key-status', async () => { await keysReady; return apiKeys.status(); });
  handle('set-freesound-key', async ({ key, persist }) => { const revision = ++keyRevision; await keysReady; if (revision !== keyRevision) throw new Error('APIキーの保存を中止しました'); if (!validKey(typeof key === 'string' ? key.trim() : '')) throw new Error('APIキーの形式を確認してください'); await freesound.verifyKey(key.trim()); if (revision !== keyRevision) throw new Error('APIキーの保存を中止しました'); const status = await apiKeys.set(key, persist === true); freesound.invalidate(); return status; });
  handle('clear-freesound-key', async () => { ++keyRevision; await keysReady; const status = await apiKeys.clear(); freesound.invalidate(); return status; });
  handle('open-api-setup', async () => shell.openExternal('https://freesound.org/apiv2/apply/'));
  handle('cache-stats', () => cache.policy.stats());
  handle('cache-limit', async bytes => { if (!cacheLimits.has(bytes)) throw new Error('キャッシュ容量を選択してください'); const pruning = cache.policy.setLimit(bytes), saving = cacheStore.write({ maxBytes: bytes }); await Promise.all([pruning, saving]); return cache.policy.stats(); });
  handle('cache-clear', () => cache.policy.prune({ clear: true }));
  handle('update-status', () => updates.status());
  handle('update-check', () => updates.check());
  handle('update-download', () => updates.download());
  app.on('before-quit', () => updates.stop());
  function syncLocal() { for (const [id, sample] of samples) if (sample.site === 'local') sample.available = local.catalog.has(id); for (const sample of local.catalog.values()) samples.set(sample.id, { ...sample, available: true }); scheduleCatalog(); }
  handle('add-folders', async () => { const chosen = await dialog.showOpenDialog(window, { title: '音源フォルダを追加', properties: ['openDirectory', 'multiSelections'] }); if (!chosen.canceled) await local.add(chosen.filePaths); syncLocal(); await persistCatalog(); return { folders: local.folders, samples: [...local.catalog.values()] }; });
  handle('remove-folder', async folder => { if (typeof folder !== 'string' || !local.folders.includes(folder)) throw new Error('登録済みフォルダを選択してください'); await local.remove(folder); syncLocal(); await persistCatalog(); return { folders: local.folders, samples: [...local.catalog.values()] }; });
  handle('search', async ({ query, requestId, enabledSites }) => {
    if (typeof query !== 'string' || query.length > 200 || !Number.isSafeInteger(requestId) || !Array.isArray(enabledSites)) throw new Error('検索語を確認してください');
    searchController?.abort(); const controller = new AbortController(); searchController = controller;
    const send = payload => { if (!controller.signal.aborted && window && !window.isDestroyed()) window.webContents.send('search-event', { requestId, ...payload }); };
    // Each site's search and error boundary is independent; local files participate in the same stream.
    void Promise.allSettled(providers.filter(provider => enabledSites.includes(provider.id)).map(async provider => {
      try {
        for await (const sample of provider.search(query, { signal: controller.signal })) { if (controller.signal.aborted) return; const previous = samples.get(sample.id); provider.reuseKnown?.(sample, previous); for (const key of ['duration', 'channels', 'sampleRate', 'metadataVerified']) if (sample[key] == null && previous?.[key] != null) sample[key] = previous[key]; samples.set(sample.id, sample); scheduleCatalog(); send({ sample }); }
      } catch (error) { send({ siteError: `${provider.name}：${error.message}` }); }
    })).then(async () => { send({ done: true }); await persistCatalog(); }).catch(error => console.error('Library:', error.message));
    return null;
  });
  handle('metadata', async (id, measured) => {
    const sample = sampleFor(id);
    if (!measured || !Number.isFinite(measured.duration) || measured.duration <= 0 || measured.duration > 86400 || !Number.isInteger(measured.channels) || measured.channels < 1 || measured.channels > 32 || !Number.isFinite(measured.sampleRate) || measured.sampleRate < 8000 || measured.sampleRate > 384000) throw new Error('音声の情報を確認できませんでした');
    let metadata;
    if (sample.site === 'local' || sample.metadataVerified) metadata = { duration: sample.duration, channels: sample.channels, sampleRate: sample.sampleRate };
    else {
      try {
        // decodeAudioData resamples to the output device. Read the original file
        // header here so its source sample rate is not replaced by the device rate.
        const { parseFile } = await import('music-metadata');
        const { format } = await withFile(sample, file => parseFile(file, { skipCovers: true, duration: true }));
        metadata = { duration: format.duration, channels: format.numberOfChannels, sampleRate: format.sampleRate }; sample.metadataVerified = true;
      } catch { metadata = { sampleRate: null }; }
    }
    const result = { duration: metadata.duration ?? measured.duration, channels: metadata.channels ?? measured.channels, sampleRate: metadata.sampleRate ?? null };
    Object.assign(sample, result); scheduleCatalog(); return { ...result, license: sample.license, audioUrl: sample.audioUrl, ...Object.fromEntries(['isPreview', 'format', 'bpm', 'key', 'loop', 'author', 'description', 'kind'].filter(key => sample[key] !== undefined).map(key => [key, sample[key]])) };
  });
  let audioPriority = 100;
  handle('prepare', async (id, intent) => { const sample = sampleFor(id); if (sample.site === 'local' && sample.size > 128 * 1024 * 1024) throw new Error('試聴できるローカル音源は128MBまでです。保存・パスコピーは利用できます。'); if (sample.site === 'local') await fileFor(sample); else await cache.prepare(sample, { priority: intent === 'prefetch' ? 0 : ++audioPriority }); return `allsample://app/audio/${id}`; });
  async function defaultExport(id, downloadsOnly = false) {
    const sample = sampleFor(id);
    if (sample.site === 'local' && !downloadsOnly) return local.file(sample);
    const revision = sample.site === 'local' ? await localRevision(await local.file(sample)) : null;
    const previous = exportsById.get(id);
    if (previous && previous.revision === revision && (!downloadsOnly || path.dirname(previous.file) === path.join(app.getPath('downloads'), sample.siteName))) { try { await fs.access(previous.file); return previous.file; } catch {} }
    const result = await withFile(sample, file => copyUnique(file, path.join(app.getPath('downloads'), sample.siteName), exportFilename(sample))); exportsById.set(id, { file: result, revision }); return result;
  }
  async function localRevision(file) { const stat = await fs.stat(file); return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join(':'); }
  handle('save', async id => {
    const sample = sampleFor(id);
    const chosen = await dialog.showSaveDialog(window, { title: '音源を保存', defaultPath: path.join(app.getPath('downloads'), exportFilename(sample)), filters: [{ name: `${sample.format} 音声`, extensions: [extension(sample)] }] });
    if (chosen.canceled) return null;
    let revision = null;
    await withFile(sample, async source => { if (sample.site === 'local') revision = await localRevision(source); if (path.resolve(source) !== path.resolve(chosen.filePath)) await fs.copyFile(source, chosen.filePath); });
    exportsById.set(id, { file: chosen.filePath, revision }); return chosen.filePath;
  });
  handle('copy-path', async id => { const file = await defaultExport(id); clipboard.writeText(file); return file; });
  handle('reveal', async id => { const file = await defaultExport(id); shell.showItemInFolder(file); return file; });
  handle('batch', async ids => { if (!Array.isArray(ids) || ids.length > 500) throw new Error('一度に書き出せるのは500件までです'); const files = []; for (const id of ids) files.push(await defaultExport(id, true)); return files; });
  handle('open-page', async id => { const sample = sampleFor(id); if (sample.site === 'local') shell.showItemInFolder(await local.file(sample)); else if (new URL(sample.pageUrl).protocol === 'https:') await shell.openExternal(sample.pageUrl); });
  handle('open-terms', async id => { const url = sampleFor(id).license.termsUrl; if (url && new URL(url).protocol === 'https:') await shell.openExternal(url); });
  handle('credits', async ids => {
    if (!Array.isArray(ids) || ids.length > 500) throw new Error('素材リストを確認してください');
    const used = ids.map(sampleFor).filter(sample => sample.license.attribution !== false);
    const text = used.length ? [...new Set(used.map(sample => `${sample.title}\n${sample.license.credit}${sample.license.attribution == null ? '\n※利用条件・表記要否を確認してください。' : ''}${sample.license.termsUrl ? '\n' + sample.license.termsUrl : ''}`))].join('\n\n') + '\n' : 'クレジット表記が必要な素材はありません。\n';
    const chosen = await dialog.showSaveDialog(window, { title: 'クレジットを書き出す', defaultPath: path.join(app.getPath('downloads'), 'クレジット.txt'), filters: [{ name: 'テキスト', extensions: ['txt'] }] });
    if (chosen.canceled) return null;
    await fs.writeFile(chosen.filePath, '\ufeff' + text, 'utf8'); return chosen.filePath;
  });
  handle('copy-credit', async id => { clipboard.writeText(sampleFor(id).license.credit); });
  const dragIcon = nativeImage.createFromPath(appIconPath).resize({ width: 32, height: 32, quality: 'best' });
  const dragFiles = new DragFiles({ acquire: acquireFile, folder: sample => path.join(app.getPath('downloads'), sample.siteName) });
  handle('prepare-drag', async (id, intent) => { await dragFiles.prepare(sampleFor(id), intent === 'prefetch' ? 0 : ++audioPriority); return true; });
  ipcMain.on('start-drag', (event, id) => {
    try {
      trusted(event); const sample = sampleFor(id);
      const file = dragFiles.start(sample, item => event.sender.startDrag(item), dragIcon);
      if (sample.site !== 'local') exportsById.set(id, { file, revision: null });
    } catch { if (!event.sender.isDestroyed()) event.sender.send('action-error', '音源の準備ができていません。行を選択して、もう一度ドラッグしてください。'); }
  });
  await createWindow();
  updates.start();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) void createWindow(); });
}).catch(error => { console.error(error); app.quit(); });
app.on('window-all-closed', () => { searchController?.abort(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => { if (quitting) return; searchController?.abort(); automation.closeAll(); if (!flushOnQuit) return; event.preventDefault(); quitting = true; void flushOnQuit().catch(error => console.error(error.message)).finally(() => app.quit()); });
