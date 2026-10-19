/**
 * hook.js — ページ本体(MAIN world)で動く。
 *
 * SampleFocus は各サンプルの mp3 URL を、React on Rails が吐く
 * <script type="application/json"> のペイロードに `sample_mp3_url` として
 * 最初から埋め込んでいる。つまり再生しなくても正解の URL が分かる。
 *
 * ここではその索引を作り、content script からの問い合わせ（slug / sample id）に
 * 答える。ページ送りやフィルタで後から来る分は fetch/XHR のレスポンスを見て
 * 足し、それでも無ければ React の fiber から拾う。
 *
 * content script (ISOLATED world) からは page のプロパティ（__reactFiber$… 等）が
 * 見えないので、この係だけは MAIN world に居る必要がある。
 */
(() => {
  if (window.__sfdlHookInstalled) return;
  window.__sfdlHookInstalled = true;

  if (location.hostname === 'samples.landr.com') {
    installLandr();
    return;
  }

  if (location.hostname === 'splice.com' || location.hostname === 'www.noiiz.com') {
    installCatalog();
    return;
  }

  const bySlug = new Map();
  const byId = new Map();

  function addEntry(o) {
    if (!o || typeof o.sample_mp3_url !== 'string') return false;
    const e = {
      mp3: o.sample_mp3_url,
      name: typeof o.name === 'string' ? o.name : '',
      slug: typeof o.slug === 'string' ? o.slug : '',
      id: o.id != null ? String(o.id) : ''
    };
    if (e.slug) bySlug.set(e.slug, e);
    if (e.id) byId.set(e.id, e);
    return true;
  }

  // 任意の JSON から sample_mp3_url を持つオブジェクトを掘り出す
  function harvest(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 8) return 0;
    let n = 0;
    if (Array.isArray(obj)) {
      for (const v of obj) n += harvest(v, depth + 1);
      return n;
    }
    if (addEntry(obj)) n++;
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') n += harvest(v, depth + 1);
    }
    return n;
  }

  /* --- 1) 埋め込み JSON（初期表示ぶん） ---------------------------------- */
  const scannedScripts = new WeakSet();

  function scanEmbeddedJson() {
    document.querySelectorAll('script[type="application/json"]').forEach((s) => {
      if (scannedScripts.has(s)) return;
      scannedScripts.add(s);
      const t = s.textContent;
      if (!t || t.indexOf('sample_mp3_url') === -1) return;
      try {
        harvest(JSON.parse(t), 0);
      } catch (_) {}
    });
  }

  scanEmbeddedJson();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanEmbeddedJson);
  }

  /* --- 2) 後から来るぶん（ページ送り・フィルタ・無限スクロール） ---------- */
  try {
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      return p.then((res) => {
        try {
          const ct = res.headers && res.headers.get && res.headers.get('content-type');
          if (ct && ct.indexOf('json') !== -1) {
            res
              .clone()
              .json()
              .then((j) => harvest(j, 0))
              .catch(() => {});
          }
        } catch (_) {}
        return res;
      });
    };
  } catch (_) {}

  try {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      this.addEventListener('load', function () {
        try {
          const t = this.responseType;
          if (t && t !== 'text' && t !== 'json') return;
          const body = t === 'json' ? this.response : this.responseText;
          if (!body) return;
          if (typeof body === 'string') {
            if (body.indexOf('sample_mp3_url') === -1) return;
            harvest(JSON.parse(body), 0);
          } else {
            harvest(body, 0);
          }
        } catch (_) {}
      });
      return origOpen.apply(this, arguments);
    };
  } catch (_) {}

  /* --- 3) 最後の砦: React fiber から拾う -------------------------------- */
  function matches(o, slug, id) {
    if (!o || typeof o.sample_mp3_url !== 'string') return false;
    if (slug && o.slug === slug) return true;
    if (id && o.id != null && String(o.id) === id) return true;
    return false;
  }

  function scanProps(obj, slug, id, depth) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;
    if (Array.isArray(obj)) {
      for (const v of obj) {
        const r = scanProps(v, slug, id, depth + 1);
        if (r) return r;
      }
      return null;
    }
    if (matches(obj, slug, id)) return obj;
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') {
        const r = scanProps(v, slug, id, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  function fromFiber(el, slug, id) {
    if (!el) return null;
    const key = Object.keys(el).find((k) => k.indexOf('__reactFiber$') === 0);
    if (!key) return null;
    let node = el[key];
    let hops = 0;
    while (node && hops++ < 30) {
      const props = node.memoizedProps || node.pendingProps;
      const hit = scanProps(props, slug, id, 0);
      if (hit) {
        addEntry(hit);
        return hit;
      }
      node = node.return;
    }
    return null;
  }

  /* --- content script との窓口 ------------------------------------------ */
  function reply(reqId, entry) {
    window.postMessage(
      {
        __sfdl: 'page->cs',
        type: 'RESOLVED',
        reqId,
        url: entry ? entry.sample_mp3_url || entry.mp3 : null,
        name: entry ? entry.name || '' : ''
      },
      location.origin
    );
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.__sfdl !== 'cs->page') return;

    if (d.type === 'RESOLVE') {
      const slug = d.slug || '';
      const id = d.id ? String(d.id) : '';

      let entry = (slug && bySlug.get(slug)) || (id && byId.get(id)) || null;

      if (!entry) {
        scanEmbeddedJson();
        entry = (slug && bySlug.get(slug)) || (id && byId.get(id)) || null;
      }
      if (!entry && d.reqId != null) {
        const el = document.querySelector('[data-sfdl-req="' + d.reqId + '"]');
        entry = fromFiber(el, slug, id);
      }
      reply(d.reqId, entry);
    }
  });
  // LANDR already requests signed preview URLs for visible samples. Observe those
  // responses rather than duplicating its GraphQL queries or authentication.
  function installLandr() {
    const streams = new Map();
    const waiting = new Set();
    const guidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

    function remember(value) {
      if (typeof value !== 'string') return;
      let url;
      try { url = new URL(value); } catch (_) { return; }
      if (url.protocol !== 'https:' || url.hostname !== 'assets.landr.com') return;
      const match = url.pathname.match(/^\/samples\/secure\/streams\/([^/]+)\/[^/]+$/);
      if (!match || !guidPattern.test(match[1])) return;
      let expires = Date.now() + 240000;
      try {
        const policy = JSON.parse(atob(url.searchParams.get('Policy').replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/')));
        const epoch = policy.Statement[0].Condition.DateLessThan['AWS:EpochTime'];
        if (Number.isFinite(epoch)) expires = epoch * 1000 - 15000;
      } catch (_) {}
      streams.delete(match[1]);
      streams.set(match[1], { url: value, expires });
      if (streams.size > 500) streams.delete(streams.keys().next().value);
      for (const notify of waiting) notify();
    }

    function harvestStreams(obj, depth = 0) {
      if (!obj || typeof obj !== 'object' || depth > 12) return;
      for (const value of Object.values(obj)) {
        if (typeof value === 'string') remember(value);
        else if (value && typeof value === 'object') harvestStreams(value, depth + 1);
      }
    }

    const originalFetch = window.fetch;
    window.fetch = function () {
      return originalFetch.apply(this, arguments).then((res) => {
        try {
          remember(res.url);
          if (res.ok && res.headers.get('content-type')?.includes('json')) {
            res.clone().json().then(harvestStreams).catch(() => {});
          }
        } catch (_) {}
        return res;
      });
    };
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      this.addEventListener('load', function () {
        try {
          if (this.status < 200 || this.status >= 300) return;
          remember(this.responseURL);
          if (this.responseType === 'json') harvestStreams(this.response);
          else if ((!this.responseType || this.responseType === 'text') && this.getResponseHeader('content-type')?.includes('json')) {
            harvestStreams(JSON.parse(this.responseText));
          }
        } catch (_) {}
      }, { once: true });
      return originalOpen.apply(this, arguments);
    };

    function sampleOf(row, id) {
      const key = Object.keys(row).find((key) => key.startsWith('__reactFiber$'));
      let node = key && row[key];
      for (let hops = 0; node && hops < 8; hops++, node = node.return) {
        const sample = (node.memoizedProps || node.pendingProps)?.sample;
        if (sample?.guid === id) return sample;
      }
      return null;
    }

    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const d = event.data;
      if (!d || d.__sfdl !== 'cs->page' || d.type !== 'RESOLVE' || !Number.isSafeInteger(d.reqId)) return;
      const row = document.querySelector('[data-sfdl-req="' + d.reqId + '"]');
      const id = String(d.id || '');
      if (!row || !guidPattern.test(id)) return;
      const checkbox = row.querySelector('[data-testid="row-checkbox-' + id + '"]');
      if (!checkbox) return;
      const sample = sampleOf(row, id);
      const name = sample?.name || row.querySelector('[title]')?.getAttribute('title') || '';
      let timer;
      function finish(url) {
        clearTimeout(timer);
        waiting.delete(check);
        window.postMessage({ __sfdl: 'page->cs', type: 'RESOLVED', reqId: d.reqId, url, name }, location.origin);
      }
      function check() {
        const entry = streams.get(id);
        if (!entry || entry.expires <= Date.now()) return false;
        finish(entry.url);
        return true;
      }
      if (check()) return;
      waiting.add(check);
      timer = setTimeout(() => finish(null), 8000);
      // A missing URL can be requested through LANDR's own player. Only a URL
      // containing this row's GUID can fulfill the request, even during prefetch.
      row.querySelector('button[aria-label="Play"]')?.click();
    });
  }
  // Splice exposes preview_mp3 files in its hydrated JSON / network responses.
  // Noiiz keeps the exact row's sample in Vue props. Neither adapter builds URLs.
  function installCatalog() {
    const splice = location.hostname === 'splice.com';
    const entries = new Map();
    const waiting = new Set();
    const scanned = new WeakSet();

    function validUrl(value) {
      try {
        const url = new URL(value);
        const hostOK = splice
          ? /^(spliceproduction\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com|spliceblob\.splice\.com)$/.test(url.hostname)
          : url.hostname.endsWith('.cloudfront.net');
        return url.protocol === 'https:' && hostOK && /\.mp3$/i.test(url.pathname) ? url : null;
      } catch (_) { return null; }
    }

    function remember(id, value, name = '') {
      const url = validUrl(value);
      if (!url || (!url.pathname.startsWith('/audio_samples/' + id + '/') && !url.pathname.startsWith('/audio_samples/' + id + '-'))) return;
      let expires = Date.now() + 240000;
      const date = url.searchParams.get('X-Amz-Date');
      const ttl = Number(url.searchParams.get('X-Amz-Expires'));
      if (date && /^\d{8}T\d{6}Z$/.test(date) && ttl > 0) {
        expires = Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')) + ttl * 1000 - 15000;
      }
      name = name || entries.get(id)?.name || '';
      entries.delete(id);
      entries.set(id, {url: value, name: name.split('/').pop(), expires});
      if (entries.size > 500) entries.delete(entries.keys().next().value);
      for (const check of waiting) check();
    }

    function harvest(obj, depth = 0) {
      if (!obj || typeof obj !== 'object' || depth > 14) return;
      if (obj.asset_type_slug === 'sample' && /^[a-f0-9]{64}$/.test(obj.uuid) && Array.isArray(obj.files)) {
        const file = obj.files.find(f => f.asset_file_type_slug === 'preview_mp3');
        if (file) remember(obj.uuid, file.url, obj.name);
      }
      // SvelteKit embeds fetched responses as JSON with a serialized body.
      if (typeof obj.body === 'string' && obj.body.includes('preview_mp3')) {
        try { harvest(JSON.parse(obj.body), depth + 1); } catch (_) {}
      }
      for (const value of Object.values(obj)) {
        if (value && typeof value === 'object') harvest(value, depth + 1);
      }
    }
    function scan() {
      document.querySelectorAll('script[type="application/json"]').forEach(script => {
        if (scanned.has(script)) return;
        scanned.add(script);
        try { harvest(JSON.parse(script.textContent)); } catch (_) {}
      });
    }
    if (splice) {
      const originalFetch = window.fetch;
      window.fetch = function () {
        return originalFetch.apply(this, arguments).then(res => {
          try {
            const url = validUrl(res.url);
            const id = url?.pathname.match(/\/audio_samples\/([a-f0-9]{64})/i)?.[1];
            if (id && res.ok) remember(id, res.url);
            if (res.ok && res.headers.get('content-type')?.includes('json')) {
              res.clone().json().then(harvest).catch(() => {});
            }
          } catch (_) {}
          return res;
        });
      };
      const originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function () {
        this.addEventListener('load', function () {
          try {
            if (this.status < 200 || this.status >= 300) return;
            if (this.responseType === 'json') harvest(this.response);
            else if ((!this.responseType || this.responseType === 'text') && this.getResponseHeader('content-type')?.includes('json')) harvest(JSON.parse(this.responseText));
          } catch (_) {}
        }, {once:true});
        return originalOpen.apply(this, arguments);
      };
    }
    function noiizSample(row) {
      const own = row.__vue__?.$props?.data;
      if (own?.sample_type) return own;
      const table = row.closest?.('.nz-table')?.__vue__;
      if (!table || !Array.isArray(table.$props?.items)) return null;
      // Ordinary rows have no Vue instance. Their VNode key is the sample ID,
      // so even duplicate filenames are resolved using the exact rendered row.
      function keyOf(node, depth = 0) {
        if (!node || depth > 20) return null;
        if (node.elm === row && node.key != null) return node.key;
        for (const child of node.children || []) {
          const key = keyOf(child, depth + 1);
          if (key != null) return key;
        }
        return node.componentInstance ? keyOf(node.componentInstance._vnode, depth + 1) : null;
      }
      const key = keyOf(table._vnode);
      return key == null ? null : table.$props.items.find(sample => String(sample.id) === String(key));
    }
    window.addEventListener('message', event => {
      if (event.source !== window || event.origin !== location.origin) return;
      const d = event.data;
      if (!d || d.__sfdl !== 'cs->page' || d.type !== 'RESOLVE' || !Number.isSafeInteger(d.reqId)) return;
      const row = document.querySelector('[data-sfdl-req="' + d.reqId + '"]');
      if (!row) return;
      const id = String(d.id || '');
      let timer;
      function finish(entry) {
        clearTimeout(timer);
        waiting.delete(check);
        window.postMessage({__sfdl:'page->cs', type:'RESOLVED', reqId:d.reqId, url:entry?.url || null, name:entry?.name || ''}, location.origin);
      }
      function check() {
        const entry = entries.get(id);
        if (!entry || entry.expires <= Date.now()) return false;
        finish(entry);
        return true;
      }
      if (!splice) {
        const sample = noiizSample(row);
        const url = sample && validUrl(sample.lq_url);
        // Pack demos are intentionally excluded; this must be an individual sample.
        finish(sample?.sample_type && url ? {url:url.href, name:sample.name} : null);
        return;
      }
      if (!/^[a-f0-9]{64}$/.test(id) || !row.querySelector('a[href*="/sounds/sample/' + id + '"]')) return;
      scan();
      if (check()) return;
      waiting.add(check);
      timer = setTimeout(() => finish(null), 8000);
      row.querySelector('[data-qa="playPausePlaybackButton"]')?.click();
    });
  }
})();
