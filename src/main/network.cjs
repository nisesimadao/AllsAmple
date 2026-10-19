const { PriorityQueue } = require('./priority-queue.cjs');
const USER_AGENT = 'AllsAmple/0.1 (+https://github.com/nisesimadao/AllsAmple)';
class SiteNetwork {
  constructor({ interval = 120, fetcher = fetch, idleTimeout = 30000 } = {}) {
    this.interval = interval; this.idleTimeout = idleTimeout; this.fetcher = fetcher; this.queue = new PriorityQueue({ concurrency: 3, backgroundConcurrency: 2 }); this.nextStart = new Map(); this.transfers = new Map();
  }
  promote(sample, priority) { this.transfers.get(sample.id)?.promote(priority); }
  async request(url, { audio = false, pageUrl, priority = audio ? 100 : 0, signal, sample, onHeaders, onChunk } = {}) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['soundeffect-lab.info', 'maou.audio', 'on-jin.com'].includes(target.hostname)) throw new Error('許可されていない取得先です');
    const task = this.queue.submit(async () => {
      if (priority <= 0) {
        const wait = Math.max(0, (this.nextStart.get(target.origin) || 0) - Date.now());
        this.nextStart.set(target.origin, Date.now() + wait + this.interval);
        if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      }
      signal?.throwIfAborted();
      // The download endpoint checks the referring source page, like SampleTap's CDN paths.
      // Keep our own User-Agent; pass the actual page from which the link was extracted.
      const headers = { 'User-Agent': USER_AGENT };
      if (pageUrl && new URL(pageUrl).origin === target.origin) headers.Referer = pageUrl;
      const idle = new AbortController(); let timer;
      const pulse = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new Error('音声・ページの応答が止まりました')), this.idleTimeout); timer.unref?.(); }; pulse();
      try {
      const res = await this.fetcher(url, { headers, signal: signal ? AbortSignal.any([signal, idle.signal]) : idle.signal, redirect: 'error' }); pulse();
      if (!res.ok) { await res.body?.cancel(); throw new Error(`サイトから取得できませんでした (HTTP ${res.status})`); }
      const limit = audio ? 80 * 1024 * 1024 : 5 * 1024 * 1024;
      if (audio && !/audio|octet-stream|application\/mpeg/i.test(res.headers.get('content-type') || '')) { await res.body?.cancel(); throw new Error('音声以外の応答を受信しました'); }
      const streaming = audio && onHeaders && onChunk;
      if (streaming) await onHeaders({ size: res.headers.get('content-encoding') ? null : Number(res.headers.get('content-length')), type: res.headers.get('content-type') });
      const reader = res.body.getReader(); const chunks = []; let size = 0;
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; pulse(); size += value.length; if (size > limit) throw new Error('ファイルが大きすぎます'); if (streaming) await onChunk(value); else chunks.push(Buffer.from(value)); }
      } finally { await reader.cancel(); }
      return streaming ? null : Buffer.concat(chunks);
      } finally { clearTimeout(timer); }
    }, { priority, signal });
    if (sample) this.transfers.set(sample.id, task);
    try { return await task.promise; } finally { if (sample && this.transfers.get(sample.id) === task) this.transfers.delete(sample.id); }
  }
}
module.exports = { SiteNetwork };
