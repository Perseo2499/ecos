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
