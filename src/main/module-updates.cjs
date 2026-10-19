const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { JsonStore } = require('./persistence.cjs');
const FILES = require('./module-files.cjs');
const BASE = 'https://github.com/nisesimadao/AllsAmple/releases/download/modules/';
const LIMIT = 2 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validVersion = value => typeof value === 'string' && /^\d{1,8}(?:\.\d{1,8}){2,3}$/.test(value);
function newer(a, b) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) { const difference = (left[i] || 0) - (right[i] || 0); if (difference) return difference > 0; }
  return false;
}
function validate(bytes, manifest) {
  if (bytes.length !== manifest.bytes || bytes.length > LIMIT || hash(bytes) !== manifest.sha256) throw new Error('モジュールのダウンロードが不完全です。もう一度取得してください。');
  const bundle = JSON.parse(bytes.toString('utf8'));
  if (bundle.api !== 1 || bundle.version !== manifest.version || !bundle.files || Object.keys(bundle.files).length !== FILES.length || FILES.some(file => typeof bundle.files[file] !== 'string')) throw new Error('このモジュールは現在のアプリに対応していません。');
  // Compile before storing; do not run downloaded code just to check for updates.
  for (const file of FILES.filter(file => /\.(?:cjs|js)$/.test(file))) vm.compileFunction(bundle.files[file], ['require', 'module', 'exports', '__filename', '__dirname'], { filename: file });
  return bundle;
}
function loadBundle(bundle, folder, appRoot) {
  const hostRequire = createRequire(path.join(appRoot, 'package.json')), cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    if (typeof bundle.files[file] !== 'string') throw new Error(`モジュール内のファイルがありません: ${file}`);
    const module = { exports: {} }; cache.set(file, module);
    const filename = path.join(folder, file);
    // These are trusted application modules from the fixed project release, not
    // sandboxed third-party plugins. Dependencies come from the installed shell.
    const requireFile = specifier => {
      if (!specifier.startsWith('.')) return hostRequire(specifier);
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      const target = [relative, `${relative}.cjs`, `${relative}.js`].find(name => Object.hasOwn(bundle.files, name));
      if (!target) throw new Error(`モジュールの依存がありません: ${specifier}`);
      return load(target);
    };
    vm.compileFunction(bundle.files[file], ['require', 'module', 'exports', '__filename', '__dirname'], { filename })(requireFile, module, module.exports, filename, path.dirname(filename));
    return module.exports;
  }
  return load('src/main/site-module.cjs');
}
class ModuleUpdates {
  constructor({ dataDir, appRoot, bundled, fetcher = fetch, onChange = () => {} }) {
    Object.assign(this, { appRoot, bundled, fetcher, onChange });
    this.folder = path.join(dataDir, 'site-modules'); this.store = new JsonStore(path.join(this.folder, 'active.json'));
    this.state = { version: bundled.version, enabled: true, phase: 'idle', nextVersion: null, message: '' };
  }
  status() { return { ...this.state }; }
  set(change) { Object.assign(this.state, change); this.onChange(this.status()); }
  async load(context) {
    const active = await this.store.read(null);
    if (active) {
      try {
        if (!validVersion(active.version) || !/^[a-f0-9]{64}$/.test(active.sha256)) throw new Error('invalid module record');
        const folder = path.join(this.folder, `${active.version}-${active.sha256.slice(0, 12)}`);
        const bytes = await fs.readFile(path.join(folder, 'bundle.json'));
        const bundle = validate(bytes, active), entry = loadBundle(bundle, folder, this.appRoot);
        const providers = this.create(entry, context);
        await Promise.all(providers.map(provider => provider.restore()));
        this.set({ version: active.version, message: '' }); return providers;
      } catch {
        this.set({ message: '追加モジュールを読み込めなかったため、同梱版を使用しています。' });
      }
    }
    const providers = this.create(this.bundled, context);
    await Promise.all(providers.map(provider => provider.restore())); return providers;
  }
  create(entry, context) {
    if (entry.api !== 1 || typeof entry.create !== 'function') throw new Error('モジュールの形式が一致しません。');
    const providers = entry.create(context), ids = ['soundeffect-lab', 'maou', 'onjin', 'freesound', 'pixabay', 'samplefocus', 'landr', 'splice', 'noiiz'];
    if (!Array.isArray(providers) || providers.length !== ids.length || ids.some(id => !providers.some(provider => provider.id === id)) || providers.some(provider => typeof provider.search !== 'function' || typeof provider.restore !== 'function' || !(provider.catalog instanceof Map))) throw new Error('サイトモジュールを読み込めませんでした。');
    return providers;
  }
  async request(name, limit) {
    const response = await this.fetcher(BASE + name, { signal: AbortSignal.timeout(15000), headers: { 'cache-control': 'no-cache' } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('更新を確認できませんでした。時間を置いて試してください。');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error('モジュールのサイズが上限を超えています。'); chunks.push(Buffer.from(value)); }
    } finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks);
  }
  async check() {
    if (this.pending) return this.pending;
    if (this.state.phase === 'ready') return this.status();
    this.pending = (async () => {
      this.set({ phase: 'checking', message: '' });
      try {
        const bytes = await this.request('allsample-modules.json', 4096);
        if (!bytes) { this.set({ phase: 'current', nextVersion: null, message: '追加のモジュール更新はありません。' }); return this.status(); }
        const manifest = JSON.parse(bytes);
        if (manifest.api !== 1 || !validVersion(manifest.version) || manifest.asset !== `allsample-sites-${manifest.version}.json` || !/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > LIMIT) throw new Error('更新情報の形式を確認できませんでした。');
        this.manifest = newer(manifest.version, this.state.version) ? manifest : null;
        this.set({ phase: this.manifest ? 'available' : 'current', nextVersion: this.manifest?.version || null, message: '' });
      } catch (error) { this.set({ phase: 'error', message: error.message }); }
      return this.status();
    })().finally(() => { this.pending = null; }); return this.pending;
  }
  async download() {
    if (this.pending) { await this.pending; return this.state.phase === 'available' ? this.download() : this.status(); }
    if (this.state.phase === 'ready') return this.status();
    if (!this.manifest) throw new Error('先にモジュールの更新を確認してください。');
    this.pending = (async () => {
      this.set({ phase: 'downloading', message: '' });
      try {
        const manifest = this.manifest, bytes = await this.request(manifest.asset, LIMIT);
        if (!bytes) throw new Error('モジュールが見つかりませんでした。更新を確認し直してください。');
        const bundle = validate(bytes, manifest);
        const folder = path.join(this.folder, `${manifest.version}-${manifest.sha256.slice(0, 12)}`);
        await fs.mkdir(folder, { recursive: true });
        for (const file of FILES) { const target = path.join(folder, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bundle.files[file]); }
        await fs.writeFile(path.join(folder, 'bundle.json'), bytes);
        await this.store.write(manifest);
        this.set({ phase: 'ready', message: '取得しました。次回起動時に読み込みます。' });
      } catch (error) { this.set({ phase: 'error', message: error.message }); }
      return this.status();
    })().finally(() => { this.pending = null; }); return this.pending;
  }
  start() {
    this.timer = setTimeout(() => { void this.check(); }, 30000); this.timer.unref?.();
    this.interval = setInterval(() => { if (['idle', 'current', 'error'].includes(this.state.phase)) void this.check(); }, 6 * 60 * 60 * 1000); this.interval.unref?.();
  }
  stop() { clearTimeout(this.timer); clearInterval(this.interval); }
}
module.exports = { ModuleUpdates, validate, loadBundle, newer, BASE };
