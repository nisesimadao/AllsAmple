const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { JsonStore } = require('../persistence.cjs');
const { expandQuery } = require('./soundeffect-lab.cjs');
const EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.aif', '.aiff']);
const license = Object.freeze({ category: 'red', commercial: null, attribution: null, redistribution: null, contentId: null, adult: null, modification: null, credit: 'ローカル素材：入手元の利用条件を確認してください。', termsUrl: null, note: 'ローカルの音源です。利用条件は入手元で確認してください。ファイルの所有と利用許諾は別です。' });
function within(file, root) { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
function localMatches(sample, query) {
  const text = `${sample.title} ${sample.description} ${sample.relativePath || ''}`.normalize('NFKC').toLowerCase();
  const terms = expandQuery(query); return !terms.length || terms.some(term => /^[a-z]+$/.test(term) ? new RegExp(`(?:^|[^a-z])${term}(?:[^a-z]|$)`).test(text) : text.includes(term));
}
class LocalFolders {
  id = 'local'; name = 'ローカル'; catalog = new Map(); folders = []; tail = Promise.resolve();
  constructor(dataDir) { this.store = new JsonStore(path.join(dataDir, 'local-index.json')); }
  async restore() { const data = await this.store.read({ folders: [], items: [] }); this.folders = Array.isArray(data.folders) ? data.folders : []; for (const item of data.items || []) if (typeof item.localPath === 'string' && this.folders.some(root => within(item.localPath, root))) this.catalog.set(item.id, { ...item, license }); }
  async persist() { await this.store.write({ folders: this.folders, items: [...this.catalog.values()] }); }
  async *walk(root, signal) {
    let entries; try { entries = await fs.opendir(root); } catch { return; }
    for await (const entry of entries) { if (signal?.aborted) return; const file = path.join(root, entry.name); if (entry.isDirectory() && !entry.name.startsWith('.')) yield* this.walk(file, signal); else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) yield file; }
  }
  async refresh(signal) {
    const previous = this.tail; let release; this.tail = new Promise(resolve => { release = resolve; }); await previous;
    try {
      const next = new Map(); let visited = 0;
      const { parseFile } = await import('music-metadata');
      for (const root of this.folders) for await (const file of this.walk(root, signal)) {
        if (signal?.aborted) return;
        const id = `local-${createHash('sha256').update(file).digest('hex').slice(0, 20)}`;
        try {
          const stat = await fs.stat(file); const previous = this.catalog.get(id);
          if (previous?.mtimeMs === stat.mtimeMs && previous.ctimeMs === stat.ctimeMs && previous.ino === stat.ino && previous.size === stat.size) { next.set(id, previous); continue; }
          const metadata = await parseFile(file, { skipCovers: true, duration: true });
          const title = metadata.common.title?.trim() || path.basename(file);
          const bpmTag = metadata.common.bpm; const bpmName = path.basename(file).match(/(?:^|[\s_-])(\d{2,3})(?:\s?bpm|[_-])/i)?.[1];
          const key = metadata.common.key || path.basename(file).match(/(?:^|[\s_-])([A-G][#b]?(?:m|maj|min)?)(?:[\s_.-]|$)/)?.[1] || null;
          next.set(id, { id, site: this.id, siteName: this.name, title, description: [metadata.common.artist, path.basename(root), path.dirname(path.relative(root, file)) === '.' ? null : path.dirname(path.relative(root, file))].filter(Boolean).join(' · '), kind: /(?:^|[\s_-])loop(?:[\s_.-]|$)/i.test(file) ? 'ループ' : '効果音', duration: metadata.format.duration ?? null, bpm: Number(bpmTag || bpmName) || null, key, loop: /(?:^|[\s_-])loop(?:[\s_.-]|$)/i.test(file) ? true : null, channels: metadata.format.numberOfChannels ?? null, sampleRate: metadata.format.sampleRate ?? null, price: 'free', pageUrl: pathToFileURL(file).href, audioUrl: pathToFileURL(file).href, localPath: file, relativePath: path.relative(root, file), root, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, size: stat.size, format: path.extname(file).slice(1).toUpperCase(), isPreview: false, license });
        } catch { /* One unreadable or unsupported file must not hide the rest of a folder. */ }
        if (++visited % 40 === 0) await new Promise(resolve => setImmediate(resolve));
      }
      if (signal?.aborted) return;
      this.catalog = next; await this.persist();
    } finally { release(); }
  }
  async add(folders) {
    for (const folder of folders) { const resolved = await fs.realpath(folder); if (!(await fs.stat(resolved)).isDirectory()) continue; if (this.folders.some(root => within(resolved, root))) continue; this.folders = this.folders.filter(root => !within(root, resolved)); this.folders.push(resolved); }
    await this.refresh(); return this.folders;
  }
  async remove(folder) { this.folders = this.folders.filter(root => root !== folder); for (const [id, sample] of this.catalog) if (!this.folders.some(root => within(sample.localPath, root))) this.catalog.delete(id); await this.persist(); }
  async file(sample) {
    const actual = await fs.realpath(sample.localPath);
    if (!this.catalog.has(sample.id) || !this.folders.some(root => within(actual, root))) throw new Error('このローカルフォルダは登録されていません');
    return actual;
  }
  async *search(query, { signal } = {}) {
    await this.refresh(signal);
    for (const sample of this.catalog.values()) { if (signal?.aborted) return; if (localMatches(sample, query)) yield sample; }
  }
}
module.exports = { LocalFolders, localMatches, within, EXTENSIONS };
