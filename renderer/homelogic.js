// Ecos · Lógica pura de Inicio (sirve en la app y en las pruebas): recuento de publicaciones pendientes,
// semana de lunes a domingo y agrupación de entradas por día.
(function (root) {
  const ms = (d) => { const n = new Date(d).getTime(); return Number.isFinite(n) ? n : 0; };
  // Topes del recuento en segundo plano
  const LIMITS = { posts: 3000, pages: 60, staleMs: 6 * 3600 * 1000, thumbs: 6 };
  // posts: publicaciones ya juntadas (si procede); isExported(p) → bool. → { total, pending, newest: [las N más recientes sin pasar] }
  function countPending(posts, isExported = () => false, n = LIMITS.thumbs) {
    const list = posts || [];
    const pend = list.filter((p) => !isExported(p));
    const newest = [...pend].sort((a, b) => ms(b.date) - ms(a.date)).slice(0, n);
    return { total: list.length, pending: pend.length, newest };
  }
  // ¿El recuento guardado hay que rehacerlo? (no existe, es de otra página/ajuste o tiene más de 6 h)
  function isStale(cache, key, now = Date.now(), maxAge = LIMITS.staleMs) {
    return !cache || cache.key !== key || !(now - cache.at < maxAge);
  }
  // Lunes (00:00 local) de la semana que contiene a d
  function weekStart(d) {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Los 7 días (lunes a domingo) desde el lunes dado
  const weekDays = (start, n = 7) => Array.from({ length: n }, (_, i) => addDays(start, i));
  // items: [{date, ...}] → array de 7 listas (una por día, lunes primero), cada una ordenada por hora
  function groupByWeekday(items, start, n = 7) {
    const days = weekDays(start, n), idx = new Map(days.map((d, i) => [ymd(d), i]));
    const out = days.map(() => []);
    for (const it of items || []) { const i = idx.get(ymd(new Date(it.date))); if (i !== undefined) out[i].push(it); }
    out.forEach((l) => l.sort((a, b) => ms(a.date) - ms(b.date)));
    return out;
  }
  // Entradas con problemas para el carrusel de Revisión: una por id, con sus etiquetas (cat/img)
  function problemItems(health, max = 24) {
    const by = new Map();
    for (const x of health?.noCat || []) by.set(x.id, { ...x, cat: true, img: false });
    for (const x of health?.noImg || []) by.set(x.id, { ...x, ...(by.get(x.id) || {}), img: true });
    return [...by.values()].sort((a, b) => ms(b.date) - ms(a.date)).slice(0, max);
  }
  // Fotos de la biblioteca que no usa ninguna entrada (las N más recientes) y cuántas hay
  function unusedPhotos(pool, usage, n = 20) {
    const free = (pool || []).filter((m) => m.type !== 'video' && !(usage?.[m.id]?.length));
    free.sort((a, b) => ms(b.date) - ms(a.date));
    return { total: free.length, items: free.slice(0, n) };
  }
  const api = { LIMITS, countPending, isStale, weekStart, weekDays, groupByWeekday, problemItems, unusedPhotos, ymd, addDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HomeLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
