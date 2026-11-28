// Tipos de contenido propios, campos personalizados (ACF, Meta Box, metas) e idiomas (Polylang, WPML): lógica pura de renderer/cpt.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../renderer/cpt');
const W = require('../src/wpself');

const TYPES = {
  post: { slug: 'post', name: 'Entradas', rest_base: 'posts', supports: { editor: true } },
  page: { slug: 'page', name: 'Páginas', rest_base: 'pages' },
  attachment: { slug: 'attachment', name: 'Medios', rest_base: 'media' },
  wp_block: { slug: 'wp_block', name: 'Patrones', rest_base: 'blocks' },
  wp_template: { slug: 'wp_template', rest_base: 'templates' }, wp_navigation: { slug: 'wp_navigation', rest_base: 'navigation' },
  wp_global_styles: { slug: 'wp_global_styles', rest_base: 'global-styles' }, wp_font_family: { slug: 'wp_font_family', rest_base: 'font-families' }, wp_font_face: { slug: 'wp_font_face', rest_base: 'x' },
  nav_menu_item: { slug: 'nav_menu_item', rest_base: 'menu-items' },
  product: { slug: 'product', name: 'Productos', rest_base: 'product', rest_namespace: 'wc/v3' },
  evento: { slug: 'evento', name: 'Eventos', rest_base: 'eventos', labels: { singular_name: 'Evento' }, supports: { editor: true, excerpt: true, thumbnail: true }, taxonomies: ['category'], hierarchical: false },
  proyecto: { slug: 'proyecto', name: 'Proyectos', rest_base: 'proyectos', labels: { singular_name: 'Proyecto' }, supports: { title: true, editor: false }, taxonomies: ['tipo-proyecto'] },
};

test('tipos: se ofrecen solo los propios, sin internos ni tiendas', () => {
  const list = C.mapTypes(TYPES);
  assert.deepEqual(list.map((x) => x.slug), ['evento', 'proyecto']);
  const ev = list[0];
  assert.equal(ev.restBase, 'eventos'); assert.equal(ev.singular, 'Evento'); assert.equal(ev.editor, true); assert.equal(ev.excerpt, true);
  assert.equal(list[1].editor, false, 'supports.editor false → sin editor de bloques');
  for (const bad of ['post', 'page', 'attachment', 'wp_block', 'wp_template', 'wp_navigation', 'wp_global_styles', 'wp_font_family', 'wp_font_face', 'nav_menu_item', 'product']) assert.ok(!list.some((x) => x.slug === bad), bad);
  assert.deepEqual(C.mapTypes(null), []);
  assert.deepEqual(C.mapTypes(Object.values(TYPES)).map((x) => x.slug), ['evento', 'proyecto'], 'también como lista');
});

test('tipos: colección REST de cada tipo', () => {
  const list = C.mapTypes(TYPES);
  assert.equal(C.collOf('post', list), 'posts'); assert.equal(C.collOf(undefined, list), 'posts'); assert.equal(C.collOf('page', list), 'pages');
  assert.equal(C.collOf('evento', list), 'eventos'); assert.equal(C.collOf('desconocido', list), 'desconocido');
});

test('taxonomías: categoría (jerárquica) y etiqueta (no jerárquica) de cada tipo', () => {
  const m = C.mapTaxonomies({
    category: { slug: 'category', name: 'Categorías', rest_base: 'categories', hierarchical: true },
    tema: { slug: 'tema', name: 'Temas', rest_base: 'temas', hierarchical: true },
    post_tag: { slug: 'post_tag', name: 'Etiquetas', rest_base: 'tags', hierarchical: false },
    nav_menu: { slug: 'nav_menu', rest_base: 'menus', hierarchical: false },
  });
  assert.equal(m.category.restBase, 'categories'); assert.equal(m.tag.restBase, 'tags'); assert.equal(m.all.length, 3);
  const own = C.mapTaxonomies({ 'tipo-proyecto': { slug: 'tipo-proyecto', name: 'Tipos', rest_base: 'tipos-proyecto', hierarchical: true } });
  assert.equal(own.category.restBase, 'tipos-proyecto'); assert.equal(own.tag, null);
  assert.deepEqual(C.mapTaxonomies([]).all, []);
});

