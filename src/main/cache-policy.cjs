const fs = require('node:fs/promises');
const path = require('node:path');
const DEFAULT_LIMIT = 2 * 1024 ** 3;
const OWN_FILE = /^([a-z-]+-[a-f0-9]{20})\.(mp3|wav)$/;
class CachePolicy {
  constructor(dir, { maxBytes = DEFAULT_LIMIT, pending = new Map(), recentMs = 15000, onEvicted } = {}) {
    this.dir = dir; this.maxBytes = maxBytes; this.pending = pending; this.recentMs = recentMs; this.onEvicted = onEvicted;
    this.held = new Map(); this.pins = new Set(); this.recent = new Map(); this.touched = new Map(); this.deleting = new Map(); this.maintenance = Promise.resolve();
  }
  hold(id) {
    this.held.set(id, (this.held.get(id) || 0) + 1); let released = false;
    return () => { if (released) return; released = true; const remaining = this.held.get(id) - 1; if (remaining > 0) this.held.set(id, remaining); else this.held.delete(id); this.schedule(); };
  }
  inUse(id) { return this.pins.has(id) || this.held.has(id) || this.pending.has(id); }
  async waitFor(id) { await this.deleting.get(id); }
  async remove(file, id) {
    if (this.inUse(id)) return false;
    // Set this before yielding: a new read either protects the ID first, or waits
    // for this exact deletion and then rechecks the file. Other IDs never wait.
    const removing = fs.unlink(file), settled = removing.catch(() => {}); this.deleting.set(id, settled);
    try { await removing; return true; } finally { if (this.deleting.get(id) === settled) this.deleting.delete(id); }
  }
  setPins(ids) { this.pins = new Set(ids); this.schedule(); }
  keepFor(id, milliseconds) { this.recent.set(id, Math.max(this.recent.get(id) || 0, Date.now() + milliseconds)); }
  async touch(id, file) {
    this.keepFor(id, this.recentMs);
    const now = Date.now(); if (now - (this.touched.get(file) || 0) < 1000) return;
    this.touched.set(file, now); await fs.utimes(file, new Date(now), new Date(now)).catch(() => {});
  }
  schedule(delay = 300) {
    const at = Date.now() + delay; if (this.timer && this.nextAt <= at) return;
    clearTimeout(this.timer); this.nextAt = at;
    this.timer = setTimeout(() => { this.timer = null; void this.prune().catch(error => console.error('Cache:', error.message)); }, delay); this.timer.unref?.();
  }
  async scan() {
    let entries; try { entries = await fs.readdir(this.dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const files = [];
    for (let index = 0; index < entries.length; index += 32) {
      await Promise.all(entries.slice(index, index + 32).map(async entry => {
        if (!entry.isFile()) return;
        const match = OWN_FILE.exec(entry.name); if (!match) return;
        const file = path.join(this.dir, entry.name);
        try { const stat = await fs.stat(file); files.push({ id: match[1], file, size: stat.size, time: stat.mtimeMs }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }));
    }
    return files;
  }
  summarize(files) { return { bytes: files.reduce((total, file) => total + file.size, 0), files: files.length, inUse: files.filter(file => this.inUse(file.id)).length, maxBytes: this.maxBytes }; }
  async stats() { await this.maintenance; return this.summarize(await this.scan()); }
  async setLimit(bytes) { if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 20 * 1024 ** 3) throw new Error('キャッシュ容量を確認してください'); this.maxBytes = bytes; return this.prune(); }
  prune({ clear = false } = {}) {
    const job = this.maintenance.catch(() => {}).then(async () => {
      const files = (await this.scan()).sort((a, b) => a.time - b.time || a.file.localeCompare(b.file));
      let bytes = files.reduce((total, file) => total + file.size, 0), removedBytes = 0, removedFiles = 0, nextExpiry = Infinity;
      for (const file of files) {
        if (!clear && bytes <= this.maxBytes) break;
        if (this.inUse(file.id)) continue;
        const expiry = this.recent.get(file.id) || 0;
        if (!clear && expiry > Date.now()) { nextExpiry = Math.min(nextExpiry, expiry); continue; }
        try { if (await this.remove(file.file, file.id)) { bytes -= file.size; removedBytes += file.size; removedFiles++; this.touched.delete(file.file); this.onEvicted?.(file.id); } }
        catch (error) { if (error.code !== 'ENOENT' && !['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error; }
      }
      // Only stale, owned partial files are disposable. A current transfer keeps
      // its ID held, and unrelated files/symlinks are outside this cache policy.
      for (const entry of await fs.readdir(this.dir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
        if (!entry.isFile() || !entry.name.endsWith('.part')) continue;
        const match = OWN_FILE.exec(entry.name.slice(0, -5)); if (!match || this.inUse(match[1])) continue;
        const file = path.join(this.dir, entry.name); const stat = await fs.stat(file).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > 86400000) await this.remove(file, match[1]).catch(() => {});
      }
      if (!clear && bytes > this.maxBytes && Number.isFinite(nextExpiry)) this.schedule(Math.max(10, nextExpiry - Date.now() + 10));
      return { ...this.summarize(await this.scan()), removedBytes, removedFiles };
    });
    this.maintenance = job.catch(() => {}); return job;
  }
}
module.exports = { CachePolicy, DEFAULT_LIMIT };
