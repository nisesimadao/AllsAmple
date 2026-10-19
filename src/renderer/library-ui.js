// Enable a newly introduced source once; preserve exclusions after it is known.
window.AllsampleRestoreSites = (enabledSites, knownSites) => {
  const inputs = [...document.querySelectorAll('[data-site]')];
  const known = new Set(knownSites || inputs.map(input => input.dataset.site).filter(id => id !== 'dova'));
  for (const input of inputs) input.checked = enabledSites.includes(input.dataset.site) || !known.has(input.dataset.site);
};
/* Library state belongs in the main process so metadata and IDs survive restarts together. */
window.AllsampleLibrary = class {
  constructor({ state, api, render, select, play, prepare, stop, notify, search, labels, accept = sample => state.known.set(sample.id, sample) }) {
    Object.assign(this, { state, api, render, select, play, prepare, stop, notify, search, labels, accept });
    this.projects = [{ id: 'default', name: '未分類', usedIds: [...state.usedIds] }];
    this.currentProject = 'default'; this.folders = []; this.saving = Promise.resolve();
    document.querySelector('#add-folder').onclick = () => this.run(async () => {
      const button = document.querySelector('#add-folder'); button.disabled = true;
      try { this.updateLocal(await api.addFolders()); document.querySelector('[data-site=local]').checked = true; await search(); } finally { button.disabled = false; }
    });
    document.querySelector('#folders').onclick = event => {
      const button = event.target.closest('[data-remove-folder]');
      if (button) this.run(async () => { this.updateLocal(await api.removeFolder(this.folders[Number(button.dataset.removeFolder)])); await search(); });
    };
    document.querySelector('#project').onchange = event => {
      this.syncProject(); this.currentProject = event.target.value;
      state.usedIds = new Set(this.projects.find(project => project.id === this.currentProject).usedIds);
      this.refresh(); this.persist();
    };
    document.querySelector('#new-project').onclick = () => { document.querySelector('#project-form').hidden = false; document.querySelector('#project-name').focus(); };
    document.querySelector('#cancel-project').onclick = () => { document.querySelector('#project-form').hidden = true; };
    document.querySelector('#project-form').onsubmit = event => {
      event.preventDefault(); const input = document.querySelector('#project-name'); const name = input.value.trim();
      if (!name) return;
      if (this.projects.length >= 100) { notify('プロジェクトは100件まで作成できます'); return; }
      this.syncProject(); const project = { id: crypto.randomUUID(), name: name.slice(0, 80), usedIds: [] };
      this.projects.push(project); this.currentProject = project.id; state.usedIds = new Set();
      input.value = ''; document.querySelector('#project-form').hidden = true; this.renderProjects(); this.refresh(); this.persist();
    };
    document.querySelector('#blind').onchange = event => { state.blind = event.target.checked; this.refresh(); this.persist(); };
    document.querySelector('#compare-slots').onclick = event => {
      const remove = event.target.closest('[data-remove-compare]');
      if (remove) { state.compareIds = state.compareIds.filter(id => id !== remove.dataset.removeCompare); if (!state.compareIds.length) state.blind = false; this.refresh(); this.persist(); return; }
      const button = event.target.closest('[data-compare-play]'); if (button) this.switchTo(Number(button.dataset.comparePlay));
    };
    document.querySelector('#library-toggle').onclick = () => {
      const open = document.body.classList.toggle('library-open'); document.querySelector('#library-toggle').setAttribute('aria-expanded', String(open));
    };
    document.querySelector('#close-library').onclick = () => { document.body.classList.remove('library-open'); document.querySelector('#library-toggle').setAttribute('aria-expanded', 'false'); };
  }
  async run(fn) { try { await fn(); } catch (error) { this.notify(error.message); } }
  async restore() {
    const data = await this.api.bootstrap();
    for (const sample of data.samples) this.accept(sample);
    this.folders = data.folders;
    if (data.ui) {
      const ui = data.ui;
      if (typeof ui.query === 'string') document.querySelector('#query').value = ui.query;
      if (Array.isArray(ui.enabledSites)) AllsampleRestoreSites(ui.enabledSites, ui.knownSites);
      this.state.favoriteIds = new Set(ui.favoriteIds); this.state.history = ui.history;
      this.projects = ui.projects; this.currentProject = ui.currentProject;
      this.state.usedIds = new Set(this.projects.find(project => project.id === this.currentProject).usedIds);
      this.state.compareIds = ui.compareIds.filter(id => this.state.known.has(id)); this.state.blind = ui.blind && this.state.compareIds.length > 0;
      document.querySelector('#volume').value = ui.volume;
      document.querySelector('#tempo').value = ui.tempo; document.querySelector('#pitch').value = ui.pitch;
      document.querySelector('#tempo').dispatchEvent(new Event('input'));
      document.querySelector('#volume').dispatchEvent(new Event('input'));
    }
    this.renderFolders(); this.renderProjects(); this.refresh();
  }
  syncProject() { const project = this.projects.find(project => project.id === this.currentProject); if (project) project.usedIds = [...this.state.usedIds]; }
  persist() {
    this.syncProject();
    const snapshot = { favoriteIds: [...this.state.favoriteIds], history: this.state.history, projects: this.projects, currentProject: this.currentProject, compareIds: this.state.compareIds, blind: this.state.blind, query: document.querySelector('#query').value, enabledSites: [...document.querySelectorAll('[data-site]:checked')].map(input => input.dataset.site), knownSites: [...document.querySelectorAll('[data-site]')].map(input => input.dataset.site), volume: Number(document.querySelector('#volume').value), tempo: this.state.tempo, pitch: this.state.pitch };
    this.saving = this.api.saveState(snapshot).catch(error => this.notify(error.message)); return this.saving;
  }
  renderProjects() {
    const select = document.querySelector('#project'); select.replaceChildren(...this.projects.map(project => new Option(project.name, project.id))); select.value = this.currentProject;
  }
  renderFolders() {
    const list = document.querySelector('#folders'); list.replaceChildren();
    for (const [index, folder] of this.folders.entries()) {
      const row = document.createElement('div'); row.className = 'folder-row';
      const name = document.createElement('span'); name.textContent = folder.split(/[\\/]/).filter(Boolean).at(-1); name.title = folder;
      const button = document.createElement('button'); button.innerHTML = AllsampleIcons.svg('x'); button.dataset.removeFolder = index; button.setAttribute('aria-label', `${name.textContent}の登録を解除`);
      row.append(name, button); list.append(row);
    }
  }
  updateLocal(data) {
    this.folders = data.folders; const ids = new Set(data.samples.map(sample => sample.id));
    // Unregistering a search folder must not erase a project's attribution record.
    for (const [id, sample] of this.state.known) if (sample.site === 'local') sample.available = ids.has(id);
    for (const sample of data.samples) this.accept(sample);
    this.state.compareIds = this.state.compareIds.filter(id => this.state.known.get(id)?.available !== false);
    if (!this.state.compareIds.length) this.state.blind = false;
    this.renderFolders(); this.refresh(); this.persist();
  }
  add(sample) {
    if (!sample) return;
    if (this.state.compareIds.includes(sample.id)) return;
    if (this.state.compareIds.length >= 4) { this.notify('比較は4件までです。候補を外すと入れ替えられます'); return; }
    this.state.compareIds.push(sample.id); this.refresh(); this.persist(); void this.prepare(sample, 'prefetch').catch(() => {});
  }
  switchTo(index) {
    const sample = this.state.known.get(this.state.compareIds[index]); if (!sample) return;
    this.select(sample);
    const row = document.querySelector(`.sample-row[data-id="${sample.id}"]`);
    (row || document.querySelector(`[data-compare-play="${index}"]`)).focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
    this.run(() => this.play(sample));
  }
  refresh() {
    const detailWasOpen = document.querySelector('#detail').classList.contains('open');
    if (this.state.blind && this.state.playing && !this.state.compareIds.includes(this.state.playing)) { this.stop(); this.state.playing = null; }
    document.body.classList.toggle('is-blind', this.state.blind);
    document.querySelector('#blind').checked = this.state.blind;
    document.querySelector('#blind').disabled = !this.state.compareIds.length;
    const selected = this.state.selected; this.state.selected = null;
    if (selected && this.state.known.has(selected.id)) this.select(this.state.blind && !this.state.compareIds.includes(selected.id) ? this.state.known.get(this.state.compareIds[0]) : selected);
    if (!detailWasOpen) document.querySelector('#detail').classList.remove('open');
    this.labels(); this.render(); this.renderCompare();
  }
  renderCompare() {
    const tray = document.querySelector('#comparison'); tray.hidden = !this.state.compareIds.length;
    document.body.classList.toggle('has-comparison', !tray.hidden);
    const list = document.querySelector('#compare-slots'); list.replaceChildren();
    this.state.compareIds.forEach((id, index) => {
      const sample = this.state.known.get(id); if (!sample) return;
      const slot = document.createElement('div'); slot.className = 'compare-slot'; slot.classList.toggle('active', this.state.playing === id && this.state.auditioning);
      const button = document.createElement('button'); button.dataset.comparePlay = index;
      const key = document.createElement('kbd'); key.textContent = index + 1;
      const label = document.createElement('span'); label.textContent = this.state.blind ? `候補 ${String.fromCharCode(65 + index)}` : sample.title; label.title = label.textContent;
      button.append(key, label); button.setAttribute('aria-label', `${index + 1}：${label.textContent}を試聴`);
      const remove = document.createElement('button'); remove.dataset.removeCompare = id; remove.innerHTML = AllsampleIcons.svg('x'); remove.setAttribute('aria-label', `${label.textContent}を比較から外す`);
      slot.append(button, remove); list.append(slot);
    });
  }
};
