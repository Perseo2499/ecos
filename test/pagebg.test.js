// Fondo de la página: CSS generado, seguridad de la URL, ida y vuelta composición → lectura, y que sin fondo nada cambia.
const test = require('node:test');
const assert = require('node:assert/strict');
const PB = require('../renderer/pagebg');
const T = require('../src/transform');
const P = require('../src/parseblocks');

const IMG = { id: 7, url: 'https://www.asociacionelin.com/wp-content/uploads/fondo.jpg' };
const para = { id: 'a', type: 'paragraph', html: 'Hola' };

test('sin pageBg no se genera nada y la composición es idéntica', () => {
  assert.equal(PB.css(null), '');
  assert.equal(PB.block(undefined), '');
  assert.equal(PB.block({ img: null, preset: null }), '');
  assert.equal(PB.block({ img: { url: 'javascript:alert(1)' } }), '');
  assert.equal(T.composeBlocks([para], { pageBg: null }), T.composeBlocks([para]));
  assert.ok(!T.composeBlocks([para], {}).includes('ecos-pagebg'));
});

test('CSS con imagen: cubrir, fija, tarjeta por defecto, cabecera blanca', () => {
  const css = PB.css({ img: IMG });
  assert.match(css, /body:has\(\.ecos-page-bg\)\{[^}]*url\("https:\/\/www\.asociacionelin\.com\/wp-content\/uploads\/fondo\.jpg"\)/);
  assert.match(css, /background-size:cover/); assert.match(css, /background-attachment:fixed/);
  assert.match(css, /max-width:960px/); assert.match(css, /border-radius:16px/); assert.match(css, /margin:40px auto/);
  assert.match(css, /#masthead,html body:has\(\.ecos-page-bg\) \.site-header\{background-color:#fff/);
  assert.match(css, /@media \(max-width:767px\)[^]*background-attachment:scroll/);
  assert.ok(!css.includes('::before'));
  for (const s of ['#page', '.site-content', '.ast-container', '.ast-separate-container .ast-article-single', '.ast-plain-container .site-content']) assert.ok(css.includes(s), s);
});

test('CSS: opciones de scroll, repetir, velo, desenfoque, ancho, esquinas, sombra, margen y cabecera', () => {
  assert.match(PB.css({ img: IMG, fixed: false }), /background-attachment:scroll!important\}/);
  const rep = PB.css({ img: IMG, mode: 'repeat' });
  assert.match(rep, /background-repeat:repeat/); assert.doesNotMatch(rep, /background-size:cover/);
  const ov = PB.css({ img: IMG, overlay: { color: 'orange', opacity: 35 } });
  assert.match(ov, /linear-gradient\(rgba\(253,152,0,0\.35\),rgba\(253,152,0,0\.35\)\),url\(/);
  assert.match(PB.css({ img: IMG, overlay: { color: 'black', opacity: 500 } }), /rgba\(0,0,0,0\.80\)/); // tope 80 %
  const bl = PB.css({ img: IMG, blur: 6 });
  assert.match(bl, /::before\{[^}]*filter:blur\(6px\)/); assert.match(bl, /position:fixed/);
  assert.match(PB.css({ img: IMG, blur: 6, fixed: false }), /::before\{content:"";position:absolute/);
  assert.match(PB.css({ img: IMG, blur: 99 }), /blur\(12px\)/);
  assert.match(PB.css({ img: IMG, width: 760 }), /max-width:760px/);
  assert.match(PB.css({ img: IMG, width: 1200 }), /max-width:1200px/);
  assert.match(PB.css({ img: IMG, width: 555 }), /max-width:960px/);
  assert.match(PB.css({ img: IMG, radius: 0, shadow: 'none', margin: 0 }), /margin:0px auto[^}]*border-radius:0px[^}]*box-shadow:none/);
  assert.match(PB.css({ img: IMG, shadow: 'strong' }), /box-shadow:0 12px 48px/);
  const hd = PB.css({ img: IMG, header: true });
  assert.match(hd, /#masthead[^{]*\{background:transparent!important/); assert.doesNotMatch(hd, /site-header\{background-color:#fff/);
});

test('fondos sugeridos: cada uno genera CSS sin foto', () => {
  for (const k of Object.keys(PB.PRESETS)) {
    const css = PB.css({ preset: k });
    assert.match(css, /gradient\(/, k); assert.ok(!css.includes('url('), k);
  }
  assert.match(PB.css({ preset: 'puntos' }), /background-size:22px 22px/);
  assert.equal(PB.css({ preset: 'no-existe' }), '');
});

test('seguridad: la URL no puede inyectar CSS ni HTML', () => {
  assert.equal(PB.safeUrl('javascript:alert(1)'), '');
  assert.equal(PB.safeUrl('data:image/png;base64,AAAA'), '');
  assert.equal(PB.safeUrl('//evil.com/x.jpg'), '');
  assert.equal(PB.safeUrl('https://a.com/x y.jpg'), '');
  assert.equal(PB.safeUrl('https://a.com/x\n.jpg'), '');
  const evil = 'https://a.com/x.jpg");}</style><script>alert(1)</script>body{background:url(\'';
  const u = PB.safeUrl(evil);
  assert.ok(u && !/["'()<>\\ ]/.test(u), u);
  const blk = PB.block({ img: { id: 1, url: evil }, preset: null });
  assert.ok(!blk.includes('<script'));
  assert.equal((blk.match(/<\/style>/g) || []).length, 1);
  assert.equal((blk.match(/<style/g) || []).length, 1);
  const url = blk.match(/url\("([^"]*)"\)/)[1];
  assert.ok(!/["'()<>\\ ]/.test(url), url);
  // el JSON del atributo tampoco puede cerrar la comilla simple ni abrir etiquetas
  const attr = blk.match(/data-ecos='([^']*)'/)[1];
  assert.ok(!attr.includes('<') && !attr.includes('>'));
  // valores sueltos se sanean
  const c = PB.normalize({ img: IMG, overlay: { color: 'red;}', opacity: '9e9' }, width: '1; x', radius: -5, blur: 'x', shadow: '1px', mode: 'zz' });
  assert.deepEqual([c.overlay.color, c.overlay.opacity, c.width, c.radius, c.blur, c.shadow, c.mode], ['white', 80, 960, 0, 0, 'soft', 'cover']);
});

test('ida y vuelta: composición → lectura del pageBg, y el bloque no aparece como bloque visible', () => {
  const pb = { img: IMG, preset: null, fixed: false, mode: 'repeat', overlay: { color: 'black', opacity: 25 }, blur: 3, width: 1200, radius: 24, shadow: 'strong', margin: 60, header: true };
  const html = T.composeBlocks([para], { pageBg: pb });
  assert.ok(html.indexOf('<!-- wp:paragraph') < html.indexOf('ecos-pagebg'));
  assert.ok(html.includes('<div class="ecos-page-bg" hidden></div>'));
  assert.deepEqual(PB.parse(html), pb);
  const back = P.parseBlocks(html);
  assert.equal(back.length, 1); assert.equal(back[0].type, 'paragraph');
  // recomponer con lo leído da el mismo contenido
  const strip = (x) => x.replace(/ecos-[cm]-[a-z0-9]+/g, '');
  assert.equal(strip(T.composeBlocks(back, { pageBg: PB.parse(html) })), strip(html));
  // con un fondo sugerido también
  const pre = T.composeBlocks([para], { pageBg: { preset: 'arena' } });
  assert.equal(PB.parse(pre).preset, 'arena'); assert.equal(PB.parse(pre).img, null);
  // sin bloque, o con datos dañados, no hay pageBg
  assert.equal(PB.parse(T.composeBlocks([para])), null);
  assert.equal(PB.parse('<style class="ecos-pagebg" data-ecos=\'{roto\'></style>'), null);
});

test('convive con el bloque de efectos de Ecos y no deja bloques «raw»', () => {
  const b = { id: 'h', type: 'heading', level: 2, html: 'Título', fx: 'sombra' };
  const html = T.composeBlocks([b, para], { pageBg: { preset: 'niebla' } });
  assert.ok(html.includes('ecos-pagebg'));
  assert.equal(P.parseBlocks(html).filter((x) => x.type === 'raw').length, 0);
});
