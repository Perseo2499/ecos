// Pruebas automáticas de Ecos (node --test). Comprueban las piezas que más se pueden romper sin que se note:
// la conversión a bloques de WordPress, la lectura de copias de seguridad, la limpieza de contenido y la seguridad.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../src/transform');
const P = require('../src/parseblocks');
const V = require('../src/vault');
const B = require('../src/backup');

const norm = (h) => h.replace(/ecos-[cm]-[a-z0-9]+/g, 'ID');

test('bloques de Ecos → WordPress → bloques de Ecos: ida y vuelta exacta', () => {
  const blocks = [
    { id: 'a', type: 'heading', level: 3, html: 'Título <strong>x</strong>', align: 'center', color: '#c00' },
    { id: 'b', type: 'paragraph', html: 'Hola <em>mundo</em>', dropCap: true, font: 'serif', size: '22px' },
    { id: 'c', type: 'list', ordered: true, items: ['uno', 'dos'] },
    { id: 'd', type: 'quote', html: 'Cita', cite: 'Ana' },
    { id: 'e', type: 'image', img: { id: 5, url: 'https://x/a.jpg', alt: 'alt' }, caption: 'pie' },
    { id: 'f', type: 'gallery', images: [{ id: 6, url: 'https://x/b.jpg', alt: '' }, { id: 7, url: 'https://x/c.jpg', alt: 'c' }], columns: 2 },
    { id: 'g', type: 'carousel', images: [{ id: 8, url: 'https://x/d.jpg', alt: '' }, { id: 9, url: 'https://x/e.jpg', alt: '' }] },
    { id: 'h', type: 'gallery', layout: 'mosaic', images: [{ id: 10, url: 'https://x/f.jpg' }, { id: 11, url: 'https://x/g.jpg' }] },
    { id: 'i', type: 'embed', url: 'https://youtu.be/dQw4w9WgXcQ', provider: 'youtube' },
    { id: 'j', type: 'table', head: true, rows: [['A', 'B'], ['1', '2']] },
    { id: 'k', type: 'buttons', html: 'Únete', url: 'https://x', align: 'center', variant: 'outline' },
    { id: 'l', type: 'separator' }, { id: 'm', type: 'spacer', height: 80 },
    { id: 'n', type: 'details', summary: 'Más', html: 'texto' },
    { id: 'o', type: 'video', video: { id: 3, url: 'https://x/v.mp4' } },
  ];
  const html = T.composeBlocks(blocks);
  const back = P.parseBlocks(html);
  assert.deepEqual(back.map((b) => b.type), ['heading', 'paragraph', 'list', 'quote', 'image', 'gallery', 'carousel', 'gallery', 'embed', 'table', 'buttons', 'separator', 'spacer', 'details', 'video']);
  assert.equal(norm(T.composeBlocks(back)), norm(html));
});

test('los bloques desconocidos de WordPress se conservan intactos', () => {
  const raw = '<!-- wp:columns -->\n<div class="wp-block-columns"><!-- wp:column --><div>x</div><!-- /wp:column --></div>\n<!-- /wp:columns -->';
  const back = P.parseBlocks(raw);
  assert.equal(back[0].type, 'raw');
  assert.equal(T.composeBlocks(back), raw);
});

test('HTML clásico (copias, editor clásico) → bloques editables sin perder texto', () => {
  const html = '<h2>Quiénes somos</h2>\n<p style="text-align:center">Somos <strong>Elín</strong>.</p>\n<ul><li>Uno</li><li>Dos</li></ul>\n<p>https://www.youtube.com/watch?v=dQw4w9WgXcQ</p>\n<figure><img src="https://x/a.jpg" class="wp-image-12"/><figcaption>Pie</figcaption></figure>\nTexto suelto\n\nOtro párrafo';
  const b = P.parseBlocks(html);
  assert.deepEqual(b.map((x) => x.type), ['heading', 'paragraph', 'list', 'embed', 'image', 'paragraph', 'paragraph']);
  assert.equal(b[1].align, 'center');
  assert.equal(b[4].img.id, 12);
  assert.equal(b[4].caption, 'Pie');
});

test('el texto que se escribe en el editor se limpia (sin etiquetas ni enlaces peligrosos)', () => {
  const [p] = T.sanitizeParagraphs('<p onclick="x()">Hola <a href="javascript:alert(1)">a</a> <script>mal()</script><b>ok</b></p>');
  assert.ok(!/onclick|javascript|<script/i.test(p), p);
  assert.match(p, /<strong>ok<\/strong>/);
});

test('las copias de una web infectada se limpian al restaurarlas', () => {
  const evil = '<p onclick="steal()">Hola</p><script>document.location="//malo"</script><iframe src="https://malo.ru/x"></iframe><iframe src="https://www.youtube.com/embed/abc"></iframe><a href="javascript:alert(1)">x</a><form action="https://malo"><input name=p></form>';
  const { html } = B.sanitizeRestored(evil);
  assert.ok(!/script|onclick|malo|javascript|<form|<input/i.test(html), html);
  assert.match(html, /youtube\.com\/embed\/abc/); // los vídeos conocidos se quedan
});

test('una copia partida en varios .xml se lee entera y sin duplicados', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-test-'));
  const item = (id, type, title, extra = '') => `<item><title><![CDATA[${title}]]></title><wp:post_id>${id}</wp:post_id><wp:post_type><![CDATA[${type}]]></wp:post_type><wp:status><![CDATA[publish]]></wp:status><wp:post_date><![CDATA[2020-01-0${id % 9 + 1} 10:00:00]]></wp:post_date><wp:post_name><![CDATA[e${id}]]></wp:post_name><content:encoded><![CDATA[<p>Texto ${id}</p>]]></content:encoded>${extra}</item>`;
  const wxr = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><wp:wxr_version>1.2</wp:wxr_version><wp:base_blog_url>https://ejemplo.org</wp:base_blog_url>${items}</channel></rss>`;
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  zip.addFile('copia/01-paginas.xml', Buffer.from(wxr(item(1, 'page', 'Inicio'))));
  zip.addFile('copia/02-entradas.xml', Buffer.from(wxr(item(2, 'post', 'Una') + item(3, 'post', 'Dos'))));
  zip.addFile('copia/todo.xml', Buffer.from(wxr(item(1, 'page', 'Inicio') + item(2, 'post', 'Una') + item(3, 'post', 'Dos'))));
  const file = path.join(dir, 'copia.zip');
  zip.writeZip(file);
  const an = await B.analyze([file]);
  assert.equal(an.stats.posts, 2);
  assert.equal(an.stats.pages, 1);
  an.sources.forEach((s) => s.close());
  fs.rmSync(dir, { recursive: true, force: true });
});

test('doble factor: códigos TOTP como Google Authenticator (vectores de la RFC 6238)', () => {
  const secret = V.base32(Buffer.from('12345678901234567890'));
  assert.equal(V.totp(secret, 59000), '287082');
  assert.equal(V.totp(secret, 1111111109000), '081804');
  assert.ok(V.checkTotp(secret, V.totp(secret, Date.now())));
  assert.ok(!V.checkTotp(secret, '000000', 59000));
});

test('bóveda: solo se abre con la contraseña correcta', () => {
  const salt = '00112233445566778899aabbccddeeff';
  const blob = V.encrypt({ wpAppPassword: 'secreto' }, V.deriveKey('buena-clave', salt));
  assert.deepEqual(V.decrypt(blob, V.deriveKey('buena-clave', salt)), { wpAppPassword: 'secreto' });
  assert.throws(() => V.decrypt(blob, V.deriveKey('mala-clave', salt)));
  assert.equal(V.hashCode('abcde-12345'), V.hashCode('ABCDE12345')); // códigos de recuperación sin importar guiones ni mayúsculas
});

test('carrusel: flechas y contador en la propia entrada (funciona aunque WordPress quite el script)', () => {
  const html = T.composeBlocks([{ id: 'c1', type: 'carousel', images: [{ id: 1, url: 'a.jpg' }, { id: 2, url: 'b.jpg' }, { id: 3, url: 'c.jpg' }] }]);
  const sinScript = html.replace(/<script>[\s\S]*?<\/script>/, '').replace(/<style>[\s\S]*?<\/style>/, '');
  assert.equal((sinScript.match(/class="ec-sbtn"/g) || []).length, 6);
  assert.match(sinScript, /1 \/ 3/);
  const js = html.split('<script>')[1].split('</script>')[0];
  assert.doesNotThrow(() => new Function(js)); // el código va en una línea válida
});

test('la IA por CLI: se extrae el JSON aunque venga envuelto', () => {
  const { extractJson } = require('../src/clirun');
  assert.deepEqual(extractJson('Aquí tienes:\n```json\n{"ok": true}\n```'), { ok: true });
});

test('normalizar formato: corrige el formato sin cambiar el texto', () => {
  const N = require('../renderer/normalize');
  let i = 0; const create = (type, extra = {}) => ({ id: 'n' + i++, type, ...extra });
  const blocks = [
    { id: 'a', type: 'heading', level: 4, html: 'El pasado sábado celebramos el CARNAVAL en Ceuta.' },
    { id: 'b', type: 'paragraph', html: '<span style="color:red">TEXTO TODO EN MAYÚSCULAS QUE GRITA</span>', color: '#f00', size: '28px' },
    { id: 'c', type: 'paragraph', html: '<strong>Lo que hicimos</strong>' },
    { id: 'd', type: 'paragraph', html: '- Talleres<br>- Encuentros' },
    { id: 'e', type: 'image', img: { id: 1, url: 'a.jpg' }, caption: '' },
    { id: 'f', type: 'image', img: { id: 2, url: 'b.jpg' }, caption: '' },
    { id: 'g', type: 'image', img: { id: 3, url: 'c.jpg' }, caption: '' },
    { id: 'h', type: 'separator' }, { id: 'i', type: 'separator' },
  ];
  const r = N.normalizeBlocks(blocks, create);
  assert.deepEqual(r.blocks.map((b) => b.type + (b.level || '')), ['paragraph', 'paragraph', 'heading2', 'list', 'gallery']);
  assert.equal(r.blocks[1].html, 'Texto todo en mayúsculas que grita');
  assert.equal(r.blocks[1].color, undefined);
  assert.deepEqual(r.blocks[3].items, ['Talleres', 'Encuentros']);
  assert.equal(r.blocks[4].images.length, 3);
  assert.equal(N.normalizeBlocks(r.blocks, create).changes, 0); // aplicarlo dos veces no cambia nada más
});

