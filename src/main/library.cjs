const { PriorityQueue } = require('./priority-queue.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { CachePolicy } = require('./cache-policy.cjs');
const { GrowingAudio, growingResponse } = require('./growing-audio.cjs');
const { mediaResponse } = require('./media-response.cjs');
const { unwrapPreview } = require('./preview-audio.cjs');
function safeName(title) {
  const cleaned = title.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '-');
  let name = '', bytes = 0;
  // Stay within both Windows UTF-16 limits and byte-based filesystem limits,
  // without cutting a surrogate pair in a Japanese/emoji title.
  for (const character of cleaned) { const size = Buffer.byteLength(character); if (name.length + character.length > 100 || bytes + size > 200) break; name += character; bytes += size; }
  name = name.replace(/[. ]+$/g, '') || 'sample';
  // Device names remain reserved even when an extension is appended.
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$) *($|\.)/i.test(name)) name = `_${name}`;
  return name;
}
function extension(sample) { if (sample.localPath) return path.extname(sample.localPath).slice(1).toLowerCase() || 'wav'; return /\.wav(?:\?|$)/i.test(sample.audioUrl) ? 'wav' : 'mp3'; }
function exportFilename(sample) { return `${safeName(sample.title.replace(/\.(?:wav|aiff?|mp3|ogg|flac)$/i, ''))}.${extension(sample)}`; }
async function copyUnique(source, folder, filename) {
  await fs.mkdir(folder, { recursive: true });
  const ext = path.extname(filename), stem = path.basename(filename, ext);
  for (let i = 0; i < 10000; i++) {
    const destination = path.join(folder, `${stem}${i ? ` (${i})` : ''}${ext}`);
    try { await fs.copyFile(source, destination, constants.COPYFILE_EXCL); return destination; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('保存名を作成できません');
}
class AudioCache {
  constructor(network, dir, options) { this.network = network; this.dir = dir; this.pending = new Map(); this.checkedPreviews = new Map(); this.queue = new PriorityQueue({ concurrency: 3, backgroundConcurrency: 1 }); this.policy = new CachePolicy(dir, { ...options, pending: this.pending }); }
  async acquire(sample, options) {
    const release = this.policy.hold(sample.id);
    try { return { file: await this.get(sample, options), release }; } catch (error) { release(); throw error; }
  }
  async get(sample, { priority = 100 } = {}) {
    const release = this.policy.hold(sample.id);
    try {
      // Wait only for this ID's deletion, so unrelated cleanup never holds up audio.
      await this.policy.waitFor(sample.id);
      const file = await this.load(sample, priority); await this.policy.touch(sample.id, file); return file;
    } finally { release(); }
  }
  async prepare(sample, { priority = 100 } = {}) {
    const release = this.policy.hold(sample.id);
    try { await this.policy.waitFor(sample.id); await this.load(sample, priority, true); }
    finally { release(); }
  }
  async response(sample, range, { complete = false } = {}) {
    const release = this.policy.hold(sample.id);
    try {
      await this.policy.waitFor(sample.id);
      // Waveform decoding needs the whole file and remains background work.
      const result = complete ? { file: await this.load(sample, 0) } : await this.load(sample, 100, true);
      if (result.transfer && !result.transfer.done) return growingResponse(result.transfer, range, release);
      await this.policy.touch(sample.id, result.file);
      return await mediaResponse(result.file, range, release);
    } catch (error) { release(); throw error; }
  }
  async load(sample, priority, early = false) {
    const file = path.join(this.dir, `${sample.id}.${extension(sample)}`);
    try {
      const stat = await fs.stat(file);
      if (stat.size > 0) {
        // Repair earlier cached Splice transport files as well as new downloads.
        // Share the atomic repair between waveform, audition and export readers.
        if (sample.site === 'splice') {
          let repair = this.checkedPreviews.get(file);
          if (!repair) {
            repair = (async () => { const bytes = await fs.readFile(file); const audio = unwrapPreview(bytes); if (audio !== bytes) { const temp = `${file}.repair`; await fs.writeFile(temp, audio); await fs.rename(temp, file); } })();
            this.checkedPreviews.set(file, repair);
            repair.catch(() => this.checkedPreviews.delete(file));
          }
          await repair;
        }
        return early ? { file } : file;
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.checkedPreviews.delete(file);
    const existing = this.pending.get(sample.id);
    if (existing) { existing.priority = Math.max(existing.priority, priority); existing.ticket.promote(priority); this.network.promote?.(sample, priority); return early ? existing.transfer.ready.then(transfer => ({ file, transfer })) : existing.ticket.promise; }
    const transfer = new GrowingAudio(file), entry = { priority, ticket: null, transfer };
    entry.ticket = this.queue.submit(async () => {
      try {
        await fs.mkdir(this.dir, { recursive: true });
        let streaming = false;
        const audio = await this.network.request(sample.audioUrl, { audio: true, pageUrl: sample.pageUrl, sample, priority: entry.priority,
          onHeaders: async headers => { streaming = true; await transfer.begin(headers); }, onChunk: chunk => transfer.append(chunk) });
        if (!streaming) {
          if (!audio?.length) throw new Error('音声が空です');
          const playable = sample.site === 'splice' ? unwrapPreview(audio) : audio;
          await fs.writeFile(transfer.partial, playable); transfer.written = playable.length;
        }
        await transfer.complete(); await this.policy.touch(sample.id, file); return file;
      } catch (error) { transfer.fail(error); await fs.unlink(transfer.partial).catch(() => {}); throw error; }
    }, { priority });
    this.pending.set(sample.id, entry);
    entry.ticket.promise.finally(() => this.pending.delete(sample.id)).catch(() => {});
    return early ? transfer.ready.then(transfer => ({ file, transfer })) : entry.ticket.promise;
  }
}
module.exports = { safeName, copyUnique, AudioCache, extension, exportFilename };
