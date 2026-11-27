// Ecos · Cola de envíos a WordPress sin conexión (lógica pura; main.js la guarda en userData/send-queue.json).
const BACKOFF_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000, 30 * 60 * 1000];

// Errores de red o del servidor (reintentables). Permisos, validación y demás no van a cola.
function isNetworkError(err) {
  if (err && (err.name === 'AuthError' || /AuthError/.test(err.constructor?.name || ''))) return false;
  const m = String((err && err.code ? err.code + ' ' : '') + (err && err.message ? err.message : err || ''));
  return /ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|fetch failed|socket hang up|No se puede conectar|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|\bHTTP 5\d\d\b/i.test(m);
}
const backoff = (attempts) => BACKOFF_MS[Math.min(Math.max(0, attempts | 0), BACKOFF_MS.length - 1)];

// Clave de una entrada: la misma entrada (tipo + id, o las mismas publicaciones de origen) se sustituye
const keyOf = (d) => (d.postId ? `${d.type === 'page' ? 'page' : 'post'}:${d.postId}` : `new:${(d.keys || []).join(',') || d.title || ''}`);

// Añade o sustituye. Devuelve la nueva cola (sin tocar la anterior).
function enqueue(queue, d, now = Date.now(), errMsg = '') {
  const key = keyOf(d);
  const old = queue.find((q) => q.key === key);
  const item = {
    id: old ? old.id : `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, key, title: String(d.title || ''),
    type: d.type === 'page' ? 'page' : 'post', status: d.status || 'draft', payload: d, attempts: 0,
    createdAt: old ? old.createdAt : now, nextAt: now + backoff(0), lastError: String(errMsg || '').slice(0, 300),
  };
  return old ? queue.map((q) => (q.key === key ? item : q)) : [...queue, item];
}
const failed = (queue, id, now, errMsg) => queue.map((q) => (q.id === id ? { ...q, attempts: q.attempts + 1, nextAt: now + backoff(q.attempts + 1), lastError: String(errMsg || '').slice(0, 300) } : q));
const remove = (queue, id) => queue.filter((q) => q.id !== id);
// hold: 'interrupted' (Ecos se cerró a mitad) o 'conflict' (cambió en WordPress): no se procesa solo hasta que la persona decida
const due = (queue, now) => queue.filter((q) => q.nextAt <= now && !q.hold);
const hold = (queue, id, why, extra = {}) => queue.map((q) => (q.id === id ? { ...q, hold: why, ...extra } : q));
const retryNow = (queue, id, now) => queue.map((q) => (id ? (q.id === id ? { ...q, nextAt: now, hold: '' } : q) : (q.hold ? q : { ...q, nextAt: now })));
const nextWake = (queue) => { const l = queue.filter((q) => !q.hold); return l.length ? Math.min(...l.map((q) => q.nextAt)) : 0; };
// Lo que ve la ventana (sin el contenido)
const view = (queue) => queue.map(({ payload, ...rest }) => rest);

module.exports = { isNetworkError, backoff, keyOf, enqueue, failed, remove, due, hold, retryNow, nextWake, view, BACKOFF_MS };
