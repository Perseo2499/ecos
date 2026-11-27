// Ecos · Envíos a WordPress reanudables por pasos (lógica sin Electron; main.js la usa y las pruebas la simulan).
// Un envío = subir medios externos + destacada + crear/actualizar la entrada. Cada paso que termina se apunta
// en disco (send-progress.json, escritura atómica) para que, tras un corte o cerrar Ecos, al reintentar no se
// vuelva a subir lo ya subido ni se cree otra entrada.
const fs = require('fs');
const path = require('path');
const SQ = require('./sendqueue');

// Escritura atómica: se escribe a .tmp, se fuerza a disco y se renombra (nunca queda un archivo a medias)
function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, text); try { fs.fsyncSync(fd); } catch { /* sin fsync */ } } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

// Progreso en disco: { [key]: registro }
function makeProgress(file) {
  let data = {};
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) data = j; } catch { /* sin progreso */ }
  const flush = () => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); atomicWrite(file, JSON.stringify(data)); } catch { /* no impide el envío */ } };
  const api = {
    get: (key) => data[key] || null,
    all: () => Object.values(data),
    // Empieza (o continúa) el envío de esta clave; conserva lo ya hecho
    begin(key, d) {
      const old = data[key] || {};
      data[key] = { media: {}, ...old, key, title: String(d.title || ''), type: d.type === 'page' ? 'page' : 'post', payload: d, running: true, startedAt: old.startedAt || Date.now(), updatedAt: Date.now(), step: old.step || 'media' };
      flush(); return data[key];
    },
    update(key, patch) { if (!data[key]) return null; Object.assign(data[key], typeof patch === 'function' ? patch(data[key]) : patch, { updatedAt: Date.now() }); flush(); return data[key]; },
    setMedia(key, url, up) { return api.update(key, (r) => ({ media: { ...r.media, [url]: { id: up.id, url: up.url } } })); },
    remove(key) { if (data[key]) { delete data[key]; flush(); } },
    stop(key) { if (data[key] && data[key].running) api.update(key, { running: false }); },
    // Resumen para la ventana
    brief(key) {
      const r = data[key]; if (!r) return null;
      return { step: r.step, mediaDone: Object.keys(r.media || {}).length, mediaTotal: r.mediaTotal || 0, postId: r.postId || 0, created: !!r.postId };
    },
    prune(maxAgeMs = 7 * 864e5) { let ch = false; for (const k of Object.keys(data)) if (!data[k].running && Date.now() - (data[k].updatedAt || 0) > maxAgeMs) { delete data[k]; ch = true; } if (ch) flush(); },
  };
  return api;
}

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));
// Reintentos con espera exponencial para errores de red (subidas grandes). tries = intentos totales.
async function withRetry(fn, { tries = 4, base = 1500, max = 30000, sleep = sleepReal, isNet = SQ.isNetworkError, onRetry } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!isNet(e) || i === tries - 1) throw e;
      const wait = Math.min(max, base * 2 ** i);
      if (onRetry) onRetry(i + 1, wait, e);
      await sleep(wait);
    }
  }
  throw last;
}

// Asegura que un medio externo está en la biblioteca, sin duplicarlo:
// 1) ya subido en un intento anterior (y sigue existiendo) → se reutiliza
// 2) ya hay en la biblioteca uno con ese nombre y tamaño → se reutiliza
// 3) si no, se sube y se anota de inmediato
async function ensureMedia({ wp, cfg, prog, key }, url, upload, probe) {
  const hit = prog.get(key)?.media?.[url];
  if (hit && (!wp.mediaExists || await wp.mediaExists(cfg, hit.id))) return { ...hit, reused: true };
  if (probe && probe.name && wp.findMediaByName) {
    const found = await wp.findMediaByName(cfg, probe.name, probe.size);
    if (found) { prog.setMedia(key, url, found); return { ...found, reused: true }; }
  }
  const up = await upload(url);
  if (!up?.url) throw new Error('No se pudo subir un medio externo');
  prog.setMedia(key, url, up);
  return up;
}

