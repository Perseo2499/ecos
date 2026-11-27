// Pruebas contra un WordPress REAL con los propios módulos de Ecos. Se lanzan con `npm run test:wp` (test-wp/run.js).
// Variables: WP_URL, WP_USER, WP_APP_PASSWORD. Opcionales: WP_EXPECT_SPECTRA=1 (comprueba que Spectra está activo),
// WP_EXPECT_YOAST=0 (si la web no tiene Yoast SEO, se omiten sus comprobaciones).
// Todo lo que se crea se borra al final (entradas, fotos, bloques sincronizados y categoría de prueba).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../src/wpself');
const T = require('../src/transform');
const PB = require('../src/parseblocks');
const WB = require('../src/wpblocks');
const ED = require('../src/wpeditor');
const { buildSamples } = require('./samples');
const { makePng } = require('./png');

const cfg = { wpUrl: process.env.WP_URL, wpUser: process.env.WP_USER, wpAppPassword: process.env.WP_APP_PASSWORD };
const EXPECT_YOAST = process.env.WP_EXPECT_YOAST !== '0';
const TAG = 'Ecos CI ' + Date.now().toString(36);
const CAT = TAG + ' categoría';

const created = { posts: [], media: [], blocks: [], cats: [] };
const S = {}; // estado compartido entre pruebas (van en orden)

// Lo que el HTML trae al azar al volver a leerlo (identificadores de mosaico y carrusel) no cuenta como diferencia
// y los de Spectra (block_id aleatorio de 8 cifras hexadecimales)
const normIds = (s) => String(s).replace(/ecos-(m|c|g)-[a-z0-9]+/gi, 'ecos-$1-X').replace(/(block_id":"|uagb-block-)[0-9a-f]{8}/g, '$1X');
const classesIn = (html) => {
  const out = new Set();
  for (const m of String(html).matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (/^ecos-[a-z0-9-]+$/.test(c) && !/^ecos-[a-z]-[a-z0-9]+$/i.test(c)) out.add(c);
  return [...out];
};
async function fetchPublic(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
      const body = await r.text();
      if (r.ok) return body;
      last = new Error('HTTP ' + r.status + ' en ' + url);
    } catch (e) { last = e; }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw last;
}
const cookiesOf = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');

test.before(() => {
  for (const k of ['wpUrl', 'wpUser', 'wpAppPassword']) assert.ok(cfg[k], 'Falta ' + { wpUrl: 'WP_URL', wpUser: 'WP_USER', wpAppPassword: 'WP_APP_PASSWORD' }[k]);
});

test.after(async () => {
  // limpieza: nunca lanza (se intenta todo y se avisa de lo que no se pudo borrar)
  const failed = [];
  for (const id of created.posts) await W.deletePost(cfg, id, 'post').catch((e) => failed.push('entrada ' + id + ': ' + e.message));
  for (const id of created.blocks) await W.request(cfg, `/wp/v2/blocks/${id}?force=true`, { method: 'DELETE' }).catch((e) => failed.push('bloque ' + id + ': ' + e.message));
  for (const id of created.media) await W.deleteMedia(cfg, id).catch((e) => failed.push('foto ' + id + ': ' + e.message));
  for (const id of created.cats) await W.deleteCategory(cfg, id).catch((e) => failed.push('categoría ' + id + ': ' + e.message));
  if (failed.length) console.warn('No se pudo borrar:\n - ' + failed.join('\n - '));
});

// ---------------------------------------------------------------------------------------------------------------------
test('conectar: usuario, permisos y nombre de la web', async () => {
  const r = await W.login(cfg);
  assert.ok(r.siteName, 'nombre de la web');
  assert.ok(r.me.id > 0, 'id de usuario');
  assert.equal(r.canPublish, true, 'el usuario de pruebas debe poder publicar');
  assert.equal(r.me.canUpload, true, 'y subir fotos');
  S.me = r.me;
  const info = await W.siteInfo(cfg);
  assert.ok(info.URL, 'siteInfo trae la dirección');
});

test('conectar con una contraseña mala da un error de autenticación claro', async () => {
  await assert.rejects(() => W.login({ ...cfg, wpAppPassword: 'abcd efgh ijkl mnop qrst uvwx' }), (e) => e.name === 'AuthError' || /contraseña|usuario/i.test(e.message));
});

