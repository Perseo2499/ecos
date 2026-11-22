// Ecos · Lógica pura del aviso de «publicaciones nuevas en redes» (sirve en la app y en las pruebas).
// Una publicación es nueva si es posterior a la última que se vio y todavía no se ha pasado al blog.
(function (root) {
  const ms = (d) => { const n = new Date(d).getTime(); return Number.isFinite(n) ? n : 0; };
  // La fecha (ISO) de la más reciente de una lista, o null
  const newestDate = (posts) => { let best = 0; for (const p of posts || []) best = Math.max(best, ms(p.date)); return best ? new Date(best).toISOString() : null; };
  // posts: publicaciones de Meta (más recientes primero o no); lastSeen: ISO o null; isExported(p) → bool
  // → { fresh, baseline }: sin «última vista» (primera vez) no se avisa de nada: baseline es la fecha desde la que empezar a contar
  function findNew(posts, lastSeen, isExported = () => false) {
    const list = posts || [];
    if (!lastSeen || !ms(lastSeen)) return { fresh: [], baseline: newestDate(list) };
    const since = ms(lastSeen);
    const fresh = list.filter((p) => ms(p.date) > since && !isExported(p)).sort((a, b) => ms(b.date) - ms(a.date));
    return { fresh, baseline: null };
  }
  // «Instagram», «Facebook» o «Instagram y Facebook» según de dónde vengan (también las que se juntaron)
  function networks(posts) {
    const s = new Set();
    for (const p of posts || []) { s.add(p.source); for (const a of p.alsoOn || []) s.add(a.source); }
    return ['instagram', 'facebook'].filter((n) => s.has(n));
  }
  const api = { newestDate, findNew, networks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NewPosts = api;
})(typeof window !== 'undefined' ? window : globalThis);
