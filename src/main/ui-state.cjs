const { randomUUID } = require('node:crypto');
const DEFAULT_PROJECT = 'default';
function ids(value, max = 5000) { return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && /^[a-z-]+-[a-f0-9]{20}$/.test(id)))].slice(0, max) : []; }
function cleanState(input = {}) {
  const projects = Array.isArray(input.projects) ? input.projects.filter(p => typeof p.id === 'string' && /^[\w-]{1,50}$/.test(p.id) && typeof p.name === 'string' && p.name.trim()).slice(0, 100).map(p => ({ id: p.id, name: p.name.trim().slice(0, 80), usedIds: ids(p.usedIds, 500) })) : [];
  if (!projects.length) projects.push({ id: DEFAULT_PROJECT, name: '未分類', usedIds: ids(input.usedIds, 500) });
  return { favoriteIds: ids(input.favoriteIds), history: ids(input.history, 200), projects, currentProject: projects.some(p => p.id === input.currentProject) ? input.currentProject : projects[0].id, compareIds: ids(input.compareIds, 4), blind: input.blind === true, enabledSites: Array.isArray(input.enabledSites) ? [...new Set(input.enabledSites.filter(id => typeof id === 'string' && /^[a-z-]{1,30}$/.test(id)))].slice(0, 30) : null, query: typeof input.query === 'string' ? input.query.slice(0, 200) : '雨', volume: Number.isFinite(input.volume) ? Math.max(0, Math.min(1, input.volume)) : .65, tempo: Number.isFinite(input.tempo) ? Math.max(.5, Math.min(2, input.tempo)) : 1, pitch: Number.isFinite(input.pitch) ? Math.max(-12, Math.min(12, input.pitch)) : 0 };
}
function newProject(name) { return { id: randomUUID(), name: name.trim().slice(0, 80), usedIds: [] }; }
module.exports = { cleanState, ids, newProject };