const conflictError = (cur) => Object.assign(new Error('Esta entrada ha cambiado en WordPress desde que la abriste.'), { code: 'CONFLICT', modified: cur });
const isConflict = (e) => !!e && e.code === 'CONFLICT';
const changedSince = (opened, current) => {
  const a = new Date(opened).getTime(), b = new Date(current).getTime();
  return !!opened && !!current && Number.isFinite(a) && Number.isFinite(b) && b > a;
};

// deps: { wp, cfg, prog, emit, sleep, log, isAuth, collectUrls(d), replaceUrls(d,map), uploadUrl(url), probeFor(url),
//         resolveFeatured(d), buildFields(d), beforePost(d,fields), afterPost(post,d,fields), deletePost(d), isSelf, noRetry }
async function runSend(d, deps) {
  const { wp, cfg, prog, emit = () => {}, sleep = sleepReal, log = () => {}, isAuth = () => false } = deps;
  const key = SQ.keyOf(d);
  const emitStep = (step, extra = {}) => emit({ key, title: d.title || '', step, ...extra });
  prog.begin(key, d);
  try {
    // Conflicto: la entrada cambió en WordPress mientras tanto
    if (d.postId && d.baseModified && !d.overwrite && !d.recreate && !prog.get(key)?.postId && deps.isSelf && wp.postModified) {
      const cur = (await wp.postModified(cfg, d.postId, d.type))?.modified || null;
      if (changedSince(d.baseModified, cur)) throw conflictError(cur);
    }
    const retryOpts = { tries: deps.noRetry ? 1 : 3, sleep, onRetry: (n, wait) => emitStep('retry', { attempt: n, wait }) };
    // Paso 1: medios externos (cada uno se apunta al subirse)
    const urls = deps.collectUrls(d);
    prog.update(key, { mediaTotal: urls.length, step: 'media' });
    const map = {};
    let failed = 0;
    for (let i = 0; i < urls.length; i++) {
      const u = urls[i];
      emitStep('media', { done: i, total: urls.length });
      try {
        const up = await ensureMedia({ wp, cfg, prog, key }, u, (x) => withRetry(() => deps.uploadUrl(x), retryOpts), deps.probeFor ? await deps.probeFor(u) : null);
        map[u] = up.url;
      } catch (e) {
        if (isAuth(e) || SQ.isNetworkError(e)) throw e; // red caída: se para y se reanuda
        failed++; log('Medio externo no subido', String(u).slice(0, 80), e.message);
      }
    }
    deps.replaceUrls(d, map);
    // Paso 2: imagen destacada
    prog.update(key, { step: 'featured' });
    emitStep('featured');
    const rec = prog.get(key);
    if (d.featuredImageId && rec.featured && rec.featured.from === String(d.featuredImageId)) d.featuredImageId = rec.featured.id;
    else { const from = String(d.featuredImageId || ''); d.featuredImageId = await deps.resolveFeatured(d); if (from) prog.update(key, { featured: { from, id: d.featuredImageId } }); }
    // Paso 3: crear o actualizar la entrada
    const fields = deps.buildFields(d);
    if (deps.beforePost) await deps.beforePost(d, fields);
    prog.update(key, { step: 'post' });
    emitStep('post');
    let post;
    const known = prog.get(key).postId;
    if (known) { d.postId = known; d.recreate = false; }
    try {
      if (d.postId && d.recreate && deps.deletePost) {
        await deps.deletePost(d);
        post = await wp.createPost(cfg, fields);
      } else post = await (d.postId ? wp.updatePost(cfg, d.postId, fields) : wp.createPost(cfg, fields));
    } catch (e) {
      // la entrada que se apuntó en un intento anterior ya no existe: se crea de nuevo
      if (known && !SQ.isNetworkError(e) && !isAuth(e) && /404|no existe|invalid|No se ha encontrado/i.test(e.message)) post = await wp.createPost(cfg, fields); else throw e;
    }
    prog.update(key, { postId: post.ID, step: 'finish' }); // en cuanto existe, se apunta
    emitStep('finish');
    const result = await deps.afterPost(post, d, fields);
    prog.remove(key);
    emitStep('done');
    return { ...result, failedMedia: failed };
  } catch (e) {
    prog.stop(key);
    throw e;
  }
}

module.exports = { atomicWrite, makeProgress, withRetry, ensureMedia, runSend, conflictError, isConflict, changedSince };