test('complemento de Ecos: estado, versión y rutas', async () => {
  const st = await W.helperStatus(cfg, { force: true });
  assert.equal(st.installed, true, 'complemento instalado y activo');
  assert.equal(st.version, W.helperBundledVersion(), 'misma versión que trae la app');
  assert.equal(st.outdated, false);
  S.helperVersion = st.version;
  const raw = await W.request(cfg, '/ecos/v1/status');
  for (const k of ['stats', 'lock', 'export', 'theme', 'render', 'editor']) assert.equal(raw[k], true, 'el complemento anuncia «' + k + '»');
  assert.equal(W.helperHasRender(st.version), true);
  assert.equal(W.helperHasLock(st.version), true);
  assert.equal(W.helperHasExport(st.version), true);
});

test('complemento: estilos del tema (Astra) y exportación', async () => {
  const theme = await W.themeStyles(cfg, S.helperVersion);
  assert.equal(theme.source, 'plugin');
  assert.equal(theme.theme.isAstra, true, 'el tema activo es Astra');
  assert.ok(theme.colors.length > 0, 'paleta de colores del tema');
  const exp = await W.helperExport(cfg);
  assert.equal(exp.plugin, 'ecos');
});

test('estructura: categorías, páginas y ajustes de lectura', async () => {
  const cats = await W.categories(cfg);
  assert.ok(Array.isArray(cats) && cats.length >= 1, 'hay al menos «Sin categoría»');
  const st = await W.siteStructure(cfg);
  assert.ok(Array.isArray(st.pages) && Array.isArray(st.categories));
  assert.ok(st.settings && typeof st.settings.showOnFront === 'string');
});

