// Estilos de la web: lectura de paletas (con fetch simulado), salida con clases del tema y su ida y vuelta, metas de Astra.
const test = require('node:test');
const assert = require('node:assert/strict');
const TS = require('../src/themestyles');
const T = require('../src/transform');
const { parseBlocks } = require('../src/parseblocks');
const W = require('../src/wpself');

const PLUGIN_THEME = {
  plugin: 'ecos', version: '1.4.0',
  theme: { name: 'Astra', stylesheet: 'astra', template: 'astra', isAstra: true },
  settings: {
    color: {
      palette: { theme: [{ slug: 'ast-global-color-0', name: 'Color 1', color: '#046bd2' }, { slug: 'bad slug', name: 'x', color: '#000' }], default: [{ slug: 'vivid-red', name: 'Rojo', color: '#cf2e2e' }] },
      gradients: { theme: [{ slug: 'sunset', name: 'Atardecer', gradient: 'linear-gradient(135deg,#f00 0%,#00f 100%)' }] },
    },
    typography: {
      fontSizes: { theme: [{ slug: 'large', name: 'Grande', size: '1.5rem' }, { slug: 'huge', name: 'Enorme', size: 'clamp(2rem, 5vw, 4rem)' }, { slug: 'evil', name: 'x', size: '1px;}body{x' }] },
      fontFamilies: { theme: [{ slug: 'serif', name: 'Serif', fontFamily: 'Georgia, serif' }] },
    },
  },
  astra: { palette: [{ slug: 'ast-global-color-0', name: 'Color 1', color: '#046bd2' }, { slug: 'ast-global-color-1', name: 'Color 2', color: '#045cb4' }], bodyFont: "'Roboto', sans-serif", headingFont: 'inherit' },
};

test('estilos de la web: se normalizan colores, tamaños y fuentes y se descartan los valores peligrosos', () => {
  const s = TS.normalize(PLUGIN_THEME);
  assert.deepEqual(s.colors.map((c) => c.slug), ['ast-global-color-0', 'ast-global-color-1']);
  assert.equal(s.colors[1].name, 'Color 2');
  assert.deepEqual(s.sizes.map((z) => z.slug), ['large', 'huge']);
  assert.deepEqual(s.fonts.map((f) => f.slug), ['serif']);
  assert.equal(s.gradients[0].slug, 'sunset');
  assert.equal(s.bodyFont, "'Roboto', sans-serif");
  assert.equal(s.headingFont, '', 'inherit = sin fuente propia para los títulos');
  assert.equal(s.theme.isAstra, true);
});

test('lectura: con el complemento 1.4 se usa ecos/v1/theme; sin él, la API estándar de estilos globales', async () => {
  const routes = [];
  const viaPlugin = await TS.fetchTheme(async (r) => { routes.push(r); return PLUGIN_THEME; }, '1.4.0');
  assert.deepEqual(routes, ['/ecos/v1/theme']);
  assert.equal(viaPlugin.source, 'plugin');
  routes.length = 0;
  const rest = await TS.fetchTheme(async (r) => {
    routes.push(r);
    if (r.startsWith('/wp/v2/themes')) return [{ stylesheet: 'twentytwentyfour', template: 'twentytwentyfour', name: { raw: 'Twenty Twenty-Four' } }];
    return { settings: { color: { palette: { theme: [{ slug: 'accent-1', name: 'Acento 1', color: '#ff0000' }] } }, typography: { fontSizes: [{ slug: 'small', name: 'Pequeño', size: '14px' }] } } };
  }, '1.3.0');
  assert.deepEqual(routes, ['/wp/v2/themes?status=active', '/wp/v2/global-styles/themes/twentytwentyfour']);
  assert.equal(rest.source, 'rest');
  assert.equal(rest.colors[0].color, '#ff0000');
  assert.equal(rest.sizes[0].size, '14px');
  // si el endpoint del complemento falla, se prueba la API estándar
  routes.length = 0;
  const fb = await TS.fetchTheme(async (r) => { routes.push(r); if (r.startsWith('/ecos')) throw new Error('404'); return r.startsWith('/wp/v2/themes') ? [{ stylesheet: 'astra' }] : { settings: {} }; }, '1.4.0');
  assert.equal(routes.length, 3);
  assert.equal(fb.source, 'rest');
});

const P = (extra) => ({ id: 'p1', type: 'paragraph', html: 'Hola', ...extra });
const th = (o) => ({ th: Object.fromEntries(Object.entries(o).map(([k, [slug, v]]) => [k, { slug, v }])) });

