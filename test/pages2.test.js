// Editor de páginas (fase 2): diseño avanzado, secciones listas, lista con iconos, mapa y bloques nuevos.
// composeBlocks → parseBlocks debe devolver lo mismo.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/transform');
const P = require('../src/parseblocks');
const S = require('../renderer/sections');
const CT = require('../renderer/templates');

const IMG = { id: 7, url: 'https://x/a.jpg', alt: 'Una foto' };
const para = (html, extra = {}) => ({ id: 'p' + html, type: 'paragraph', html, ...extra });
const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'id' && typeof x === 'string' ? undefined : x)));
const rt = (blocks) => P.parseBlocks(T.composeBlocks(blocks));
// lo que escribe el editor al aplicar una plantilla (ids nuevos) para poder componer
let n = 0;
const build = (list) => (list || []).map(({ type, children, cols, ...rest }) => ({
  id: 'x' + n++, type, ...JSON.parse(JSON.stringify(rest)),
  ...(children ? { children: build(children) } : {}),
  ...(cols ? { cols: cols.map((c) => ({ width: c.width, children: build(c.children) })) } : {}),
}));

test('paleta y degradados: colores de la marca y degradados seguros', () => {
  for (const c of ['#fd9800', '#b3202a', '#0f172a', '#fff9e0', '#ffffff', '#000000']) assert.ok(S.PALETTE.includes(c), c);
  assert.equal(S.GRADIENTS.length, 6);
  for (const g of S.GRADIENTS) assert.equal(S.safeGradient(g.css), g.css);
  assert.equal(S.safeGradient('url(javascript:alert(1))'), '');
  assert.equal(S.safeGradient('linear-gradient(red,blue)'), '');
});

