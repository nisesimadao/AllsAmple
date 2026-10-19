const { PriorityQueue } = require('./priority-queue.cjs');
const USER_AGENT = 'AllsAmple/0.1 (+https://github.com/nisesimadao/AllsAmple)';
class SiteNetwork {
  constructor({ interval = 120, fetcher = fetch } = {}) {
    this.interval = interval; this.fetcher = fetcher; this.queue = new PriorityQueue({ concurrency: 3, backgroundConcurrency: 2 }); this.nextStart = new Map();
  }
  async request(url, { audio = false, pageUrl, priority = audio ? 100 : 0, signal } = {}) {
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
      const res = await this.fetcher(url, { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000), redirect: 'error' });
      if (!res.ok) throw new Error(`サイトから取得できませんでした (HTTP ${res.status})`);
      const limit = audio ? 80 * 1024 * 1024 : 5 * 1024 * 1024;
      const reader = res.body.getReader(); const chunks = []; let size = 0;
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error('ファイルが大きすぎます'); chunks.push(Buffer.from(value)); }
      } finally { await reader.cancel(); }
      const body = Buffer.concat(chunks);
      if (audio && !(/audio|octet-stream/i.test(res.headers.get('content-type') || '')) ) throw new Error('音声以外の応答を受信しました');
      return body;
    }, { priority, signal });
    return task.promise;
  }
}
module.exports = { SiteNetwork };
