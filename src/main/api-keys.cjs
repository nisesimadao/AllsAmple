const path = require('node:path');
const { JsonStore } = require('./persistence.cjs');
function validKey(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(value); }
class ApiKeys {
  constructor(dataDir, protector) { this.store = new JsonStore(path.join(dataDir, 'api-keys.json')); this.protector = protector; this.key = null; this.saved = false; this.error = ''; this.operation = 0; }
  async restore() {
    const data = await this.store.read({}); this.saved = typeof data?.freesoundCipher === 'string';
    if (!this.saved) return;
    try { if (!this.protector.available()) throw new Error('unavailable'); const key = await this.protector.decrypt(Buffer.from(data.freesoundCipher, 'base64')); if (!validKey(key)) throw new Error('invalid'); this.key = key; }
    catch { this.error = '保存したAPIキーを読み出せませんでした。設定から入力し直すか解除してください'; }
  }
  status() { return { configured: Boolean(this.key), saved: this.saved, canPersist: this.protector.available(), error: this.error }; }
  async set(value, persist) {
    const operation = ++this.operation;
    const key = typeof value === 'string' ? value.trim() : ''; if (!validKey(key)) throw new Error('APIキーの形式を確認してください');
    let data = {};
    if (persist) { if (!this.protector.available()) throw new Error('この環境ではキーを保存できません。「この端末に保存」を外して使用できます'); data = { freesoundCipher: (await this.protector.encrypt(key)).toString('base64') }; }
    if (operation !== this.operation) throw new Error('APIキーの保存を中止しました');
    await this.store.write(data); if (operation !== this.operation) throw new Error('APIキーの保存を中止しました');
    this.key = key; this.saved = persist === true; this.error = ''; return this.status();
  }
  async clear() { ++this.operation; await this.store.write({}); this.key = null; this.saved = false; this.error = ''; return this.status(); }
}
module.exports = { ApiKeys, validKey };
