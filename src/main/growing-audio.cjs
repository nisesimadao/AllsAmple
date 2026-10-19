const fs = require('node:fs/promises');

// One transfer feeds both auditioning and the final, unchanged cache file.
// Readers wait at the current EOF; a normal file stream would stop there.
class GrowingAudio {
  constructor(file) {
    this.file = file; this.partial = `${file}.part`; this.size = null; this.written = 0;
    this.done = false; this.error = null; this.listeners = new Set();
    this.ready = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.ready.catch(() => {});
  }
  wake() { for (const listener of [...this.listeners]) listener(); }
  async begin({ size }) {
    this.size = Number.isSafeInteger(size) && size > 0 ? size : null;
    await fs.writeFile(this.partial, Buffer.alloc(0));
  }
  async append(chunk) {
    await fs.appendFile(this.partial, chunk); this.written += chunk.length;
    if (this.size && this.written > this.size) throw new Error('音声のサイズが応答と一致しません');
    if (this.size && this.written) this.resolve(this);
    this.wake();
  }
  async complete() {
    if (!this.written) throw new Error('音声が空です');
    if (this.size != null && this.size !== this.written) throw new Error('音声の取得が途中で終了しました');
    await fs.rename(this.partial, this.file);
    this.size = this.written; this.done = true; this.resolve(this); this.wake();
  }
  fail(error) { this.error = error; this.reject(error); this.wake(); }
}

function growingResponse(transfer, range, release) {
  const size = transfer.size, headers = { 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/mpeg' };
  let start = 0, end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    } else start = NaN;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      release(); return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  let position = start, cancelled = false, active = false, closed = false, wake;
  const close = () => { if (!closed) { closed = true; release(); } };
  const stream = new ReadableStream({
    async pull(controller) {
      active = true;
      try {
        while (!cancelled && position >= transfer.written && !transfer.done && !transfer.error) {
          await new Promise(resolve => { wake = () => { transfer.listeners.delete(wake); resolve(); }; transfer.listeners.add(wake); });
        }
        if (cancelled) return;
        if (transfer.error) throw transfer.error;
        if (position > end) { controller.close(); close(); return; }
        const count = Math.min(64 * 1024, end - position + 1, transfer.written - position);
        if (count <= 0) throw new Error('音声の取得が途中で終了しました');
        // Rename can happen between choosing a path and opening it.
        let handle;
        try { handle = await fs.open(transfer.done ? transfer.file : transfer.partial, 'r'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; handle = await fs.open(transfer.file, 'r'); }
        const bytes = Buffer.allocUnsafe(count); let read;
        try { read = (await handle.read(bytes, 0, count, position)).bytesRead; } finally { await handle.close(); }
        if (cancelled) return;
        if (!read) throw new Error('音声を読み込めませんでした');
        position += read; controller.enqueue(bytes.subarray(0, read));
        if (position > end) { controller.close(); close(); }
      } catch (error) { if (!cancelled) controller.error(error); close(); }
      finally { active = false; if (cancelled) close(); }
    },
    cancel() { cancelled = true; wake?.(); if (!active) close(); }
  });
  return new Response(stream, { status: range ? 206 : 200, headers });
}
module.exports = { GrowingAudio, growingResponse };