test('salida: el color, el fondo y el tamaño del tema usan las clases y atributos estándar de WordPress', () => {
  const out = T.composeBlocks([P({ color: '#046bd2', bg: '#fff3e0', size: '1.5rem', ...th({ color: ['ast-global-color-0', '#046bd2'], bg: ['accent', '#fff3e0'], size: ['large', '1.5rem'] }) })]);
  assert.match(out, /<!-- wp:paragraph \{[^}]*"textColor":"ast-global-color-0"/);
  assert.match(out, /"backgroundColor":"accent"/);
  assert.match(out, /"fontSize":"large"/);
  assert.match(out, /class="[^"]*has-ast-global-color-0-color/);
  assert.match(out, /class="[^"]*has-accent-background-color/);
  assert.match(out, /class="[^"]*has-large-font-size/);
  assert.doesNotMatch(out, /#046bd2|#fff3e0|1\.5rem/, 'sin valores sueltos');
});

test('salida: si el valor del bloque ya no es el del tema (otro color elegido a mano), se escribe el color suelto', () => {
  const out = T.composeBlocks([P({ color: '#112233', ...th({ color: ['accent', '#046bd2'] }) })]);
  assert.doesNotMatch(out, /textColor|has-accent-color/);
  assert.match(out, /color:#112233/);
});

test('ida y vuelta: párrafo, título, lista, cita, sección, columnas y botón conservan sus colores, tamaños y fuentes del tema', () => {
  TS.set(TS.normalize(PLUGIN_THEME));
  const blocks = [
    P({ color: '#046bd2', size: '1.5rem', font: 'wp:serif', align: 'center', ...th({ color: ['ast-global-color-0', '#046bd2'], size: ['large', '1.5rem'] }) }),
    { id: 'h', type: 'heading', level: 3, html: 'T', bg: '#045cb4', ...th({ bg: ['ast-global-color-1', '#045cb4'] }) },
    { id: 'l', type: 'list', items: ['a', 'b'], color: '#046bd2', ...th({ color: ['ast-global-color-0', '#046bd2'] }) },
    { id: 'q', type: 'quote', html: 'c', color: '#046bd2', ...th({ color: ['ast-global-color-0', '#046bd2'] }) },
    { id: 'g', type: 'group', bg: '#045cb4', color: '#046bd2', pad: 'm', children: [P({ html: 'dentro' })], ...th({ bg: ['ast-global-color-1', '#045cb4'], color: ['ast-global-color-0', '#046bd2'] }) },
    { id: 'c', type: 'columns', bg: '#045cb4', cols: [{ width: '50%', children: [P({ html: 'A' })] }, { width: '50%', children: [P({ html: 'B' })] }], ...th({ bg: ['ast-global-color-1', '#045cb4'] }) },
    { id: 'b', type: 'buttons', html: 'Pulsa', url: 'https://x.org', bg: '#046bd2', color: '#045cb4', ...th({ bg: ['ast-global-color-0', '#046bd2'], color: ['ast-global-color-1', '#045cb4'] }) },
  ];
  const out = T.composeBlocks(blocks);
  const back = parseBlocks(out);
  assert.deepEqual(back.map((b) => b.type), ['paragraph', 'heading', 'list', 'quote', 'group', 'columns', 'buttons']);
  assert.equal(back[0].color, '#046bd2'); assert.equal(back[0].th.color.slug, 'ast-global-color-0');
  assert.equal(back[0].size, '1.5rem'); assert.equal(back[0].th.size.slug, 'large'); assert.equal(back[0].font, 'wp:serif');
  assert.equal(back[1].bg, '#045cb4'); assert.equal(back[1].th.bg.slug, 'ast-global-color-1');
  assert.equal(back[4].type, 'group'); assert.equal(back[4].th.bg.slug, 'ast-global-color-1'); assert.equal(back[4].th.color.slug, 'ast-global-color-0');
  assert.equal(back[5].th.bg.slug, 'ast-global-color-1');
  assert.equal(back[6].th.bg.slug, 'ast-global-color-0'); assert.equal(back[6].th.color.slug, 'ast-global-color-1');
  // y al volver a enviar sale exactamente lo mismo
  const strip = (s) => s.replace(/ecos-[cm]-[a-z0-9]+/g, '');
  assert.equal(strip(T.composeBlocks(back)), strip(out));
  TS.set(null);
});

test('ida y vuelta sin la paleta en caché: el valor se guarda como variable estándar y la clase se conserva', () => {
  TS.set(null);
  const out = T.composeBlocks([P({ color: '#abcdef', size: '2rem', ...th({ color: ['mi-color', '#abcdef'], size: ['xl', '2rem'] }) })]);
  const back = parseBlocks(out);
  assert.equal(back[0].th.color.slug, 'mi-color');
  assert.equal(back[0].color, 'var(--wp--preset--color--mi-color)');
  assert.equal(T.composeBlocks(back), out);
});

test('fuente de los títulos: va en línea y vuelve como «heading»', () => {
  TS.set(TS.normalize({ ...PLUGIN_THEME, astra: { ...PLUGIN_THEME.astra, headingFont: "'Playfair Display', serif" } }));
  const out = T.composeBlocks([P({ font: 'heading', ...th({ font: ['heading', "'Playfair Display', serif"] }) })]);
  assert.match(out, /font-family:'Playfair Display', serif/);
  const back = parseBlocks(out);
  assert.equal(back[0].font, 'heading');
  assert.equal(T.composeBlocks(back), out);
  TS.set(null);
});

test('texto en línea con color del tema: clase estándar y vuelta idéntica', () => {
  const html = 'Un <mark style="background-color:rgba(0, 0, 0, 0)" class="has-inline-color has-ast-global-color-0-color">color</mark> y <mark style="background-color:rgba(0, 0, 0, 0)" class="has-inline-color has-accent-background-color">fondo</mark> y <mark style="background-color:#ffee00" class="has-inline-color">suelto</mark>';
  const out = T.composeBlocks([P({ html })]);
  assert.ok(out.includes('class="has-inline-color has-ast-global-color-0-color"'));
  assert.ok(out.includes('class="has-inline-color has-accent-background-color"'));
  assert.ok(out.includes('<mark style="background-color:#ffee00" class="has-inline-color">'));
  assert.equal(T.composeBlocks(parseBlocks(out)), out);
});

test('metas de Astra: el modelo del editor se convierte en metas, vuelve igual y se envía en la petición REST', async () => {
  const a = { layout: 'wide', sidebar: 'none', transparent: 'on', hideTitle: true, hideImage: false, hideHeader: true, hideFooter: true };
  const meta = TS.astraToMeta(a);
  assert.equal(meta['ast-site-content-layout'], 'full-width-container');
  assert.equal(meta['site-sidebar-layout'], 'no-sidebar');
  assert.equal(meta['site-post-title'], 'disabled');
  assert.equal(meta['ast-featured-img'], '');
  assert.equal(meta['ast-main-header-display'], 'disabled');
  assert.equal(meta['footer-sml-layout'], 'disabled');
  assert.equal(meta['theme-transparent-header-meta'], 'enabled');
  assert.deepEqual(TS.astraFromMeta(meta), a);
  assert.equal(TS.astraFromMeta({}), null, 'sin metas (complemento antiguo) no hay ajustes');
  assert.deepEqual(TS.astraFromMeta(TS.astraToMeta({})), { layout: '', sidebar: '', hideTitle: false, hideImage: false, hideHeader: false, hideFooter: false, transparent: '' });
  const rest = await W.toRest({}, { type: 'page', title: 'T', content: 'c', status: 'draft', astraMeta: { ...meta, 'otra-meta': 'x' }, seoKey: '_yoast_wpseo_metadesc', seoDesc: 'D' });
  assert.equal(rest.meta['site-sidebar-layout'], 'no-sidebar');
  assert.equal(rest.meta['_yoast_wpseo_metadesc'], 'D');
  assert.ok(!('otra-meta' in rest.meta), 'solo las metas de Astra conocidas');
  const none = await W.toRest({}, { type: 'page', title: 'T', content: 'c', status: 'draft' });
  assert.ok(!('meta' in none));
});

test('vista exacta: se incrustan las hojas de estilo, se quitan los scripts y los enlaces no navegan', async () => {
  const html = "<html><head><link rel='stylesheet' id='a' href='/s.css?x=1&#038;y=2' media='all' /><link rel=\"stylesheet\" href=\"https://c.x/b.css\" media=\"print\"><link rel=\"preload\" href=\"/f.woff2\"><script>x()</script><script src=\"a.js\"></script></head><body><a href=\"https://x.org\">k</a><form action=\"/e\"></form></body></html>";
  const asked = [];
  const out = await TS.prepareExact(html, async (u) => { asked.push(u); return 'body{background:url(i.png)}@import url(z.css);'; }, { base: 'https://w.org/' });
  assert.deepEqual(asked, ['https://w.org/s.css?x=1&y=2']);
  assert.match(out, /<style>body\{background:url\("https:\/\/w\.org\/i\.png"\)\}<\/style>/);
  assert.doesNotMatch(out, /<script|@import|preload|https:\/\/x\.org/);
  assert.match(out, /href="javascript:void\(0\)"/);
  assert.match(out, /onsubmit="return false"/);
});