test('carrusel en la web propia: galería de Spectra que se lee de vuelta como carrusel', () => {
  const { parseBlocks } = require('../src/parseblocks');
  const html = T.composeBlocks([{ id: 'c1', type: 'carousel', images: [{ id: 1, url: 'a.jpg', alt: 'uno' }, { id: 2, url: 'b.jpg', alt: '' }] }], { spectra: true });
  assert.match(html, /^<!-- wp:uagb\/image-gallery \{.*"feedLayout":"carousel".*\} \/-->$/);
  const back = parseBlocks(html);
  assert.equal(back.length, 1);
  assert.equal(back[0].type, 'carousel');
  assert.deepEqual(back[0].images.map((i) => i.id), [1, 2]);
});

test('mosaico: se adapta al número de piezas sin huecos y admite vídeos', () => {
  const { mosaicLayout } = require('../renderer/mosaic');
  for (let n = 2; n <= 16; n++) {
    const { cells, rows } = mosaicLayout(n);
    assert.equal(cells.length, n);
    const used = new Set();
    for (const c of cells) for (let r = c.row; r < c.row + c.rows; r++) for (let k = c.col; k < c.col + c.cols; k++) { assert.ok(!used.has(r + ':' + k), `solape con ${n}`); used.add(r + ':' + k); }
    assert.equal(used.size, rows * 6, `huecos con ${n}`);
  }
  const { parseBlocks } = require('../src/parseblocks');
  const items = [{ id: 1, url: 'a.jpg', alt: '' }, { type: 'video', id: 5, url: 'v.mp4' }, { id: 2, url: 'b.jpg', alt: '' }];
  const back = parseBlocks(T.composeBlocks([{ id: 'm1', type: 'gallery', layout: 'mosaic', images: items }]))[0];
  assert.equal(back.layout, 'mosaic');
  assert.deepEqual(back.images.map((i) => i.type || 'image'), ['image', 'video', 'image']);
  const grid = parseBlocks(T.composeBlocks([{ id: 'g1', type: 'gallery', columns: 2, images: items }]))[0];
  assert.equal(grid.columns, 2);
  assert.equal(grid.images[1].url, 'v.mp4');
  // el carrusel solo lleva fotos; el estilo se conserva
  const car = parseBlocks(T.composeBlocks([{ id: 'c2', type: 'carousel', view: 'peek', squares: true, images: items }], { spectra: true }))[0];
  assert.equal(car.images.length, 2);
  assert.equal(car.view, 'peek');
  assert.equal(car.squares, true);
});

test('biblioteca de medios: detección de fotos usadas', () => {
  const W = require('../src/wpself');
  const media = [
    { id: 1, source_url: 'https://x.org/wp-content/uploads/2024/05/playa.jpg' },
    { id: 2, source_url: 'https://x.org/wp-content/uploads/2024/05/mar-scaled.jpg' },
    { id: 3, source_url: 'https://x.org/wp-content/uploads/2024/05/playa2.jpg' },
    { id: 4, source_url: 'https://x.org/wp-content/uploads/2024/05/destacada.png' },
    { id: 5, source_url: 'https://x.org/wp-content/uploads/2024/05/galeria.jpg' },
    { id: 6, source_url: 'https://x.org/wp-content/uploads/2024/05/libre.jpg' },
    { id: 7, source_url: 'https://x.org/wp-content/uploads/2024/05/clase.jpg' },
  ];
  const posts = [
    { id: 10, title: { raw: 'Viaje' }, featured_media: 4, content: { raw: '<!-- wp:image {"id":5} --><figure><img src="https://www.x.org/wp-content/uploads/2024/05/playa-300x200.jpg"></figure><!-- /wp:image -->' } },
    { id: 11, title: { raw: 'Otra' }, featured_media: 0, content: { raw: '<img class="wp-image-7" src="a"><img src="http://x.org/wp-content/uploads/2024/05/mar-1024x768.jpg">' } },
  ];
  const u = W.usedMediaIds(posts, media);
  assert.deepEqual(Object.keys(u).sort(), ['1', '2', '4', '5', '7']);
  assert.equal(u[4][0].title, 'Viaje');
  assert.equal(u[2][0].id, 11);
  assert.equal(u[3], undefined); // playa2 no es playa
  assert.equal(u[6], undefined);
});

test('buscar y reemplazar: solo el texto visible, sin tocar etiquetas ni atributos', () => {
  const F = require('../renderer/findreplace');
  const html = '<p>Una img <img src="a.png" alt="img"> y <a href="/x">href</a> &amp; más Img</p>';
  assert.deepEqual(F.replaceInHtml(html, 'img', 'foto'), { html: '<p>Una foto <img src="a.png" alt="img"> y <a href="/x">href</a> &amp; más foto</p>', count: 2 });
  assert.equal(F.replaceInHtml(html, 'href', 'enlace').html, html.replace('>href<', '>enlace<'));
  assert.equal(F.replaceInHtml(html, 'img', 'foto', { caseSensitive: true }).count, 1);
  assert.equal(F.replaceInHtml('<p>casa casas Casa</p>', 'casa', 'X', { wholeWord: true }).html, '<p>X casas X</p>');
  assert.equal(F.replaceInHtml('<p>Tom &amp; Jerry</p>', 'Tom & Jerry', 'A<B').html, '<p>A&lt;B</p>');
  assert.equal(F.countInHtml('<p>a<b>b</b>a</p>', 'a'), 2);
  const blocks = [
    { id: 'a', type: 'paragraph', html: 'Hola mundo' }, { id: 'b', type: 'list', items: ['mundo', 'nada'] },
    { id: 'c', type: 'image', img: { alt: 'un mundo' }, caption: '<em>mundo</em>' }, { id: 'd', type: 'table', rows: [['x', 'mundo']] },
  ];
  const hits = F.findInBlocks(blocks, 'mundo');
  assert.deepEqual(hits.map((h) => h.blockId + h.field), ['ahtml', 'bitems', 'ccaption', 'calt', 'drows']);
  assert.equal(F.replaceInBlocks(blocks, 'mundo', 'sol', {}, hits[1]).count, 1);
  assert.equal(blocks[1].items[0], 'sol'); assert.equal(blocks[0].html, 'Hola mundo');
  assert.equal(F.replaceInBlocks(blocks, 'mundo', 'sol').count, 4);
});

test('tablas de maquetación (foto + pie) de entradas antiguas: imagen con su pie', () => {
  const { parseBlocks } = require('../src/parseblocks');
  const html = '<p>Intro</p><table><tbody><tr><td style="text-align:center"><a href="x.jpg"><img src="https://x/f.jpg" alt=""></a></td></tr><tr><td><span>Adama y su compañero<br>un «dúo dinámico».</span></td></tr></tbody></table><p><strong>Otra cosa</strong></p>';
  const b = parseBlocks(html);
  assert.deepEqual(b.map((x) => x.type), ['paragraph', 'image', 'paragraph']);
  assert.equal(b[1].img.url, 'https://x/f.jpg');
  assert.match(b[1].caption, /Adama y su compañero<br>un «dúo dinámico»\./);
  // tabla de WordPress (bloque) con foto dentro
  const wp = '<!-- wp:table --><figure class="wp-block-table"><table><tbody><tr><td><img src="https://x/g.jpg"></td></tr><tr><td>Pie</td></tr></tbody></table></figure><!-- /wp:table -->';
  const b2 = parseBlocks(wp);
  assert.deepEqual(b2.map((x) => x.type + ':' + (x.caption || '')), ['image:Pie']);
  // una tabla de datos sigue siendo tabla
  assert.equal(parseBlocks('<table><tr><td>a</td><td>b</td></tr></table>')[0].type, 'table');
});

test('las fotos se amplían al pulsarlas y las fotos sin número no rompen el bloque', () => {
  const html = T.composeBlocks([{ id: 'i', type: 'image', img: { id: 7, url: 'https://x/a.jpg', alt: '' }, caption: '' }, { id: 'j', type: 'image', img: { id: 'https://x/b.jpg', url: 'https://x/b.jpg', alt: '' }, caption: '' }]);
  const attrs = [...html.matchAll(/<!-- wp:image (\{.*?\}) -->/g)].map((m) => JSON.parse(m[1]));
  assert.equal(attrs.length, 2);
  assert.deepEqual(attrs[0].lightbox, { enabled: true });
  assert.equal(attrs[0].id, 7);
  assert.equal(attrs[1].id, undefined);
  const back = require('../src/parseblocks').parseBlocks(html);
  assert.deepEqual(back.map((b) => b.img.url), ['https://x/a.jpg', 'https://x/b.jpg']);
  const mos = require('../src/parseblocks').parseBlocks(T.composeBlocks([{ id: 'm', type: 'gallery', layout: 'mosaic', images: [{ id: 1, url: 'a.jpg' }, { id: 2, url: 'b.jpg' }] }]))[0];
  assert.equal(mos.images.length, 2);
});

test('restaurar: reconoce entradas que ya están en la web aunque cambie la escritura', () => {
  const W = require('../src/wpself');
  const index = [
    { id: 1, slug: 'acompanamiento-de-inmigrantes', title: W.normTitle('Acompañamiento de inmigrantes'), day: '2011-11-05', status: 'draft' },
    { id: 2, slug: '', title: W.normTitle('VOLUNTARIADO EN NAVIDAD'), day: '2011-11-03', status: 'draft' },
    { id: 3, slug: 'otra', title: W.normTitle('Encuentros festivos'), day: '2011-11-04', status: 'draft' },
  ];
  assert.equal(W.matchExisting(index, { slug: 'acompa%C3%B1amiento-de-inmigrantes', title: 'x', date: '2011-11-05 10:00:00' })?.id, undefined); // otra dirección y otro título
  assert.equal(W.matchExisting(index, { slug: '', title: 'Acompañamiento  de inmigrantes', date: '2011-11-05 10:00:00' }).id, 1);
  assert.equal(W.matchExisting(index, { slug: 'voluntariado-en-navidad', title: 'Voluntariado en Navidad', date: '2011-11-03 09:00:00' }).id, 2);
  assert.equal(W.matchExisting(index, { slug: 'otra', title: 'Nada que ver', date: '' }).id, 3);
  assert.equal(W.matchExisting(index, { slug: 'nueva', title: 'Nueva entrada', date: '2020-01-01' }), null);
});