const ACF_GROUPS = [{ key: 'group_1', title: 'Datos del evento', fields: [
  { key: 'field_a', name: 'lugar', label: 'Lugar', type: 'text', required: 1, instructions: 'Dónde es' },
  { key: 'field_b', name: 'fecha', label: 'Fecha', type: 'date_picker' },
  { key: 'field_c', name: 'gratis', label: 'Gratis', type: 'true_false' },
  { key: 'field_d', name: 'aforo', label: 'Aforo', type: 'number', min: '1', max: '500', step: '' },
  { key: 'field_e', name: 'nivel', label: 'Nivel', type: 'select', choices: { a: 'Alto', b: 'Bajo' }, multiple: 0 },
  { key: 'field_f', name: 'temas', label: 'Temas', type: 'checkbox', choices: { x: 'X', y: 'Y' } },
  { key: 'field_g', name: 'cartel', label: 'Cartel', type: 'image', return_format: 'array' },
  { key: 'field_h', name: 'web', label: 'Web', type: 'link' },
  { key: 'field_i', name: 'sesiones', label: 'Sesiones', type: 'repeater', sub_fields: [] },
  { key: 'field_j', name: 'relacionados', label: 'Relacionados', type: 'relationship' },
  { key: 'field_k', name: 'inicio', label: 'Inicio', type: 'date_time_picker' },
  { key: 'field_l', name: 'correo', label: 'Correo', type: 'email' },
] }];

test('ACF: normaliza los campos (editables y de solo lectura)', () => {
  const f = C.normalizeAcf(ACF_GROUPS);
  const by = Object.fromEntries(f.map((x) => [x.name, x]));
  assert.equal(by.lugar.kind, 'text'); assert.equal(by.lugar.required, true); assert.equal(by.lugar.help, 'Dónde es'); assert.equal(by.lugar.group, 'Datos del evento'); assert.equal(by.lugar.id, 'acf:lugar');
  assert.equal(by.fecha.kind, 'date'); assert.equal(by.gratis.kind, 'bool');
  assert.deepEqual([by.aforo.min, by.aforo.max, by.aforo.step], [1, 500, undefined]);
  assert.deepEqual(by.nivel.options, [{ value: 'a', label: 'Alto' }, { value: 'b', label: 'Bajo' }]); assert.equal(by.nivel.multiple, false);
  assert.equal(by.temas.kind, 'checkbox'); assert.equal(by.temas.multiple, true);
  assert.equal(by.cartel.kind, 'image'); assert.equal(by.web.kind, 'link'); assert.equal(by.inicio.kind, 'datetime'); assert.equal(by.correo.kind, 'email');
  assert.equal(by.sesiones.kind, 'readonly', 'repetidor: solo lectura'); assert.equal(by.relacionados.kind, 'readonly', 'relación: solo lectura');
  assert.deepEqual(C.normalizeAcf(null), []);
});

test('Meta Box y metas registradas: normalización', () => {
  const mb = C.normalizeMetaBox([{ title: 'Ficha', fields: [
    { id: 'precio', name: 'Precio', type: 'number', min: 0, desc: 'En euros' }, { id: 'activo', name: 'Activo', type: 'switch' },
    { id: 'color', name: 'Color', type: 'select', options: { r: 'Rojo', v: 'Verde' } }, { id: 'foto', name: 'Foto', type: 'single_image' },
    { id: 'galeria', name: 'Galería', type: 'image_advanced' }, { id: 'tel', name: 'Teléfonos', type: 'text', clone: true }, { id: 'g', name: 'Grupo', type: 'group' },
  ] }]);
  const by = Object.fromEntries(mb.map((x) => [x.name, x]));
  assert.equal(by.precio.kind, 'number'); assert.equal(by.precio.id, 'metabox:precio'); assert.equal(by.precio.help, 'En euros'); assert.equal(by.precio.min, 0);
  assert.equal(by.activo.kind, 'bool'); assert.equal(by.color.kind, 'select'); assert.equal(by.color.options.length, 2); assert.equal(by.foto.kind, 'image');
  for (const n of ['galeria', 'tel', 'g']) assert.equal(by[n].kind, 'readonly', n);
  const metas = C.normalizeMetas([
    { key: 'aforo_max', type: 'integer', description: 'Plazas', single: true }, { key: 'lleno', type: 'boolean', single: true }, { key: 'notas', type: 'string', single: true },
    { key: 'lista', type: 'array', single: true }, { key: 'varios', type: 'string', single: false }, { key: '_yoast_wpseo_metadesc', type: 'string', single: true }, { key: 'rank_math_title', type: 'string', single: true }, { key: 'ast-main-header-display', type: 'string', single: true },
  ]);
  assert.deepEqual(metas.map((m) => [m.name, m.kind]), [['aforo_max', 'number'], ['lleno', 'bool'], ['notas', 'text'], ['lista', 'readonly'], ['varios', 'readonly']], 'las del SEO y Astra se descartan');
});

