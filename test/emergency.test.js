const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const E = require('../src/emergency');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-emerg-'));
const ORIGIN = 'https://www.example.org';

test('rutas locales: una carpeta por dirección y enlaces relativos', () => {
  assert.equal(E.localPage('https://x.org/'), 'index.html');
  assert.equal(E.localPage('https://x.org/quienes-somos/'), 'quienes-somos/index.html');
  assert.equal(E.localPage('https://x.org/quienes-somos'), 'quienes-somos/index.html');
  assert.equal(E.localPage('https://x.org/blog/2026/hola/'), 'blog/2026/hola/index.html');
  assert.equal(E.localPage('https://x.org/a.html'), 'a.html');
  assert.match(E.localPage('https://x.org/blog/?paged=2'), /^blog\/index~[0-9a-f]{6}\.html$/);
  assert.equal(E.pageKey('https://x.org/a/'), E.pageKey('https://www.x.org/a'));
  assert.equal(E.localAsset('https://x.org/wp-content/themes/astra/style.css?ver=4.1'), 'wp-content/themes/astra/style.css');
  assert.match(E.localAsset('https://x.org/dyn.php?x=1'), /^dyn~[0-9a-f]{6}\.php$/);
  assert.equal(E.localAsset('https://x.org/a/b%20c.png'), 'a/b c.png');
  assert.equal(E.relLink('index.html', 'wp-content/a.css'), 'wp-content/a.css');
  assert.equal(E.relLink('blog/hola/index.html', 'wp-content/a.css'), '../../wp-content/a.css');
  assert.equal(E.relLink('blog/hola/index.html', 'index.html'), '../../index.html');
  assert.equal(E.relLink('a/index.html', 'a b/c.png'), '../a%20b/c.png');
  // nombres peligrosos
  assert.ok(!/[<>:"|?*]/.test(E.localAsset('https://x.org/a/b:c*d.png')));
});

test('límites de dominio: solo la misma web (con o sin www)', () => {
  assert.equal(E.sameSite('https://example.org/a', ORIGIN), true);
  assert.equal(E.sameSite('http://WWW.example.org/a', ORIGIN), true);
  assert.equal(E.sameSite('https://fonts.googleapis.com/css', ORIGIN), false);
  assert.equal(E.sameSite('https://example.org.evil.com/a', ORIGIN), false);
  assert.equal(E.sameSite('mailto:a@example.org', ORIGIN), false);
  assert.equal(E.sameSite('javascript:alert(1)', ORIGIN), false);
  assert.equal(E.crawlablePage('https://example.org/wp-admin/x', ORIGIN), false);
  assert.equal(E.crawlablePage('https://example.org/feed/', ORIGIN), false);
  assert.equal(E.crawlablePage('https://example.org/doc.pdf', ORIGIN), false);
  assert.equal(E.crawlablePage('https://example.org/blog/', ORIGIN), true);
  assert.equal(E.crawlablePage('https://otra.com/blog/', ORIGIN), false);
});

const HTML = `<!doctype html><html><head>
<base href="https://www.example.org/">
<link rel="stylesheet" href="/wp-content/themes/astra/style.css?ver=4.1" integrity="sha384-x" crossorigin="anonymous">
<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Lato">
<link rel="canonical" href="https://www.example.org/quienes-somos/">
<link rel="next" href="https://www.example.org/blog/page/2/">
<link rel="icon" href="/favicon.ico">
<style>.h{background:url(/wp-content/uploads/bg.jpg)} @import url("/x.css");</style>
<script src="/wp-includes/js/jquery.js?ver=3"></script>
<script>var s = '<a href="/no-tocar/">x</a>';</script>
<!-- <img src="/comentado.png"> -->
</head><body>
<a href="/quienes-somos/#equipo" class="x">Quiénes somos</a>
<a href="https://otra.com/">externa</a>
<a href="mailto:a@b.c">mail</a><a href="#top">arriba</a>
<img src="/wp-content/uploads/a.jpg" srcset="/wp-content/uploads/a-300.jpg 300w, /wp-content/uploads/a-600.jpg 600w, https://cdn.otra.com/b.jpg 900w" data-src='/wp-content/uploads/lazy.jpg'>
<div style="background-image:url('/wp-content/uploads/inline.png')" data-info='{"a":">"}'></div>
<a href="/blog/?a=1&#038;b=2">q</a>
</body></html>`;

test('extracción de recursos: src, href, srcset, data-src, url() y @import; sin tocar comentarios ni scripts', () => {
  const r = E.extractHtml(HTML, 'https://www.example.org/');
  const rel = (l) => l.map((u) => u.replace('https://www.example.org', '')).sort();
  assert.deepEqual(rel(r.assets), ['/favicon.ico', '/wp-content/themes/astra/style.css?ver=4.1', '/wp-content/uploads/a-300.jpg', '/wp-content/uploads/a-600.jpg', '/wp-content/uploads/a.jpg', '/wp-content/uploads/bg.jpg', '/wp-content/uploads/inline.png', '/wp-content/uploads/lazy.jpg', '/wp-includes/js/jquery.js?ver=3', '/x.css'].concat(['https://fonts.googleapis.com/css?family=Lato', 'https://cdn.otra.com/b.jpg']).sort());
  assert.ok(r.links.includes('https://www.example.org/quienes-somos/'));
  assert.ok(r.links.includes('https://www.example.org/blog/?a=1&b=2'), 'entidades decodificadas');
  assert.deepEqual(r.next, ['https://www.example.org/blog/page/2/']);
  assert.ok(!r.assets.some((u) => /comentado|no-tocar/.test(u)));
  const css = E.extractCss('@import "a.css"; .a{background:url( "img/b.png" )} .b{src:url(../f/x.woff2?v=1) format("woff2")} .c{background:url(data:image/png;base64,AAA)}', 'https://x.org/css/main.css');
  assert.deepEqual(css.sort(), ['https://x.org/css/a.css', 'https://x.org/css/img/b.png', 'https://x.org/f/x.woff2?v=1']);
});

test('reescritura de enlaces: internos a relativos, externos intactos, sin integrity ni <base>', () => {
  const assets = new Map([['https://www.example.org/wp-content/themes/astra/style.css?ver=4.1', 'wp-content/themes/astra/style.css'], ['https://www.example.org/wp-content/uploads/a.jpg', 'wp-content/uploads/a.jpg'], ['https://www.example.org/wp-content/uploads/a-300.jpg', 'wp-content/uploads/a-300.jpg'], ['https://www.example.org/wp-content/uploads/inline.png', 'wp-content/uploads/inline.png'], ['https://www.example.org/wp-content/uploads/bg.jpg', 'wp-content/uploads/bg.jpg']]);
  const pages = new Set(['/quienes-somos', '/blog/page/2']);
  const from = 'blog/hola/index.html';
  const mapper = (abs, kind) => {
    if (!E.sameSite(abs, ORIGIN)) return null;
    const k = abs.split('#')[0];
    const local = kind === 'link' || kind === 'next' ? (pages.has(E.pageKey(k)) ? E.localPage(k) : null) : assets.get(k);
    return local ? E.relLink(from, local) + (abs.includes('#') ? '#' + abs.split('#')[1] : '') : null;
  };
  const out = E.rewriteHtml(HTML, 'https://www.example.org/', mapper);
  assert.match(out, /href="\.\.\/\.\.\/wp-content\/themes\/astra\/style\.css"/);
  assert.doesNotMatch(out, /integrity|crossorigin/);
  assert.doesNotMatch(out, /<base/);
  assert.match(out, /href="\.\.\/\.\.\/quienes-somos\/index\.html#equipo"/);
  assert.match(out, /rel="next" href="\.\.\/page\/2\/index\.html"|rel="next" href="\.\.\/\.\.\/blog\/page\/2\/index\.html"/);
  assert.match(out, /href="https:\/\/otra\.com\/"/);
  assert.match(out, /href="https:\/\/fonts\.googleapis\.com\/css\?family=Lato"/);
  assert.match(out, /href="mailto:a@b\.c"/); assert.match(out, /href="#top"/);
  assert.match(out, /srcset="\.\.\/\.\.\/wp-content\/uploads\/a-300\.jpg 300w, \/wp-content\/uploads\/a-600\.jpg 600w, https:\/\/cdn\.otra\.com\/b\.jpg 900w"/);
  assert.match(out, /url\("\.\.\/\.\.\/wp-content\/uploads\/bg\.jpg"\)/);
  assert.match(out, /style="background-image:url\(&quot;\.\.\/\.\.\/wp-content\/uploads\/inline\.png&quot;\)"/);
  assert.match(out, /data-info='\{"a":">"\}'/, 'atributos con > intactos');
  assert.match(out, /<a href="\/no-tocar\/">x<\/a>/, 'el contenido de los scripts no se toca');
  assert.match(out, /<!-- <img src="\/comentado\.png"> -->/);
});

test('filtrado de opciones sensibles: JS y la lista del PHP son la misma', () => {
  for (const n of ['astra-license-key', 'uag_api_TOKEN', 'spectra_secret', 'astra_password', 'mailchimp_pass', 'License', 'bypass_x', 'api_key']) assert.equal(E.isSensitiveName(n), true, n);
  for (const n of ['astra-settings', 'uag_enable_beta', 'spectra_blocks', 'theme-color', 'header-layout']) assert.equal(E.isSensitiveName(n), false, n);
  const php = fs.readFileSync(path.join(__dirname, '..', 'wp-plugin', 'ecos', 'includes', 'export.php'), 'utf8');
  const m = /define\( 'ECOS_WP_SENSITIVE_RE', '\/(.+)\/i' \)/.exec(php);
  assert.ok(m, 'patrón en el PHP');
  assert.equal(m[1], E.SENSITIVE_RE.source);
  assert.equal(E.SENSITIVE_RE.flags, 'i');
  assert.match(php, /permission_callback[\s\S]*manage_options/);
  const clean = E.scrub({ a: 1, api_key: 'x', nested: { License: 'y', ok: [{ token: 't', v: 2 }] } });
  assert.deepEqual(clean, { a: 1, nested: { ok: [{ v: 2 }] } });
  try { require('child_process').execFileSync('php', ['-l', path.join(__dirname, '..', 'wp-plugin', 'ecos', 'includes', 'export.php')], { stdio: 'pipe' }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
});

test('rotación y calendario de copias', () => {
  const dir = tmp();
  const mk = (name, ageDays) => { const f = path.join(dir, name); fs.writeFileSync(f, 'x'.repeat(10)); const t = new Date(Date.now() - ageDays * 864e5); fs.utimesSync(f, t, t); };
  mk('ecos-emergencia-web-2026-01-01-0900.zip', 50); mk('ecos-emergencia-web-2026-02-01-0900.zip', 40); mk('ecos-emergencia-web-2026-03-01-0900.zip', 30);
  mk('ecos-emergencia-web-2026-04-01-0900.zip', 20); mk('ecos-emergencia-web-2026-05-01-0900.zip', 10);
  fs.writeFileSync(path.join(dir, 'otro.zip'), 'no tocar'); fs.writeFileSync(path.join(dir, 'ecos-emergencia-web-2026-06-01-0900.zip.partial'), 'a medias');
  const l = E.listCopies(dir);
  assert.equal(l.length, 5); assert.equal(l[0].name, 'ecos-emergencia-web-2026-05-01-0900.zip'); assert.equal(l[0].bytes, 10);
  assert.deepEqual(E.pickRotation(l, 4), ['ecos-emergencia-web-2026-01-01-0900.zip']);
  assert.equal(E.pickRotation(l, 0).length, 4, 'siempre se conserva al menos una');
  assert.deepEqual(E.rotate(dir, 3), ['ecos-emergencia-web-2026-02-01-0900.zip', 'ecos-emergencia-web-2026-01-01-0900.zip']);
  assert.ok(fs.existsSync(path.join(dir, 'otro.zip')));
  assert.equal(E.cleanPartials(dir), 1);
  assert.match(E.copyName('www.Asociacion-Elin.com', new Date(2026, 10, 3, 9, 5)), /^ecos-emergencia-asociacion-elin\.com-2026-11-03-0905\.zip$/);
  const now = Date.now();
  assert.equal(E.shouldAutoRun({ auto: 'never', lastCopyAt: 0, now }), false);
  assert.equal(E.shouldAutoRun({ auto: 'weekly', lastCopyAt: 0, now }), true);
  assert.equal(E.shouldAutoRun({ auto: 'weekly', lastCopyAt: now - 3 * 864e5, now }), false);
  assert.equal(E.shouldAutoRun({ auto: 'weekly', lastCopyAt: now - 8 * 864e5, now }), true);
  assert.equal(E.shouldAutoRun({ auto: 'monthly', lastCopyAt: now - 20 * 864e5, now }), false);
  assert.equal(E.shouldAutoRun({ auto: 'monthly', lastCopyAt: now - 31 * 864e5, now }), true);
  assert.equal(E.shouldAutoRun({ auto: 'weekly', lastCopyAt: now - 30 * 864e5, lastAttempt: now - 3600e3, lastFailed: true, now }), false, 'tras un fallo espera');
  assert.equal(E.shouldAutoRun({ auto: 'weekly', lastCopyAt: now - 30 * 864e5, lastAttempt: now - 7 * 3600e3, lastFailed: true, now }), true);
  assert.equal(E.staleDays(now - 31 * 864e5, now), 31); assert.equal(E.staleDays(0, now), null);
});

test('PHP serializado para el .dat del personalizador', () => {
  assert.equal(E.phpSerialize({ a: 1, b: [true, null, 'ñ'], c: 1.5 }), 'a:3:{s:1:"a";i:1;s:1:"b";a:3:{i:0;b:1;i:1;N;i:2;s:2:"ñ";}s:1:"c";d:1.5;}');
  const dat = E.customizerDat({ theme: { stylesheet: 'astra' }, theme_mods: { custom_logo: 12 }, options: { 'astra-settings': { 'site-layout': 'ast-full-width-layout' } }, custom_css: 'a{}' });
  assert.match(dat, /s:8:"template";s:5:"astra";/); assert.match(dat, /astra-settings\[site-layout\]/);
});

// ---------------------------------------------------------------- servidor de prueba: 3 páginas + CSS + imagen
function startServer() {
  const hits = [];
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const page = (title, body) => `<!doctype html><html><head><title>${title}</title><link rel="stylesheet" href="/wp-content/style.css?ver=1"><script src="/wp-content/app.js"></script></head><body><nav><a href="/">Inicio</a> <a href="/acerca/">Acerca</a> <a href="/blog/">Blog</a></nav>${body}<img src="/wp-content/logo.png" srcset="/wp-content/logo.png 1x, /wp-content/big.png 2x"><a href="https://externa.example.net/x">fuera</a></body></html>`;
  const routes = {
    '/': () => ['text/html', page('Inicio', '<h1>Inicio</h1><a href="/acerca/#eq">equipo</a><a href="/blog/page/2/">más</a>')],
    '/acerca/': () => ['text/html', page('Acerca', '<h1>Acerca</h1><a href="/">volver</a>')],
    '/blog/': () => ['text/html', page('Blog', '<h1>Blog</h1><link rel="next" href="/blog/page/2/"><a href="/blog/page/2/">2</a>')],
    '/blog/page/2/': () => ['text/html', page('Blog 2', '<h1>Blog 2</h1><a href="/blog/">1</a>')],
    '/wp-content/style.css': () => ['text/css', '@import url("/wp-content/more.css");body{background:url(logo.png)} @font-face{src:url("fonts/f.woff2?v=2")} .x{background:url(https://externa.example.net/bg.png)}'],
    '/wp-content/more.css': () => ['text/css', '@import "style.css"; .m{background:url(../wp-content/logo.png)}'],
    '/wp-content/app.js': () => ['application/javascript', 'console.log(1)'],
    '/wp-content/logo.png': () => ['image/png', PNG],
    '/wp-content/big.png': () => ['image/png', Buffer.alloc(3000, 7)],
    '/wp-content/fonts/f.woff2': () => ['font/woff2', Buffer.from('woff')],
  };
  let flaky = 0;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push(u.pathname);
    if (u.pathname === '/wp-content/app.js' && flaky++ < 2) { res.statusCode = 503; return res.end('busy'); } // reintentos
    const r = routes[u.pathname];
    if (!r) { res.statusCode = 404; return res.end('no'); }
    const [type, body] = r();
    res.setHeader('Content-Type', type); res.end(body);
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, hits, origin: `http://127.0.0.1:${srv.address().port}` })));
}
async function zipEntries(file) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true }, (e, zf) => {
    if (e) return reject(e);
    const out = new Map(); zf.readEntry();
    zf.on('entry', (en) => zf.openReadStream(en, (er, st) => { if (er) return reject(er); const c = []; st.on('data', (d) => c.push(d)); st.on('end', () => { out.set(en.fileName, Buffer.concat(c)); zf.readEntry(); }); }));
    zf.on('end', () => resolve(out)); zf.on('error', reject);
  }));
}

