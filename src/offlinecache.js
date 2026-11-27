// Ecos · Caché local para el modo sin conexión: lista del Blog / Inicio y últimas versiones de las entradas abiertas.
// Archivo único en userData (offline-cache.json), escritura atómica. Lógica sin Electron.
const fs = require('fs');
const path = require('path');
const { atomicWrite } = require('./sendsteps');

const MAX_LISTS = 12, MAX_POSTS = 40;

function make(file, now = () => Date.now()) {
  let data = { lists: {}, posts: {} };
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && j.lists && j.posts) data = j; } catch { /* sin caché */ }
  let timer = null;
  const flushNow = () => { clearTimeout(timer); timer = null; try { fs.mkdirSync(path.dirname(file), { recursive: true }); atomicWrite(file, JSON.stringify(data)); } catch { /* sin caché */ } };
  const flush = () => { if (!timer) { timer = setTimeout(flushNow, 400); timer.unref?.(); } };
  const trim = (obj, max) => { const k = Object.keys(obj); if (k.length > max) k.sort((a, b) => obj[a].at - obj[b].at).slice(0, k.length - max).forEach((x) => delete obj[x]); };
  const listKey = (o) => JSON.stringify(Object.keys(o || {}).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {}));
  return {
    putList(opts, value) { data.lists[listKey(opts)] = { at: now(), value, type: opts?.type || 'post' }; trim(data.lists, MAX_LISTS); flush(); },
    // Exacta o, si no, la más reciente del mismo tipo
    getList(opts) {
      const ex = data.lists[listKey(opts)]; if (ex) return ex;
      const same = Object.values(data.lists).filter((x) => x.type === (opts?.type || 'post')).sort((a, b) => b.at - a.at);
      return same[0] || null;
    },
    putPost(type, id, value) { data.posts[`${type === 'page' ? 'page' : 'post'}:${id}`] = { at: now(), value }; trim(data.posts, MAX_POSTS); flush(); },
    getPost(type, id) { return data.posts[`${type === 'page' ? 'page' : 'post'}:${id}`] || null; },
    flushNow,
  };
}
module.exports = { make };
