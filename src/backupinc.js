// Ecos · Copias incrementales. No se vuelve a bajar lo que no ha cambiado desde la última copia:
//  · Fotos: caché local (carpeta «media/» + «index.json») con cada medio ya descargado, identificado por su ID y una
//    firma «fecha de modificación | dirección | tamaño». Si la firma coincide y el archivo sigue en disco con su tamaño,
//    la copia lo lee de allí en vez de la red. El ZIP resultante sigue siendo COMPLETO (se restaura solo).
//  · Entradas y páginas: lista ligera (id + modified_gmt); solo se bajan completas las nuevas o cambiadas
//    (modified_after y, para lo que falte, include=ids). Las borradas desaparecen al no estar en la lista ligera.
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- caché de medios
const sigOf = (m) => `${m.modified || m.date || ''}|${m.url || ''}`;

class MediaCache {
  constructor(dir) {
    this.dir = dir; this.file = path.join(dir, 'index.json'); this.files = path.join(dir, 'media');
    this.index = {}; this.dirty = false;
    try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (j && j.v === 1 && j.items) this.index = j.items; } catch { /* sin caché */ }
  }
  // Ruta del archivo en caché si sigue valiendo, o null
  lookup(m) {
    const e = this.index[m.id];
    if (!e || e.sig !== sigOf(m)) return null;
    const f = path.join(this.files, String(e.f));
    try { return fs.statSync(f).size === e.size ? f : null; } catch { return null; }
  }
  read(m) { const f = this.lookup(m); return f ? fs.readFileSync(f) : null; }
  store(m, buf) {
    fs.mkdirSync(this.files, { recursive: true });
    const name = String(m.id).replace(/[^0-9a-z_-]/gi, '_');
    const tmp = path.join(this.files, name + '.tmp');
    fs.writeFileSync(tmp, buf); fs.renameSync(tmp, path.join(this.files, name));
    this.index[m.id] = { sig: sigOf(m), size: buf.length, f: name }; this.dirty = true;
  }
  // Quita lo que ya no está en la biblioteca (ids vivos)
  prune(liveIds) {
    const live = new Set(liveIds.map(String));
    for (const id of Object.keys(this.index)) if (!live.has(id)) { try { fs.unlinkSync(path.join(this.files, String(this.index[id].f))); } catch { /* ya no está */ } delete this.index[id]; this.dirty = true; }
  }
  save() {
    if (!this.dirty) return;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify({ v: 1, items: this.index })); fs.renameSync(this.file + '.tmp', this.file);
    this.dirty = false;
  }
  bytes() { return Object.values(this.index).reduce((a, e) => a + (e.size || 0), 0); }
  count() { return Object.keys(this.index).length; }
  clear() { fs.rmSync(this.dir, { recursive: true, force: true }); this.index = {}; this.dirty = false; }
}

// download(url) con caché. media: lista de la biblioteca de Ecos ({id, url, date, modified}). stats se rellena solo.
function cachedDownload(cache, media, rawDownload, stats = {}) {
  const byUrl = new Map(media.map((m) => [m.url, m]));
  stats.mediaReused = stats.mediaReused || 0; stats.mediaDownloaded = stats.mediaDownloaded || 0; stats.mediaBytesSaved = stats.mediaBytesSaved || 0;
  return async (url) => {
    const m = byUrl.get(url);
    if (m) { const hit = cache.read(m); if (hit) { stats.mediaReused++; stats.mediaBytesSaved += hit.length; return hit; } }
    const buf = await rawDownload(url);
    if (buf && m) { try { cache.store(m, buf); } catch { /* disco lleno: se sigue sin caché */ } }
    if (buf) stats.mediaDownloaded++;
    return buf;
  };
}

// ---------------------------------------------------------------- entradas y páginas
// Caché en un JSON por tipo: { v:1, syncedAt, mod: {id: modified_gmt}, items: {id: objeto REST completo} }
class PostCache {
  constructor(dir) { this.dir = dir; }
  _f(type) { return path.join(this.dir, `posts-${type}.json`); }
  load(type) { try { const j = JSON.parse(fs.readFileSync(this._f(type), 'utf8')); if (j.v === 1) return j; } catch { /* vacía */ } return { v: 1, syncedAt: '', mod: {}, items: {} }; }
  save(type, c) { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this._f(type) + '.tmp', JSON.stringify(c)); fs.renameSync(this._f(type) + '.tmp', this._f(type)); }
  clear() { try { for (const f of fs.readdirSync(this.dir)) if (/^posts-.*\.json$/.test(f)) fs.unlinkSync(path.join(this.dir, f)); } catch { /* nada */ } }
}

const ROUTE_RE = /^\/wp\/v2\/(posts|pages)\?/;
const FULL_FIELDS = 'id,title,content,excerpt,date,date_gmt,status,slug,categories,tags,featured_media,parent,menu_order,link'; // = POST_FIELDS de backupcreate
const withParam = (route, k, v) => `${route}${route.includes('?') ? '&' : '?'}${k}=${encodeURIComponent(v)}`;
const setFields = (route, fields) => route.replace(/_fields=[^&]*/, '_fields=' + fields);

// Devuelve un listAll con la misma forma que el de createBackup, pero incremental para /wp/v2/posts y /wp/v2/pages.
// listAll(ruta) → [] · now() → ms · stats se rellena: postsReused, postsFetched, postsRemoved
function incrementalListAll(listAll, cache, stats = {}, now = () => Date.now()) {
  for (const k of ['postsReused', 'postsFetched', 'postsRemoved']) stats[k] = stats[k] || 0;
  return async (route) => {
    const m = ROUTE_RE.exec(route);
    if (!m || !route.includes('_fields=' + FULL_FIELDS)) return listAll(route);
    const type = m[1], c = cache.load(type), started = now();
    const light = await listAll(setFields(route, 'id,modified_gmt'));
    const stale = light.filter((x) => !c.items[x.id] || c.mod[x.id] !== x.modified_gmt);
    const byId = {};
    if (!c.syncedAt || !Object.keys(c.items).length || stale.length * 2 > light.length) {
      // primera vez o casi todo ha cambiado: lista completa
      const all = light.length ? await listAll(route) : [];
      for (const it of all) byId[it.id] = it;
    } else if (stale.length) {
      const after = new Date(new Date(c.syncedAt).getTime() - 5 * 60e3).toISOString().replace(/\.\d+Z$/, '');
      for (const it of await listAll(withParam(route, 'modified_after', after))) byId[it.id] = it;
      const missing = stale.filter((x) => !byId[x.id]).map((x) => x.id);
      for (let i = 0; i < missing.length; i += 50) for (const it of await listAll(withParam(route, 'include', missing.slice(i, i + 50).join(',')))) byId[it.id] = it;
    }
    const liveIds = new Set(light.map((x) => String(x.id)));
    const out = [];
    for (const x of light) {
      const fresh = byId[x.id];
      if (fresh) { c.items[x.id] = fresh; c.mod[x.id] = x.modified_gmt; stats.postsFetched++; out.push(fresh); }
      else if (c.items[x.id]) { stats.postsReused++; out.push(c.items[x.id]); }
    }
    for (const id of Object.keys(c.items)) if (!liveIds.has(id)) { delete c.items[id]; delete c.mod[id]; stats.postsRemoved++; }
    c.syncedAt = new Date(started).toISOString();
    cache.save(type, c);
    return out;
  };
}

module.exports = { MediaCache, PostCache, cachedDownload, incrementalListAll, sigOf };
