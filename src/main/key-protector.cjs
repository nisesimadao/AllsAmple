function createKeyProtector(storage, platform = process.platform) {
  return {
    // isEncryptionAvailable() can synchronously query the macOS Keychain and
    // show an OS prompt. Merely opening settings must never access that vault.
    available: () => platform !== 'linux' || !['basic_text', 'unknown'].includes(storage.getSelectedStorageBackend()),
    encrypt: async text => {
      if (!await storage.isAsyncEncryptionAvailable()) throw new Error('OSの保護機能を利用できません。「この端末に保存」を外して使用できます');
      return storage.encryptStringAsync(text);
    },
    decrypt: async bytes => {
      if (!await storage.isAsyncEncryptionAvailable()) throw new Error('OSの保護機能を利用できません');
      return (await storage.decryptStringAsync(bytes)).result;
    }
  };
}
module.exports = { createKeyProtector };
