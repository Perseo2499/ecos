// Ecos · Lógica pura de los borradores automáticos de las publicaciones nuevas (sirve en la app y en las pruebas).
// Qué publicaciones se procesan en cada ronda, sin duplicar lo ya exportado ni lo que se está procesando (también tras reiniciar).
(function (root) {
  const LIMIT = 5;
  const BUSY_MS = 6 * 3600e3;   // una publicación «en proceso» no se vuelve a coger hasta pasado este tiempo (por si la app se cerró a mitad)
  const RETRY_MS = 1 * 3600e3;  // tras un fallo se espera antes de reintentar
  const keysOf = (p) => [p.source + ':' + p.id, ...(p.alsoOn || []).map((a) => a.source + ':' + a.id)];
  // claims: { clave: caducaEn(ms) } → solo las vigentes
  const activeClaims = (claims, now = Date.now()) => Object.fromEntries(Object.entries(claims || {}).filter(([, exp]) => Number(exp) > now));
  // fresh: nuevas (ya juntadas Instagram+Facebook); isExported(p) → bool; claims: marcas guardadas en la configuración
  // → { todo: hasta `limit` publicaciones, más antiguas primero; rest: las que quedan para otra ronda; skipped: ya exportadas o en proceso }
  function select(fresh, { isExported = () => false, claims = {}, limit = LIMIT, now = Date.now() } = {}) {
    const busy = new Set(Object.keys(activeClaims(claims, now)));
    const taken = new Set();
    const todo = [], rest = [], skipped = [];
    const ordered = [...(fresh || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const p of ordered) {
      const ks = keysOf(p);
      if (isExported(p) || ks.some((k) => busy.has(k) || taken.has(k))) { skipped.push(p); continue; }
      ks.forEach((k) => taken.add(k)); // la misma publicación (Instagram/Facebook) dos veces en la lista no se duplica
      (todo.length < limit ? todo : rest).push(p);
    }
    return { todo, rest, skipped };
  }
  const claim = (claims, p, now = Date.now()) => ({ ...activeClaims(claims, now), ...Object.fromEntries(keysOf(p).map((k) => [k, now + BUSY_MS])) });
  const fail = (claims, p, now = Date.now()) => ({ ...activeClaims(claims, now), ...Object.fromEntries(keysOf(p).map((k) => [k, now + RETRY_MS])) });
  const release = (claims, p, now = Date.now()) => { const c = activeClaims(claims, now); for (const k of keysOf(p)) delete c[k]; return c; };
  const api = { LIMIT, keysOf, activeClaims, select, claim, fail, release };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AutoDrafts = api;
})(typeof window !== 'undefined' ? window : globalThis);