// ---- Revisar enlaces (src/links.js) con un fetch simulado: sin red real
const LK = require('../src/links');
const fakeFetch = (routes) => async (url, opts = {}) => {
  const r = routes[url];
  if (r === undefined) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  if (r instanceof Error) throw r;
  const o = typeof r === 'function' ? r(opts) : r;
  return { status: o.status ?? 200, url: o.url ?? url, json: async () => o.json, body: { cancel: async () => {} } };
};

test('extractLinks: a e img, &amp;, mailto, anclas y duplicados', () => {
  const html = '<p><a href="https://a.es/x?a=1&amp;b=2">Mi <b>enlace</b></a> <a href="mailto:x@y.es">m</a> <a href="#top">t</a> <a href="">v</a> <a href="tel:123">t</a> <a href="https://a.es/x?a=1&b=2">otra vez</a></p><img src="https://a.es/f.jpg" alt="Foto">';
  assert.deepEqual(LK.extractLinks(html), [{ url: 'https://a.es/x?a=1&b=2', text: 'Mi enlace' }, { url: 'https://a.es/f.jpg', text: 'Foto', kind: 'image' }]);
});
test('checkUrl: con redirección a https, barra o www sigue siendo ok', async () => {
  const f = fakeFetch({ 'http://a.es/p': { url: 'https://www.a.es/p/' } });
  assert.equal((await LK.checkUrl('http://a.es/p', { fetch: f })).status, 'ok');
});
test('checkUrl: redirección a otra web = moved con sugerencia', async () => {
  const r = await LK.checkUrl('https://a.es/x', { fetch: fakeFetch({ 'https://a.es/x': { url: 'https://b.org/nuevo' } }) });
  assert.equal(r.status, 'moved'); assert.equal(r.suggestion, 'https://b.org/nuevo'); assert.equal(r.suggestionSource, 'redirect');
});
test('checkUrl: HEAD no permitido, se prueba GET', async () => {
  const f = fakeFetch({ 'https://a.es/x': (o) => ({ status: o.method === 'HEAD' ? 405 : 200 }) });
  assert.equal((await LK.checkUrl('https://a.es/x', { fetch: f })).status, 'ok');
});
test('checkUrl: 404 con copia en el Archivo de Internet', async () => {
  const wb = 'https://archive.org/wayback/available?url=' + encodeURIComponent('https://viejo.com/a');
  const f = fakeFetch({ 'https://viejo.com/a': { status: 404 }, [wb]: { json: { archived_snapshots: { closest: { available: true, url: 'http://web.archive.org/web/2020/https://viejo.com/a' } } } } });
  const r = await LK.checkUrl('https://viejo.com/a', { fetch: f });
  assert.equal(r.status, 'broken'); assert.equal(r.suggestionSource, 'archive'); assert.equal(r.suggestion, 'https://web.archive.org/web/2020/https://viejo.com/a');
});
test('checkUrl: http roto, pero la versión https funciona', async () => {
  const f = fakeFetch({ 'http://c.es/a': new Error('boom'), 'https://c.es/a': { status: 200 } });
  const r = await LK.checkUrl('http://c.es/a', { fetch: f });
  assert.equal(r.status, 'broken'); assert.equal(r.suggestion, 'https://c.es/a'); assert.equal(r.suggestionSource, 'https');
});
test('checkUrl: enlace de la propia web con findOnSite', async () => {
  const f = fakeFetch({ 'https://www.mi.org/viejo-slug/': { status: 404 }, 'https://www.mi.org/2024/nuevo/': { status: 200 } });
  const r = await LK.checkUrl('https://www.mi.org/viejo-slug/', { fetch: f, siteUrl: 'https://mi.org', findOnSite: async () => 'https://www.mi.org/2024/nuevo/' });
  assert.equal(r.suggestionSource, 'site'); assert.equal(r.suggestion, 'https://www.mi.org/2024/nuevo/');
});
test('checkUrl: 403 y 999 no son rotos sino «unknown»', async () => {
  assert.equal((await LK.checkUrl('https://l.com/x', { fetch: fakeFetch({ 'https://l.com/x': { status: 999 } }) })).status, 'unknown');
  assert.equal((await LK.checkUrl('https://l.com/y', { fetch: fakeFetch({ 'https://l.com/y': { status: 403 } }) })).status, 'unknown');
});
test('checkMany: sin repetir y con caché', async () => {
  let n = 0;
  const f = async (u) => { n++; return { status: 200, url: u, body: null }; };
  await LK.checkMany(['https://z.es/1', 'https://z.es/1'], { fetch: f });
  await LK.checkMany(['https://z.es/1'], { fetch: f });
  assert.equal(n, 1);
});
test('replaceLinkInHtml: solo cambia atributos, no el texto visible', () => {
  const h = '<p>Visita https://a.es/x?a=1&amp;b=2 y <a href="https://a.es/x?a=1&amp;b=2">https://a.es/x?a=1&amp;b=2</a><img src="https://a.es/x?a=1&b=2"></p>';
  const out = LK.replaceLinkInHtml(h, 'https://a.es/x?a=1&b=2', 'https://n.es/y');
  assert.equal(out, '<p>Visita https://a.es/x?a=1&amp;b=2 y <a href="https://n.es/y">https://a.es/x?a=1&amp;b=2</a><img src="https://n.es/y"></p>');
  assert.equal(LK.unlinkInHtml('<a href="https://q.es/">hola</a> y <a href="https://o.es/">otro</a>', 'https://q.es/'), 'hola y <a href="https://o.es/">otro</a>');
});

test('fotos desaparecidas: copia del Archivo de Internet tal cual (id_)', async () => {
  const L = require('../src/links');
  assert.equal(L.rawArchive('https://web.archive.org/web/20111105120000/http://x.blogspot.com/a.jpg'), 'https://web.archive.org/web/20111105120000id_/http://x.blogspot.com/a.jpg');
  const fake = async (u) => ({ status: 200, url: u, json: async () => ({ archived_snapshots: { closest: { available: true, url: 'http://web.archive.org/web/2011/http://x/a.jpg' } } }) });
  assert.match(await L.archivedFile('http://x/a.jpg', { fetch: fake }), /^https:\/\/web\.archive\.org\/web\/\d+id_\/http:\/\/x\/a\.jpg$/);
  // sin copia directa: se usa el servicio de búsqueda
  const viaApi = async (u) => (/wayback\/available/.test(u) ? { status: 200, url: u, json: async () => ({ archived_snapshots: { closest: { available: true, url: 'http://web.archive.org/web/2011/http://x/a.jpg' } } }) } : { status: 404, url: u });
  assert.equal(await L.archivedFile('http://x/a.jpg', { fetch: viaApi }), 'https://web.archive.org/web/2011id_/http://x/a.jpg');
  const dead = async (u) => ({ status: 404, url: u });
  assert.equal(await L.imageWorks('http://x/a.jpg', { fetch: dead }), false);
});

test('fotos rotas: variantes de Blogger y quitar la foto del contenido', () => {
  const L = require('../src/links');
  const v = L.urlVariants('https://4.bp.blogspot.com/-a/b/c/d/s1600/foto.jpg');
  assert.ok(v.includes('http://4.bp.blogspot.com/-a/b/c/d/s320/foto.jpg'));
  const html = '<!-- wp:image {"id":3} --><figure class="wp-block-image"><a href="x"><img src="https://x/f.jpg&amp;a=1"></a></figure><!-- /wp:image --><p>Texto <img src="https://x/g.jpg"></p>';
  const out = L.removeImageInHtml(html, 'https://x/f.jpg&a=1');
  assert.equal(out.includes('f.jpg'), false);
  assert.equal(out.includes('wp:image'), false);
  assert.ok(out.includes('g.jpg') && out.includes('Texto'));
});

test('fotos de Blogger: una por foto aunque esté en varios tamaños, y en su tamaño original', () => {
  const B = require('../src/backup');
  const html = '<a href="http://4.bp.blogspot.com/-a/UO9/AAA/xyz/s1600/foto+1.jpg"><img src="http://4.bp.blogspot.com/-a/UO9/AAA/xyz/s320/foto+1.jpg"></a><img src="https://1.bp.blogspot.com/-b/c/d/e/w400-h300/otra.png">';
  const list = B.externalImages(html);
  assert.equal(list.length, 2);
  assert.equal(list[0].url, 'https://4.bp.blogspot.com/-a/UO9/AAA/xyz/s0/foto+1.jpg');
  assert.equal(B.googleKey('http://3.bp.blogspot.com/-a/UO9/AAA/xyz/s400/foto+1.jpg'), list[0].gkey);
  assert.equal(list[1].url, 'https://1.bp.blogspot.com/-b/c/d/e/s0/otra.png');
});

test('recuperar fotos originales: el mismo nombre aunque WordPress lo cambie', () => {
  const B = require('../src/backup');
  const k = B.photoKey('2011/11/Fiesta Navidad.jpg');
  for (const u of ['https://x/wp-content/uploads/2026/11/Fiesta-Navidad-1024x768.jpg', 'https://x/wp-content/uploads/2026/11/Fiesta-Navidad-scaled.jpg'])
    assert.equal(B.photoKey(u), k);
  assert.equal(B.photoKey('https://x/wp-content/uploads/2026/11/fiesta-navidad-1.jpg', true), k);
  assert.notEqual(B.photoKey('foto-1.jpg'), B.photoKey('foto-2.jpg')); // fotos distintas no se confunden
  assert.notEqual(B.photoKey('https://x/otra-foto.jpg'), k);
  const an = { posts: [{ type: 'post', slug: '', title: 'Encuentros festivos', date: '2011-11-04 10:00:00' }, { type: 'post', slug: 'voluntariado-en-navidad', title: 'Voluntariado', date: '2011-11-03' }] };
  assert.equal(B.matchBackupPost(an, { title: 'ENCUENTROS FESTIVOS', date: '2011-11-04T10:00:00' }).title, 'Encuentros festivos');
  assert.equal(B.matchBackupPost(an, { slug: 'voluntariado-en-navidad', title: 'x', date: '' }).title, 'Voluntariado');
});