test('sin complemento: los campos se deducen de lo que trae la API', () => {
  const f = C.inferFields({ lugar: 'Sala', aforo: 40, gratis: true, mezcla: [1, 2] }, { _yoast_wpseo_metadesc: 'x', nota: 'hola' });
  assert.deepEqual(f.map((x) => [x.id, x.kind]), [['acf:lugar', 'text'], ['acf:aforo', 'number'], ['acf:gratis', 'bool'], ['acf:mezcla', 'readonly'], ['meta:nota', 'text']]);
  assert.deepEqual(C.inferFields([], []), []);
});

test('ecos/v1/fields → campos y valores iniciales por id', () => {
  const r = C.fromHelper({ acf: { groups: ACF_GROUPS, values: { lugar: 'Sala', fecha: '20260115', gratis: true }, rest: true }, metabox: { boxes: [{ title: 'F', fields: [{ id: 'precio', name: 'Precio', type: 'number' }] }], values: { precio: '12' } }, meta: { keys: [{ key: 'notas', type: 'string', single: true }], values: { notas: 'ok' } } });
  assert.equal(r.acfRest, true); assert.equal(r.values['acf:lugar'], 'Sala'); assert.equal(r.values['metabox:precio'], '12'); assert.equal(r.values['meta:notas'], 'ok');
  assert.ok(r.fields.some((f) => f.id === 'acf:sesiones' && f.kind === 'readonly'));
  assert.equal(C.fromHelper({}).fields.length, 0);
});

const field = (name, kind, extra = {}) => ({ id: 'acf:' + name, source: 'acf', name, label: name, kind, required: false, options: [], ...extra });

test('valores: conversión entre ACF y los controles (ida y vuelta)', () => {
  const d = field('fecha', 'date'), dt = field('inicio', 'datetime'), tm = field('hora', 'time'), b = field('gratis', 'bool'), n = field('aforo', 'number'), im = field('cartel', 'image'), ln = field('web', 'link'), ck = field('temas', 'checkbox', { options: [{ value: 'x', label: 'X' }] });
  assert.equal(C.toInput(d, '20260115'), '2026-01-15'); assert.equal(C.fromInput(d, '2026-01-15'), '20260115');
  assert.equal(C.toInput(dt, '2026-01-15 18:30:00'), '2026-01-15T18:30'); assert.equal(C.fromInput(dt, '2026-01-15T18:30'), '2026-01-15 18:30:00');
  assert.equal(C.toInput(tm, '18:30:00'), '18:30'); assert.equal(C.fromInput(tm, '18:30'), '18:30:00');
  assert.equal(C.toInput(b, '1'), true); assert.equal(C.toInput(b, 0), false); assert.equal(C.fromInput(b, true), 1);
  assert.equal(C.fromInput({ ...b, source: 'meta' }, true), true);
  assert.equal(C.fromInput(n, '12.5'), 12.5); assert.equal(C.fromInput(n, ''), '');
  assert.equal(C.toInput(im, { ID: 7 }), 7); assert.equal(C.toInput(im, '9'), 9); assert.equal(C.fromInput(im, 7), 7);
  assert.deepEqual(C.toInput(ln, { title: 'A', url: 'https://a.es', target: '_blank' }), { title: 'A', url: 'https://a.es', target: '_blank' }); assert.deepEqual(C.toInput(ln, null), { title: '', url: '', target: '' });
  assert.deepEqual(C.toInput(ck, 'x'), ['x']); assert.deepEqual(C.toInput(ck, null), []);
});

