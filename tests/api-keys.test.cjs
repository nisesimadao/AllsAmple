const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ApiKeys } = require('../src/main/api-keys.cjs');
const { createKeyProtector } = require('../src/main/key-protector.cjs');
function protector() {
  const master = crypto.randomBytes(32);
  return { available: () => true, encrypt: async text => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', master, iv); const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); }, decrypt: async bytes => { const decipher = crypto.createDecipheriv('aes-256-gcm', master, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(); } };
}
const token = 'test_private_token_0123456789';
test('persistent keys use the supplied OS protector and only encrypted bytes reach JSON', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-keys-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const protectedStorage = protector(), keys = new ApiKeys(dir, protectedStorage); await keys.restore(); await keys.set(token, true);
  const json = await fs.readFile(keys.store.file, 'utf8'); assert(!json.includes(token)); assert(!JSON.stringify(keys.status()).includes(token));
  const restored = new ApiKeys(dir, protectedStorage); await restored.restore(); assert.equal(restored.key, token); assert.equal(restored.status().saved, true);
  await restored.clear(); const empty = new ApiKeys(dir, protectedStorage); await empty.restore(); assert.equal(empty.key, null); assert.deepEqual(JSON.parse(await fs.readFile(keys.store.file, 'utf8')), {});
});
test('session-only keys are not persisted and insecure storage cannot silently save plaintext', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-keys-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const keys = new ApiKeys(dir, { available: () => false }); await keys.set(token, false); assert.equal(keys.key, token);
  assert(!JSON.stringify(await keys.store.read({})).includes(token)); await assert.rejects(keys.set(token, true), /保存できません/);
  const restored = new ApiKeys(dir, { available: () => false }); await restored.restore(); assert.equal(restored.key, null);
  await assert.rejects(keys.set('bad\nheader', false), /形式/);
});
test('an unreadable encrypted key leaves public search available and can be removed', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-keys-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const keys = new ApiKeys(dir, protector()); await keys.set(token, true);
  const moved = new ApiKeys(dir, protector()); await moved.restore(); assert.equal(moved.key, null); assert(moved.status().error.includes('読み出せません')); assert.equal(moved.status().saved, true);
  await moved.clear(); assert.equal(moved.status().error, '');
});
test('clearing a key while encryption is pending cannot resurrect it afterwards', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'allsample-keys-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let release, entered; const waiting = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const storage = protector(), keys = new ApiKeys(dir, { ...storage, encrypt: async text => { entered(); await waiting; return storage.encrypt(text); } });
  const saving = keys.set(token, true); await started; await keys.clear(); release(); await assert.rejects(saving, /中止/);
  assert.equal(keys.key, null); assert.deepEqual(await keys.store.read({}), {});
});
test('opening key settings never probes a synchronous OS vault; only explicit storage uses asynchronous encryption', async () => {
  let calls = 0;
  const storage = { isEncryptionAvailable: () => { throw new Error('synchronous vault access is forbidden'); }, isAsyncEncryptionAvailable: async () => { calls++; return true; }, encryptStringAsync: async text => Buffer.from(text), decryptStringAsync: async bytes => ({ result: bytes.toString() }) };
  const protectedStorage = createKeyProtector(storage, 'darwin');
  assert.equal(protectedStorage.available(), true); assert.equal(calls, 0);
  assert.equal((await protectedStorage.encrypt(token)).toString(), token); assert.equal(calls, 1);
  assert.equal(await protectedStorage.decrypt(Buffer.from(token)), token); assert.equal(calls, 2);
  assert.equal(createKeyProtector({ getSelectedStorageBackend: () => 'basic_text' }, 'linux').available(), false);
});
