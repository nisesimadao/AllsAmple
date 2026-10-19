const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => { const result = await ipcRenderer.invoke(channel, ...args); if (!result.ok) throw new Error(result.error); return result.value; };
contextBridge.exposeInMainWorld('allsample', {
  bootstrap: () => invoke('bootstrap'), saveState: state => invoke('save-state', state),
  apiKeyStatus: () => invoke('api-key-status'), setFreesoundKey: (key, persist) => invoke('set-freesound-key', { key, persist }), clearFreesoundKey: () => invoke('clear-freesound-key'), openApiSetup: () => invoke('open-api-setup'),
  cacheStats: () => invoke('cache-stats'), cacheLimit: bytes => invoke('cache-limit', bytes), clearCache: () => invoke('cache-clear'), cachePins: ids => invoke('cache-pins', ids),
  updateStatus: () => invoke('update-status'), checkUpdate: () => invoke('update-check'), downloadUpdate: () => invoke('update-download'),
  onUpdate: callback => { const listener = (_, state) => callback(state); ipcRenderer.on('update-state', listener); return () => ipcRenderer.removeListener('update-state', listener); },
  addFolders: () => invoke('add-folders'), removeFolder: folder => invoke('remove-folder', folder),
  search: options => invoke('search', options), prepare: (id, intent) => invoke('prepare', id, intent),
  metadata: (id, measured) => invoke('metadata', id, measured),
  save: id => invoke('save', id), copyPath: id => invoke('copy-path', id), reveal: id => invoke('reveal', id), batch: ids => invoke('batch', ids),
  openPage: id => invoke('open-page', id), openTerms: id => invoke('open-terms', id), copyCredit: id => invoke('copy-credit', id),
  credits: ids => invoke('credits', ids),
  prepareDrag: (id, intent) => invoke('prepare-drag', id, intent),
  startDrag: id => ipcRenderer.send('start-drag', id),
  onSearch: callback => { const listener = (_, data) => callback(data); ipcRenderer.on('search-event', listener); return () => ipcRenderer.removeListener('search-event', listener); },
  onError: callback => { const listener = (_, message) => callback(message); ipcRenderer.on('action-error', listener); return () => ipcRenderer.removeListener('action-error', listener); },
  onCacheEvicted: callback => { const listener = (_, id) => callback(id); ipcRenderer.on('cache-evicted', listener); return () => ipcRenderer.removeListener('cache-evicted', listener); }
});