test('mejorar con IA: tamaño final (×4 con tope de 2× o 1600 y nunca más de 2560)', () => {
  const U = require('../src/upscale');
  assert.deepEqual(U.targetSize(640, 480), { width: 1600, height: 1200 });
  assert.deepEqual(U.targetSize(300, 200), { width: 1200, height: 800 }); // ×4 cabe: 1200 ≤ 1600
  assert.deepEqual(U.targetSize(480, 640), { width: 1200, height: 1600 });
  assert.deepEqual(U.targetSize(1200, 800), { width: 2400, height: 1600 }); // 2×
  assert.deepEqual(U.targetSize(2000, 1000), { width: 2560, height: 1280 }); // tope absoluto
  assert.deepEqual(U.targetSize(1, 1), { width: 4, height: 4 });
});

test('mejorar con IA: cambiar la foto en el contenido (direcciones, wp-image e id de bloque)', () => {
  const U = require('../src/upscale');
  const old = 'https://x.org/wp-content/uploads/2020/a.jpg', oldS = 'https://x.org/wp-content/uploads/2020/a-300x200.jpg';
  const nu = 'https://x.org/wp-content/uploads/2026/a-mejorada.jpg';
  const html = `<!-- wp:image {"id":12,"sizeSlug":"large"} --><figure><img src="${oldS}" srcset="${oldS} 300w, ${old} 600w" class="wp-image-12" alt="a"/></figure><!-- /wp:image -->
<p>Texto con <a href="${old}">enlace</a> y ${old} visible, wp-image-123 y "id":123</p><!-- wp:image {"id":123} /-->`;
  const out = U.swapMediaInHtml(html, { oldUrls: [old, oldS], newUrl: nu, oldId: 12, newId: 99 });
  assert.match(out, /"id":99,"sizeSlug"/);
  assert.match(out, /class="wp-image-99"/);
  assert.ok(out.includes(`src="${nu}"`) && out.includes(`href="${nu}"`));
  assert.ok(!out.includes('srcset'));
  assert.ok(out.includes(`y ${old} visible`)); // el texto visible no se toca
  assert.ok(out.includes('wp-image-123') && out.includes('{"id":123}')); // otros ids intactos
});

test('fotos repetidas: misma foto en dos tamaños = un grupo; se queda la grande', () => {
  const D = require('../src/dupes');
  const g1 = Array.from({ length: 72 }, (_, i) => (i * 37) % 255), g2 = g1.map((v) => v + 1), g3 = g1.map((v, i) => (i % 2 ? 255 - v : v));
  const h1 = D.dhash(g1), h2 = D.dhash(g2), h3 = D.dhash(g3);
  assert.equal(D.hamming(h1, h2), 0);
  assert.ok(D.hamming(h1, h3) > 6);
  const groups = D.groupDuplicates([
    { id: 1, hash: h1, width: 400, height: 267, size: 32000 }, { id: 2, hash: h2, width: 1000, height: 667, size: 75000 },
    { id: 3, hash: h3, width: 1000, height: 667 }, { id: 4, hash: h1, width: 300, height: 300 }, // otra forma: no es la misma
  ]);
  assert.deepEqual(groups, [{ keep: 2, drop: [1] }]);
});

test('fecha real de fotos sin entrada: en el nombre o dentro de la foto (EXIF)', () => {
  const P = require('../src/photodate');
  assert.equal(P.dateFromName('WhatsApp-Image-2023-02-04-at-10.15.22.jpeg'), '2023-02-04');
  assert.equal(P.dateFromName('IMG_20190512_123456.jpg'), '2019-05-12');
  assert.equal(P.dateFromName('702677198_18088941234567890_n.jpg'), null); // número de Instagram: no es fecha
  assert.equal(P.dateFromName('Dia-del-Inmigrante-3.jpg'), null);
  // JPEG mínima con EXIF (little endian): IFD0 → puntero EXIF → DateTimeOriginal
  const tiff = Buffer.alloc(80);
  tiff.write('II', 0, 'latin1'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x8769, 10); tiff.writeUInt16LE(4, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(1, 26); tiff.writeUInt16LE(0x9003, 28); tiff.writeUInt16LE(2, 30); tiff.writeUInt32LE(20, 32); tiff.writeUInt32LE(44, 36);
  tiff.write('2011:11:04 18:30:00\0', 44, 'latin1');
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2); len.writeUInt16BE(app1.length + 2);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xda])]);
  assert.equal(P.exifDate(jpg), '2011-11-04T18:30:00');
});

// --- Estructura: avisos (renderer/sitemap.js) ---
const SM = require('../renderer/sitemap');
test('estructura: páginas fuera del menú, menú con páginas ocultas y categorías vacías', () => {
  const pg = (id, parent, status = 'publish') => ({ id, title: 'P' + id, parent, status, order: id });
  const pages = [pg(1, 0), pg(2, 1), pg(3, 2), pg(4, 0), pg(5, 4), pg(6, 0, 'draft'), pg(7, 0), pg(8, 0)];
  const menu = [
    { id: 10, object: 'page', objectId: 1 }, { id: 11, object: 'page', objectId: 6 }, { id: 12, object: 'page', objectId: 99 },
    { id: 13, object: 'custom', objectId: 0 }, { id: 14, object: 'category', objectId: 4 },
  ];
  // 1,2,3 (cuelgan de la 1) y 6 (en el menú, pero borrador) se alcanzan; 4,5,7 no; 8 es la portada
  assert.deepEqual([...SM.reachablePages(pages, menu)].sort(), [1, 2, 3, 6]);
  assert.deepEqual(SM.unlinkedPages(pages, menu, { showOnFront: 'page', pageOnFront: 8 }).map((p) => p.id), [4, 5, 7]);
  assert.deepEqual(SM.unlinkedPages(pages, menu, { showOnFront: 'posts' }).map((p) => p.id), [4, 5, 7, 8]);
  assert.deepEqual(SM.menuProblems(pages, menu).map((x) => [x.item.id, x.why]), [[11, 'draft'], [12, 'trash']]);
  const cats = [{ id: 1, count: 0, parent: 0 }, { id: 2, count: 0, parent: 0 }, { id: 3, count: 0, parent: 2 }, { id: 4, count: 5, parent: 0 }];
  assert.deepEqual(SM.emptyCategories(cats).map((c) => c.id), [3]);
});

test('páginas en Ecos: toRest envía la página superior y no categorías ni etiquetas', async () => {
  const W = require('../src/wpself');
  const body = await W.toRest({}, { type: 'page', parent: '7', title: 'Quiénes somos', content: '<p>x</p>', status: 'draft', categories: 'Noticias', tags: 'a,b' });
  assert.equal(body.parent, 7);
  assert.ok(!('categories' in body) && !('tags' in body));
  assert.ok(!('date_gmt' in body));
});

test('calendario editorial: nuevo día conservando la hora y estado según la fecha', () => {
  const { calNewDate, calDropDecision, calLocalInput } = require('../renderer/app/calview');
  const old = new Date(2026, 10, 3, 17, 45, 12).toISOString();
  const d = calNewDate(old, new Date(2026, 10, 24));
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()], [2026, 10, 24, 17, 45, 12]);
  const sin = calNewDate(null, new Date(2026, 11, 1));
  assert.deepEqual([sin.getDate(), sin.getHours(), sin.getMinutes()], [1, 10, 0]); // sin fecha previa: las 10:00
  const now = new Date(2026, 10, 21, 12, 0);
  assert.deepEqual(calDropDecision('draft', new Date(2026, 10, 25, 10), now), { action: 'set', status: 'future' });
  assert.deepEqual(calDropDecision('future', new Date(2026, 10, 25, 10), now), { action: 'set', status: 'future' });
  assert.deepEqual(calDropDecision('draft', new Date(2026, 10, 5, 10), now), { action: 'past', status: 'publish' });
  assert.deepEqual(calDropDecision('publish', new Date(2026, 10, 5, 10), now), { action: 'confirm', status: 'publish' });
  assert.deepEqual(calDropDecision('publish', new Date(2026, 10, 30, 10), now), { action: 'confirm', status: 'future' });
  assert.equal(calLocalInput(new Date(2026, 0, 5, 9, 3)), '2026-01-05T09:03');
});

test('fotos dentro del texto: a un lado con el texto alrededor y su tamaño, ida y vuelta', () => {
  const { parseBlocks } = require('../src/parseblocks');
  const html = T.composeBlocks([{ id: 'f', type: 'image', img: { id: 9, url: 'https://x/a.jpg', alt: '' }, caption: '', align: 'right', width: 33 }]);
  assert.match(html, /"align":"right"/); assert.match(html, /alignright/); assert.match(html, /width:250px/);
  const b = parseBlocks(html)[0];
  assert.equal(b.align, 'right'); assert.equal(b.width, 33);
  const plain = T.composeBlocks([{ id: 'g', type: 'image', img: { id: 9, url: 'https://x/a.jpg', alt: '' }, caption: '' }]);
  assert.equal(parseBlocks(plain)[0].align, undefined);
});