test('sección: degradado, margen exterior y borde hacen la ida y vuelta', () => {
  const g = { id: 'g', type: 'group', gradient: S.GRADIENTS[0].css, color: '#ffffff', pad: 'm', mt: 32, mb: 0, radius: 12, border: '#e5e7eb', shadow: true, children: [para('Hola')] };
  const html = T.composeBlocks([g]);
  assert.match(html, /"color":\{"gradient":"linear-gradient\(135deg,#fd9800 0%,#b3202a 100%\)","text":"#ffffff"\}/);
  assert.match(html, /"margin":\{"top":"32px","bottom":"0px"\}/);
  assert.match(html, /"border":\{"radius":"12px","width":"1px","color":"#e5e7eb","style":"solid"\}/);
  assert.match(html, /style="[^"]*background:linear-gradient\(135deg,#fd9800 0%,#b3202a 100%\)[^"]*margin-top:32px;margin-bottom:0px/);
  const back = rt([g]);
  assert.equal(back[0].type, 'group');
  assert.deepEqual(strip(back[0]), strip({ ...g, children: [para('Hola')] }));
  assert.equal(T.composeBlocks(back), html);
});

test('sección: un degradado raro o un margen ajeno la dejan como bloque de WordPress', () => {
  const mk = (st) => `<!-- wp:group {"style":${JSON.stringify(st)},"layout":{"type":"constrained"}} -->\n<div class="wp-block-group"></div>\n<!-- /wp:group -->`;
  assert.equal(P.parseBlocks(mk({ color: { gradient: 'var(--wp--preset--gradient--x)' } }))[0].type, 'raw');
  assert.equal(P.parseBlocks(mk({ spacing: { margin: { left: '10px' } } }))[0].type, 'raw');
  assert.equal(P.parseBlocks(mk({ spacing: { blockGap: '1em' } }))[0].type, 'raw');
  assert.equal(P.parseBlocks(mk({ border: { width: '4px', color: '#000000', style: 'dashed' } }))[0].type, 'raw');
});

test('columnas: separación, margen, degradado y fondo hacen la ida y vuelta', () => {
  const c = { id: 'c', type: 'columns', gap: 32, mt: 16, mb: 48, gradient: S.GRADIENTS[4].css, cols: [{ width: '50%', children: [para('A')] }, { width: '50%', children: [para('B')] }] };
  const html = T.composeBlocks([c]);
  assert.match(html, /<!-- wp:columns \{"style":\{"color":\{"gradient":"[^"]+"\},"spacing":\{"blockGap":"32px","margin":\{"top":"16px","bottom":"48px"\}\}\}\} -->/);
  assert.match(html, /<div class="wp-block-columns has-background" style="background:linear-gradient\(180deg,#fff9e0 0%,#ffe9a8 100%\);margin-top:16px;margin-bottom:48px">/);
  const back = rt([c]);
  assert.equal(back[0].type, 'columns');
  assert.equal(back[0].gap, 32); assert.equal(back[0].mt, 16); assert.equal(back[0].mb, 48); assert.equal(back[0].gradient, c.gradient);
  assert.equal(T.composeBlocks(back), html);
  // con color de fondo en lugar de degradado
  const d = { id: 'd', type: 'columns', bg: '#fff9e0', cols: [{ width: '50%', children: [] }, { width: '50%', children: [] }] };
  assert.equal(rt([d])[0].bg, '#fff9e0');
  assert.equal(T.composeBlocks(rt([d])), T.composeBlocks([d]));
  // atributos ajenos: se conservan tal cual
  const raw = '<!-- wp:columns {"style":{"spacing":{"padding":{"top":"1em"}}}} -->\n<div class="wp-block-columns"></div>\n<!-- /wp:columns -->';
  assert.equal(P.parseBlocks(raw)[0].type, 'raw');
});

test('columnas sin diseño avanzado se escriben igual que antes', () => {
  const c = { id: 'c', type: 'columns', cols: [{ width: '50%', children: [para('A')] }, { width: '50%', children: [para('B')] }] };
  const html = T.composeBlocks([c]);
  assert.match(html, /^<!-- wp:columns -->\n<div class="wp-block-columns">/);
});

test('portada: punto focal, parallax, margen y degradado hacen la ida y vuelta', () => {
  const cv = { id: 'v', type: 'cover', img: IMG, overlay: '#000000', dim: 40, height: 400, focalPoint: { x: 0.3, y: 0.7 }, parallax: true, mt: 24, mb: 24, children: [{ id: 'h', type: 'heading', level: 2, html: 'Hola' }] };
  const html = T.composeBlocks([cv]);
  assert.match(html, /"focalPoint":\{"x":0\.3,"y":0\.7\},"hasParallax":true/);
  assert.match(html, /class="wp-block-cover has-parallax"/);
  assert.match(html, /<div role="img" class="wp-block-cover__image-background wp-image-7 has-parallax" style="background-position:30% 70%;background-image:url\(https:\/\/x\/a\.jpg\)"/);
  assert.match(html, /"style":\{"spacing":\{"margin":\{"top":"24px","bottom":"24px"\}\}\}/);
  const back = rt([cv]);
  assert.equal(back[0].type, 'cover');
  assert.deepEqual(back[0].focalPoint, { x: 0.3, y: 0.7 }); assert.equal(back[0].parallax, true);
  assert.equal(back[0].img.url, IMG.url); assert.equal(back[0].img.id, 7); assert.equal(back[0].mt, 24);
  assert.equal(T.composeBlocks(back), html);
  // sin parallax: la imagen lleva su punto focal en object-position
  const f = { ...cv, parallax: false };
  const h2 = T.composeBlocks([f]);
  assert.match(h2, /<img class="wp-block-cover__image-background wp-image-7"[^>]*style="object-position:30% 70%"/);
  const b2 = rt([f]);
  assert.deepEqual(b2[0].focalPoint, { x: 0.3, y: 0.7 }); assert.ok(!b2[0].parallax);
  assert.equal(T.composeBlocks(b2), h2);
  // punto focal en el centro: no se escribe
  assert.doesNotMatch(T.composeBlocks([{ ...cv, parallax: false, focalPoint: { x: 0.5, y: 0.5 } }]), /focalPoint/);
});

test('portada con degradado como capa', () => {
  const cv = { id: 'v', type: 'cover', img: null, overlay: '#000000', dim: 100, height: 300, gradient: S.GRADIENTS[3].css, children: [] };
  const html = T.composeBlocks([cv]);
  assert.match(html, /"customGradient":"linear-gradient\(135deg,#1e293b 0%,#0f172a 100%\)"/);
  assert.match(html, /class="wp-block-cover__background has-background-dim has-background-gradient[ "]/);
  const back = rt([cv]);
  assert.equal(back[0].type, 'cover'); assert.equal(back[0].gradient, cv.gradient);
  assert.equal(T.composeBlocks(back), html);
});

test('lista con iconos: símbolo por elemento, clase ecos-iconos y estilos mínimos en el bloque de efectos', () => {
  const l = { id: 'l', type: 'list', ordered: false, items: ['Uno', 'Dos <strong>y</strong> tres'], icons: ['✔', '★'] };
  const html = T.composeBlocks([l]);
  assert.match(html, /<!-- wp:list \{"className":"ecos-iconos"\} -->/);
  assert.match(html, /<ul class="wp-block-list ecos-iconos">/);
  assert.match(html, /<li><span class="ecos-ico" aria-hidden="true">✔<\/span> Uno<\/li>/);
  assert.match(html, /<style class="ecos-fx">[^<]*\.ecos-iconos/);
  const back = rt([l]);
  assert.equal(back.length, 1); // el bloque de efectos no vuelve como bloque
  assert.deepEqual(back[0].icons, ['✔', '★']);
  assert.deepEqual(back[0].items, ['Uno', 'Dos <strong>y</strong> tres']);
  assert.equal(T.composeBlocks(back), html);
  // una lista normal no cambia
  assert.doesNotMatch(T.composeBlocks([{ id: 'n', type: 'list', ordered: false, items: ['a'] }]), /ecos-iconos|ecos-fx/);
  // un símbolo con etiquetas no se escribe
  assert.doesNotMatch(T.composeBlocks([{ ...l, icons: ['<b>', '"x'] }]), /<b>|"x/);
});

test('mapa: dirección → iframe de Google Maps y vuelta', () => {
  const m = { id: 'm', type: 'map', address: 'Calle Mayor 1, 28013 Madrid', height: 420, radius: 24 };
  const html = T.composeBlocks([m]);
  assert.match(html, /^<!-- wp:html -->\n<div class="ecos-mapa" style="border-radius:24px;overflow:hidden;line-height:0">/);
  assert.match(html, /<iframe src="https:\/\/www\.google\.com\/maps\?q=Calle%20Mayor%201%2C%2028013%20Madrid&amp;output=embed" width="100%" height="420"/);
  const back = rt([m]);
  assert.equal(back.length, 1); assert.equal(back[0].type, 'map');
  assert.equal(back[0].address, m.address); assert.equal(back[0].height, 420); assert.equal(back[0].radius, 24);
  assert.equal(T.composeBlocks(back), html);
  // sin dirección no se escribe nada; una dirección con comillas o etiquetas queda escapada
  assert.equal(T.composeBlocks([{ id: 'e', type: 'map', address: '  ' }]), '');
  const evil = T.composeBlocks([{ id: 'e', type: 'map', address: '"><script>x</script>' }]);
  assert.doesNotMatch(evil, /<script>/);
  // un iframe de otro sitio sigue siendo un bloque de WordPress
  const other = '<!-- wp:html -->\n<div class="ecos-mapa"><iframe src="https://evil.example/?q=a"></iframe></div>\n<!-- /wp:html -->';
  assert.equal(P.parseBlocks(other)[0].type, 'raw');
});

test('tarjeta y cifra: presets de sección que vuelven como sección', () => {
  for (const mk of [S.PRESETS.card, S.PRESETS.figure]) {
    const [b] = build([mk()]);
    const html = T.composeBlocks([b]);
    const back = rt([b]);
    assert.equal(back[0].type, 'group');
    assert.equal(T.composeBlocks(back), html);
  }
  const [card] = build([S.PRESETS.card()]);
  card.children[0].img = IMG; card.children[1].html = 'Título'; card.children[2].html = 'Texto'; card.children[3].html = 'Saber más'; card.children[3].url = 'https://x/';
  const html = T.composeBlocks([card]);
  assert.match(html, /"border":\{"radius":"12px","width":"1px","color":"#e5e7eb","style":"solid"\}/);
  assert.match(html, /"shadow":/);
  const back = rt([card]);
  assert.deepEqual(back[0].children.map((x) => x.type), ['image', 'heading', 'paragraph', 'buttons']);
  assert.equal(back[0].border, '#e5e7eb'); assert.equal(back[0].shadow, true);
  const [fig] = build([S.PRESETS.figure()]);
  fig.children[0].html = '250'; fig.children[1].html = 'Personas';
  const fh = T.composeBlocks([fig]);
  assert.match(fh, /"fontSize":"56px"/); assert.match(fh, /#fd9800/);
  const fb = rt([fig]);
  assert.equal(fb[0].children[0].size, '56px'); assert.equal(fb[0].children[0].color, '#fd9800');
});

test('secciones listas: cada una se compone, vuelve igual y tiene su miniatura', () => {
  assert.deepEqual(S.SECTIONS.map((x) => x.id), ['cabecera', 'tarjetas', 'colabora', 'faq', 'testimonio', 'cifras', 'alternos', 'equipo']);
  for (const sec of S.SECTIONS) {
    const blocks = build(sec.blocks);
    // con textos rellenos para que se escriba algo
    const fill = (list) => list.forEach((b) => {
      if (b.type === 'heading' || b.type === 'paragraph' || b.type === 'buttons') b.html = b.html || 'Texto';
      if (b.type === 'details') b.summary = 'Pregunta';
      if (b.type === 'quote') b.html = 'Cita';
      if (b.type === 'image' && !b.img) b.img = IMG;
      for (const l of b.children ? [b.children] : b.cols ? b.cols.map((c) => c.children) : []) fill(l);
    });
    fill(blocks);
    const html = T.composeBlocks(blocks);
    const back = P.parseBlocks(html);
    assert.equal(back.length, blocks.length, sec.id);
    const types = (l) => l.flatMap((b) => [b.type, ...(b.children ? types(b.children) : b.cols ? b.cols.flatMap((c) => types(c.children)) : [])]);
    assert.ok(!types(back).includes('raw'), sec.id + ' sin raw');
    assert.deepEqual(types(back), types(blocks), sec.id);
    assert.equal(T.composeBlocks(back), html, sec.id);
    assert.match(S.thumbHtml(sec.thumb), /class="sg-th"/);
  }
});

test('secciones: «Cabecera» es una portada; «Tres tarjetas», 3 columnas con 4 bloques; «Cifras», 4 columnas', () => {
  const by = (id) => S.SECTIONS.find((x) => x.id === id).blocks;
  assert.equal(by('cabecera')[0].type, 'cover');
  assert.deepEqual(by('cabecera')[0].children.map((x) => x.type), ['heading', 'paragraph', 'buttons']);
  const cards = by('tarjetas')[0];
  assert.equal(cards.cols.length, 3);
  assert.deepEqual(cards.cols[0].children[0].children.map((x) => x.type), ['image', 'heading', 'paragraph', 'buttons']);
  assert.equal(by('cifras')[0].cols.length, 4);
  assert.equal(by('alternos').length, 2);
  assert.equal(by('equipo')[0].cols[0].children[0].frame, 'circle');
  assert.equal(by('faq')[0].children.filter((x) => x.type === 'details').length, 3);
  // los textos de ejemplo son marcadores, no texto escrito
  assert.equal(by('cabecera')[0].children[0].html, ''); assert.ok(by('cabecera')[0].children[0].ph);
});

test('«Guardar como sección»: sin fotos ni identificadores, conserva el diseño', () => {
  const cv = { id: 'v', type: 'cover', img: IMG, overlay: '#000000', dim: 40, height: 400, parallax: true, gradient: S.GRADIENTS[0].css, children: [{ id: 'i', type: 'image', img: IMG, caption: 'pie' }, para('Texto')] };
  const sec = S.makeUserSection('  Mi portada  ', cv);
  assert.equal(sec.name, 'Mi portada');
  assert.equal(sec.blocks.length, 1);
  assert.equal(sec.blocks[0].id, undefined); assert.equal(sec.blocks[0].img, null);
  assert.equal(sec.blocks[0].parallax, true); assert.equal(sec.blocks[0].gradient, cv.gradient);
  assert.equal(sec.blocks[0].children[0].img, null); assert.equal(sec.blocks[0].children[0].caption, '');
  assert.equal(cv.img.url, IMG.url); // no toca el original
  assert.ok(!JSON.stringify(sec).includes('x/a.jpg'));
  assert.equal(S.validUserSections([sec, null, { name: 'x' }, { name: 'y', blocks: [] }]).length, 1);
  const cols = S.makeUserSection('C', { id: 'c', type: 'columns', gap: 24, cols: [{ width: '50%', children: [{ id: 'g', type: 'gallery', images: [IMG], columns: 2 }] }, { width: '50%', children: [] }] });
  assert.deepEqual(cols.blocks[0].cols[0].children[0].images, []); assert.equal(cols.blocks[0].gap, 24);
  assert.ok(CT.blocksToTemplate([cv])[0]);
});

test('anidar diseño avanzado: tarjetas con margen dentro de columnas con separación', () => {
  const c = { id: 'c', type: 'columns', gap: 24, cols: [0, 1].map((k) => ({ width: '50%', children: [{ id: 'g' + k, type: 'group', pad: 's', mt: 8, gradient: S.GRADIENTS[1].css, children: [para('x' + k)] }] })) };
  const html = T.composeBlocks([c]);
  const back = rt([c]);
  assert.equal(back[0].cols[1].children[0].mt, 8);
  assert.equal(T.composeBlocks(back), html);
});
