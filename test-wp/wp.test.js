// Pruebas contra un WordPress REAL con los propios módulos de Ecos. Se lanzan con `npm run test:wp` (test-wp/run.js).
// Variables: WP_URL, WP_USER, WP_APP_PASSWORD. Opcionales: WP_EXPECT_SPECTRA=1 (comprueba que Spectra está activo),
// WP_EXPECT_YOAST=0 (si la web no tiene Yoast SEO, se omiten sus comprobaciones), WP_EXPECT_CPT=1 (la web tiene el tipo «evento» con campos de ACF),
// WP_EXPECT_LANG=1 (Polylang con los idiomas es y en).
// Todo lo que se crea se borra al final (entradas, fotos, bloques sincronizados y categoría de prueba).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../src/wpself');
const T = require('../src/transform');
const PB = require('../src/parseblocks');
const CPT = require('../renderer/cpt');
const WB = require('../src/wpblocks');
const ED = require('../src/wpeditor');
const WM = require('../src/wpmenus');
const MT = require('../renderer/menutree');
const WL = require('../renderer/widgetlogic');
const SM = require('../renderer/app/seo-meta');
const { buildSamples } = require('./samples');
const { makePng } = require('./png');

const cfg = { wpUrl: process.env.WP_URL, wpUser: process.env.WP_USER, wpAppPassword: process.env.WP_APP_PASSWORD };
const EXPECT_YOAST = process.env.WP_EXPECT_YOAST !== '0';
const TAG = 'Ecos CI ' + Date.now().toString(36);
const CAT = TAG + ' categoría';

const created = { posts: [], media: [], blocks: [], cats: [], menus: [], widgets: [], cpt: [] }; // cpt: [{ id, type }]
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
  for (const x of created.cpt) await W.deletePost(cfg, x.id, x.type).catch((e) => failed.push(x.type + ' ' + x.id + ': ' + e.message));
  for (const id of created.posts) await W.deletePost(cfg, id, 'post').catch((e) => failed.push('entrada ' + id + ': ' + e.message));
  for (const id of created.blocks) await W.request(cfg, `/wp/v2/blocks/${id}?force=true`, { method: 'DELETE' }).catch((e) => failed.push('bloque ' + id + ': ' + e.message));
  for (const id of created.media) await W.deleteMedia(cfg, id).catch((e) => failed.push('foto ' + id + ': ' + e.message));
  for (const id of created.menus) await WM.deleteMenu(cfg, id).catch((e) => failed.push('menú ' + id + ': ' + e.message));
  for (const id of created.widgets) await W.request(cfg, `/wp/v2/widgets/${id}?force=true`, { method: 'DELETE' }).catch((e) => failed.push('widget ' + id + ': ' + e.message));
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
  // qué responde WordPress de verdad (para el registro de la prueba)
  const raw = await fetch(cfg.wpUrl.replace(/\/$/, '') + '/wp-json/wp/v2/users/me', { headers: { Authorization: 'Basic ' + Buffer.from(cfg.wpUser + ':abcdefghijklmnopqrstuvwx').toString('base64') } });
  console.log('# contraseña mala → HTTP', raw.status, (await raw.text()).slice(0, 300));
  await assert.rejects(() => W.login({ ...cfg, wpAppPassword: 'abcd efgh ijkl mnop qrst uvwx' }), (e) => /contraseña|usuario/i.test(e.message) && !/cabecera/.test(e.message));
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
    // con los campos reducidos (_fields) siguen llegando las medidas, el peso y el tipo para la rejilla
    const it = found.items.find((x) => x.id === up.id);
    assert.ok(it && it.url && it.type === 'image' && it.name, 'campos básicos de la biblioteca');
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