// --- Mapa: enlaces de una página, resolver destinos y editar botones ---
const PL = require('../src/pagelinks');
const BTN = (t, h, o = '') => PL.buttonHtml(t, h, o);
const PAGE_HTML = `<!-- wp:paragraph -->\n<p>Hola <a href="https://www.asociacionelin.com/contacto/">escríbenos</a> o mira <a href="https://otra.org/x">otra</a>.</p>\n<!-- /wp:paragraph -->\n\n${BTN('Colabora', 'https://asociacionelin.com/colabora')}\n\n<!-- wp:paragraph -->\n<p>Fin <a href="#abajo">ir</a></p>\n<!-- /wp:paragraph -->\n\n${BTN('Más información', 'https://x.org/info', 'outline')}`;
test('extractLinks separa botones y enlaces del texto', () => {
  const r = SM.extractLinks(PAGE_HTML);
  assert.deepEqual(r.buttons.map((b) => [b.index, b.text, b.href, b.variant]), [[0, 'Colabora', 'https://asociacionelin.com/colabora', 'fill'], [1, 'Más información', 'https://x.org/info', 'outline']]);
  assert.deepEqual(r.links.map((l) => l.href), ['https://www.asociacionelin.com/contacto/', 'https://otra.org/x', '#abajo']);
});
test('makeResolver: por enlace, slug, sin www ni barra final, externas y rotas', () => {
  const items = [{ id: 1, type: 'page', title: 'Contacto', link: 'https://www.asociacionelin.com/contacto/', slug: 'contacto' }, { id: 2, type: 'page', title: 'Colabora', link: 'https://www.asociacionelin.com/colabora/', slug: 'colabora' }, { id: 9, type: 'post', title: 'Noticia', link: 'https://www.asociacionelin.com/2024/noticia/', slug: 'noticia' }];
  const r = SM.makeResolver(items, 'https://www.asociacionelin.com');
  assert.equal(r('https://asociacionelin.com/colabora').id, 2);
  assert.equal(r('http://www.asociacionelin.com/contacto').id, 1);
  assert.equal(r('/contacto/#form').id, 1);
  assert.equal(r('/otro/noticia/').id, 9);
  assert.equal(r('/?page_id=2').id, 2);
  assert.equal(r('https://otra.org/x').host, 'otra.org');
  assert.equal(r('#a').kind, 'anchor');
  assert.equal(r('/no-existe/').kind, 'broken');
  assert.equal(r('mailto:a@b.es').kind, 'mail');
  assert.equal(r('https://www.asociacionelin.com/').kind, 'home');
  assert.equal(SM.normUrl('HTTPS://www.A.com/b/'), 'a.com/b');
});
test('blockOutline: bloques de primer nivel', () => {
  assert.deepEqual(SM.blockOutline(PAGE_HTML), ['paragraph', 'buttons', 'paragraph', 'buttons']);
});
test('insertar botón: al final y tras el primer párrafo', () => {
  const blk = BTN('Hola', 'https://a.com/');
  assert.match(blk, /<!-- wp:buttons -->[\s\S]*wp-block-button__link[^>]*href="https:\/\/a\.com\/"[^>]*>Hola<\/a>/);
  const end = SM.insertBlock(PAGE_HTML, blk, 'end');
  assert.equal(SM.extractLinks(end).buttons.length, 3);
  assert.equal(SM.extractLinks(end).buttons[2].text, 'Hola');
  const after = SM.insertBlock(PAGE_HTML, blk, 'afterFirst');
  assert.equal(SM.extractLinks(after).buttons[0].text, 'Hola');
  assert.ok(after.indexOf('Hola</a>') > after.indexOf('<!-- /wp:paragraph -->'));
  assert.equal(SM.insertBlock('', blk, 'end'), blk);
  assert.equal(PL.buttonHtml('A & B <x>', 'https://a.com/', 'fill').includes('A &amp; B &lt;x&gt;'), true);
});
test('editar y quitar un botón con precisión', () => {
  const e = SM.editButton(PAGE_HTML, 1, { text: 'Más información', href: 'https://x.org/info' }, { text: 'Dona', href: 'https://x.org/dona?a=1&b=2', variant: 'fill' });
  const b = SM.extractLinks(e).buttons;
  assert.equal(b[1].text, 'Dona'); assert.equal(b[1].href, 'https://x.org/dona?a=1&b=2'); assert.equal(b[1].variant, 'fill');
  assert.equal(b[0].text, 'Colabora');
  assert.ok(!/is-style-outline/.test(e));
  assert.throws(() => SM.editButton(PAGE_HTML, 1, { text: 'otro', href: 'x' }, { text: 'a' }), /ha cambiado/);
  const rm = SM.removeButton(PAGE_HTML, 0, { text: 'Colabora', href: 'https://asociacionelin.com/colabora' });
  assert.equal(SM.extractLinks(rm).buttons.length, 1);
  assert.equal((rm.match(/<!-- wp:buttons/g) || []).length, 1);
  assert.equal(SM.removeButton(BTN('Solo', 'https://a.com/'), 0), '');
  const two = '<!-- wp:buttons -->\n<div class="wp-block-buttons"><!-- wp:button -->\n<div class="wp-block-button"><a class="wp-block-button__link" href="/a">A</a></div>\n<!-- /wp:button --><!-- wp:button -->\n<div class="wp-block-button"><a class="wp-block-button__link" href="/b">B</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->';
  const one = SM.removeButton(two, 0);
  assert.deepEqual(SM.extractLinks(one).buttons.map((x) => x.text), ['B']); assert.ok(one.includes('wp:buttons'));
});

test('foto a un lado: en WordPress lo que no la rodea empieza por debajo (corte), y el corte no vuelve al editor', () => {
  const { parseBlocks } = require('../src/parseblocks');
  const img = { id: 'i', type: 'image', img: { id: 3, url: 'https://x/a.jpg', alt: '' }, caption: '', align: 'right', width: 50 };
  const html = T.composeBlocks([img, { id: 'p', type: 'paragraph', html: 'Texto al lado' }, { id: 'g', type: 'carousel', images: [{ id: 1, url: 'a.jpg' }, { id: 2, url: 'b.jpg' }] }]);
  const iClear = html.indexOf('ecos-clear'), iPar = html.indexOf('Texto al lado'), iCar = html.indexOf('ecos-carrusel');
  assert.ok(iClear > iPar && iClear < iCar, 'el corte va entre el texto y el carrusel');
  assert.deepEqual(parseBlocks(html).map((b) => b.type), ['image', 'paragraph', 'carousel']);
  // al final de todo también se cierra
  assert.match(T.composeBlocks([img, { id: 'p', type: 'paragraph', html: 'x' }]), /ecos-clear/);
  // sin fotos a un lado, no hay cortes
  assert.doesNotMatch(T.composeBlocks([{ id: 'p', type: 'paragraph', html: 'x' }]), /ecos-clear/);
});

// ---------------------------------------------------------------- copia de seguridad de la web (WXR + ZIP) y avisos de redes
test('copia de la web: el WXR creado se lee de vuelta con las mismas entradas', async () => {
  const BC = require('../src/backupcreate');
  const items = [
    { id: 7, type: 'post', title: 'Fiesta de Navidad', content: '<!-- wp:paragraph --><p>Hola ]]> mundo</p><!-- /wp:paragraph -->', excerpt: 'Resumen', date: '2025-12-20T10:30:00', dateGmt: '2025-12-20T09:30:00',
      status: 'publish', slug: 'fiesta-de-navidad', categories: [{ name: 'Eventos', slug: 'eventos' }], tags: [{ name: 'Navidad', slug: 'navidad' }], featured: 50 },
    { id: 8, type: 'page', title: 'Quiénes somos', content: '<p>Texto</p>', excerpt: '', date: '2024-01-02T08:00:00', dateGmt: '2024-01-02T07:00:00', status: 'draft', slug: 'quienes-somos', parent: 3, categories: [], tags: [] },
  ];
  const attachments = [{ id: 50, title: 'Foto navidad', url: 'https://x.org/wp-content/uploads/2025/12/navidad.jpg', rel: '2025/12/navidad.jpg', mime: 'image/jpeg', alt: 'Niños', date: '2025-12-19T10:00:00', parent: 7 }];
  const xml = BC.buildWxr({ title: 'Asociación Elín', link: 'https://x.org', items, attachments, terms: { categories: [{ id: 2, name: 'Eventos', slug: 'eventos', parent: 0 }], tags: [{ id: 5, name: 'Navidad', slug: 'navidad' }] } });
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-wxr-')), 'copia.xml');
  fs.writeFileSync(f, xml);
  const an = await B.analyze([f]);
  assert.equal(an.siteName, 'Asociación Elín');
  assert.equal(an.posts.length, 2);
  const p = an.posts.find((x) => x.id === '7'), g = an.posts.find((x) => x.id === '8');
  assert.equal(p.title, 'Fiesta de Navidad'); assert.equal(p.status, 'publish'); assert.equal(p.slug, 'fiesta-de-navidad'); assert.equal(p.type, 'post');
  assert.equal(p.content, items[0].content); assert.equal(p.excerpt, 'Resumen'); assert.equal(p.date, '2025-12-20 10:30:00');
  assert.deepEqual(p.categories, ['Eventos']); assert.deepEqual(p.tags, ['Navidad']);
  assert.equal(p.thumbRel, '2025/12/navidad.jpg'); // imagen destacada
  assert.equal(g.type, 'page'); assert.equal(g.status, 'draft');
  const wp = B.wpFromWxr(xml);
  assert.equal(wp.posts.find((x) => x.ID === '8').post_parent, '3');
});