test('copia de emergencia completa con un servidor local: contenido, visual, configuración y guía', async () => {
  const { srv, hits, origin } = await startServer();
  const dir = tmp();
  try {
    const listAll = async (route) => {
      if (/\/wp\/v2\/(posts|pages)\?.*_fields=id,link/.test(route)) return route.includes('/pages') ? [{ id: 2, link: origin + '/acerca/' }] : [{ id: 3, link: origin + '/blog/' }];
      if (/\/wp\/v2\/(posts|pages)\?/.test(route)) return [{ id: 1, title: { raw: 'Hola' }, content: { raw: '<p>x</p>' }, excerpt: { raw: '' }, date: '2026-01-01T10:00:00', date_gmt: '2026-01-01T10:00:00', status: 'publish', slug: 'hola', categories: [], tags: [], featured_media: 0, link: origin + '/hola/' }];
      if (/categories/.test(route)) return [{ id: 1, name: 'Blog', slug: 'blog', parent: 0, count: 3, link: origin + '/blog/' }];
      if (/tags/.test(route)) return [];
      if (/menus\?/.test(route)) return [{ id: 7, name: 'Principal', slug: 'principal', locations: ['primary'] }];
      if (/menu-items/.test(route)) return [{ id: 70, title: { rendered: 'Inicio' }, url: origin + '/', parent: 0, menu_order: 1, menus: 7 }];
      if (/users/.test(route)) return [{ id: 1, name: 'Ana', slug: 'ana', roles: ['administrator'], email: 'ana@example.org' }];
      if (/templates|template-parts|blocks/.test(route)) throw new Error('rest_no_route');
      if (/pages/.test(route)) return [{ id: 2, title: { rendered: 'Acerca' }, parent: 0, slug: 'acerca', status: 'publish', link: origin + '/acerca/' }];
      return [];
    };
    const exp = { plugin: 'ecos', version: '1.3.0', site: { name: 'Web', wordpress: '6.8', php: '8.2.1', permalinks: '/%postname%/', language: 'es_ES' }, theme: { stylesheet: 'astra', template: 'astra', name: 'Astra', version: '4.8.0' },
      theme_mods: { custom_logo: 5, license_key: 'SECRETO' }, custom_css: '.a{color:red}', widgets: { sidebars_widgets: {} }, options: { 'astra-settings': { 'site-layout': 'x', api_key: 'SECRETO' } },
      plugins: [{ name: 'Spectra', version: '2.0', active: true, file: 'ultimate-addons-for-gutenberg/x.php' }], themes: [{ name: 'Astra', stylesheet: 'astra', version: '4.8.0', parent: '', active: true }] };
    const progress = [];
    const r = await E.runEmergency({
      siteName: 'Web de prueba', siteUrl: origin, media: [{ id: 9, url: origin + '/wp-content/uploads/2026/01/f.png', name: 'f', mime: 'image/png', date: '2026-01-01T00:00:00' }],
      listAll, getJson: async (route) => (route === '/wp/v2/settings' ? { title: 'Web', language: 'es_ES' } : route === '/wp/v2/menu-locations' ? { primary: { name: 'Principal' } } : (() => { throw new Error('404'); })()),
      exportData: async () => exp, me: { roles: ['administrator'] }, ecosVersion: '9.9.9',
      download: async (u) => (u.endsWith('f.png') ? Buffer.from('PNGDATA') : null),
    }, { dir, keep: 2, delayMs: 0, onProgress: (p) => progress.push(p.phase) });
    assert.equal(r.posts, 1); assert.equal(r.pages, 1); assert.equal(r.photos, 1); assert.equal(r.photosMissing, 0);
    assert.equal(r.visualPages, 4, 'portada, acerca, blog y blog/page/2'); // 2 de ellas descubiertas por paginación
    assert.ok(fs.existsSync(r.file) && !fs.existsSync(r.file + '.partial'));
    assert.deepEqual([...new Set(progress)], ['contenido', 'configuracion', 'visual', 'guia', 'guardar']);
    const z = await zipEntries(r.file);
    const names = [...z.keys()];
    for (const n of ['LEEME.html', 'copia.json', 'contenido/ecos-copia-de-seguridad.xml', 'visual/index.html', 'visual/acerca/index.html', 'visual/blog/index.html', 'visual/blog/page/2/index.html', 'visual/wp-content/style.css', 'visual/wp-content/more.css', 'visual/wp-content/app.js', 'visual/wp-content/logo.png', 'visual/wp-content/big.png', 'visual/wp-content/fonts/f.woff2',
      'configuracion/ajustes-wordpress.json', 'configuracion/menus.json', 'configuracion/paginas.json', 'configuracion/categorias.json', 'configuracion/etiquetas.json', 'configuracion/usuarios.json', 'configuracion/personalizador-theme_mods.json', 'configuracion/personalizador-astra.dat', 'configuracion/css-adicional.css', 'configuracion/widgets.json', 'configuracion/opciones-astra-spectra.json', 'configuracion/plugins.json', 'configuracion/temas.json', 'configuracion/sistema.json', 'configuracion/avisos.json']) assert.ok(names.includes(n), 'falta ' + n + ' en ' + names.join(', '));
    assert.ok(names.includes('contenido/uploads/2026/01/f.png'), 'la foto va en contenido/uploads');
    const idx = z.get('visual/index.html').toString();
    assert.match(idx, /href="acerca\/index\.html#eq"/); assert.match(idx, /href="wp-content\/style\.css"/); assert.match(idx, /src="wp-content\/logo\.png"/);
    assert.match(idx, /href="https:\/\/externa\.example\.net\/x"/); assert.match(idx, /srcset="wp-content\/logo\.png 1x, wp-content\/big\.png 2x"/);
    assert.match(z.get('visual/blog/page/2/index.html').toString(), /href="\.\.\/\.\.\/index\.html"/);
    const css = z.get('visual/wp-content/style.css').toString();
    assert.match(css, /@import url\("more\.css"\)/); assert.match(css, /url\("logo\.png"\)/); assert.match(css, /url\("fonts\/f\.woff2"\)/); assert.match(css, /url\("https:\/\/externa\.example\.net\/bg\.png"\)|url\(https:\/\/externa\.example\.net\/bg\.png\)/);
    assert.match(z.get('visual/wp-content/more.css').toString(), /@import "style\.css"/);
    assert.equal(z.get('visual/wp-content/app.js').toString(), 'console.log(1)', 'tras dos 503 el reintento funciona');
    assert.equal(hits.filter((h) => h === '/wp-content/logo.png').length, 1, 'cada recurso se baja una sola vez');
    assert.ok(!hits.some((h) => /externa|no-existe/.test(h)));
    // configuración sin secretos
    const all = [...z.entries()].filter(([n]) => n.startsWith('configuracion/')).map(([, b]) => b.toString()).join('\n');
    assert.ok(!all.includes('SECRETO'), 'sin claves');
    assert.match(z.get('configuracion/personalizador-theme_mods.json').toString(), /custom_logo/);
    assert.match(z.get('configuracion/usuarios.json').toString(), /ana@example\.org/);
    assert.equal(z.get('configuracion/css-adicional.css').toString(), '.a{color:red}');
    const guide = z.get('LEEME.html').toString();
    assert.match(guide, /Astra/); assert.match(guide, /6\.8/); assert.match(guide, /Spectra/); assert.match(guide, /Herramientas → Importar/); assert.match(guide, /visual<\/code>/); assert.match(guide, /Web de prueba/);
    assert.match(z.get('contenido/ecos-copia-de-seguridad.xml').toString(), /<wp:wxr_version>1\.2/);
    // visual extraído y navegable desde disco
    const out = tmp();
    const index = await E.extractVisual(r.file, out);
    assert.ok(fs.existsSync(index) && fs.existsSync(path.join(out, 'wp-content', 'logo.png')));
    // rotación: la 3ª copia borra la más antigua
    for (let i = 0; i < 2; i++) { await E.runEmergency({ siteName: 'W', siteUrl: origin, media: [], listAll: async () => [], getJson: async () => null, exportData: null, download: async () => null }, { dir, keep: 2, delayMs: 0, name: `ecos-emergencia-x-2026-0${i + 1}-01-1000.zip` }); }
    assert.equal(E.listCopies(dir).length, 2);
  } finally { srv.close(); }
});

test('límites: máximo de páginas, recursos grandes y cancelación', async () => {
  const { srv, origin } = await startServer();
  try {
    const mkZip = () => { const f = path.join(tmp(), 'v.zip'); return { f, zip: new (require('../src/backupcreate').ZipWriter)(f) }; };
    let { f, zip } = mkZip();
    let r = await E.crawlVisual({ origin, seeds: [origin + '/', origin + '/acerca/', origin + '/blog/'], zip, maxPages: 2, delayMs: 0 });
    await zip.finish();
    assert.equal(r.pages, 2); assert.equal(r.truncated, 1);
    ({ f, zip } = mkZip());
    r = await E.crawlVisual({ origin, seeds: [origin + '/'], zip, maxAsset: 2000, delayMs: 0 });
    await zip.finish();
    assert.equal(r.tooBig, 1, 'big.png (3000 B) supera el límite'); assert.ok(!(await zipEntries(f)).has('visual/wp-content/big.png'));
    ({ zip } = mkZip());
    let n = 0;
    await assert.rejects(E.crawlVisual({ origin, seeds: [origin + '/'], zip, delayMs: 0, cancelled: () => ++n > 3 }), /Cancelado/);
  } finally { srv.close(); }
});
