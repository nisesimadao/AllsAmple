const fs = require('node:fs/promises');
const path = require('node:path');
class JsonStore {
  tail = Promise.resolve();
  constructor(file) { this.file = file; }
  async read(fallback) { try { return JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback; throw error; } }
  write(value) {
    const text = JSON.stringify(value);
    const task = this.tail.catch(() => {}).then(async () => { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(`${this.file}.tmp`, text); await fs.rename(`${this.file}.tmp`, this.file); });
    this.tail = task; return task;
  }
  async flush() { await this.tail; }
}
module.exports = { JsonStore };
