const fs = require('node:fs');
const path = require('node:path');
const { exportFilename } = require('./library.cjs');

// Native drag must begin inside the OS drag gesture. Network work happens in
// advance; only a local file copy and startDrag remain in that gesture.
class DragFiles {
  constructor({ acquire, folder }) { this.acquire = acquire; this.folder = folder; this.ready = new Map(); this.pending = new Map(); this.exports = new Map(); }
  async prepare(sample, priority = 100) {
    if (this.pending.has(sample.id)) { void this.acquire(sample, { priority }).then(lease => lease.release()).catch(() => {}); return this.pending.get(sample.id); }
    const job = (async () => {
      const lease = await this.acquire(sample, { priority });
      try { this.ready.set(sample.id, { sample, source: lease.file }); }
      finally { lease.release(); }
    })();
    this.pending.set(sample.id, job);
    try { await job; } finally { if (this.pending.get(sample.id) === job) this.pending.delete(sample.id); }
  }
  start(sample, startDrag, icon) {
    const entry = this.ready.get(sample.id);
    if (!entry || sample.available === false) throw new Error('音源の準備ができていません。もう一度ドラッグしてください。');
    fs.accessSync(entry.source);
    let file = entry.source;
    if (sample.site !== 'local') {
      // A DAW may reference the dropped path instead of copying it. Export on
      // the actual drag, so cache eviction cannot break that project later.
      const previous = this.exports.get(sample.id);
      if (previous && fs.existsSync(previous)) file = previous;
      else {
        const folder = this.folder(sample); fs.mkdirSync(folder, { recursive: true });
        const filename = exportFilename(sample), ext = path.extname(filename), stem = path.basename(filename, ext);
        for (let i = 0; ; i++) {
          if (i >= 10000) throw new Error('保存名を作成できません');
          file = path.join(folder, `${stem}${i ? ` (${i})` : ''}${ext}`);
          try { fs.copyFileSync(entry.source, file, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE); break; }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        this.exports.set(sample.id, file);
      }
    }
    startDrag({ file, icon });
    return file;
  }
}
module.exports = { DragFiles };