test('copia de la web: ZIP con uploads/ que el restaurador encuentra, y ZIP64 con desplazamientos grandes', async () => {
  const BC = require('../src/backupcreate');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-zip-'));
  const media = [{ id: 1, name: 'a', url: 'https://x.org/wp-content/uploads/2024/05/a.jpg', mime: 'image/jpeg', date: '2024-05-01T00:00:00' }, { id: 2, name: 'b', url: 'https://x.org/wp-content/uploads/2024/05/b.png', date: '2024-05-01' }];
  const rest = { id: 1, title: { raw: 'Hola' }, content: { raw: '<p>x</p>' }, excerpt: { raw: '' }, date: '2024-05-01T10:00:00', date_gmt: '2024-05-01T08:00:00', status: 'publish', slug: 'hola', categories: [3], tags: [], featured_media: 1 };
  const deps = {
    siteName: 'Web', siteUrl: 'https://x.org', media,
    listAll: async (route) => (route.includes('/posts?') ? [rest] : route.includes('/categories') ? [{ id: 3, name: 'Cat', slug: 'cat', parent: 0 }] : []),
    download: async (url) => (url.endsWith('b.png') ? null : Buffer.from('FOTO-' + url)),
  };
  const f = path.join(dir, 'copia.zip');
  const steps = [];
  const r = await BC.createBackup(deps, { file: f, photos: true, onProgress: (p) => steps.push(p.step) });
  assert.equal(r.posts, 1); assert.equal(r.files, 1); assert.equal(r.missing, 1);
  assert.ok(steps.includes('fotos') && steps.includes('guardar'));
  const an = await B.analyze([f]);
  assert.equal(an.posts.length, 1); assert.deepEqual(an.posts[0].categories, ['Cat']);
  const hit = an.findFile('2024/05/a.jpg');
  assert.ok(hit); assert.equal((await hit.src.read(hit.name)).toString(), 'FOTO-https://x.org/wp-content/uploads/2024/05/a.jpg');
  an.sources.forEach((s) => s.close());
  // sin fotos: solo el XML
  const x = path.join(dir, 'copia.xml');
  await BC.createBackup(deps, { file: x, photos: false });
  assert.ok(fs.readFileSync(x, 'utf8').includes('<wp:wxr_version>1.2'));
  // cancelar borra el archivo a medias
  const c = path.join(dir, 'cancel.zip'); let n = 0;
  await assert.rejects(BC.createBackup(deps, { file: c, photos: true, cancelled: () => ++n > 2 }), /Cancelado/);
  assert.equal(fs.existsSync(c), false);
  // ZIP64: se fuerza con un límite pequeño y yauzl lo lee igual
  const z = path.join(dir, 'z64.zip');
  const w = new BC.ZipWriter(z, { limit: 60 });
  for (let i = 0; i < 4; i++) await w.add(`uploads/f${i}.jpg`, Buffer.from('dato' + i));
  await w.finish();
  const names = await new Promise((res, rej) => require('yauzl').open(z, { lazyEntries: true }, (e, zf) => {
    if (e) return rej(e);
    const out = []; zf.readEntry(); zf.on('entry', (en) => { out.push(en.fileName); zf.readEntry(); }); zf.on('end', () => res(out)); zf.on('error', rej);
  }));
  assert.deepEqual(names, [0, 1, 2, 3].map((i) => `uploads/f${i}.jpg`));
  assert.equal(BC.safeRel('../x.jpg'), false); assert.equal(BC.safeRel('2024/05/a.jpg'), true);
});

test('publicaciones nuevas en redes: solo las posteriores a la última vista y no pasadas al blog', () => {
  const N = require('../renderer/newposts');
  const mk = (id, date, source = 'instagram') => ({ id, date, source });
  const posts = [mk('1', '2026-11-20T10:00:00Z'), mk('2', '2026-11-18T10:00:00Z', 'facebook'), mk('3', '2026-11-10T10:00:00Z'), mk('4', '2026-11-19T10:00:00Z')];
  const r = N.findNew(posts, '2026-11-15T00:00:00Z', (p) => p.id === '4');
  assert.deepEqual(r.fresh.map((p) => p.id), ['1', '2']); // 3 es antigua y 4 ya está en el blog
  assert.equal(r.baseline, null);
  assert.deepEqual(N.networks(r.fresh), ['instagram', 'facebook']);
  // primera vez: no se avisa, pero se fija desde dónde contar
  const first = N.findNew(posts, null);
  assert.equal(first.fresh.length, 0); assert.equal(first.baseline, '2026-11-20T10:00:00.000Z');
  assert.equal(N.findNew([], '2026-11-15T00:00:00Z').fresh.length, 0);
  assert.equal(N.newestDate([]), null);
});

test('SEO: cortes, contadores y avisos del editor', () => {
  const S = require('../renderer/app/seo');
  assert.equal(S.cut('Hola mundo', 60), 'Hola mundo');
  const long = 'Una asociación que acoge a personas migrantes en la frontera sur de España desde hace años';
  const c = S.cut(long, 60);
  assert.ok(c.length <= 60 && c.endsWith('…') && !c.includes('  '));
  assert.equal(S.titleLevel('x'.repeat(45)), 'ok');
  assert.equal(S.titleLevel('x'.repeat(10)), 'warn');
  assert.equal(S.titleLevel('x'.repeat(65)), 'warn');
  assert.equal(S.titleLevel('x'.repeat(90)), 'bad');
  assert.equal(S.descLevel(''), 'bad');
  assert.equal(S.descLevel('x'.repeat(120)), 'ok');
  assert.equal(S.descLevel('x'.repeat(160)), 'warn');
  const codes = (o) => S.warnings(o).map((w) => w.code);
  assert.deepEqual(codes({ title: 'x'.repeat(70), desc: '', keyword: 'Rabat', hasImage: false, slug: 'a'.repeat(70) }), ['titleLong', 'noDesc', 'kwTitle', 'noImage', 'slugLong']);
  assert.deepEqual(codes({ title: 'Primer día en Rabat', desc: 'Algo', keyword: 'dia en Rabat', hasImage: true, slug: 'rabat' }), []);
});

test('Facebook: mensaje con enlace aparte, texto de partida y texto para Instagram', () => {
  const S = require('../renderer/app/seo');
  const link = 'https://www.asociacionelin.com/entrada/';
  assert.deepEqual(S.fbMessage('Mirad esto\n\n\n\n' + link + '\n', link), { message: 'Mirad esto', link });
  assert.equal(S.prefill('<p>Extracto</p>', 'otro'), 'Extracto');
  assert.equal(S.prefill('', 'Primero\n\nSegundo\n\n' + 'z'.repeat(500)), 'Primero\n\nSegundo');
  assert.equal(S.igText('Hola ' + link + ' amigos', 'Enlace en la bio'), 'Hola amigos\n\nEnlace en la bio');
});

test('SEO de la web: detecta Yoast/Rank Math solo si se puede escribir; la web real no tiene plugin', () => {
  const { detectSeo } = require('../src/wpself');
  assert.deepEqual(detectSeo({ meta: { _yoast_wpseo_metadesc: '' } }), { plugin: 'yoast', key: '_yoast_wpseo_metadesc', writable: true });
  assert.equal(detectSeo({ meta: { rank_math_description: '' } }).key, 'rank_math_description');
  assert.deepEqual(detectSeo({ hasYoastHead: true, meta: {} }), { plugin: 'yoast', key: null, writable: false });
  assert.deepEqual(detectSeo({ namespaces: ['wp/v2', 'astra/v1'], meta: { 'site-sidebar-layout': 'default' } }), { plugin: null, key: null, writable: false });
});

test('Meta: errores de publicación explican el permiso pages_manage_posts', () => {
  const { explainShareError } = require('../src/meta');
  assert.match(explainShareError({ code: 200, message: '(#200) Requires pages_manage_posts permission' }), /NEED_PUBLISH_PERMISSION/);
  assert.match(explainShareError({ code: 190, message: 'Invalid OAuth access token' }), /caducado/);
});

test('Meta: la conexión normal no pide el permiso de publicar (evita «Invalid Scopes»)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/meta.js'), 'utf8');
  const base = src.match(/const SCOPES = \[([^\]]*)\]/)[1];
  assert.doesNotMatch(base, /pages_manage_posts/);
});

test('Inicio: recuento de pendientes sin las ya exportadas, caché y semana', () => {
  const H = require('../renderer/homelogic');
  const posts = Array.from({ length: 10 }, (_, i) => ({ id: String(i), source: 'instagram', date: new Date(2026, 0, 1 + i).toISOString() }));
  const done = new Set(['2', '9']);
  const r = H.countPending(posts, (p) => done.has(p.id), 3);
  assert.equal(r.total, 10); assert.equal(r.pending, 8);
  assert.deepEqual(r.newest.map((p) => p.id), ['8', '7', '6']); // las más recientes sin exportar
  assert.equal(H.countPending([], () => false).pending, 0);
  // caché: nueva, de otra página o con más de 6 h → se rehace
  const now = Date.now();
  assert.equal(H.isStale(null, 'a|1', now), true);
  assert.equal(H.isStale({ key: 'a|1', at: now - 3600e3 }, 'a|1', now), false);
  assert.equal(H.isStale({ key: 'a|1', at: now - 7 * 3600e3 }, 'a|1', now), true);
  assert.equal(H.isStale({ key: 'b|1', at: now }, 'a|1', now), true);
  // semana de lunes a domingo (22/11/2026 es domingo → lunes 16)
  const ws = H.weekStart(new Date(2026, 10, 22, 15));
  assert.equal(H.ymd(ws), '2026-11-16');
  assert.equal(H.ymd(H.weekStart(new Date(2026, 10, 16))), '2026-11-16');
  const g = H.groupByWeekday([
    { id: 1, date: new Date(2026, 10, 16, 18).toISOString() }, { id: 2, date: new Date(2026, 10, 16, 9).toISOString() },
    { id: 3, date: new Date(2026, 10, 22, 10).toISOString() }, { id: 4, date: new Date(2026, 10, 23, 10).toISOString() },
  ], ws);
  assert.equal(g.length, 7);
  assert.deepEqual(g[0].map((x) => x.id), [2, 1]); // ordenadas por hora
  assert.deepEqual(g[6].map((x) => x.id), [3]);
  assert.equal(g.flat().length, 3); // la del lunes siguiente queda fuera
  // revisión y fotos sin entrada
  const pi = H.problemItems({ noCat: [{ id: 1, date: '2026-01-01' }, { id: 2, date: '2026-02-01' }], noImg: [{ id: 1, date: '2026-01-01' }] });
  assert.deepEqual(pi.map((x) => [x.id, !!x.cat, !!x.img]), [[2, true, false], [1, true, true]]);
  const un = H.unusedPhotos([{ id: 1, type: 'image', date: '2026-01-01' }, { id: 2, type: 'image', date: '2026-03-01' }, { id: 3, type: 'video', date: '2026-04-01' }, { id: 4, type: 'image', date: '2026-02-01' }], { 1: [{ id: 9 }] }, 1);
  assert.equal(un.total, 2); assert.deepEqual(un.items.map((m) => m.id), [2]);
});

