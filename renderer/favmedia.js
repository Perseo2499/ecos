// Fotos destacadas a mano: favoritas (★) y «usadas recientemente» del selector de medios, por web, y mapa de
// imágenes destacadas de entradas. Lógica pura (la usan renderer/app/media.js y las pruebas).
// Forma guardada en la configuración (clave `mediaFavs`): { [web]: { fav: [copia mínima], recent: [copia mínima] } }
(function (root) {
  const RECENT_MAX = 24;
  const FAV_MAX = 500;
  // Clave de la web: dirección sin protocolo, «www.» ni barra final, en minúsculas
  const webKey = (url) => String(url || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  // Copia mínima para pintar al instante sin pedir nada a WordPress
  const slim = (m) => {
    const o = { id: Number(m.id), url: String(m.url || ''), thumb: String(m.thumb || m.tiny || ''), alt: String(m.alt || ''), type: m.type === 'video' ? 'video' : 'image' };
    if (m.large) o.large = String(m.large);
    if (m.name) o.name = String(m.name);
    return o;
  };
  const valid = (m) => !!(m && Number(m.id) > 0 && m.url);
  const mine = (store, web) => {
    const e = (store && store[webKey(web)]) || {};
    return { fav: Array.isArray(e.fav) ? e.fav : [], recent: Array.isArray(e.recent) ? e.recent : [] };
  };
  const put = (store, web, e) => ({ ...(store || {}), [webKey(web)]: e });
  const favs = (store, web) => mine(store, web).fav;
  const recents = (store, web) => mine(store, web).recent;
  const isFav = (store, web, id) => mine(store, web).fav.some((m) => m.id === Number(id));

  // Marca o desmarca una foto. Las nuevas van primero. Devuelve { store, on }.
  function toggleFav(store, web, m) {
    if (!valid(m)) return { store: store || {}, on: false };
    const e = mine(store, web), id = Number(m.id), was = e.fav.some((x) => x.id === id);
    const fav = was ? e.fav.filter((x) => x.id !== id) : [slim(m), ...e.fav].slice(0, FAV_MAX);
    return { store: put(store, web, { ...e, fav }), on: !was };
  }
  // Anota fotos como usadas: las últimas primero, sin repetidas y con límite
  function addRecent(store, web, items, max = RECENT_MAX) {
    const e = mine(store, web), add = (items || []).filter(valid).map(slim);
    if (!add.length) return store || {};
    const ids = new Set(add.map((m) => m.id));
    // la última de la lista pasa a ser la más reciente
    const recent = [...add.slice().reverse(), ...e.recent.filter((m) => !ids.has(m.id))].filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i).slice(0, max);
    return put(store, web, { ...e, recent });
  }
  // Quita una foto que ya no existe en WordPress, de favoritas y de recientes
  function removeMissing(store, web, id) {
    const e = mine(store, web), n = Number(id);
    return put(store, web, { fav: e.fav.filter((m) => m.id !== n), recent: e.recent.filter((m) => m.id !== n) });
  }

  // Imágenes destacadas de entradas. posts: [{id,title,featured_media,type?}] → { [idMedio]: [{id,title}] }
  function featuredMap(posts) {
    const out = {};
    for (const p of posts || []) {
      const id = Number(p.featured_media);
      if (!id) continue;
      const title = typeof p.title === 'string' ? p.title : (p.title?.raw ?? p.title?.rendered ?? '');
      const list = (out[id] ||= []);
      if (!list.some((x) => x.id === p.id)) list.push({ id: p.id, title: String(title || '').replace(/<[^>]+>/g, '').trim() || `#${p.id}` });
    }
    return out;
  }
  // Los medios de una lista que son imagen destacada de alguna entrada (en el orden de la lista)
  const featuredItems = (pool, map) => (pool || []).filter((m) => map && map[m.id]?.length);

  const api = { RECENT_MAX, webKey, slim, favs, recents, isFav, toggleFav, addRecent, removeMissing, featuredMap, featuredItems };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FavMedia = api;
})(typeof self !== 'undefined' ? self : this);