test('valores: validación', () => {
  const ok = (f, v) => C.validateValue(f, v).ok, err = (f, v) => C.validateValue(f, v).error;
  assert.equal(err(field('a', 'text', { required: true }), '  '), 'required'); assert.ok(ok(field('a', 'text'), ''));
  assert.ok(ok(field('a', 'bool', { required: true }), false), 'un sí/no obligatorio puede ser «no»');
  const n = field('n', 'number', { min: 1, max: 10 });
  assert.equal(err(n, 'abc'), 'number'); assert.equal(err(n, '0'), 'min'); assert.equal(err(n, '11'), 'max'); assert.ok(ok(n, '5'));
  assert.equal(err(field('e', 'email'), 'a@b'), 'email'); assert.ok(ok(field('e', 'email'), 'a@b.es'));
  assert.equal(err(field('u', 'url'), 'www.a.es'), 'url'); assert.ok(ok(field('u', 'url'), 'https://a.es/x'));
  assert.equal(err(field('d', 'date'), '2026-13-40'), 'date'); assert.ok(ok(field('d', 'date'), '2026-02-03'));
  assert.equal(err(field('h', 'time'), '25:00'), 'time'); assert.ok(ok(field('h', 'time'), '23:59'));
  const sel = field('s', 'select', { options: [{ value: 'a', label: 'A' }] });
  assert.equal(err(sel, 'z'), 'option'); assert.ok(ok(sel, 'a')); assert.equal(err(field('c', 'checkbox', { options: [{ value: 'a' }] }), ['a', 'q']), 'option');
  assert.equal(err(field('l', 'link'), { url: 'javascript:alert(1)' }), 'url'); assert.ok(ok(field('l', 'link'), { url: 'https://a.es' }));
  assert.equal(err(field('i', 'image', { required: true }), 0), 'required');
  assert.ok(ok(field('r', 'readonly', { required: true }), undefined), 'los de solo lectura no se validan');
  const all = C.validateAll([field('a', 'text', { required: true }), field('b', 'email')], { 'acf:a': '', 'acf:b': 'no' });
  assert.equal(all.ok, false); assert.deepEqual(all.errors, { 'acf:a': 'required', 'acf:b': 'email' });
});

test('envío: construye acf, meta y lo que va por el complemento (solo lo cambiado)', () => {
  const fields = [field('lugar', 'text'), field('gratis', 'bool'), field('fecha', 'date'), field('sesiones', 'readonly'),
    { id: 'meta:aforo_max', source: 'meta', name: 'aforo_max', kind: 'number', options: [] }, { id: 'metabox:precio', source: 'metabox', name: 'precio', kind: 'number', options: [] }];
  const initial = { 'acf:lugar': 'Sala', 'acf:gratis': false, 'acf:fecha': '2026-01-15', 'acf:sesiones': [1], 'meta:aforo_max': '40', 'metabox:precio': '10' };
  const values = { 'acf:lugar': 'Plaza', 'acf:gratis': true, 'acf:fecha': '2026-01-15', 'acf:sesiones': [9], 'meta:aforo_max': '50', 'metabox:precio': '12' };
  const rest = C.buildFieldsPost(fields, values, initial, { acfRest: true });
  assert.deepEqual(rest.post, { acf: { lugar: 'Plaza', gratis: 1 }, meta: { aforo_max: 50 } });
  assert.deepEqual(rest.helper, { metabox: { precio: 12 } });
  const noRest = C.buildFieldsPost(fields, values, initial, { acfRest: false });
  assert.deepEqual(noRest.post, { meta: { aforo_max: 50 } });
  assert.deepEqual(noRest.helper, { acf: { lugar: 'Plaza', gratis: 1 }, metabox: { precio: 12 } });
  assert.equal(C.buildFieldsPost(fields, initial, initial, { acfRest: true }).empty, true, 'sin cambios no se envía nada');
  const date = C.buildFieldsPost(fields, { ...initial, 'acf:fecha': '2026-02-01' }, initial, { acfRest: true });
  assert.deepEqual(date.post, { acf: { fecha: '20260201' } });
});

test('toRest: la API recibe acf, meta, idioma y términos del tipo propio', async () => {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push(String(url));
    const u = String(url);
    const json = (d) => ({ ok: true, status: 200, headers: new Map(), json: async () => d });
    if (u.includes('/wp/v2/types')) return json(TYPES);
    if (u.includes('/wp/v2/taxonomies')) return json({ tema: { slug: 'tema', name: 'Temas', rest_base: 'temas', hierarchical: true }, post_tag: { slug: 'post_tag', name: 'Etiquetas', rest_base: 'tags', hierarchical: false } });
    if (u.includes('/wp/v2/temas?search')) return json([{ id: 5, name: 'Música' }]);
    if (u.includes('/wp/v2/tags?search')) return json([{ id: 8, name: 'verano' }]);
    return json([]);
  };
  try {
    const cfg = { wpUrl: 'https://t.example', wpUser: 'u', wpAppPassword: 'abcd efgh ijkl mnop qrst uvwx' };
    const body = await W.toRest(cfg, { type: 'evento', title: 'E', content: 'c', status: 'draft', categories: 'Música', tags: 'verano', acf: { lugar: 'Sala' }, meta: { aforo_max: 5 }, lang: 'es' });
    assert.deepEqual(body.acf, { lugar: 'Sala' }); assert.deepEqual(body.meta, { aforo_max: 5 }); assert.equal(body.lang, 'es');
    assert.deepEqual(body.temas, [5]); assert.deepEqual(body.tags, [8]); assert.equal(body.categories, undefined, 'no se usan las categorías de las entradas');
    const post = await W.toRest(cfg, { type: 'post', title: 'P', content: 'c', status: 'draft', categories: '', tags: '' });
    assert.equal(post.acf, undefined); assert.deepEqual(post.categories, []);
    const types = await W.cptTypes(cfg, { force: true });
    assert.deepEqual(types.map((x) => x.slug), ['evento', 'proyecto']);
  } finally { global.fetch = orig; }
});