test('fotos destacadas: Ecos ve qué foto es la imagen destacada de la entrada y detecta las que ya no existen (404)', async () => {
  const map = await W.featuredMedia(cfg);
  const mine = (map[S.img.id] || []).find((x) => x.id === S.postId);
  assert.ok(mine, 'la foto aparece como imagen destacada de la entrada de prueba');
  assert.equal(mine.title, TAG + ' · todos los bloques');
  // una foto que existe no sale como «perdida»; una que no existe, sí (y un fallo de red no cuenta)
  assert.deepEqual(await W.mediaMissing(cfg, [S.img.id, 999999991]), [999999991]);
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

test('SEO completo (complemento): escribir y leer canónica, indexación, palabra clave, Open Graph y X, y verlos en la web', { skip: !EXPECT_YOAST && 'WP_EXPECT_YOAST=0' }, async () => {
  const g0 = await W.seoGet(cfg, S.postId);
  assert.equal(g0.helper, true, 'el complemento es ≥ 1.8.0');
  assert.equal(g0.plugin, 'yoast');
  assert.ok(g0.fields && g0.fields.noindex === false, 'se lee de vuelta el estado inicial');
  const canon = W.publicBase(cfg).replace(/\/$/, '') + '/canonica-' + TAG.replace(/\s+/g, '-').toLowerCase() + '/';
  const want = { focusKw: 'palabra clave de prueba', canonical: canon, noindex: false, nofollow: false, ogTitle: 'OG ' + TAG, ogDesc: 'Descripción para Facebook', ogImage: S.img.url, ogImageId: S.img.id, twTitle: 'X ' + TAG, twDesc: 'Descripción para X', twImage: S.img.url, twImageId: S.img.id };
  const saved = await W.seoSave(cfg, S.postId, want);
  assert.deepEqual(SM.diff(want, saved.fields), {}, 'lo guardado vuelve igual');
  const again = await W.seoGet(cfg, S.postId);
  assert.deepEqual(SM.diff(want, again.fields), {}, 'y se lee igual al abrir (ida y vuelta)');
  // la web pública lleva las etiquetas
  let html = await fetchPublic(S.postUrl);
  const tag = (re) => (re.exec(html) || [])[1]; // Yoast usa el filtro wp_robots: WordPress escribe la etiqueta con comillas simples
  assert.equal(tag(/<meta property="og:title" content="([^"]*)"/), 'OG ' + TAG, 'og:title');
  assert.match(html, /<meta property="og:description" content="Descripción para Facebook"/);
  assert.match(html, /<meta property="og:image" content="[^"]+/);
  assert.equal(tag(/<link rel="canonical" href="([^"]*)"/), canon, 'canonical');
  assert.equal(tag(/<meta name="twitter:title" content="([^"]*)"/), 'X ' + TAG, 'twitter:title');
  assert.doesNotMatch(tag(/<meta name=["']robots["'] content=["']([^"']*)["']/) || '', /noindex/, 'indexable por defecto');
  // noindex: Yoast pone «noindex» en robots y, a propósito, deja de escribir la canónica en las páginas noindex
  await W.seoSave(cfg, S.postId, { noindex: true });
  assert.equal((await W.seoGet(cfg, S.postId)).fields.noindex, true, 'noindex se lee de vuelta');
  html = await fetchPublic(S.postUrl);
  assert.match(tag(/<meta name=["']robots["'] content=["']([^"']*)["']/), /noindex/, 'robots noindex');
  // quitar noindex: vuelve la canónica
  await W.seoSave(cfg, S.postId, { noindex: false });
  html = await fetchPublic(S.postUrl);
  assert.doesNotMatch(tag(/<meta name=["']robots["'] content=["']([^"']*)["']/) || '', /noindex/, 'sin noindex');
  assert.equal(tag(/<link rel="canonical" href="([^"]*)"/), canon, 'la canónica vuelve');
  // quitar la canónica: la web usa la propia
  await W.seoSave(cfg, S.postId, { canonical: '' });
  html = await fetchPublic(S.postUrl);
  assert.notEqual(tag(/<link rel="canonical" href="([^"]*)"/), canon, 'ya no usa la canónica antigua');
  // un campo fuera de la lista blanca no se puede colar
  await W.request(cfg, `/ecos/v1/seo/${S.postId}`, { method: 'POST', json: { fields: { evil: 'x', '_edit_lock': '1' } } });
  const post = await W.request(cfg, `/wp/v2/posts/${S.postId}?context=edit&_fields=id,meta`);
  assert.ok(!('evil' in (post.meta || {})));
});

test('menús: crear uno con 3 elementos anidados, asignarlo a la ubicación primary de Astra y verlo en la web', async () => {
  const before = await WM.loadMenus(cfg);
  assert.equal(before.blockTheme, false, 'Astra es un tema clásico: tiene ubicaciones');
  const loc = before.locations.find((l) => l.slug === 'primary');
  assert.ok(loc, 'Astra tiene la ubicación primary');
  const menu = await WM.createMenu(cfg, TAG + ' menú');
  created.menus.push(menu.id);
  const site = W.publicBase(cfg).replace(/\/$/, '');
  let tree = [];
  tree = MT.add(tree, MT.newItem('t1', 'custom', { title: 'Nivel uno ' + TAG, url: site + '/#uno' })).tree;
  tree = MT.add(tree, MT.newItem('t2', 'custom', { title: 'Nivel dos ' + TAG, url: site + '/#dos' }), 't1').tree;
  tree = MT.add(tree, MT.newItem('t3', 'custom', { title: 'Nivel tres ' + TAG, url: site + '/#tres' }), 't2').tree;
  const d = MT.diff([], MT.flatten(tree));
  assert.equal(d.add.length, 3);
  const r = await WM.saveMenu(cfg, menu.id, d);
  assert.deepEqual(r.errors, []);
  assert.equal(r.calls, 3, 'solo 3 peticiones');
  assert.deepEqual((await WM.setLocations(cfg, MT.locationsDiff([{ id: menu.id, locations: [] }], MT.assign([{ id: menu.id, locations: [] }], menu.id, 'primary')))).errors, []);

  // se lee de vuelta con la misma estructura
  const back = (await WM.loadMenus(cfg)).menus.find((m) => m.id === menu.id);
  assert.deepEqual(back.locations, ['primary']);
  const t = MT.nest(back.items);
  assert.equal(MT.depth(t), 3);
  assert.deepEqual([t[0].title, t[0].children[0].title, t[0].children[0].children[0].title], ['Nivel uno ' + TAG, 'Nivel dos ' + TAG, 'Nivel tres ' + TAG]);
  assert.equal(MT.diff(back.items, MT.flatten(t)).count, 0, 'sin tocar nada no hay nada que guardar');

  // la web pública lo muestra anidado
  const html = await fetchPublic(site + '/');
  for (const n of ['Nivel uno', 'Nivel dos', 'Nivel tres']) assert.ok(html.includes(n + ' ' + TAG), n + ' en el menú de la web');
  assert.ok(html.indexOf('Nivel uno') < html.indexOf('Nivel dos') && html.indexOf('Nivel dos') < html.indexOf('Nivel tres'), 'en orden');
  assert.match(html, /sub-menu/, 'con submenús');

  // renombrar uno y reordenar: solo las peticiones necesarias
  const upd = MT.diff(back.items, MT.flatten(MT.rename(t, back.items.find((i) => i.title.startsWith('Nivel dos')).id, { title: 'Dos renombrado ' + TAG })));
  assert.equal(upd.count, 1);
  assert.deepEqual((await WM.saveMenu(cfg, menu.id, upd)).errors, []);
  const after = (await WM.loadMenus(cfg)).menus.find((m) => m.id === menu.id);
  assert.ok(after.items.some((i) => i.title === 'Dos renombrado ' + TAG));
});

test('widgets: añadir un widget de bloque a la barra lateral de Astra y verlo en la web', async () => {
  const w0 = await WM.loadWidgets(cfg);
  assert.ok(w0.sidebars.some((x) => x.id === 'sidebar-1'), 'Astra tiene sidebar-1');
  const zones = WL.normalize(w0.sidebars, w0.widgets);
  const content = '<!-- wp:paragraph -->\n<p>Widget de prueba ' + TAG + '</p>\n<!-- /wp:paragraph -->';
  const added = WL.addBlock(zones, 'sidebar-1', content, 'new-1');
  const d = WL.diff(zones, added.zones);
  assert.equal(d.add.length, 1);
  const r = await WM.saveWidgets(cfg, d);
  assert.deepEqual(r.errors, []);
  const id = r.ids['new-1'];
  assert.match(id, /^block-\d+$/);
  created.widgets.push(id);
  const w1 = await WM.loadWidgets(cfg);
  const z1 = WL.normalize(w1.sidebars, w1.widgets);
  const mine = WL.locate(z1, id);
  assert.equal(mine.zone.id, 'sidebar-1');
  assert.equal(mine.widget.raw.content.includes('Widget de prueba ' + TAG), true, 'su contenido vuelve igual (instance.raw.content)');
  // en la web (Astra pinta la barra lateral en la portada de entradas y en cada entrada)
  const site = W.publicBase(cfg).replace(/\/$/, '');
  const pages = [await fetchPublic(site + '/'), await fetchPublic(S.postUrl)];
  assert.ok(pages.some((h) => h.includes('Widget de prueba ' + TAG)), 'el widget aparece en la web');
  // cambiar su texto: una sola petición
  const edit = WL.diff(z1, WL.setRaw(z1, id, { content: content.replace('prueba', 'cambiado') }));
  assert.equal(edit.count, 1);
  assert.deepEqual((await WM.saveWidgets(cfg, edit)).errors, []);
  // moverlo al pie y devolverlo
  const moved = WL.diff(z1, WL.move(z1, id, z1.find((z) => z.id !== 'sidebar-1' && !z.inactive).id).zones);
  assert.deepEqual((await WM.saveWidgets(cfg, moved)).errors, []);
  const z2 = WL.normalize((await WM.loadWidgets(cfg)).sidebars, (await WM.loadWidgets(cfg)).widgets);
  assert.equal(WL.locate(z2, id).zone.id !== 'sidebar-1', true, 'ya no está en la barra lateral');
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
  assert.match(first.headers.get('location') || '', /wp-admin\/post\.php\?post=\d+&action=edit/);
  const cookie = cookiesOf(first);
  assert.match(cookie, /wordpress_logged_in_/, 'inicia sesión con cookies');

  // las cookies sirven para abrir el editor
  let editor = await fetch(new URL(first.headers.get('location'), site), { headers: { Cookie: cookie }, redirect: 'manual' });
  // (Spectra recién activado lleva una sola vez a su asistente: se vuelve a pedir)
  if (editor.status === 302 && /spectra|onboarding/i.test(editor.headers.get('location') || '')) editor = await fetch(new URL(first.headers.get('location'), site), { headers: { Cookie: cookie }, redirect: 'manual' });
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

test('bloques de Spectra, Kadence y GenerateBlocks: Ecos los edita y la web conserva clases y estilos del plugin', async () => {
  const TP = require('../renderer/thirdparty');
  const SM = require('../test/thirdparty-samples');
  const act = await W.request(cfg, '/wp/v2/plugins?status=active').then((l) => l.map((p) => p.plugin), () => []);
  const has = (n) => act.some((p) => p.startsWith(n));
  if (process.env.WP_EXPECT_SPECTRA === '1') { assert.ok(has('kadence-blocks'), 'Kadence Blocks debería estar activo'); assert.ok(has('generateblocks'), 'GenerateBlocks debería estar activo'); }
  const want = [['spectra', ['heading', 'buttons', 'container', 'info', 'image'], has('ultimate-addons-for-gutenberg')], ['kadence', ['kHeading', 'kBtns', 'kRow', 'kInfo', 'kList'], has('kadence-blocks')], ['gb', ['gHead', 'gCont'], has('generateblocks')]];
  const keys = want.filter((w) => w[2]).flatMap((w) => w[1]);
  const content = keys.map((k) => SM[k]).join('\n\n');
  const post = await W.createPost(cfg, { title: TAG + ' · bloques de terceros', content, status: 'publish' });
  created.posts.push(post.ID);
  const back = await W.getPost(cfg, post.ID, 'post');
  const blocks = PB.parseBlocks(back.content);
  assert.equal(blocks.length, keys.length);
  assert.ok(blocks.every((b) => b.type === 'third'), 'Ecos los reconoce como editables al leerlos con context=edit');
  assert.equal(T.composeBlocks(blocks, { helper: true, spectra: true }), back.content, 'sin cambios vuelve idéntico a lo leído');
  // un cambio de texto: se reenvía y el HTML público sigue llevando las clases del plugin
  const h = blocks.find((b) => b.name === 'uagb/advanced-heading') || blocks.find((b) => b.name === 'kadence/advancedheading') || blocks[0];
  const oldText = TP.texts(h)[0].v;
  TP.setText(h, TP.texts(h)[0].k, 'Título cambiado desde Ecos');
  const next = T.composeBlocks(blocks, { helper: true, spectra: true });
  await W.request(cfg, '/wp/v2/posts/' + post.ID, { method: 'POST', json: { content: next } });
  const again = await W.getPost(cfg, post.ID, 'post');
  assert.equal(again.content, back.content.replace('>' + oldText + '<', '>Título cambiado desde Ecos<'), 'solo cambia el texto');
  const html = await fetchPublic(post.URL);
  if (has('ultimate-addons-for-gutenberg')) assert.match(html, /uagb-heading-text/, 'Spectra conserva sus clases');
  if (has('kadence-blocks')) assert.match(html, /kt-adv-heading|wp-block-kadence/, 'Kadence conserva sus clases');
  if (has('generateblocks')) assert.match(html, /gb-headline|gb-container/, 'GenerateBlocks conserva sus clases');
  assert.match(html, /Título cambiado desde Ecos/);
});

// --- Revisión entre varias personas: colaborador, editor, notas internas ancladas a bloques (complemento 1.8.0) ---------------------------
const cfgOf = (u, p) => ({ wpUrl: process.env.WP_URL, wpUser: process.env.WP_USER && u, wpAppPassword: p });
const cfgContrib = cfgOf(process.env.WP_CONTRIB_USER, process.env.WP_CONTRIB_APP_PASSWORD);
const cfgEditor = cfgOf(process.env.WP_EDITOR_USER, process.env.WP_EDITOR_APP_PASSWORD);
const SKIP_PEOPLE = !(process.env.WP_CONTRIB_USER && process.env.WP_EDITOR_USER) && 'faltan WP_CONTRIB_USER / WP_EDITOR_USER (los crea test-wp/setup.sh)';
const RV = {};

test('revisión: el colaborador no puede publicar y el editor sí puede revisar (capacidades de /users/me)', { skip: SKIP_PEOPLE }, async () => {
  const st = await W.helperStatus(cfg, { force: true });
  assert.ok(W.helperHasReview(st.version), 'el complemento trae la revisión (≥ 1.8.0): ' + st.version);
  cfgContrib.ecosHelper = cfgEditor.ecosHelper = { installed: true, version: st.version };
  const c = await W.me(cfgContrib), e = await W.me(cfgEditor);
  assert.equal(c.canPublish, false, 'colaborador: no publica'); assert.equal(c.canEditOthers, false);
  assert.equal(e.canPublish, true); assert.equal(e.canEditOthers, true, 'editor: revisa lo de otras personas');
  RV.contrib = c; RV.editor = e;
});

test('revisión: el colaborador envía a revisión (pending) y no puede publicar', { skip: SKIP_PEOPLE }, async () => {
  const anc = 'rv' + Date.now().toString(36).slice(-6);
  RV.anc = anc;
  const blocks = [{ id: 'rvp1', type: 'paragraph', html: 'Primer párrafo de ' + TAG }, { id: 'rvp2', type: 'paragraph', html: 'Segundo párrafo con ancla', anc }];
  RV.content = T.composeBlocks(blocks);
  const post = await W.request(cfgContrib, '/wp/v2/posts', { method: 'POST', json: { title: TAG + ' revisión', content: RV.content, status: 'pending' } });
  created.posts.push(post.id); RV.id = post.id;
  assert.equal(post.status, 'pending', 'queda pendiente de revisión');
  await assert.rejects(() => W.request(cfgContrib, `/wp/v2/posts/${post.id}`, { method: 'POST', json: { status: 'publish' } }), /permiso|publicar|cannot/i);
  assert.equal((await W.getPost(cfgEditor, post.id, 'post')).status, 'pending', 'sigue pendiente');
  assert.match((await W.getPost(cfgEditor, post.id, 'post')).content, new RegExp('ecos-a-' + anc), 'el ancla llega a WordPress y vuelve');
});

test('revisión: el editor ve la entrada pendiente, añade una nota anclada y la devuelve', { skip: SKIP_PEOPLE }, async () => {
  const sum = await W.reviewSummary(cfgEditor);
  const mine = sum.pending.find((p) => p.id === RV.id);
  assert.ok(mine, 'aparece en «Pendientes de revisión»'); assert.equal(mine.author.id, RV.contrib.id);
  const note = await W.noteAdd(cfgEditor, { post: RV.id, text: 'Falta la fecha en este párrafo (' + TAG + ')', anchor: RV.anc, block: 'rvp2' });
  RV.note = note;
  assert.equal(note.anchor, RV.anc); assert.equal(note.author.id, RV.editor.id); assert.equal(note.resolved, false);
  assert.ok(note.author.name, 'la nota trae el nombre de quien la escribió');
  // devolver con comentarios: nota «return» y la entrada vuelve a borrador
  RV.ret = await W.noteAdd(cfgEditor, { post: RV.id, text: 'Devuelta: arregla la fecha y vuelve a enviarla.', kind: 'return' });
  assert.equal(RV.ret.kind, 'return');
  await W.request(cfgEditor, `/wp/v2/posts/${RV.id}`, { method: 'POST', json: { status: 'draft' } });
  // el colaborador no puede devolver (solo quien edita entradas ajenas)
  await assert.rejects(() => W.noteAdd(cfgContrib, { post: RV.id, text: 'x', kind: 'return' }), /permiso|devolver|WordPress/i);
});

test('revisión: el colaborador lee la nota, ve que se la devolvieron y responde', { skip: SKIP_PEOPLE }, async () => {
  const notes = await W.notesList(cfgContrib, RV.id);
  const root = notes.find((n) => n.id === RV.note.id);
  assert.ok(root, 'lee la nota del editor'); assert.equal(root.anchor, RV.anc);
  const sum = await W.reviewSummary(cfgContrib);
  const back = sum.returned.find((p) => p.id === RV.id);
  assert.ok(back, 'aparece en «Te han devuelto»'); assert.match(back.returnedText, /Devuelta/); assert.equal(back.returnedBy.id, RV.editor.id);
  const reply = await W.noteAdd(cfgContrib, { post: RV.id, text: 'Hecho, ya lleva la fecha.', parent: root.id });
  RV.reply = reply;
  assert.equal(reply.parent, root.id);
  const th = require('../renderer/editorial').buildThreads(await W.notesList(cfgEditor, RV.id));
  const t = th.threads.find((x) => x.id === root.id);
  assert.deepEqual(t.replies.map((r) => r.id), [reply.id], 'el editor ve la respuesta en el mismo hilo');
  // la autora puede borrar lo suyo; no lo de otra persona
  await assert.rejects(() => W.noteDelete(cfgContrib, root.id), /permiso|WordPress/i);
  // vuelve a enviarla: pendiente otra vez, y la marca de «devuelta» desaparece
  const p = await W.request(cfgContrib, `/wp/v2/posts/${RV.id}`, { method: 'POST', json: { status: 'pending' } });
  assert.equal(p.status, 'pending');
  assert.equal((await W.reviewSummary(cfgContrib)).returned.some((x) => x.id === RV.id), false);
});

test('revisión: el editor resuelve el hilo, aprueba y publica; quién la cambió', { skip: SKIP_PEOPLE }, async () => {
  const r = await W.noteResolve(cfgEditor, RV.note.id, true);
  assert.equal(r.resolved, true);
  assert.equal((await W.notesList(cfgContrib, RV.id)).find((n) => n.id === RV.note.id).resolved, true, 'se ve resuelto para todas las personas');
  const ch = await W.postChanges(cfgEditor, RV.id, 'post');
  assert.equal(ch.by.id, RV.contrib.id, 'la última persona que la cambió fue el colaborador');
  const pub = await W.request(cfgEditor, `/wp/v2/posts/${RV.id}`, { method: 'POST', json: { status: 'publish' } });
  assert.equal(pub.status, 'publish');
  assert.equal((await W.reviewSummary(cfgEditor)).pending.some((p) => p.id === RV.id), false, 'ya no está pendiente');
  assert.ok((await W.reviewSummary(cfgEditor)).activity.some((p) => p.id === RV.id), 'sale en la actividad reciente');
});

test('revisión: las notas no aparecen en la web pública ni en los comentarios públicos', { skip: SKIP_PEOPLE }, async () => {
  const post = await W.getPost(cfgEditor, RV.id, 'post');
  const html = await fetchPublic(post.url);
  assert.ok(!html.includes('Falta la fecha en este párrafo'), 'la web pública no lleva el texto de la nota');
  assert.ok(!html.includes('Hecho, ya lleva la fecha'), 'ni sus respuestas');
  const base = cfg.wpUrl.replace(/\/+$/, '');
  for (const route of [`/wp-json/wp/v2/comments?post=${RV.id}`, '/wp-json/wp/v2/comments?per_page=100', `/wp-json/wp/v2/comments?post=${RV.id}&type=ecos_note`, `/?feed=comments-rss2&p=${RV.id}`]) {
    const res = await fetch(base + route);
    const txt = await res.text();
    assert.ok(!/Falta la fecha|Hecho, ya lleva|Devuelta: arregla/.test(txt), 'sin notas en ' + route);
  }
  // sin sesión no hay acceso a las rutas de notas
  const anon = await fetch(`${base}/wp-json/ecos/v1/notes?post=${RV.id}`);
  assert.ok([401, 403].includes(anon.status), 'las notas piden sesión: ' + anon.status);
  // ni en el recuento de comentarios de la entrada
  const pub = await (await fetch(`${base}/wp-json/wp/v2/posts/${RV.id}`)).json().catch(() => null);
  if (pub?.id) assert.ok(!JSON.stringify(pub).includes('Falta la fecha'));
});

test('revisión: borrar notas (la autora o quien edita entradas ajenas) y limpiar', { skip: SKIP_PEOPLE }, async () => {
  const gone = await W.noteDelete(cfgEditor, RV.note.id);
  assert.ok(gone.includes(RV.note.id) && gone.includes(RV.reply.id), 'borrar un hilo borra también sus respuestas');
  const left = await W.notesList(cfgEditor, RV.id);
  assert.ok(!left.some((n) => n.id === RV.note.id || n.id === RV.reply.id));
  for (const n of left) await W.noteDelete(cfgEditor, n.id);
  assert.equal((await W.notesList(cfgEditor, RV.id)).length, 0);
});

test('listados y calendario: Ecos ve la entrada creada', async () => {
  const l = await W.listPosts(cfg, { status: 'any', search: TAG, number: 20 });
  assert.ok(l.items.some((x) => x.id === S.postId), 'aparece en el listado del blog');
  const d = await W.listDates(cfg, { status: 'any', search: TAG });
  assert.ok(d.length >= 1);
  // la caché corta de listas: la misma petición seguida devuelve lo mismo, `fresh` la salta y una escritura la vacía
  const again = await W.listPosts(cfg, { status: 'any', search: TAG, number: 20 });
  assert.deepEqual(again.items.map((x) => x.id), l.items.map((x) => x.id));
  assert.ok((await W.listPosts(cfg, { status: 'any', search: TAG, number: 20, fresh: true })).items.some((x) => x.id === S.postId));
  assert.ok(typeof l.items[0].image === 'string' && l.items[0].title, 'la lista trae título e imagen (miniatura) con los campos reducidos');
});

// ---------------------------------------------------------------------------------------------------------------------
// Tipos de contenido propios y campos personalizados (setup.sh escribe un mu-plugin con el tipo «evento», un meta y un grupo de ACF)
const EXPECT_CPT = process.env.WP_EXPECT_CPT === '1';
const EXPECT_LANG = process.env.WP_EXPECT_LANG === '1';
let helperFields = false;

test('tipos de contenido: Ecos lista los propios y deja fuera los internos', { skip: !EXPECT_CPT && 'WP_EXPECT_CPT no activado' }, async () => {
  const types = await W.cptTypes(cfg, { force: true });
  const ev = types.find((x) => x.slug === 'evento');
  assert.ok(ev, 'aparece «evento»: ' + types.map((x) => x.slug).join(', '));
  assert.equal(ev.restBase, 'eventos'); assert.equal(ev.editor, true);
  for (const bad of ['post', 'page', 'attachment', 'wp_block', 'wp_template', 'wp_navigation', 'nav_menu_item', 'wp_global_styles', 'product']) assert.ok(!types.some((x) => x.slug === bad), bad + ' no debe ofrecerse');
  const tax = await W.cptTaxonomies(cfg, 'evento');
  assert.equal(tax.category?.restBase, 'temas', 'su categoría es la taxonomía «tema»');
  const st = await W.helperStatus(cfg, { force: true });
  helperFields = st.installed && W.helperHasFields(st.version);
  assert.ok(helperFields, 'el complemento trae campos (1.8.0): ' + st.version);
});

test('campos: crear un evento con campos de ACF y metas, y leerlos de vuelta', { skip: !EXPECT_CPT && 'WP_EXPECT_CPT no activado' }, async () => {
  const def = await W.fieldsLoad(cfg, { type: 'evento', helper: helperFields });
  const by = Object.fromEntries(def.fields.map((f) => [f.id, f]));
  for (const id of ['acf:lugar', 'acf:fecha', 'acf:gratis', 'meta:aforo_max']) assert.ok(by[id], 'campo ' + id + ' en ' + Object.keys(by).join(', '));
  assert.equal(by['acf:lugar'].kind, 'text'); assert.equal(by['acf:fecha'].kind, 'date'); assert.equal(by['acf:gratis'].kind, 'bool'); assert.equal(by['meta:aforo_max'].kind, 'number');
  const values = { 'acf:lugar': 'Sala ' + TAG, 'acf:fecha': '2026-03-04', 'acf:gratis': true, 'meta:aforo_max': '40' };
  const built = CPT.buildFieldsPost(def.fields, values, {}, { acfRest: def.acfRest });
  assert.ok(!built.empty);
  const r = await W.createPost(cfg, { type: 'evento', title: TAG + ' evento', content: '<!-- wp:paragraph --><p>Hola</p><!-- /wp:paragraph -->', excerpt: 'Un evento', status: 'draft', categories: CAT + ' tema', createCategories: true, ...built.post });
  created.cpt.push({ id: r.ID, type: 'evento' });
  S.eventoId = r.ID;
  if (built.helper.acf || built.helper.metabox) await W.fieldsSave(cfg, r.ID, built.helper);
  // al abrirlo se leen sus valores (ida y vuelta)
  const back = await W.fieldsLoad(cfg, { type: 'evento', postId: r.ID, helper: helperFields });
  const got = Object.fromEntries(back.fields.map((f) => [f.id, CPT.toInput(f, back.values[f.id])]));
  assert.equal(got['acf:lugar'], 'Sala ' + TAG); assert.equal(got['acf:fecha'], '2026-03-04'); assert.equal(got['acf:gratis'], true); assert.equal(Number(got['meta:aforo_max']), 40);
  const p = await W.getPost(cfg, r.ID, 'evento');
  assert.equal(p.type, 'evento'); assert.equal(p.title, TAG + ' evento'); assert.ok(p.categories.includes(CAT + ' tema'), 'categoría del tipo: ' + p.categories);
  assert.match(p.content, /Hola/);
  const l = await W.listPosts(cfg, { type: 'evento', status: 'any', search: TAG, number: 20 });
  assert.ok(l.items.some((x) => x.id === r.ID && x.type === 'evento'), 'aparece en el listado del tipo');
  // un cambio posterior solo envía lo modificado
  const again = CPT.buildFieldsPost(def.fields, { ...values, 'acf:lugar': 'Plaza' }, values, { acfRest: def.acfRest });
  assert.deepEqual(Object.keys({ ...again.post.acf, ...again.helper.acf }), ['lugar']);
  await W.updatePost(cfg, r.ID, { type: 'evento', title: TAG + ' evento', content: p.content, status: 'draft', ...again.post });
  if (again.helper.acf) await W.fieldsSave(cfg, r.ID, again.helper);
  const back2 = await W.fieldsLoad(cfg, { type: 'evento', postId: r.ID, helper: helperFields });
  assert.equal(back2.values['acf:lugar'], 'Plaza');
});

test('idiomas: Polylang se detecta y se crea una traducción enlazada', { skip: !EXPECT_LANG && 'WP_EXPECT_LANG no activado' }, async () => {
  const info = await W.langInfo(cfg, { helper: helperFields });
  assert.equal(info.plugin, 'polylang');
  const codes = info.languages.map((l) => l.code);
  assert.ok(codes.includes('es') && codes.includes('en'), 'idiomas: ' + codes);
  const orig = await W.createPost(cfg, { type: 'post', title: TAG + ' idioma', content: '<!-- wp:paragraph --><p>Hola</p><!-- /wp:paragraph -->', status: 'draft' });
  created.posts.push(orig.ID);
  await W.langSet(cfg, { postId: orig.ID, lang: 'es', type: 'post', helper: helperFields });
  const draft = CPT.translationDraft({ id: orig.ID, type: 'post', title: TAG + ' idioma', content: '<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->' }, 'en');
  const tr = await W.createPost(cfg, { ...draft, lang: undefined });
  created.posts.push(tr.ID);
  await W.langSet(cfg, { postId: tr.ID, lang: 'en', translationOf: orig.ID, type: 'post', helper: helperFields });
  const after = await W.langInfo(cfg, { helper: helperFields, postId: orig.ID });
  if (helperFields) { assert.equal(after.post.lang, 'es'); assert.equal(after.post.translations.en, tr.ID); }
  const back = await W.langInfo(cfg, { helper: helperFields, postId: tr.ID });
  if (helperFields) { assert.equal(back.post.lang, 'en'); assert.equal(back.post.translations.es, orig.ID); }
  const p = await W.getPost(cfg, tr.ID, 'post');
  assert.equal(p.status, 'draft'); assert.equal(p.lang, 'en');
  const en = await W.listPosts(cfg, { type: 'post', status: 'any', search: TAG, lang: 'en', number: 20 });
  assert.ok(en.items.some((x) => x.id === tr.ID) && !en.items.some((x) => x.id === orig.ID), 'el filtro por idioma separa original y traducción');
  if (helperFields) assert.equal((await W.langBatch(cfg, [orig.ID, tr.ID]))[tr.ID], 'en');
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
