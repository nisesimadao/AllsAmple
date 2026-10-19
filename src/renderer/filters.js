(function(root) {
  function normalizedKey(value) {
    const key = String(value || '').normalize('NFKC').replace(/([A-G][#b]?)M\b/g, '$1maj').toLowerCase().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/minor|min\b/g, 'm').replace(/major|maj\b/g, '').replace(/\s+/g, '');
    const match = /^([a-g][#b]?)(m?)$/.exec(key);
    const notes = { c: 0, 'b#': 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, fb: 4, 'e#': 5, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11, cb: 11 };
    return match ? `${notes[match[1]]}:${match[2] || 'maj'}` : key;
  }
  function matches(sample, filters, measured = {}) {
    const duration = measured.duration ?? sample.duration;
    const channels = measured.channels ?? sample.channels;
    if (filters.kind && sample.kind !== filters.kind) return false;
    if (filters.free && sample.price !== 'free') return false;
    if (filters.noCredit && sample.license.attribution !== false) return false;
    for (const permission of ['commercial', 'redistribution', 'contentId', 'adult', 'modification']) if (filters[permission] && sample.license[permission] !== true) return false;
    if ((filters.minDuration > 0 || filters.maxDuration != null) && (!Number.isFinite(duration) || duration < (filters.minDuration || 0) || (filters.maxDuration != null && duration > filters.maxDuration))) return false;
    if (filters.minBpm != null && (!Number.isFinite(sample.bpm) || sample.bpm < filters.minBpm)) return false;
    if (filters.maxBpm != null && (!Number.isFinite(sample.bpm) || sample.bpm > filters.maxBpm)) return false;
    if (filters.key && normalizedKey(sample.key) !== normalizedKey(filters.key)) return false;
    if (filters.loop != null && sample.loop !== filters.loop) return false;
    if (filters.channels != null && channels !== filters.channels) return false;
    return true;
  }
  const api = { matches, normalizedKey };
  if (typeof module !== 'undefined') module.exports = api; else root.AllsampleFilters = api;
})(globalThis);
