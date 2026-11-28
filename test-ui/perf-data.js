// Datos simulados GRANDES y deterministas para el banco de rendimiento (test-ui/perf.test.js).
// `perfPatch` y `hugeBlocks` se ejecutan DENTRO de la página (se serializan con toString): no pueden usar variables externas.
// Los tamaños salen de window.__PERF (los fija el banco antes de cargar la página).
function perfPatch(api) {
  const P = window.__PERF || {};
  const N = { entries: 3000, media: 15000, posts: 2000, ...P };
  let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const svg = (c, w, h) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${c}"/></svg>`);
  const cols = ['#b5541c', '#3b5ba9', '#386a20', '#984061', '#7a6a2b', '#5b3b8c'];
  const small = cols.map((c) => svg(c, 60, 40)); // fotos mínimas: se mide el DOM y la lógica, no la red
  const end = new Date(2026, 10, 26).getTime(), start = new Date(2012, 0, 1).getTime();
  const dates = (n, from) => Array.from({ length: n }, () => new Date(from + rnd() * (end - from))).sort((a, b) => b - a);
  const lorem = 'La asociación celebró una jornada con vecinos, voluntarios y familias para compartir comida, juegos y música durante toda la tarde. ';
  // Blog
  const ed = dates(N.entries, start);
  const blogAll = ed.map((d, i) => ({ id: 1000 + i, type: 'post', title: 'Entrada de ejemplo número ' + i, excerpt: lorem.slice(0, 60 + (i % 60)), status: ['publish', 'publish', 'publish', 'draft', 'future'][i % 5], date: d.toISOString(), modified: d.toISOString(), url: 'https://x/' + i, image: i % 4 ? small[i % 6] : '', categories: ['Blog', 'Noticias'].slice(0, 1 + (i % 2)), author: { id: 1, name: 'Ana', avatar: '' } }));
  // Medios
  const mdates = dates(N.media, start);
  const mediaAll = mdates.map((d, i) => ({ id: 50000 + i, date: d.toISOString(), url: 'https://x/wp-content/uploads/IMG_' + (i % 3 ? '2019' : '2023') + String(1 + (i % 12)).padStart(2, '0') + '15_' + i + '.jpg', thumb: small[i % 6], tiny: small[i % 6], type: i % 40 === 0 ? 'video' : 'image', alt: i % 7 ? 'Foto ' + i : '', name: 'IMG_' + i + '.jpg', width: 4000, height: 3000, size: 3200000 + i }));
  const usage = { _postDates: {} };
  for (let i = 0; i < mediaAll.length; i += 2) usage[mediaAll[i].id] = [{ id: 1000 + (i % N.entries), title: 'Entrada de ejemplo número ' + (i % N.entries), date: blogAll[i % N.entries].date }];
  // Publicaciones de redes
  const pd = dates(N.posts, new Date(2016, 0, 1).getTime());
  const posts = pd.map((d, i) => ({ source: i % 2 ? 'facebook' : 'instagram', id: 'p' + i, text: 'Publicación ' + i + '. ' + lorem.repeat(1 + (i % 4)) + ' #solidaridad @amigo' + (i % 9), date: d.toISOString(), permalink: 'https://x/p/' + i, media: Array.from({ length: 1 + (i % 7) }, (_, k) => ({ type: 'image', url: small[(i + k) % 6] })) }));
  Object.assign(api, {
    metaPosts: async () => ({ posts, cursors: {} }),
    blogList: async (o) => {
      let l = blogAll;
      if (o.search) { const s = String(o.search).toLowerCase(); l = l.filter((x) => x.title.toLowerCase().includes(s)); }
      if (o.after) l = l.filter((x) => x.date >= o.after);
      if (o.before) l = l.filter((x) => x.date < o.before);
      if (o.status && o.status !== 'any') l = l.filter((x) => x.status === o.status);
      if (o.order === 'asc') l = l.slice().reverse();
      const per = o.number || 20, pg = o.page || 1;
      return { found: l.length, items: l.slice((pg - 1) * per, pg * per) };
    },
    blogDates: async (o) => { let l = blogAll; if (o.status && o.status !== 'any') l = l.filter((x) => x.status === o.status); return l.map((x) => x.date); },
    blogHealth: async () => ({ noCat: [], noImg: [], total: N.entries, at: Date.now() }),
    mediaAll: async () => mediaAll, mediaUsage: async () => usage,
    mediaList: async (o) => { const per = o.perPage || 40, pg = o.page || 1; return { items: mediaAll.slice((pg - 1) * per, pg * per), total: mediaAll.length, totalPages: Math.ceil(mediaAll.length / per) }; },
  });
}

// Entrada enorme (por defecto 250 bloques y 110 fotos)
function hugeBlocks(nBlocks, nImgs) {
  let seed = 99; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const svg = (c) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><rect width="400" height="260" fill="${c}"/></svg>`);
  const cols = ['#b5541c', '#3b5ba9', '#386a20', '#984061', '#7a6a2b', '#5b3b8c'];
  const out = []; let img = 0;
  for (let i = 0; i < nBlocks; i++) {
    const id = 'h' + i;
    if (i % 25 === 0) out.push({ id, type: 'heading', level: 2, html: 'Apartado número ' + i / 25 });
    else if (img < nImgs && i % 2 === 0) { img++; out.push({ id, type: 'image', img: { id: 7000 + img, url: svg(cols[img % 6]), alt: img % 3 ? 'Foto ' + img : '', type: 'image' }, caption: '' }); }
    else if (i % 11 === 0) out.push({ id, type: 'list', ordered: false, items: ['Uno ' + i, 'Dos <b>con negrita</b>', 'Tres'] });
    else if (i % 13 === 0) out.push({ id, type: 'quote', html: 'Una cita larga que alguien dijo en la jornada ' + i });
    else out.push({ id, type: 'paragraph', html: 'Párrafo ' + i + ' con <b>negrita</b>, <i>cursiva</i> y un <a href="https://example.org/' + i + '">enlace</a>. ' + 'Texto de relleno '.repeat(8 + Math.floor(rnd() * 8)) });
  }
  return out;
}
module.exports = { perfPatch, hugeBlocks };
