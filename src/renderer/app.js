const api = window.allsample;
const uiIcon = name => AllsampleIcons.svg(name);
let libraryUI = null;
const $ = selector => document.querySelector(selector);
const state = { results: [], selected: null, requestId: 0, busy: false, view: 'all', favoriteIds: new Set(readStored('favorites', [])), history: readStored('history', []), usedIds: new Set(readStored('used', [])), known: new Map(readStored('known', []).map(sample => [sample.id, sample])), info: new Map(), prepared: new Map(), audioLoads: new Map(), playing: null, pendingPlay: null, auditioning: false, compareIds: [], blind: false, ready: false, tempo: 1, pitch: 0 };
function readStored(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
const audio = new Audio(); audio.volume = 0.65;
const audioGraph = new AllsampleAudioGraph(audio);
let filterControls;
let audioContext, playGeneration = 0, toastTimer;
let cachePinKey = null;
function syncCachePins() {
  const ids = [...new Set([...state.compareIds, state.playing, state.pendingPlay, state.selected?.id].filter(Boolean))];
  const key = ids.slice().sort().join(','); if (key === cachePinKey) return; cachePinKey = key;
  void api.cachePins(ids).catch(() => { if (cachePinKey === key) cachePinKey = null; });
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }
function playbackDuration() { return state.info.get(state.playing)?.duration ?? state.known.get(state.playing)?.duration ?? audio.duration; }
function playGlyph(id) { return uiIcon(state.pendingPlay === id && state.auditioning ? 'loader-circle' : state.playing === id && !audio.paused ? 'pause' : 'play'); }
function time(seconds) { if (!Number.isFinite(seconds)) return '—:—'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function notify(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500); }
function fail(error) { notify(error.message || String(error)); }
async function action(fn) { try { return await fn(); } catch (error) { fail(error); } }
function visibleResults() {
  if (state.blind) return state.compareIds.map(id => state.known.get(id)).filter(Boolean);
  const filters = { kind: $('#kind').value, free: $('#price').value === 'free', noCredit: $('#no-credit').checked, commercial: $('#commercial').checked, ...(filterControls?.get() || {}) };
  const savedView = state.view !== 'all';
  const queryMatches = AllsampleQuery.createMatcher($('#query').value);
  const enabledSites = new Set([...document.querySelectorAll('[data-site]:checked')].map(input => input.dataset.site));
  const items = (savedView ? [...state.known.values()] : state.results).filter(sample => AllsampleFilters.matches(sample, filters, state.info.get(sample.id)) && (!savedView || (enabledSites.has(sample.site) && queryMatches([sample.title, sample.description, sample.relativePath, sample.kind, sample.author, ...(Array.isArray(sample.tags) ? sample.tags : [sample.tags])].filter(Boolean).join(' ')))) && (state.view !== 'used' || state.usedIds.has(sample.id)) && (state.view !== 'favorites' || state.favoriteIds.has(sample.id)) && (state.view !== 'history' || state.history.includes(sample.id)));
  if (state.view === 'history') {
    const positions = new Map(state.history.map((id, index) => [id, index]));
    items.sort((a, b) => positions.get(a.id) - positions.get(b.id));
  }
  return items;
}
function badge(sample) {
  const category = sample.license.category;
  const label = ({ green: '表記不要', yellow: '表記必要', orange: '条件あり', gray: '有料 / 試聴用', red: '条件不明' })[category] || '条件不明';
  const iconName = ({ green: 'check', yellow: 'copyright', orange: 'triangle-alert', gray: 'credit-card', red: 'circle-help' })[category] || 'circle-help';
  return `<span class="license-badge ${category}" title="${escapeHtml(sample.license.note || (sample.license.commercial ? '商用利用可' : '規約を確認'))}">${uiIcon(iconName)}<span>${label}</span></span>`;
}
function sampleById(id) { return state.known.get(id) || state.results.find(sample => sample.id === id); }
function sampleRevision(sample) { return sample?.site === 'local' ? [sample.size, sample.mtimeMs, sample.ctimeMs, sample.ino].join(':') : ''; }
function rememberSample(sample) {
  const previous = state.known.get(sample.id);
  if (sample.site === 'local' && previous && sampleRevision(previous) !== sampleRevision(sample)) {
    state.info.delete(sample.id); state.prepared.delete(sample.id); state.audioLoads.delete(sample.id);
    if (state.playing === sample.id || state.pendingPlay === sample.id) { stop(); state.playing = null; refreshPlayback(); }
  }
  state.known.set(sample.id, sample);
  if (state.selected?.id === sample.id) { const open = $('#detail').classList.contains('open'); state.selected = null; selectSample(sample); if (!open) $('#detail').classList.remove('open'); }
}
function persistKnown() { try { localStorage.setItem('known', JSON.stringify([...state.known.values()])); } catch {} libraryUI?.persist(); }
function sampleTitle(sample) { return state.blind ? `候補 ${String.fromCharCode(65 + Math.max(0, state.compareIds.indexOf(sample.id)))}` : sample.title; }
function playerLabels() { const sample = sampleById(state.pendingPlay || state.playing); if (sample) { $('#player-title').textContent = sampleTitle(sample); $('#player-source').textContent = state.blind ? 'ブラインド比較' : `${sample.siteName} · ${sample.format}${sample.isPreview ? ' 試聴用' : ''}`; $('#player-play').disabled = false; } else { $('#player-title').textContent = '未選択'; $('#player-source').textContent = '—'; $('#player-play').disabled = true; $('#seek').disabled = true; } }
function renderResults() {
  syncCachePins();
  const items = visibleResults();
  const markup = items.map(sample => `<div class="sample-row ${state.selected?.id === sample.id ? 'selected' : ''}" data-id="${sample.id}" tabindex="0" role="group" aria-label="${escapeHtml(sampleTitle(sample))}" draggable="${state.info.has(sample.id)}"><div class="sample-main"><button class="row-play" data-play="${sample.id}" aria-label="${escapeHtml(sampleTitle(sample))}を試聴">${playGlyph(sample.id)}</button><div class="sample-text"><div class="sample-title">${escapeHtml(sampleTitle(sample))}</div><div class="sample-meta"><span>${escapeHtml(state.blind ? '' : sample.siteName + (sample.available === false ? '（フォルダ未登録）' : ''))}</span><span>${escapeHtml(sample.kind)}${currentWorkflow === 'music' ? escapeHtml([sample.bpm ? sample.bpm + ' BPM' : '', sample.key || ''].filter(Boolean).join(' · ') ? ' · ' + [sample.bpm ? sample.bpm + ' BPM' : '', sample.key || ''].filter(Boolean).join(' · ') : '') : ''}</span></div></div></div><div class="wave-wrap">${state.info.has(sample.id) ? `<canvas class="wave-canvas" data-wave="${sample.id}" aria-label="音声の波形"></canvas>` : '<div class="wave-pending" aria-label="波形未取得"></div>'}</div>${badge(sample)}<span class="duration" data-duration="${sample.id}">${time(state.info.get(sample.id)?.duration ?? sample.duration)}</span><button class="favorite ${state.favoriteIds.has(sample.id) ? 'on' : ''}" data-favorite="${sample.id}" aria-label="お気に入り${state.favoriteIds.has(sample.id) ? 'から削除' : 'に追加'}">${uiIcon('star')}</button></div>`).join('');
  const container = $('#results');
  const template = document.createElement('template'); template.innerHTML = markup;
  const existing = new Map([...container.children].map(row => [row.dataset.id, row]));
  const wanted = new Set(items.map(sample => sample.id));
  for (const row of [...container.children]) if (!wanted.has(row.dataset.id)) row.remove();
  [...template.content.children].forEach((fresh, index) => {
    const row = existing.get(fresh.dataset.id) || fresh;
    if (container.children[index] !== row) container.insertBefore(row, container.children[index] || null);
    row.querySelector('.sample-title').textContent = sampleTitle(sampleById(row.dataset.id));
    row.setAttribute('aria-label', sampleTitle(sampleById(row.dataset.id)));
    row.querySelector('[data-play]').innerHTML = playGlyph(row.dataset.id); row.querySelector('[data-play]').setAttribute('aria-busy', String(state.pendingPlay === row.dataset.id));
    row.querySelector('[data-play]').setAttribute('aria-label', `${sampleTitle(sampleById(row.dataset.id))}を試聴`);
    row.querySelector('.sample-meta').innerHTML = fresh.querySelector('.sample-meta').innerHTML;
    const oldBadge = row.querySelector('.license-badge'), newBadge = fresh.querySelector('.license-badge'); if (oldBadge.outerHTML !== newBadge.outerHTML) oldBadge.replaceWith(newBadge);
    row.classList.toggle('selected', row.dataset.id === state.selected?.id);
    const favorite = row.querySelector('[data-favorite]'); const isFavorite = state.favoriteIds.has(row.dataset.id);
    favorite.classList.toggle('on', isFavorite); favorite.innerHTML = uiIcon('star'); favorite.setAttribute('aria-label', `お気に入り${isFavorite ? 'から削除' : 'に追加'}`);
  });
  $('#result-title').textContent = state.blind ? 'ブラインド比較' : ($('#query').value.trim() || 'すべての音源');
  $('#result-count').textContent = `${items.length} 件${state.busy ? ' · 検索中' : ''}`;
  $('#empty').hidden = Boolean(items.length || state.busy); $('#batch').disabled = !items.length;
  $('#favorite-count').textContent = state.favoriteIds.size;
  document.querySelectorAll('[data-wave]').forEach(canvas => drawWave(canvas, state.info.get(canvas.dataset.wave).peaks));
}
function drawWave(canvas, peaks, progress = 0) {
  if (!canvas || !peaks) return;
  const bounds = canvas.getBoundingClientRect(); if (!bounds.width) return;
  const ratio = devicePixelRatio || 1; canvas.width = bounds.width * ratio; canvas.height = bounds.height * ratio;
  const context = canvas.getContext('2d'); context.scale(ratio, ratio);
  const count = Math.floor(bounds.width / 3); const middle = bounds.height / 2;
  const palette = getComputedStyle(document.documentElement); const waveColor = palette.getPropertyValue('--slate-11').trim(); const playedColor = palette.getPropertyValue('--gray-12').trim();
  for (let i = 0; i < count; i++) { const amplitude = Math.max(1.5, peaks[Math.floor(i / count * peaks.length)] * bounds.height * .85); context.fillStyle = i / count <= progress ? playedColor : waveColor; context.fillRect(i * 3, middle - amplitude / 2, 1.5, amplitude); }
}
function loadAudio(sample, intent = 'interactive') {
  let entry = state.audioLoads.get(sample.id);
  if (!entry) {
    entry = { interactive: intent !== 'prefetch', promise: api.prepare(sample.id, intent).then(url => { const target = new URL(url); if (sample.site === 'local') target.searchParams.set('v', sampleRevision(sample)); return target.href; }) };
    state.audioLoads.set(sample.id, entry);
    entry.promise.catch(() => { if (state.audioLoads.get(sample.id) === entry) state.audioLoads.delete(sample.id); });
  } else if (intent !== 'prefetch' && !entry.interactive) {
    entry.interactive = true;
    // Promote the shared transfer. A play click must not remain a background prefetch.
    void api.prepare(sample.id, intent).catch(() => {});
  }
  return entry.promise;
}
async function prepare(sample, intent = 'interactive') {
  // A waveform can outlive its evicted audio file. Warm the audio independently.
  void loadAudio(sample, intent).catch(() => {});
  if (!state.prepared.has(sample.id)) {
    const revision = sampleRevision(sample);
    const current = () => sampleRevision(sampleById(sample.id)) === revision;
    const pending = (async () => {
      const url = await loadAudio(sample, intent);
      const waveformUrl = new URL(url); waveformUrl.searchParams.set('waveform', '1');
      const response = await fetch(waveformUrl); if (!response.ok) throw new Error('音声を読み込めませんでした');
      audioContext ||= new AudioContext(); const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
      if (!current()) return null;
      const peaks = []; const bins = 240;
      for (let i = 0; i < bins; i++) { let max = 0; const start = Math.floor(i * buffer.length / bins); const end = Math.floor((i + 1) * buffer.length / bins); const stride = Math.max(1, Math.floor((end - start) / 180)); for (let channel = 0; channel < buffer.numberOfChannels; channel++) { const data = buffer.getChannelData(channel); for (let j = start; j < end; j += stride) max = Math.max(max, Math.abs(data[j])); } peaks.push(max); }
      const previousLicense = JSON.stringify(sample.license);
      const measured = await api.metadata(sample.id, { duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
      if (!current()) return null;
      const peakMax = Math.max(...peaks, .001); const info = { ...measured, peaks: peaks.map(peak => peak / peakMax), url };
      state.info.set(sample.id, info);
      Object.assign(sample, { duration: info.duration, channels: info.channels, sampleRate: info.sampleRate, license: measured.license || sample.license, audioUrl: measured.audioUrl ?? sample.audioUrl });
      // Patch the row in place to preserve keyboard focus and pointer gestures.
      const row = document.querySelector(`[data-id="${sample.id}"]`);
      if (row) { row.draggable = true; row.querySelector('.duration').textContent = time(info.duration); const wrap = row.querySelector('.wave-wrap'); wrap.innerHTML = `<canvas class="wave-canvas" data-wave="${sample.id}" aria-label="音声の波形"></canvas>`; drawWave(wrap.firstChild, info.peaks); }
      if (state.selected?.id === sample.id) {
        if (previousLicense !== JSON.stringify(sample.license)) { const open = $('#detail').classList.contains('open'); state.selected = null; selectSample(sample); if (!open) $('#detail').classList.remove('open'); }
        else updateDetailAudio(sample);
      }
      if (filterControls && Object.values(filterControls.get()).some(value => value != null && value !== false && value !== '')) renderResults();
      return info;
    })();
    state.prepared.set(sample.id, pending); pending.catch(() => { if (state.prepared.get(sample.id) === pending) state.prepared.delete(sample.id); });
  }
  return state.prepared.get(sample.id);
}
function stop() { playGeneration++; state.pendingPlay = null; state.auditioning = false; audioGraph.mute(); audio.pause(); refreshPlayback(); }
async function play(sample) {
  const generation = ++playGeneration;
  audioGraph.mute(); audio.pause(); state.pendingPlay = sample.id; state.auditioning = true; refreshPlayback();
  let url;
  try { [url] = await Promise.all([loadAudio(sample, 'interactive'), audioGraph.ensure(audioContext ||= new AudioContext())]); }
  catch (error) { if (generation === playGeneration) stop(); throw error; }
  if (generation !== playGeneration) return;
  state.playing = sample.id; state.pendingPlay = null;
  audio.src = url; audio.currentTime = 0; audioGraph.reset();
  await audioGraph.resume(() => generation === playGeneration); if (generation !== playGeneration) return;
  playerLabels(); $('#player-play').disabled = false; $('#seek').disabled = false;
  try { await audio.play(); } catch (error) { if (generation !== playGeneration || error.name === 'AbortError') return; stop(); throw error; }
  if (generation !== playGeneration) return;
  // Waveform decoding follows playback rather than delaying the first audible sample.
  action(() => prepare(sample));
  state.history = [sample.id, ...state.history.filter(id => id !== sample.id)].slice(0, 200); localStorage.setItem('history', JSON.stringify(state.history)); persistKnown();

  refreshPlayback();
}
async function resumePlayback() {
  if (!audio.src || !state.playing) return;
  const generation = ++playGeneration; state.auditioning = true;
  await audioGraph.ensure(audioContext ||= new AudioContext()); if (generation !== playGeneration) return;
  audioGraph.reset(); await audioGraph.resume(() => generation === playGeneration); if (generation !== playGeneration) return;
  try { await audio.play(); } catch (error) { if (generation !== playGeneration || error.name === 'AbortError') return; stop(); throw error; }
  refreshPlayback();
}
function refreshPlayback() {
  syncCachePins();
  libraryUI?.renderCompare();
  playerLabels();
  $('#player-play').innerHTML = uiIcon(state.pendingPlay ? 'loader-circle' : audio.paused ? 'play' : 'pause'); $('#player-play').setAttribute('aria-busy', String(Boolean(state.pendingPlay)));
  $('#seek').disabled = Boolean(state.pendingPlay) || !state.playing;
  if (state.pendingPlay) $('#player-time').textContent = `0:00 / ${time(sampleById(state.pendingPlay)?.duration)}`;
  document.querySelectorAll('[data-play]').forEach(button => { button.innerHTML = playGlyph(button.dataset.play); button.setAttribute('aria-busy', String(state.pendingPlay === button.dataset.play)); });
}
function seekPlayback(sample, fraction) {
  if (state.playing !== sample.id) return;
  const duration = state.info.get(sample.id)?.duration ?? sample.duration ?? audio.duration;
  if (!Number.isFinite(duration)) return;
  audio.currentTime = Math.max(0, Math.min(1, fraction)) * duration; audioGraph.reset();
}
function selectSample(sample) {
  if (state.selected?.id === sample.id && $('#detail').classList.contains('open')) return;
  const changed = state.selected?.id !== sample.id;
  state.selected = sample;
  syncCachePins();
  document.querySelectorAll('.sample-row[data-id]').forEach(row => row.classList.toggle('selected', row.dataset.id === sample.id));
  $('#detail').classList.add('open');
  const condition = value => value === true ? `${uiIcon('check')}可` : value === false ? `${uiIcon('x')}不可` : `${uiIcon('triangle-alert')}条件を確認`;
  const l = sample.license;
  $('#detail').innerHTML = `<div class="detail-kicker"><span>${escapeHtml(state.blind ? '' : sample.siteName + (sample.available === false ? '（フォルダ未登録）' : ''))}</span><button id="close-detail" aria-label="詳細を閉じる">${uiIcon('x')}</button></div><h2>${escapeHtml(sampleTitle(sample))}</h2>${sample.description && sample.description !== sample.title ? `<p class="detail-description">${escapeHtml(sample.description)}</p>` : ''}${badge(sample)}<canvas class="detail-wave" id="detail-wave" aria-label="波形をドラッグして再生位置を変更"></canvas><div class="detail-measures"><span id="detail-format">${sample.format}</span><span id="detail-duration">—:—</span></div><div class="detail-section"><div class="detail-label"><span>利用条件</span><button class="text-button" id="open-terms">規約 ${uiIcon('external-link')}</button></div><dl><dt>商用利用</dt><dd>${condition(l.commercial)}</dd><dt>クレジット表記</dt><dd>${l.attribution === true ? `${uiIcon('copyright')}必要` : l.attribution === false ? '不要' : `${uiIcon('triangle-alert')}条件を確認`}</dd><dt>改変</dt><dd>${condition(l.modification)}</dd><dt>素材の再配布</dt><dd>${condition(l.redistribution)}</dd><dt>Content ID 登録</dt><dd>${condition(l.contentId)}</dd><dt>アダルト利用</dt><dd>${condition(l.adult)}</dd></dl>${l.note ? `<p class="license-note">${escapeHtml(l.note)}</p>` : ''}<button id="copy-credit" class="text-button">クレジット文をコピー</button></div><p class="file-note">${sample.site === 'local' ? 'ローカルの元ファイル' : sample.isPreview ? '試聴用音源（元音源とは異なります）' : `配布元の${sample.format}・変換なし`}</p><button id="save" class="save-button">${uiIcon('download')}${sample.format}を保存</button><div class="secondary-actions"><button id="copy-path">パスをコピー</button><button id="reveal">フォルダで表示</button></div><button id="add-compare" class="usage-button">${state.compareIds.includes(sample.id) ? '比較に追加済み' : '比較に追加'}</button><button id="use-sample" class="usage-button">${state.usedIds.has(sample.id) ? '使用素材に追加済み' : '使用素材に追加'}</button><button id="open-page" class="detail-link">配布ページを開く ${uiIcon('external-link')}</button>`;
  $('#add-compare').onclick = () => libraryUI?.add(sample);
  $('#close-detail').onclick = () => $('#detail').classList.remove('open');
  $('#save').onclick = () => action(async () => { const file = await api.save(sample.id); if (file) notify('保存しました'); });
  $('#copy-path').onclick = () => action(async () => { await api.copyPath(sample.id); notify('保存先のパスをコピーしました'); });
  $('#copy-credit').onclick = () => action(async () => { await api.copyCredit(sample.id); notify('クレジット文をコピーしました'); });
  $('#use-sample').onclick = () => { if (state.usedIds.has(sample.id)) state.usedIds.delete(sample.id); else state.usedIds.add(sample.id); localStorage.setItem('used', JSON.stringify([...state.usedIds])); persistKnown(); $('#detail').classList.remove('open'); selectSample(sample); if (state.view === 'used') renderResults(); };
  if (sample.site === 'local') { $('#open-terms').hidden = true; $('#open-page').innerHTML = '元ファイルを表示 ' + uiIcon('external-link'); }
  $('#reveal').onclick = () => action(() => api.reveal(sample.id));
  $('#open-page').onclick = () => action(() => api.openPage(sample.id)); $('#open-terms').onclick = () => action(() => api.openTerms(sample.id));
  const canvas = $('#detail-wave');
  const seekFromEvent = event => { const bounds = canvas.getBoundingClientRect(); seekPlayback(sample, (event.clientX - bounds.left) / bounds.width); };
  canvas.onpointerdown = event => { canvas.setPointerCapture(event.pointerId); seekFromEvent(event); }; canvas.onpointermove = event => { if (event.buttons === 1) seekFromEvent(event); };
  updateDetailAudio(sample);
  if (changed) $('#detail').scrollTop = 0;
}
function updateDetailAudio(sample) { const info = state.info.get(sample.id); if (!info || !$('#detail-wave')) return; $('#detail-format').textContent = `${sample.format} / ${info.sampleRate ? info.sampleRate / 1000 + ' kHz' : 'レート不明'} / ${info.channels === 1 ? 'MONO' : info.channels === 2 ? 'STEREO' : info.channels + 'ch'}`; $('#detail-duration').textContent = time(info.duration); drawWave($('#detail-wave'), info.peaks); }
$('#results').addEventListener('click', event => {
  const row = event.target.closest('[data-id]'); if (!row) return; const sample = sampleById(row.dataset.id);
  if (event.target.closest('[data-favorite]')) { if (state.favoriteIds.has(sample.id)) state.favoriteIds.delete(sample.id); else state.favoriteIds.add(sample.id); localStorage.setItem('favorites', JSON.stringify([...state.favoriteIds])); persistKnown(); renderResults(); return; }
  selectSample(sample);
  if (event.target.closest('[data-play]')) { if ((state.playing === sample.id || state.pendingPlay === sample.id) && state.auditioning) stop(); else action(() => play(sample)); }
  else action(() => prepare(sample));
});
// Hover warms the cache only. Selection and playback are controlled explicitly.
$('#results').addEventListener('pointerover', event => {
  const row = event.target.closest('[data-id]'); if (!row || row.contains(event.relatedTarget)) return;
  // Speculative downloads must not interrupt someone who only moved the pointer.
  void prepare(sampleById(row.dataset.id), 'prefetch').catch(() => {});
});
let rowSeek = null;
$('#results').addEventListener('pointerdown', event => {
  const canvas = event.target.closest('[data-wave]'); if (!canvas || event.button !== 0) return;
  event.preventDefault(); canvas.setPointerCapture(event.pointerId);
  const sample = sampleById(canvas.dataset.wave), bounds = canvas.getBoundingClientRect();
  const drag = { sample, canvas, pointerId: event.pointerId, fraction: (event.clientX - bounds.left) / bounds.width }; rowSeek = drag;
  selectSample(sample);
  if (state.playing === sample.id) seekPlayback(sample, drag.fraction);
  else action(async () => { const generation = playGeneration + 1; await play(sample); if (generation === playGeneration) seekPlayback(sample, drag.fraction); });
});
$('#results').addEventListener('pointermove', event => {
  if (!rowSeek || rowSeek.pointerId !== event.pointerId) return;
  const bounds = rowSeek.canvas.getBoundingClientRect(); rowSeek.fraction = (event.clientX - bounds.left) / bounds.width;
  seekPlayback(rowSeek.sample, rowSeek.fraction);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#results').addEventListener(name, event => { if (rowSeek?.pointerId === event.pointerId) rowSeek = null; });
$('#results').addEventListener('dragstart', event => { const row = event.target.closest('[data-id]'); if (!row) return; event.preventDefault(); if (event.target.closest('[data-wave]')) return; if (state.info.has(row.dataset.id)) api.startDrag(row.dataset.id); else notify('音源を読み込んでからドラッグしてください'); });
async function search() {
  rememberWorkflow(); stop(); if (state.view === 'all') state.results = []; state.busy = state.view === 'all'; state.requestId++; state.selected = null; $('#search-error').textContent = ''; $('#detail').classList.remove('open');
  $('#result-title').textContent = $('#query').value.trim() ? $('#query').value.trim() : 'すべての音源'; $('#search-error').hidden = true; renderResults();
  try { await api.search({ query: $('#query').value, requestId: state.requestId, enabledSites: state.view === 'all' ? [...document.querySelectorAll('[data-site]:checked')].map(input => input.dataset.site) : [] }); } catch (error) { state.busy = false; $('#search-error').textContent = error.message; $('#search-error').hidden = false; renderResults(); }
}
let renderFrame;
api.onSearch(event => {
  if (event.requestId !== state.requestId) return;
  if (event.sample && !state.results.some(sample => sample.id === event.sample.id)) {
    state.results.push(event.sample); rememberSample(event.sample);
  }
  if (event.done) { state.busy = false; persistKnown(); }
  if (event.siteError) { $('#search-error').textContent += ($('#search-error').textContent ? '\n' : '') + event.siteError; $('#search-error').hidden = false; }
  // Keep row nodes so incoming results preserve selection, focus and waveform gestures.
  cancelAnimationFrame(renderFrame); renderFrame = requestAnimationFrame(renderResults);
});
api.onError(notify);
api.onCacheEvicted(id => { state.audioLoads.delete(id); });

const workflowProfiles = readStored('workflowProfiles', {});
let currentWorkflow = readStored('workflow', 'all');
function captureProfile() { return { sites: [...document.querySelectorAll('[data-site]:checked')].map(input => input.dataset.site), kind: $('#kind').value, free: $('#price').value, noCredit: $('#no-credit').checked, commercial: $('#commercial').checked, advanced: filterControls?.get() || {} }; }
function applyProfile(profile) { document.querySelectorAll('[data-site]').forEach(input => { input.checked = profile.sites.includes(input.dataset.site); }); $('#kind').value = profile.kind || ''; $('#price').value = profile.free || 'all'; $('#no-credit').checked = Boolean(profile.noCredit); $('#commercial').checked = Boolean(profile.commercial); filterControls?.apply(profile.advanced); }
function rememberWorkflow() { workflowProfiles[currentWorkflow] = captureProfile(); localStorage.setItem('workflowProfiles', JSON.stringify(workflowProfiles)); localStorage.setItem('workflow', JSON.stringify(currentWorkflow)); }
function selectWorkflow() {
  rememberWorkflow(); currentWorkflow = $('#workflow').value;
  const presets = { all: ['soundeffect-lab', 'maou', 'onjin', 'samplefocus', 'landr', 'splice', 'noiiz', 'freesound', 'pixabay', 'local'], video: ['soundeffect-lab', 'maou', 'onjin', 'freesound', 'pixabay', 'local'], music: ['maou', 'samplefocus', 'landr', 'splice', 'noiiz', 'freesound', 'pixabay', 'local'] };
  applyProfile(workflowProfiles[currentWorkflow] || { sites: presets[currentWorkflow], kind: '', free: 'all', noCredit: false, commercial: false });
  rememberWorkflow(); search();
}
filterControls = new AllsampleFilterControls(() => { rememberWorkflow(); renderResults(); });
$('#workflow').value = currentWorkflow;
if (workflowProfiles[currentWorkflow]) applyProfile(workflowProfiles[currentWorkflow]);
$('#workflow').onchange = selectWorkflow;

$('#search-form').onsubmit = event => { event.preventDefault(); search(); };
document.querySelectorAll('[data-site]').forEach(input => { input.onchange = search; }); $('#kind').onchange = () => { rememberWorkflow(); renderResults(); }; $('#no-credit').onchange = () => { rememberWorkflow(); renderResults(); }; $('#commercial').onchange = () => { rememberWorkflow(); renderResults(); }; $('#price').onchange = () => { rememberWorkflow(); renderResults(); };
function clearFilters() { $('#price').value = 'all'; $('#kind').value = ''; $('#no-credit').checked = false; $('#commercial').checked = false; filterControls.apply(); rememberWorkflow(); renderResults(); }
$('#clear-filters').onclick = clearFilters; $('#reset-search').onclick = clearFilters;
$('#export-credits').onclick = () => action(async () => { if (!state.usedIds.size) { notify('詳細から使用素材を追加してください'); return; } if (await api.credits([...state.usedIds])) notify('クレジット.txt を保存しました'); });
document.querySelectorAll('[data-query]').forEach(button => { button.onclick = () => { $('#query').value = button.dataset.query; search(); }; });
document.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => { state.view = button.dataset.view; document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button)); search(); }; });
$('#batch').onclick = () => action(async () => { const button = $('#batch'); button.disabled = true; try { const files = await api.batch(visibleResults().map(sample => sample.id)); notify(`${files.length}件を Downloads の各サイトフォルダに書き出しました`); } finally { button.disabled = false; } });
$('#volume').oninput = event => { audio.volume = Number(event.target.value); libraryUI?.persist(); };
$('#seek').oninput = event => { if (Number.isFinite(playbackDuration())) { audio.currentTime = Number(event.target.value) / 1000 * playbackDuration(); audioGraph.reset(); } };
$('#player-play').onclick = () => action(async () => { if (state.auditioning) stop(); else await resumePlayback(); });
function setPlaybackSettings() {
  if (!$('#tempo').validity.valid || !$('#pitch').validity.valid || !$('#tempo').value || !$('#pitch').value) return;
  state.tempo = Number($('#tempo').value); state.pitch = Number($('#pitch').value);
  audioGraph.set(state.tempo, state.pitch); libraryUI?.persist();
}
$('#tempo').oninput = setPlaybackSettings; $('#pitch').oninput = setPlaybackSettings;
$('#reset-playback').onclick = () => { $('#tempo').value = 1; $('#pitch').value = 0; setPlaybackSettings(); };
function closePlaybackSettings() { document.body.classList.remove('adjust-open'); $('#adjust').setAttribute('aria-expanded', 'false'); }
$('#adjust').onclick = () => { const open = document.body.classList.toggle('adjust-open'); $('#adjust').setAttribute('aria-expanded', String(open)); };
document.addEventListener('pointerdown', event => { if (!event.target.closest('#adjust, #playback-settings')) closePlaybackSettings(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('adjust-open')) { closePlaybackSettings(); $('#adjust').focus(); } });

audio.ontimeupdate = () => { if (state.pendingPlay) return; $('#player-time').textContent = `${time(audio.currentTime)} / ${time(playbackDuration())}`; $('#seek').value = Number.isFinite(playbackDuration()) ? audio.currentTime / playbackDuration() * 1000 : 0; if (state.selected?.id === state.playing) drawWave($('#detail-wave'), state.info.get(state.playing)?.peaks, audio.currentTime / playbackDuration()); };
audio.onplay = refreshPlayback; audio.onpause = refreshPlayback;
audio.onended = () => { state.auditioning = false; audioGraph.idle(); refreshPlayback(); }; audio.onerror = () => { stop(); notify('音声を再生できませんでした。もう一度お試しください。'); };
document.addEventListener('keydown', event => {
  if ($('#settings').open) return;
  if (event.isComposing || event.target.closest('input:not([type=checkbox]), select, textarea, [contenteditable=true]') || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.matches('input[type=checkbox]') && (event.code === 'Space' || event.key === 'Enter')) return;
  if (event.key === '/') { event.preventDefault(); $('#query').focus(); $('#query').select(); }
  if (/^[1-4]$/.test(event.key)) { event.preventDefault(); libraryUI?.switchTo(Number(event.key) - 1); return; }
  if (event.key === 'b') { event.preventDefault(); libraryUI?.add(state.selected); return; }
  const items = visibleResults(); const index = items.findIndex(sample => sample.id === state.selected?.id);
  if (['ArrowDown', 'ArrowUp', 'j', 'k'].includes(event.key)) {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' || event.key === 'j' ? 1 : -1;
    const next = items[index < 0 ? 0 : Math.max(0, Math.min(items.length - 1, index + direction))];
    if (next && next.id !== state.selected?.id) {
      const continuePlayback = state.auditioning;
      selectSample(next);
      const row = document.querySelector(`[data-id="${next.id}"]`);
      row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' });
      if (continuePlayback) action(() => play(next)); else action(() => prepare(next));
    }
  }
  if (event.code === 'Space') { event.preventDefault(); if (state.auditioning) stop(); else if (state.selected) action(() => state.playing === state.selected.id ? resumePlayback() : play(state.selected)); }
  if (event.key === 'Enter' && state.selected && !event.target.matches('button')) { event.preventDefault(); action(async () => { if (await api.save(state.selected.id)) notify('保存しました'); }); }
  if (event.key === 'Escape') $('#detail').classList.remove('open');
});
window.addEventListener('blur', stop);
window.addEventListener('resize', () => { document.querySelectorAll('[data-wave]').forEach(canvas => drawWave(canvas, state.info.get(canvas.dataset.wave)?.peaks)); if (state.selected) updateDetailAudio(state.selected); });
libraryUI = new AllsampleLibrary({ state, api, render: renderResults, select: selectSample, play, prepare, stop, notify, search, labels: playerLabels, accept: rememberSample });
new AllsampleSettings(api, notify, () => { $('[data-site=freesound]').checked = true; search(); });
action(async () => { await libraryUI.restore(); if (workflowProfiles[currentWorkflow]) applyProfile(workflowProfiles[currentWorkflow]); state.ready = true; await search(); });