test('recuento rápido de Meta: listado ligero de 100 en 100 y total de Instagram', async () => {
  const meta = require('../src/meta');
  const seen = [];
  const orig = global.fetch;
  global.fetch = async (u) => {
    seen.push(String(u));
    const url = new URL(u);
    if (url.pathname.endsWith('/ig1')) return { json: async () => ({ media_count: 321 }) };
    if (url.pathname.endsWith('/ig1/media')) return { json: async () => ({ data: [{ id: 'a', caption: 'Hola', timestamp: '2026-11-01T10:00:00Z', media_type: 'VIDEO', thumbnail_url: 'th.jpg', media_url: 'v.mp4' }], paging: { next: 'x', cursors: { after: 'C2' } } }) };
    return { json: async () => ({ data: [{ id: 'f', message: 'Texto', created_time: '2026-11-02T10:00:00Z', full_picture: 'p.jpg' }] }) };
  };
  try {
    const acc = { igId: 'ig1', pageId: 'pg', pageToken: 'tk' };
    const ig = await meta.lightPosts({}, acc, 'instagram');
    assert.equal(ig.next, 'C2');
    assert.deepEqual(ig.posts[0], { source: 'instagram', id: 'a', text: 'Hola', date: '2026-11-01T10:00:00Z', media: [{ type: 'image', url: 'th.jpg' }] });
    const fb = await meta.lightPosts({}, acc, 'facebook');
    assert.equal(fb.next, null); assert.equal(fb.posts[0].source, 'facebook');
    assert.equal(await meta.instagramCount({}, acc), 321);
    assert.ok(seen.slice(0, 2).every((u) => /limit=100/.test(u) && !/children/.test(u)), 'pide 100 por página y sin hijos');
    assert.equal(await meta.instagramCount({}, { pageId: 'pg' }), null);
  } finally { global.fetch = orig; }
});

test('agenda de Inicio: rangos de día, semana, mes y año, pasos y recuento por estado', () => {
  const HL = require('../renderer/homelogic');
  const d = new Date(2026, 10, 22, 15); // domingo 22 nov 2026
  const r = (v) => { const x = HL.agRange(v, d); return [x.from.toDateString(), x.to.toDateString()]; };
  assert.deepEqual(r('day'), [new Date(2026, 10, 22).toDateString(), new Date(2026, 10, 23).toDateString()]);
  assert.deepEqual(r('week'), [new Date(2026, 10, 16).toDateString(), new Date(2026, 10, 23).toDateString()]);
  assert.deepEqual(r('month'), [new Date(2026, 10, 1).toDateString(), new Date(2026, 11, 1).toDateString()]);
  assert.deepEqual(r('year'), [new Date(2026, 0, 1).toDateString(), new Date(2027, 0, 1).toDateString()]);
  assert.equal(HL.agStep('month', d, 1).getMonth(), 11);
  assert.equal(HL.agStep('year', d, -1).getFullYear(), 2025);
  assert.equal(HL.agStep('week', d, 1).getDate(), 29);
  assert.ok(HL.agIsNow('week', new Date(2026, 10, 17), d));
  assert.ok(!HL.agIsNow('day', new Date(2026, 10, 21), d));
  assert.deepEqual(HL.agCount([{ status: 'publish' }, { status: 'private' }, { status: 'future' }, { status: 'draft' }, { status: 'pending' }]), { publish: 2, future: 1, draft: 2 });
});

test('duplicados Instagram–Facebook: aguanta menciones, hashtags quitados, recortes y fotos', () => {
  const Tr = require('../src/transform');
  const P = (source, id, text, date, n = 1, url) => ({ source, id, text, date, media: Array.from({ length: n }, (_, i) => ({ type: 'image', url: url || `${source}${id}-${i}.jpg` })) });
  const ig = [
    P('instagram', 'i1', 'Hoy hemos participado en el Encuentro de Fronteras junto a @cearong y @apdha en Ceuta. ¡Gracias a todas! #fronteras #ceuta #derechoshumanos', '2026-11-10T18:00:00Z', 3),
    P('instagram', 'i2', 'Último Círculo de Silencio del año en la plaza de los Reyes. Os esperamos el próximo mes con más fuerza que nunca para seguir denunciando.', '2026-11-12T10:00:00Z', 2),
    P('instagram', 'i3', '', '2026-11-14T09:00:00Z', 1),
    P('instagram', 'i4', 'Taller de cocina intercultural este sábado en el local de la asociación', '2026-11-15T09:00:00Z', 1),
  ];
  const fb = [
    P('facebook', 'f1', 'Hoy hemos participado en el Encuentro de Fronteras junto a CEAR y APDHA en Ceuta. ¡Gracias a todas!', '2026-11-10T18:02:00Z', 3),
    P('facebook', 'f2', 'Último Círculo de Silencio del año en la plaza de los Reyes. Os esperamos el próximo mes…', '2026-11-12T10:05:00Z', 2),
    P('facebook', 'f3', '', '2026-11-14T09:01:00Z', 1),
    P('facebook', 'f4', 'Recogida de alimentos el domingo en el barrio del Príncipe, traed lo que podáis', '2026-11-15T10:00:00Z', 1),
  ];
  const out = Tr.mergeDuplicates([...ig, ...fb]);
  const pairs = out.filter((p) => p.alsoOn?.length).map((p) => p.id + '+' + p.alsoOn[0].id).sort();
  assert.deepEqual(pairs, ['i1+f1', 'i2+f2', 'i3+f3']);
  assert.equal(out.length, 5, 'i4 y f4 son distintas');
  // el texto más completo se conserva
  assert.match(out.find((p) => p.id === 'i2').text, /denunciando/);
  // con huellas: textos distintos pero misma foto el mismo día → misma publicación
  const a = P('instagram', 'x', 'Texto escrito para Instagram con emojis y otra redacción distinta', '2026-11-20T10:00:00Z', 1, 'a.jpg');
  const b = P('facebook', 'y', 'Publicación de Facebook explicando la actividad de otra manera', '2026-11-20T11:00:00Z', 1, 'b.jpg');
  assert.equal(Tr.mergeDuplicates([a, b]).length, 2);
  const hashes = new Map([['a.jpg', '0f0f0f0f0f0f0f0f'], ['b.jpg', '0f0f0f0f0f0f0f0e']]);
  assert.equal(Tr.mergeDuplicates([a, b], { hashes }).length, 1);
  assert.deepEqual(Tr.dupCandidates([a, b]).map((x) => x.map((p) => p.id)), [['x', 'y']]);
  // nunca se juntan dos de la misma red ni con más de 3 días
  assert.equal(Tr.mergeDuplicates([P('instagram', '1', 'mismo texto largo de prueba aqui', '2026-11-01T00:00:00Z'), P('instagram', '2', 'mismo texto largo de prueba aqui', '2026-11-01T00:00:00Z')]).length, 2);
  assert.equal(Tr.mergeDuplicates([P('instagram', '1', 'mismo texto largo de prueba aqui', '2026-11-01T00:00:00Z'), P('facebook', '2', 'mismo texto largo de prueba aqui', '2026-11-09T00:00:00Z')]).length, 2);
});

// --- Juntar varias publicaciones de una actividad en una entrada ---
const U = require('../renderer/unify');
const mkPost = (id, day, text, n = 1, source = 'instagram') => ({ source, id, date: `2026-11-${String(day).padStart(2, '0')}T10:00:00Z`, text, permalink: '', media: Array.from({ length: n }, (_, i) => ({ type: 'image', url: `u${id}${i}.jpg` })) });
const upAll = (ps) => new Map(ps.flatMap((p) => p.media.map((m) => [T.mediaKey(m), { id: 1, url: m.url }])));

test('misma actividad: hashtag poco frecuente o texto parecido, a ≤10 días y sin las ya exportadas', () => {
  const a = mkPost('a', 10, 'Primera jornada del campamento de verano con los niños en la sierra #CampamentoElin #elin');
  const b = mkPost('b', 12, 'Seguimos con muchas actividades #CampamentoElin');
  const c = mkPost('c', 11, 'Tarde de manualidades y juegos con los niños del campamento en la sierra');
  const far = mkPost('d', 28, 'Otra cosa #CampamentoElin');
  const other = mkPost('e', 11, 'Reunión de voluntarios #elin');
  const exp = mkPost('f', 11, 'Más campamento #CampamentoElin');
  const all = [a, b, c, far, other, exp, ...Array.from({ length: 12 }, (_, i) => mkPost('z' + i, 11, 'Cosa distinta número ' + i + ' #elin'))];
  const r = U.relatedPosts(all, [a], { isExported: (p) => p.id === 'f' }).map((p) => p.id);
  assert.deepEqual(r, ['c', 'b']); // «#elin» es demasiado frecuente; d está lejos; f ya exportada
  assert.deepEqual(U.relatedPosts(all, []), []);
  assert.ok(U.overlap('Jornada de manualidades con niños', 'Cena de gala') < 0.35);
});

test('quitar lo repetido: líneas idénticas en todas las publicaciones', () => {
  const out = U.removeCommon(['Campamento 2026\nDía uno\n\nGracias a todos!', 'campamento 2026\nDía dos\n\nGracias a todos']);
  assert.deepEqual(out, ['Día uno', 'Día dos']);
  assert.deepEqual(U.removeCommon(['solo una']), ['solo una']);
});

const trio = () => [
  mkPost('1', 12, 'Campamento 2026 en la sierra\nLlegada y juegos #camp', 2),
  mkPost('2', 13, 'Campamento 2026 en la sierra\nExcursión al río #camp', 1),
  mkPost('3', 14, 'Campamento 2026 en la sierra\nFiesta final #camp', 3),
];
const types = (bs) => bs.map((b) => b.type);

