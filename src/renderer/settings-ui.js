window.AllsampleSettings = class {
  constructor(api, notify, onProviderChange) {
    this.api = api; this.notify = notify; this.dialog = document.querySelector('#settings'); this.onProviderChange = onProviderChange;
    document.querySelector('#open-settings').onclick = () => { this.dialog.showModal(); this.run(() => Promise.all([this.refresh(), this.refreshKey(), this.refreshUpdate()])); this.timer = setInterval(() => this.run(() => this.refresh()), 3000); };
    document.querySelector('#close-settings').onclick = () => this.dialog.close();
    this.dialog.addEventListener('close', () => { clearInterval(this.timer); document.querySelector('#freesound-key').value = ''; });
    document.querySelector('#cache-limit').onchange = () => this.run(async () => {
      const select = document.querySelector('#cache-limit'); select.disabled = true;
      try { this.render(await api.cacheLimit(Number(select.value))); } finally { select.disabled = false; }
    });
    document.querySelector('#clear-cache').onclick = () => this.run(async () => {
      const button = document.querySelector('#clear-cache'); button.disabled = true;
      try { const result = await api.clearCache(); this.render(result); notify(`未使用の音声を${result.removedFiles}件削除しました`); } finally { button.disabled = false; }
    });
    document.querySelector('#freesound-key-form').onsubmit = event => {
      event.preventDefault(); this.run(async () => {
        const button = document.querySelector('#save-freesound-key'), input = document.querySelector('#freesound-key'); button.disabled = true;
        try { this.renderKey(await api.setFreesoundKey(input.value, document.querySelector('#remember-key').checked)); input.value = ''; notify('APIキーを設定しました'); onProviderChange(); } finally { button.disabled = false; }
      });
    };
    document.querySelector('#clear-freesound-key').onclick = () => this.run(async () => { this.renderKey(await api.clearFreesoundKey()); document.querySelector('#freesound-key').value = ''; notify('APIキーを解除しました'); onProviderChange(); });
    document.querySelector('#open-api-setup').onclick = () => this.run(() => api.openApiSetup());
    api.onUpdate(state => this.renderUpdate(state));
    for (const [id, method] of [['check-update', 'checkUpdate'], ['download-update', 'downloadUpdate']]) document.querySelector(`#${id}`).onclick = () => this.run(async () => { document.querySelector(`#${id}`).disabled = true; try { this.renderUpdate(await api[method]()); } finally { await this.refreshUpdate(); } });
  }
  async run(fn) { try { await fn(); } catch (error) { this.notify(error.message); } }
  bytes(value) { return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`; }
  render(stats) {
    document.querySelector('#cache-usage').textContent = `${this.bytes(stats.bytes)} / ${this.bytes(stats.maxBytes)}`;
    document.querySelector('#cache-files').textContent = `${stats.files}ファイル・使用中${stats.inUse}件`;
    document.querySelector('#cache-limit').value = stats.maxBytes;
  }
  async refresh() { this.render(await this.api.cacheStats()); }
  renderKey(state) {
    document.querySelector('#freesound-key').placeholder = state.configured ? '設定済み（変更する場合のみ入力）' : 'APIキーを入力';
    const remember = document.querySelector('#remember-key'); remember.disabled = !state.canPersist; remember.checked = state.saved || (!state.configured && state.canPersist);
    document.querySelector('#clear-freesound-key').disabled = !state.configured && !state.saved;
    document.querySelector('#key-storage-note').textContent = state.error || (state.canPersist ? '保存にはOSの保護機能を使います。外すと起動中だけ使用します。' : 'この環境では、キーは起動中だけ使用できます。');
  }
  async refreshKey() { this.renderKey(await this.api.apiKeyStatus()); }
  renderUpdate(state) {
    document.querySelector('#app-version').textContent = state.version;
    const messages = { idle: 'サイトの検索・取得処理だけを更新します。', current: '最新のモジュールです。', checking: '更新を確認しています。', available: `${state.nextVersion}を利用できます。`, downloading: 'モジュールを取得しています。', ready: '取得しました。次回起動時に読み込みます。', error: '更新を取得できませんでした。' };
    document.querySelector('#update-message').textContent = state.message || messages[state.phase] || '';
    const check = document.querySelector('#check-update'), download = document.querySelector('#download-update');
    check.hidden = !state.enabled || ['downloading', 'ready'].includes(state.phase); check.disabled = state.phase === 'checking';
    download.hidden = !state.enabled || !state.nextVersion || !['available', 'error', 'downloading'].includes(state.phase); download.disabled = state.phase === 'downloading';
  }
  async refreshUpdate() { this.renderUpdate(await this.api.updateStatus()); }
};
