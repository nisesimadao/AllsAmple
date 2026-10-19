// Runs in the remote page's MAIN world. URL resolution remains in unmodified
// SampleTap hook.js; this bridge only identifies rows and reads their metadata.
(() => {
  const host = location.hostname;
  const site = host === 'samplefocus.com' ? 'samplefocus' : host === 'samples.landr.com' ? 'landr' : host === 'splice.com' ? 'splice' : host === 'www.noiiz.com' ? 'noiiz' : null;
  if (!site) return;
  let sequence = 0;
  const selector = site === 'samplefocus' ? '.sample-card' : site === 'landr' ? '[data-isdownloaded]' : site === 'splice' ? '[data-qa="sampleAssetRow"]' : '.nz-table tbody > tr';
  function fiberSample(row, id) {
    const key = Object.keys(row).find(key => key.startsWith('__reactFiber$')); let node = key && row[key];
    for (let hops = 0; node && hops < 8; hops++, node = node.return) { const sample = (node.memoizedProps || node.pendingProps)?.sample; if (sample?.guid === id) return sample; }
    return null;
  }
  function vueSample(row) {
    const own = row.__vue__?.$props?.data; if (own?.sample_type) return own;
    const table = row.closest('.nz-table')?.__vue__; if (!table?.$props?.items) return null;
    function keyOf(node, depth = 0) {
      if (!node || depth > 20) return null; if (node.elm === row && node.key != null) return node.key;
      for (const child of node.children || []) { const key = keyOf(child, depth + 1); if (key != null) return key; }
      return node.componentInstance ? keyOf(node.componentInstance._vnode, depth + 1) : null;
    }
    const key = keyOf(table._vnode); return key == null ? null : table.$props.items.find(sample => String(sample.id) === String(key));
  }
  function descriptor(row) {
    let remoteId = '', slug = '', title = '', pageUrl = location.href, duration = null, bpm = null, key = null, loop = null, description = '';
    if (site === 'samplefocus') {
      const anchor = row.querySelector('a.sample-card-link[href], a[href*="/samples/"]');
      pageUrl = anchor?.href; slug = pageUrl?.match(/\/samples\/([^/?#]+)/)?.[1] || '';
      remoteId = row.querySelector('img[data-testid="sample-waveform-image"], img[src*="sample_files/"]')?.src.match(/sample_files\/(\d+)\//)?.[1] || '';
      title = row.querySelector('[role="heading"]')?.textContent.trim() || '';
      duration = Number.parseFloat(row.querySelector('[aria-label="Duration"]')?.textContent) || null;
      bpm = Number.parseFloat(row.querySelector('[aria-label="Tempo"]')?.textContent) || null;
      key = row.querySelector('[aria-label="Key"]')?.textContent.trim() || null;
      description = [...row.querySelectorAll('.sample-tags .tag-link')].map(tag => tag.textContent.trim()).join(' · ');
      loop = /(?:^|\W)loop(?:\W|$)/i.test(description) ? true : /one.shot/i.test(description) ? false : null;
    } else if (site === 'landr') {
      remoteId = row.querySelector('[data-testid^="row-checkbox-"]')?.dataset.testid.slice('row-checkbox-'.length) || '';
      const sample = fiberSample(row, remoteId); title = sample?.name || row.querySelector('[title]')?.title || '';
      duration = sample?.duration ?? null; bpm = sample?.bpm ?? null; key = sample?.key?.name || (typeof sample?.key === 'string' ? sample.key : null) || [...row.children].map(cell => cell.textContent.trim()).find(text => /^[A-G][#b]?\s+(?:min|maj)$/.test(text)) || null; loop = sample?.sampleType === 'loop' ? true : sample?.sampleType === 'one_shot' ? false : null;
      description = sample?.classifiers?.map(item => item.code).join(' · ') || '';
      const link = row.querySelector('a[href*="/packs/"]'); pageUrl = link?.href || location.href;
    } else if (site === 'splice') {
      const anchor = row.querySelector('a[href*="/sounds/sample/"]'); pageUrl = anchor?.href || location.href;
      remoteId = pageUrl.match(/\/sounds\/sample\/([a-f0-9]{64})(?:[/?#]|$)/)?.[1] || '';
      title = row.querySelector('[data-qa="asset-filename"]')?.textContent.trim() || '';
      description = row.querySelector('[data-qa="tags"]')?.textContent.replace(/\s+/g, ' ').trim() || '';
      const cells = [...row.querySelectorAll('[role="gridcell"]')];
      const durationText = cells.find(cell => /^\d+:\d\d$/.test(cell.textContent.trim()))?.textContent.trim();
      if (durationText) { const [minutes, seconds] = durationText.split(':').map(Number); duration = minutes * 60 + seconds || null; }
      loop = Boolean(row.querySelector('use[href="#icon-loop"]')) ? true : row.querySelector('use[href="#icon-oneshot"]') ? false : null;
      const bpmCell = row.querySelector('[data-qa="bpm"], [data-qa="asset-bpm"]'); bpm = Number.parseFloat(bpmCell?.textContent) || null;
      const keyText = row.querySelector('[data-qa="asset-key"]')?.textContent.trim() || cells[5]?.textContent.trim(); key = keyText && keyText !== '--' ? keyText : null;
    } else {
      const sample = vueSample(row); if (!sample?.sample_type) return null;
      remoteId = String(sample.id); title = sample.name; duration = sample.waveform?.duration ?? null; bpm = sample.tempo ?? null; key = sample.key || null; loop = sample.sample_type === 'loop';
      description = [sample.instrument, sample.packName || sample.collection?.name, sample.genre].filter(Boolean).join(' · ');
      pageUrl = new URL(`/sounds/samples/${sample.id}`, location.origin).href;
    }
    if (!remoteId || !title || !pageUrl) return null;
    row.dataset.allsampleKey = remoteId;
    return { remoteId, slug, title, pageUrl, duration, bpm, key, loop, description };
  }
  window.__allsampleCatalog = {
    rows: () => [...document.querySelectorAll(selector)].map(descriptor).filter(Boolean),
    resolve: remoteId => new Promise(resolve => {
      const row = [...document.querySelectorAll(selector)].find(row => descriptor(row)?.remoteId === remoteId);
      if (!row) { resolve(null); return; }
      const sample = descriptor(row); const reqId = ++sequence; let timer;
      function finish(value) { clearTimeout(timer); window.removeEventListener('message', listener); if (row.dataset.sfdlReq === String(reqId)) delete row.dataset.sfdlReq; resolve(value); }
      function listener(event) { const data = event.data; if (event.source === window && event.origin === location.origin && data?.__sfdl === 'page->cs' && data.type === 'RESOLVED' && data.reqId === reqId) finish(data.url ? { url: data.url, name: data.name } : null); }
      window.addEventListener('message', listener); row.dataset.sfdlReq = String(reqId);
      timer = setTimeout(() => finish(null), 11000);
      window.postMessage({ __sfdl: 'cs->page', type: 'RESOLVE', reqId, id: sample.remoteId, slug: sample.slug }, location.origin);
    }),
    download: async url => {
      const response = await fetch(url, { credentials: 'omit' }); if (!response.ok) throw new Error(`音源取得 HTTP ${response.status}`);
      const type = response.headers.get('content-type') || ''; if (!/audio|octet-stream|^application\/mpeg(?:;|$)/.test(type)) throw new Error(`音声以外の応答です (${type || 'Content-Typeなし'})`);
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 80 * 1024 * 1024) throw new Error('音源サイズ上限を超えました'); chunks.push(value); } } finally { await reader.cancel(); }
      return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('音声を読み込めませんでした')); reader.readAsDataURL(new Blob(chunks, { type })); });
    }
  };
})();
