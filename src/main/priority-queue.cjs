class PriorityQueue {
  pending = []; active = 0; background = 0; sequence = 0;
  constructor({ concurrency = 3, backgroundConcurrency = 1 } = {}) { this.concurrency = concurrency; this.backgroundConcurrency = backgroundConcurrency; }
  submit(run, { priority = 0, signal } = {}) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const task = { run, priority, signal, resolve, reject, sequence: this.sequence++, started: false };
    const abort = () => { if (task.started) return; this.pending = this.pending.filter(item => item !== task); reject(signal.reason || new Error('キャンセルされました')); };
    if (signal?.aborted) { abort(); return { promise, promote() {} }; }
    signal?.addEventListener('abort', abort, { once: true });
    task.cleanup = () => signal?.removeEventListener('abort', abort);
    this.pending.push(task); queueMicrotask(() => this.pump());
    return { promise, promote: priority => { if (task.started) return; task.priority = Math.max(task.priority, priority); this.pump(); } };
  }
  pump() {
    this.pending.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
    while (this.active < this.concurrency) {
      const index = this.pending.findIndex(task => task.priority > 0 || this.background < this.backgroundConcurrency);
      if (index < 0) break;
      const task = this.pending.splice(index, 1)[0]; task.started = true; task.cleanup();
      const background = task.priority <= 0; this.active++; if (background) this.background++;
      Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => { this.active--; if (background) this.background--; this.pump(); });
    }
  }
}
module.exports = { PriorityQueue };