test('idiomas: detección, normalización y traducciones', () => {
  assert.equal(C.detectLangPlugin(['wp/v2', 'pll/v1']), 'polylang'); assert.equal(C.detectLangPlugin(['wp/v2', 'wpml/v1']), 'wpml');
  assert.equal(C.detectLangPlugin(['wp/v2']), null); assert.equal(C.detectLangPlugin(['wp/v2'], { plugin: 'wpml' }), 'wpml');
  const L = C.normalizeLangs({ plugin: 'polylang', languages: [{ code: 'es', name: 'Español', locale: 'es_ES', default: true }, { code: 'en', name: 'English' }, { name: 'sin código' }] });
  assert.equal(L.plugin, 'polylang'); assert.equal(L.languages.length, 2); assert.equal(L.default, 'es');
  assert.equal(C.normalizeLangs({ plugin: 'otro' }).plugin, null);
  const P = C.normalizePostLang({ lang: 'es', translations: { en: 12, fr: 0 } }, 10);
  assert.deepEqual(P, { lang: 'es', translations: { en: 12, es: 10 } });
  assert.deepEqual(C.missingLangs({ languages: [{ code: 'es' }, { code: 'en' }, { code: 'fr' }] }, P).map((l) => l.code), ['fr']);
  assert.deepEqual(C.langChip(L, 'en'), { code: 'en', label: 'EN', name: 'English' }); assert.equal(C.langChip(L, 'xx'), null);
  const d = C.translationDraft({ id: 4, type: 'evento', title: 'Hola', content: '<p>x</p>', excerpt: 'e', featured: 9 }, 'en');
  assert.deepEqual([d.type, d.title, d.status, d.lang, d.translationOf, d.featured_image], ['evento', 'Hola (EN)', 'draft', 'en', 4, 9]);
  assert.equal(C.translationDraft({ id: 4, title: 'Hola' }, 'en', { suffix: false }).title, 'Hola');
});

test('traducir con IA: solo cambian los textos, no la estructura ni las fotos', () => {
  const blocks = [
    { id: 'a', type: 'heading', html: 'Hola' }, { id: 'b', type: 'image', img: { id: 5, url: 'x.jpg' } }, { id: 'c', type: 'paragraph', html: 'Mundo <b>bonito</b>' },
    { id: 'd', type: 'list', items: ['uno', 'dos'] }, { id: 'e', type: 'columns', cols: [{ children: [{ id: 'f', type: 'paragraph', html: 'dentro' }, { id: 'g', type: 'paragraph', html: '  ' }] }] },
  ];
  const kids = (b) => (b.cols ? b.cols.map((c) => c.children) : []);
  const before = JSON.stringify(blocks.map((b) => ({ id: b.id, type: b.type })));
  const col = C.collectTexts(blocks, kids);
  assert.deepEqual(col.items.map((i) => i.html), ['Hola', 'Mundo <b>bonito</b>', 'uno', 'dos', 'dentro']);
  const n = col.apply({ T1: 'Hello', T2: 'Beautiful <b>world</b>', T3: 'one', T4: '', T5: 'inside' });
  assert.equal(n, 4);
  assert.equal(blocks[0].html, 'Hello'); assert.equal(blocks[2].html, 'Beautiful <b>world</b>'); assert.deepEqual(blocks[3].items, ['one', 'dos'], 'lo que la IA no devuelve se queda como estaba');
  assert.equal(blocks[4].cols[0].children[0].html, 'inside'); assert.equal(blocks[1].img.url, 'x.jpg');
  assert.equal(JSON.stringify(blocks.map((b) => ({ id: b.id, type: b.type }))), before);
});
