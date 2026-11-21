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
