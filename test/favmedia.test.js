// Fotos destacadas a mano: favoritas, «usadas recientemente» (por web, con límite y sin repetidas) e imágenes destacadas de entradas.
const test = require('node:test');
const assert = require('node:assert/strict');
const FM = require('../renderer/favmedia');
const wpself = require('../src/wpself');

const W = 'https://Example.org/';
const ph = (id, extra = {}) => ({ id, url: `https://example.org/wp-content/uploads/f${id}.jpg`, thumb: `https://example.org/wp-content/uploads/f${id}-300.jpg`, alt: 'foto ' + id, type: 'image', name: 'f' + id, size: 12345, width: 800, ...extra });

test('la clave de la web ignora protocolo, www, mayúsculas y barra final', () => {
  assert.equal(FM.webKey('https://www.Example.org/'), 'example.org');
  assert.equal(FM.webKey('http://example.org'), 'example.org');
  assert.equal(FM.webKey('  '), '');
});

test('destacar y quitar: la copia es mínima, las nuevas van primero', () => {
  let r = FM.toggleFav({}, W, ph(1));
  assert.equal(r.on, true);
  r = FM.toggleFav(r.store, W, ph(2, { type: 'video' }));
  assert.deepEqual(FM.favs(r.store, W).map((m) => m.id), [2, 1]);
  const one = FM.favs(r.store, W)[1];
  assert.deepEqual(Object.keys(one).sort(), ['alt', 'id', 'name', 'thumb', 'type', 'url']); // sin size, width…
  assert.equal(FM.isFav(r.store, 'https://example.org', 1), true);
  r = FM.toggleFav(r.store, W, ph(1));
  assert.equal(r.on, false);
  assert.deepEqual(FM.favs(r.store, W).map((m) => m.id), [2]);
  // sin id o sin dirección no se guarda
  assert.equal(FM.toggleFav({}, W, { id: 0, url: 'x' }).on, false);
  assert.equal(FM.toggleFav({}, W, { id: 5 }).on, false);
});

test('no modifica el almacén original', () => {
  const s0 = Object.freeze({});
  const { store } = FM.toggleFav(s0, W, ph(1));
  assert.deepEqual(s0, {});
  assert.equal(FM.favs(store, W).length, 1);
});

test('cada web tiene sus propias listas', () => {
  let { store } = FM.toggleFav({}, 'https://a.org', ph(1));
  ({ store } = FM.toggleFav(store, 'https://b.org', ph(2)));
  store = FM.addRecent(store, 'https://b.org', [ph(3)]);
  assert.deepEqual(FM.favs(store, 'https://a.org').map((m) => m.id), [1]);
  assert.deepEqual(FM.favs(store, 'https://b.org').map((m) => m.id), [2]);
  assert.deepEqual(FM.recents(store, 'https://a.org'), []);
  assert.deepEqual(FM.recents(store, 'https://b.org').map((m) => m.id), [3]);
  assert.deepEqual(FM.favs(undefined, 'https://c.org'), []);
});

test('recientes: la última añadida primero, sin repetidas y con límite de 24', () => {
  let s = FM.addRecent({}, W, [ph(1), ph(2), ph(3)]);
  assert.deepEqual(FM.recents(s, W).map((m) => m.id), [3, 2, 1]);
  s = FM.addRecent(s, W, [ph(1)]); // una usada otra vez sube arriba y no se duplica
  assert.deepEqual(FM.recents(s, W).map((m) => m.id), [1, 3, 2]);
  s = FM.addRecent(s, W, [ph(4), ph(4)]);
  assert.deepEqual(FM.recents(s, W).map((m) => m.id), [4, 1, 3, 2]);
  for (let i = 10; i < 60; i++) s = FM.addRecent(s, W, [ph(i)]);
  const ids = FM.recents(s, W).map((m) => m.id);
  assert.equal(ids.length, 24);
  assert.equal(ids[0], 59);
  assert.equal(ids[23], 36);
  assert.equal(new Set(ids).size, 24);
  assert.equal(FM.addRecent(s, W, []), s); // nada que anotar
});

test('una foto que ya no existe se quita de favoritas y de recientes', () => {
  let { store } = FM.toggleFav({}, W, ph(7));
  ({ store } = FM.toggleFav(store, W, ph(8)));
  store = FM.addRecent(store, W, [ph(7), ph(9)]);
  store = FM.removeMissing(store, W, 7);
  assert.deepEqual(FM.favs(store, W).map((m) => m.id), [8]);
  assert.deepEqual(FM.recents(store, W).map((m) => m.id), [9]);
});

test('imágenes destacadas de entradas: mapa por foto con el título de cada entrada', () => {
  const posts = [
    { id: 10, title: { raw: 'Fiesta &amp; música', rendered: 'x' }, featured_media: 5 },
    { id: 11, title: { rendered: '<b>Taller</b>' }, featured_media: 5 },
    { id: 12, title: { raw: '' }, featured_media: 6 },
    { id: 13, title: { raw: 'Sin imagen' }, featured_media: 0 },
    { id: 10, title: { raw: 'Repetida' }, featured_media: 5 },
  ];
  const map = FM.featuredMap(posts);
  assert.deepEqual(Object.keys(map).sort(), ['5', '6']);
  assert.deepEqual(map[5].map((x) => x.id), [10, 11]);
  assert.equal(map[5][1].title, 'Taller');
  assert.equal(map[6][0].title, '#12');
  const pool = [{ id: 4 }, { id: 5 }, { id: 6 }, { id: 7 }];
  assert.deepEqual(FM.featuredItems(pool, map).map((m) => m.id), [5, 6]);
  assert.deepEqual(FM.featuredItems(pool, {}), []);
});

test('wpself.featuredMedia pide solo los campos necesarios, pagina y mapea', async () => {
  const urls = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    urls.push(String(url));
    const u = new URL(String(url));
    const page = Number(u.searchParams.get('page') || 1);
    const posts = u.pathname.endsWith('/posts');
    const rows = posts ? [{ id: 1 + page * 10, title: { raw: 'Entrada ' + page }, featured_media: 100 + page }] : [{ id: 90, title: { raw: 'Página' }, featured_media: 100 }];
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json', 'x-wp-total': posts ? '2' : '1', 'x-wp-totalpages': posts ? '2' : '1' } });
  };
  try {
    const map = await wpself.featuredMedia({ wpUrl: 'https://example.org', wpUser: 'u', wpAppPassword: 'p', wpMode: 'selfhosted' });
    assert.ok(urls.every((u) => u.includes('_fields=id%2Ctitle%2Cfeatured_media') || u.includes('_fields=id,title,featured_media')), urls.join('\n'));
    assert.deepEqual(Object.keys(map).sort(), ['100', '101', '102']);
    assert.equal(map[100][0].title, 'Página');
  } finally { global.fetch = realFetch; }
});