test('subir una foto y leerla de vuelta (context=edit)', async () => {
  const file = path.join(os.tmpdir(), `ecos-ci-${process.pid}.png`);
  fs.writeFileSync(file, makePng(96, 64));
  try {
    const up = await W.uploadFile(cfg, file);
    assert.ok(up.id > 0 && /^https?:\/\//.test(up.url), 'subida: id y URL');
    created.media.push(up.id);
    await W.updateMedia(cfg, up.id, { alt: 'Foto de prueba de Ecos' });
    const m = await W.getMedia(cfg, up.id);
    assert.equal(m.id, up.id);
    assert.equal(m.source_url, up.url);
    assert.match(m.mime_type, /^image\//);
    assert.equal(m.alt_text, 'Foto de prueba de Ecos');
    assert.equal(m.media_type, 'image');
    assert.equal(await W.mediaExists(cfg, up.id), true);
    const found = await W.listMedia(cfg, { search: path.basename(file, '.png').slice(0, 12) });
    assert.ok(JSON.stringify(found).includes(String(up.id)), 'aparece en la biblioteca');
    S.img = { id: up.id, url: up.url, alt: 'Foto de prueba de Ecos' };
  } finally { fs.rmSync(file, { force: true }); }
});

test('el HTML de cada tipo de bloque vuelve igual (compose → parse → compose), sin WordPress de por medio', () => {
  S.samples = buildSamples(S.img, { id: S.img.id, url: S.img.url.replace(/\.png$/, '.mp4') });
  const bad = [];
  for (const [name, blocks] of Object.entries(S.samples)) {
    for (const opts of [{ helper: true, spectra: false }, { helper: true, spectra: true }]) {
      const out = T.composeBlocks(blocks, opts);
      const back = PB.parseBlocks(out);
      const again = T.composeBlocks(back, opts);
      if (normIds(again) !== normIds(out)) bad.push(`${name} (spectra=${opts.spectra}): al volver a componer cambia`);
      if (blocks.length === 1 && !['gallery', 'carousel', 'image'].includes(name) && back.length >= 1 && back.every((b) => b.type === 'raw')) bad.push(`${name}: no se reconoce al leerlo`);
    }
  }
  assert.deepEqual(bad, []);
});

test('entrada con muestras de TODOS los tipos de bloque: se crea y vuelve igual', async () => {
  const spectra = await W.request(cfg, '/wp/v2/plugins?status=active').then((l) => l.some((p) => /ultimate-addons-for-gutenberg/.test(p.plugin)), () => null);
  if (process.env.WP_EXPECT_SPECTRA === '1') assert.equal(spectra, true, 'Spectra debería estar activo');
  S.spectra = spectra === true;
  const blocks = Object.values(S.samples).flat();
  S.opts = { helper: true, spectra: S.spectra };
  S.content = T.composeBlocks(blocks, S.opts);
  assert.ok(S.content.length > 5000, 'contenido compuesto');

  const post = await W.createPost(cfg, {
    title: TAG + ' · todos los bloques', content: S.content, status: 'publish', excerpt: 'Extracto de prueba de Ecos',
    categories: CAT, createCategories: true, featured_image: S.img.id,
    ...(await seoFields('Descripción SEO de prueba enviada por Ecos')),
  });
  assert.ok(post.ID > 0);
  created.posts.push(post.ID);
  S.postId = post.ID; S.postUrl = post.URL;
  assert.equal(post.status, 'publish');

  const back = await W.getPost(cfg, post.ID, 'post');
  assert.equal(back.title, TAG + ' · todos los bloques');
  assert.equal(back.status, 'publish');
  assert.equal(back.featured, S.img.id, 'imagen destacada');
  assert.deepEqual(back.categories, [CAT], 'categoría creada y asignada');
  assert.equal(back.excerpt.trim(), 'Extracto de prueba de Ecos');
  // WordPress guarda el HTML tal cual (la persona de pruebas es administradora); si lo cambiara, Ecos lo vería distinto al reabrir
  assert.equal(normIds(back.content), normIds(S.content), 'el contenido guardado es el que se envió');
  const parsed = PB.parseBlocks(back.content);
  assert.equal(normIds(T.composeBlocks(parsed, S.opts)), normIds(S.content), 'ida y vuelta completa: parseBlocks(lo leído) → composeBlocks = lo enviado');
  const kinds = new Set(parsed.map((b) => b.type));
  for (const t of ['paragraph', 'heading', 'list', 'quote', 'columns', 'group', 'tabs', 'timeline', 'figures', 'testimonials', 'cards', 'cta', 'donate', 'event', 'audio', 'pdf', 'hotspots', 'compare', 'faq']) {
    assert.ok(kinds.has(t), 'al leer, vuelve el bloque «' + t + '»');
  }
  const cat = (await W.categories(cfg)).find((c) => c.name === CAT);
  if (cat) created.cats.push(cat.id);
});

// Yoast guarda su descripción en un campo «meta»; solo se puede escribir si el plugin lo publica en la API REST
async function seoFields(desc) {
  if (!EXPECT_YOAST) return {};
  const info = await W.seoInfo(cfg);
  S.seo = info;
  return info.writable ? { seoKey: info.key, seoDesc: desc } : {};
}

test('Yoast SEO: se detecta y lee la descripción enviada', { skip: !EXPECT_YOAST && 'WP_EXPECT_YOAST=0' }, async () => {
  assert.equal(S.seo.plugin, 'yoast', 'Ecos detecta Yoast SEO');
  assert.equal(S.seo.writable, true, 'Yoast publica su campo de descripción en la API (Ecos puede escribirlo)');
  const back = await W.getPost(cfg, S.postId, 'post');
  assert.equal(back.seoDesc, 'Descripción SEO de prueba enviada por Ecos', 'Ecos lee de vuelta la descripción');
  const r = await W.request(cfg, `/wp/v2/posts/${S.postId}?_fields=id,yoast_head_json`);
  if (r.yoast_head_json) {
    assert.equal(r.yoast_head_json.description, 'Descripción SEO de prueba enviada por Ecos', 'Yoast la usa como descripción');
    assert.match(r.yoast_head_json.title, new RegExp(TAG), 'el título SEO parte del título de la entrada');
  }
});

test('web pública: clases ecos-*, bloque ecos-fx, scripts y estilos del complemento', async () => {
  const html = await fetchPublic(S.postUrl);
  S.html = html;
  const want = classesIn(S.content);
  assert.ok(want.length > 20, 'el contenido enviado usa muchas clases ecos-*');
  const missing = want.filter((c) => !new RegExp(`class="[^"]*\\b${c}\\b`).test(html));
  assert.deepEqual(missing, [], 'clases ecos-* que WordPress no mostró');
  assert.match(html, /<style class="ecos-fx">[^<]{50,}/, 'bloque ecos-fx con su CSS');
  assert.match(html, /wp-content\/plugins\/ecos\/assets\/ecos\.css/, 'hoja de estilos del complemento');
  for (const js of ['ecos-anim.js', 'ecos-carousel.js', 'ecos-videos.js', 'ecos-more.js']) assert.match(html, new RegExp('plugins/ecos/assets/' + js.replace('.', '\\.')), js + ' encolado');
  assert.ok(!/class="ecos-(a|m)js"/.test(html), 'con el complemento no se incrustan los scripts en la entrada');
  assert.ok(html.includes(S.img.url.replace(/^https?:\/\/[^/]+/, '')), 'la foto subida aparece en la página');
  // Astra: la página se pinta con el tema
  assert.match(html, /ast-|astra/i, 'la página la pinta Astra');
  if (S.spectra) assert.match(html, /uagb-/, 'Spectra pinta sus bloques');
});

test('Yoast SEO: la web pública lleva la descripción y el título', { skip: !EXPECT_YOAST && 'WP_EXPECT_YOAST=0' }, async () => {
  assert.match(S.html, /<meta name="description" content="Descripción SEO de prueba enviada por Ecos"/);
  assert.match(S.html, new RegExp('<title>[^<]*' + TAG));
});

test('vista previa exacta del complemento (render) con el tema real', async () => {
  const html = await W.helperRender(cfg, { id: 0, type: 'post', title: TAG + ' vista previa', excerpt: '', content: T.composeBlocks(Object.values(S.samples).flat().slice(0, 12), S.opts) });
  assert.ok(html.length > 1000);
  assert.match(html, new RegExp(TAG + ' vista previa'));
  assert.match(html, /ecos-/);
});

test('bloque sincronizado (wp_block): crear, leer, listar, usar en una entrada y borrar', async () => {
  const content = T.composeBlocks([{ id: 'sy1', type: 'heading', level: 3, html: 'Aviso ' + TAG }, { id: 'sy2', type: 'paragraph', html: 'Texto del bloque sincronizado' }]);
  const a = await WB.saveSynced(cfg, { title: TAG + ' sync', content, sync: '' });
  assert.ok(a.id > 0); created.blocks.push(a.id);
  const b = await WB.saveSynced(cfg, { title: TAG + ' patrón', content, sync: 'unsynced' });
  created.blocks.push(b.id);

  const got = await WB.getSynced(cfg, a.id);
  assert.equal(got.title, TAG + ' sync');
  assert.deepEqual(got.blocks.map((x) => x.type), ['heading', 'paragraph']);
  assert.equal(got.sync, '');
  const gotB = await WB.getSynced(cfg, b.id);
  assert.equal(gotB.sync, 'unsynced');

  const list = await WB.listSynced(cfg);
  assert.ok(list.some((x) => x.id === a.id) && list.some((x) => x.id === b.id), 'aparecen en la lista');

  // actualizar
  await WB.saveSynced(cfg, { id: a.id, title: TAG + ' sync 2', content: content.replace('Texto del bloque', 'Texto cambiado del bloque'), sync: '' });
  const upd = await WB.getSynced(cfg, a.id);
  assert.equal(upd.title, TAG + ' sync 2');
  assert.match(upd.content, /Texto cambiado del bloque/);

  // una entrada que lo usa por referencia: la web pública muestra su contenido
  const post = await W.createPost(cfg, { title: TAG + ' con referencia', content: T.composeBlocks([{ id: 'sy3', type: 'synced', ref: a.id }]), status: 'publish', categories: '' });
  created.posts.push(post.ID);
  const back = await W.getPost(cfg, post.ID, 'post');
  assert.match(back.content, new RegExp(`<!-- wp:block \\{"ref":${a.id}\\} /-->`));
  assert.deepEqual(PB.parseBlocks(back.content).map((x) => [x.type, x.ref]), [['synced', a.id]]);
  const html = await fetchPublic(post.URL);
  assert.match(html, /Texto cambiado del bloque/, 'WordPress sustituye la referencia por el contenido');

  // borrar
  for (const id of [a.id, b.id]) {
    await W.request(cfg, `/wp/v2/blocks/${id}?force=true`, { method: 'DELETE' });
    created.blocks = created.blocks.filter((x) => x !== id);
  }
  await assert.rejects(() => WB.getSynced(cfg, a.id), /./);
  const after = await WB.listSynced(cfg);
  assert.ok(!after.some((x) => x.id === a.id || x.id === b.id), 'ya no están en la lista');
});

test('patrones de la web: la API los lista', async () => {
  const r = await WB.listPatterns(cfg);
  assert.ok(Array.isArray(r.patterns) && Array.isArray(r.categories));
});

test('bloqueo de edición: se toma y se suelta', async () => {
  const l = await W.helperLock(cfg, S.postId);
  assert.equal(l.supported, true);
  assert.equal(l.locked, false, 'la propia persona no se bloquea a sí misma');
  assert.equal(await W.helperUnlock(cfg, S.postId), true);
});

test('editor de WordPress: la dirección de un solo uso funciona una vez y la segunda no', async () => {
  const site = W.publicBase(cfg);
  const target = ED.targetFor(S.postId);
  const r = await W.request(cfg, '/ecos/v1/editor-session', { method: 'POST', json: { target } });
  assert.equal(r.plugin, 'ecos');
  assert.equal(ED.validOneTime(r.url, site), true, 'la dirección es de la propia web y tiene la forma esperada');
  const sess = await ED.sessionUrl(W, cfg, target, S.helperVersion);
  assert.equal(sess.oneTime, true, 'Ecos obtiene una dirección de un solo uso');

  // primera vez: redirige al editor y entrega las cookies de sesión
  const first = await fetch(r.url, { redirect: 'manual' });
  assert.ok([301, 302, 303, 307].includes(first.status), 'redirige (HTTP ' + first.status + ')');
  // (Spectra recién instalado puede desviar al administrador a su asistente: basta con que lleve a wp-admin)
  assert.match(first.headers.get('location') || '', /wp-admin\/(post\.php\?post=\d+&action=edit|admin\.php\?page=spectra)/);
  const cookie = cookiesOf(first);
  assert.match(cookie, /wordpress_logged_in_/, 'inicia sesión con cookies');

  // las cookies sirven para abrir el editor
  const editor = await fetch(new URL(first.headers.get('location'), site), { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(editor.status, 200, 'el editor se abre con esa sesión');
  assert.match(await editor.text(), /post-php|wp-admin|editor/i);

  // segunda vez con la misma dirección: rechazada y sin cookies
  const second = await fetch(r.url, { redirect: 'manual' });
  assert.equal(second.status, 403, 'la segunda vez se rechaza');
  assert.equal(cookiesOf(second), '', 'y no entrega sesión');
  assert.match(await second.text(), /ya se us|caducado/i);

  // destinos no permitidos
  await assert.rejects(() => W.request(cfg, '/ecos/v1/editor-session', { method: 'POST', json: { target: 'plugins.php' } }), /Solo se puede abrir|WordPress/);
});

test('listados y calendario: Ecos ve la entrada creada', async () => {
  const l = await W.listPosts(cfg, { status: 'any', search: TAG, number: 20 });
  assert.ok(l.items.some((x) => x.id === S.postId), 'aparece en el listado del blog');
  const d = await W.listDates(cfg, { status: 'any', search: TAG });
  assert.ok(d.length >= 1);
});

test('borrar todo lo creado: no queda nada', async () => {
  await W.deletePost(cfg, S.postId, 'post');
  created.posts = created.posts.filter((x) => x !== S.postId);
  await assert.rejects(() => W.getPost(cfg, S.postId, 'post'), /./);
  for (const id of [...created.posts]) { await W.deletePost(cfg, id, 'post'); created.posts = created.posts.filter((x) => x !== id); }
  await W.deleteMedia(cfg, S.img.id); created.media = [];
  assert.equal(await W.mediaExists(cfg, S.img.id), false, 'la foto se borró');
  const cat = (await W.categories(cfg)).find((c) => c.name === CAT);
  if (cat) { await W.deleteCategory(cfg, cat.id); created.cats = []; }
  const left = await W.listPosts(cfg, { status: 'any', search: TAG, number: 20 });
  assert.equal(left.items.length, 0, 'no quedan entradas de prueba');
});
