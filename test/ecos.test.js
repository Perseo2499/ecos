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