test('buildDraft con unify: por jornadas, título común y sin lo repetido', () => {
  const ps = trio();
  const d = T.buildDraft(ps, upAll(ps), { unify: { layout: 'days', photos: 'each', dedupe: true } });
  assert.equal(d.title, 'Campamento 2026 en la sierra');
  const heads = d.blocks.filter((b) => b.type === 'heading');
  assert.equal(heads.length, 3);
  assert.equal(heads[0].level, 3);
  assert.match(heads[0].html, /^Jornada 1 · .*12 de noviembre/);
  assert.ok(!d.blocks.some((b) => b.type === 'separator'));
  assert.ok(!d.blocks.some((b) => b.type === 'paragraph' && /Campamento 2026/.test(b.html)));
  assert.deepEqual(types(d.blocks).filter((x) => x === 'gallery' || x === 'image'), ['gallery', 'image', 'gallery']);
  assert.deepEqual(d.tags, ['camp']);
  const keep = T.buildDraft(ps, upAll(ps), { unify: { layout: 'days', photos: 'each', dedupe: false, title: 'Mi título' } });
  assert.equal(keep.title, 'Mi título');
  assert.ok(keep.blocks.some((b) => b.type === 'paragraph' && /Campamento 2026/.test(b.html)));
});

test('buildDraft con unify: las tres opciones de fotos y «todo seguido»', () => {
  const ps = trio();
  const base = { layout: 'days', dedupe: true };
  const end = T.buildDraft(ps, upAll(ps), { unify: { ...base, photos: 'end' } }).blocks;
  assert.equal(end.filter((b) => b.type === 'gallery').length, 1);
  assert.equal(end[end.length - 1].type, 'gallery');
  assert.equal(end[end.length - 1].images.length, 6);
  const car = T.buildDraft(ps, upAll(ps), { unify: { ...base, photos: 'carousel' } }).blocks;
  assert.equal(car[0].type, 'carousel');
  assert.equal(car[0].images.length, 6);
  assert.ok(!car.some((b) => b.type === 'gallery' || b.type === 'image'));
  const flow = T.buildDraft(ps, upAll(ps), { unify: { layout: 'flow', photos: 'each', dedupe: true } }).blocks;
  assert.equal(flow.filter((b) => b.type === 'separator').length, 2);
  assert.ok(!flow.some((b) => b.type === 'heading'));
});

test('buildDraft sin unify (o con una sola publicación) no cambia', () => {
  const ps = trio();
  const strip2 = (d) => JSON.stringify(d, (k, v) => (k === 'id' && typeof v === 'string' ? undefined : v));
  const a = T.buildDraft(ps, upAll(ps), {}), b = T.buildDraft(ps, upAll(ps), { unify: undefined });
  assert.equal(strip2(a), strip2(b));
  assert.match(a.title, /^Resumen del 12 al 14 de noviembre/);
  assert.equal(a.blocks.filter((x) => x.type === 'separator').length, 2);
  const one = T.buildDraft([ps[0]], upAll(ps), { unify: { layout: 'days', photos: 'end', dedupe: true } });
  assert.equal(one.title, 'Campamento 2026 en la sierra');
  assert.ok(!one.blocks.some((x) => x.type === 'heading'));
});

// --- Imagen y texto y carrusel: opciones nuevas ---------------------------------------------------------
const mtImg = (n) => ({ id: n, url: `https://x/${n}.jpg`, alt: '' });
test('imagen y texto: tamaño, alineación, rellenar y estilo hacen ida y vuelta y salen como media-text de WordPress', () => {
  const b = { id: 'm', type: 'mediatext', img: mtImg(5), html: 'Hola<br><br>Dos', right: true, mediaWidth: 33, valign: 'bottom', fill: true, ratio: '4/3', frame: 'border', frameColor: '#cc0000', fx: 'zoom' };
  const html = T.composeBlocks([b]);
  assert.match(html, /<!-- wp:media-text \{[^}]*"mediaPosition":"right"[^}]*"mediaWidth":33[^}]*"verticalAlignment":"bottom"[^}]*"imageFill":true/);
  assert.match(html, /is-vertically-aligned-bottom is-image-fill" style="grid-template-columns:auto 33%"/);
  assert.match(html, /<style class="ecos-fx">.*ecos-mt-zoom/);
  const back = P.parseBlocks(html);
  assert.equal(back.length, 1);
  const { id: _a, ...got } = back[0], { id: _b, ...want } = b;
  assert.deepEqual(got, want);
  assert.equal(T.composeBlocks(back), html);
});
test('imagen y texto: cada marco, recorte y efecto sobrevive y los valores por defecto no añaden nada', () => {
  for (const o of [{ frame: 'rounded' }, { frame: 'circle', ratio: '1' }, { frame: 'shadow' }, { fx: 'bw' }, { ratio: '16/9' }, { valign: 'top' }, { valign: 'center' }, { mediaWidth: 66 }, { mediaWidth: 25 }]) {
    const b = { id: 'm', type: 'mediatext', img: mtImg(7), html: 'Texto', right: false, ...o };
    const back = P.parseBlocks(T.composeBlocks([b]));
    assert.equal(back.length, 1, JSON.stringify(o));
    const { id: _a, ...got } = back[0], { id: _b, ...want } = b;
    assert.deepEqual(got, want, JSON.stringify(o));
  }
  const plain = T.composeBlocks([{ id: 'm', type: 'mediatext', img: mtImg(7), html: 'T', right: false }]);
  assert.doesNotMatch(plain, /mediaWidth|verticalAlignment|imageFill|grid-template/);
  // un media-text de WordPress con cosas que Ecos no sabe escribir igual se conserva intacto
  const wp = '<!-- wp:media-text {"mediaId":3,"mediaType":"image","mediaSizeSlug":"large"} -->\n<div class="wp-block-media-text is-stacked-on-mobile"><figure class="wp-block-media-text__media"><img src="https://x/3.jpg" alt="" class="wp-image-3 size-large"/></figure><div class="wp-block-media-text__content"><!-- wp:paragraph -->\n<p>t</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:media-text -->';
  assert.equal(P.parseBlocks(wp)[0].type, 'raw');
});
test('carrusel: tamaño, proporción y estilo hacen ida y vuelta (HTML propio y Spectra) y squares equivale a 1:1', () => {
  const imgs = [mtImg(1), mtImg(2)];
  const opts = { size: 'xl', ratio: '3/4', corners: 'square', shadow: 'on', gap: '0', arrows: false, dots: false };
  const nid = (h) => norm(h).replace(/"block_id":"\w+"/, '');
  for (const o of [{}, { spectra: true }]) {
    const html = T.composeBlocks([{ id: 'c', type: 'carousel', images: imgs, ...opts }], o);
    const back = P.parseBlocks(html);
    assert.equal(back.length, 1);
    assert.equal(back[0].type, 'carousel');
    for (const [k, v] of Object.entries(opts)) assert.equal(back[0][k], v, k);
    assert.equal(nid(T.composeBlocks(back, o)), nid(html));
  }
  const html = T.composeBlocks([{ id: 'c', type: 'carousel', images: imgs, ...opts }]);
  assert.match(html, /height:70vh;aspect-ratio:3\/4/);
  assert.match(html, /\.ec-btn,#ecos-c-c \.ec-sbtn\{display:none/);
  assert.doesNotMatch(html, /class="ec-nav"/);
  const sp = T.composeBlocks([{ id: 'c', type: 'carousel', images: imgs, size: 'm', ratio: '16/9', gap: 's' }], { spectra: true });
  assert.match(sp, /"className":"ecos-carrusel ecos-cz-m ecos-cr-16-9 ecos-cg-s"/);
  assert.match(sp, /"paginateUseArrows":true/);
  assert.match(sp, /<style class="ecos-fx">.*\.ecos-carrusel\.ecos-cz-m img\{height:360px/);
  // compatibilidad: squares:true es 1:1
  const old = T.composeBlocks([{ id: 'c', type: 'carousel', images: imgs, squares: true }], { spectra: true });
  assert.match(old, /"carouselSquares":true/);
  assert.equal(P.parseBlocks(old)[0].squares, true);
  const sq = P.parseBlocks(T.composeBlocks([{ id: 'c', type: 'carousel', images: imgs, ratio: '1' }], { spectra: true }))[0];
  assert.equal(sq.ratio, '1');
});
test('foto flotante + párrafo ↔ imagen y texto: ambos resultados son bloques de WordPress que se leen de vuelta', () => {
  // lo que hace «Soltar en el texto»: imagen flotante (align + width) seguida del párrafo
  const floating = [{ id: 'i', type: 'image', img: mtImg(5), caption: '', align: 'right', width: 33, ratio: '1', frame: 'rounded' }, { id: 'p', type: 'paragraph', html: 'El texto' }];
  const back = P.parseBlocks(T.composeBlocks(floating));
  assert.deepEqual(back.map((x) => x.type), ['image', 'paragraph']);
  assert.equal(back[0].align, 'right'); assert.equal(back[0].width, 33); assert.equal(back[0].ratio, '1'); assert.equal(back[0].frame, 'rounded');
  // y lo que hace «Juntar con el texto»
  const joined = [{ id: 'm', type: 'mediatext', img: mtImg(5), html: 'El texto', right: true, mediaWidth: 33, ratio: '1', frame: 'rounded' }];
  const j = P.parseBlocks(T.composeBlocks(joined));
  assert.deepEqual(j.map((x) => x.type), ['mediatext']);
  assert.equal(j[0].html, 'El texto'); assert.equal(j[0].right, true); assert.equal(j[0].mediaWidth, 33);
});

test('imagen y texto: el texto no queda metido hacia dentro (sin el 8 % de margen de WordPress)', () => {
  const { parseBlocks } = require('../src/parseblocks');
  const html = T.composeBlocks([{ id: 'm', type: 'mediatext', img: { id: 5, url: 'https://x/a.jpg' }, html: 'Hola' }]);
  assert.match(html, /class="wp-block-media-text ecos-mt/);
  assert.match(html, /\.ecos-mt>\.wp-block-media-text__content\{padding:0 0 0 2em\}/);
  const b = parseBlocks(html).find((x) => x.type === 'mediatext');
  assert.ok(b && !b.frame && !b.ratio, 'vuelve como imagen y texto normal');
});
