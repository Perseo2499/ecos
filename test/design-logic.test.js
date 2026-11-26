// Panel de diseño universal (lógica pura): salida de cada opción, clases por dispositivo y animación, tipografía y fuentes,
// copiar y pegar estilo, estilos guardados y lo que el complemento añade (ecos-anim.js, Google Fonts).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const T = require('../src/transform');
const PB = require('../src/parseblocks');
const D = require('../renderer/design');
const DK = require('../renderer/sections');
const ROOT = path.join(__dirname, '..');

const para = (extra = {}) => ({ id: 'p1', type: 'paragraph', html: 'Hola', ...extra });
const compose = (b, o) => T.composeBlocks([b], o);
const first = (html) => html.split('\n\n')[0];

test('escala de espacios: 0, XS, S, M, L, XL', () => {
  assert.deepEqual(D.SC_N, ['0', 'XS', 'S', 'M', 'L', 'XL']);
  assert.deepEqual(D.SC, [0, 8, 16, 32, 64, 96]);
  assert.equal(D.snap(20), 16); assert.equal(D.snap(50), 64); assert.equal(D.snap(1000), 96);
});

test('espaciado exterior e interior: atributos estándar en bloques de texto, clases en el resto', () => {
  const html = first(compose(para({ mt: 16, mb: 64, p: { t: 8, r: 32, b: 8, l: 32 } })));
  assert.match(html, /"spacing":\{"margin":\{"top":"16px","bottom":"64px"\},"padding":\{"top":"8px","right":"32px","bottom":"8px","left":"32px"\}\}/);
  assert.match(html, /style="margin-top:16px;margin-bottom:64px;padding-top:8px;padding-right:32px;padding-bottom:8px;padding-left:32px"/);
  const img = compose({ id: 'i', type: 'image', img: { id: 1, url: 'https://x.org/a.jpg' }, mt: 16, p: { t: 32 } });
  assert.match(img, /class="[^"]*ecos-d-mt-16[^"]*ecos-d-pt-32/);
  assert.ok(!/style="margin/.test(img));
  assert.match(img, /\.ecos-d-mt-16\{margin-top:16px!important\}/); // su CSS va en ecos-fx
});

test('bordes, esquinas y sombra', () => {
  const html = first(compose(para({ bw: 4, bs: 'dashed', bc: '#112233', rd: 28, sh: 'l' })));
  assert.match(html, /"border":\{"width":"4px","style":"dashed","color":"#112233","radius":"28px"\}/);
  assert.match(html, /has-border-color/);
  assert.match(html, /box-shadow:0 18px 40px rgba\(0, 0, 0, 0\.3\)/);
  const tbl = compose({ id: 't', type: 'table', rows: [['a']], bw: 2, bc: '#ff0000', rd: 8, sh: 's' });
  assert.match(tbl, /ecos-d-bw-2/); assert.match(tbl, /ecos-d-bc-ff0000/); assert.match(tbl, /ecos-d-rd-8/); assert.match(tbl, /ecos-d-sh-s/);
  assert.match(tbl, /\.ecos-d-bc-ff0000\{border-color:#ff0000\}/); // color propio: regla dinámica
});

test('fondo: color, degradado e imagen con punto focal y oscurecido', () => {
  const g = DK.GRADIENTS[0].css;
  const col = compose({ id: 'm', type: 'mediatext', img: { id: 1, url: 'https://x.org/a.jpg' }, html: 'x', fbg: '#fff9e0' });
  assert.match(col, /"color":\{"background":"#fff9e0"\}/);
  const gr = compose({ id: 'v', type: 'video', video: { id: 2, url: 'https://x.org/v.mp4' }, fgr: g });
  assert.match(gr, /ecos-d-bgg-0/);
  const bgi = compose(para({ bgi: { url: 'https://x.org/f.jpg', x: 0.25, y: 0.75, dim: 40 } }));
  const m = bgi.match(/ecos-d-bgi-([0-9a-f]{8})/);
  assert.ok(m, 'clase de imagen de fondo');
  assert.match(bgi, new RegExp(`\\.ecos-d-bgi-${m[1]}\\{background-image:linear-gradient\\(rgba\\(0,0,0,0\\.4\\),rgba\\(0,0,0,0\\.4\\)\\),url\\("https://x\\.org/f\\.jpg"\\);background-size:cover;background-position:25% 75%\\}`));
  // la imagen de fondo vuelve de la regla del bloque de estilos
  const back = PB.parseBlocks(bgi)[0];
  assert.deepEqual(back.bgi, { url: 'https://x.org/f.jpg', x: 0.25, y: 0.75, dim: 40 });
  // direcciones peligrosas: no se escriben
  assert.ok(!/ecos-d-bgi/.test(compose(para({ bgi: { url: 'javascript:alert(1)', x: 0.5, y: 0.5, dim: 0 } }))));
  assert.ok(!/ecos-d-bgi/.test(compose(para({ bgi: { url: 'https://x.org/a.jpg"); x{', x: 0.5, y: 0.5, dim: 0 } }))));
});

test('vídeo de fondo: solo en portada (con ida y vuelta)', () => {
  const html = compose({ id: 'c', type: 'cover', bgVideo: { id: 9, url: 'https://x.org/v.mp4' }, dim: 40, height: 300, children: [para()] });
  assert.match(html, /"backgroundType":"video"/);
  assert.match(html, /<video class="wp-block-cover__video-background intrinsic-ignore" autoplay muted loop playsinline src="https:\/\/x\.org\/v\.mp4"/);
  assert.deepEqual(PB.parseBlocks(html)[0].bgVideo, { id: 9, url: 'https://x.org/v.mp4' });
  // en otro bloque no hace nada
  assert.ok(!/video/.test(compose(para({ bgVideo: { url: 'https://x.org/v.mp4' } }))));
});

test('ancho (contenido, ancho, completo) y alineación', () => {
  assert.match(compose({ id: 'i', type: 'image', img: { id: 1, url: 'https://x.org/a.jpg' }, wd: 'wide' }), /"align":"wide"[\s\S]*alignwide/);
  assert.match(compose({ id: 'g', type: 'group', children: [para()], width: 'full' }), /alignfull/);
  assert.match(compose({ id: 'c', type: 'columns', cols: [{ width: '50%', children: [para()] }, { width: '50%', children: [para()] }], width: 'wide' }), /alignwide/);
  assert.match(compose(para({ wd: 'full' })), /ecos-d-w-full/); // el texto no admite ancho en WordPress: clase propia
  assert.match(compose({ id: 'l', type: 'list', items: ['a'], da: 'center' }), /ecos-d-al-center/);
  assert.match(first(compose(para({ align: 'center' }))), /has-text-align-center/);
});

test('por dispositivo: clases de ocultar y tamaño de letra y espaciado en móvil (móvil < 600 px, tableta 600-1024)', () => {
  const html = compose(para({ hm: true, ht: true, hd: true, fsm: 20, pm: 16 }));
  for (const c of ['ecos-hide-m', 'ecos-hide-t', 'ecos-hide-d', 'ecos-m-fs-20', 'ecos-m-p-16']) assert.match(first(html), new RegExp(c));
  assert.match(html, /@media \(max-width:599px\)\{\.ecos-hide-m\{display:none!important\}\}/);
  assert.match(html, /@media \(min-width:600px\) and \(max-width:1024px\)\{\.ecos-hide-t\{display:none!important\}\}/);
  assert.match(html, /@media \(min-width:1025px\)\{\.ecos-hide-d\{display:none!important\}\}/);
  assert.match(html, /@media \(max-width:599px\)\{\.ecos-m-fs-20[^{]*\{font-size:20px!important\}\}/);
  assert.match(html, /@media \(max-width:599px\)\{\.ecos-m-p-16\{padding:16px!important\}\}/);
  assert.ok(D.isHidden({ hm: true }, 'mobile') && !D.isHidden({ hm: true }, 'desktop') && D.isHidden({ ht: true }, 'tablet'));
  // un valor que no está en la lista no se escribe
  assert.ok(!/ecos-m-fs-/.test(compose(para({ fsm: 21 }))));
});

test('animaciones: clases, duración y retardo; el guion va codificado (o en el complemento)', () => {
  for (const a of ['fade', 'up', 'left', 'right', 'zoom']) assert.match(first(compose(para({ an: a }))), new RegExp('ecos-anim-' + a));
  const html = compose(para({ an: 'up', ad: 900, ay: 300 }));
  assert.match(first(html), /ecos-anim-up ecos-ad-900 ecos-ay-300/);
  assert.match(html, /\.ecos-js \.ecos-anim-up:not\(\.ecos-in\)\{opacity:0;transform:translateY\(32px\)\}/);
  assert.match(html, /prefers-reduced-motion:reduce/);
  // sin complemento: el guion va en el bloque de estilos, codificado como el del carrusel (WordPress altera los && si no)
  const m = html.match(/<script class="ecos-ajs">new Function\(atob\("([A-Za-z0-9+/=]+)"\)\)\(\)<\/script>/);
  assert.ok(m, 'guion codificado en línea');
  const src = Buffer.from(m[1], 'base64').toString('utf8');
  assert.match(src, /IntersectionObserver/); assert.match(src, /prefers-reduced-motion/);
  assert.doesNotThrow(() => new Function(src));
  // con el complemento (helper) no hay guion en línea
  assert.ok(!/ecos-ajs/.test(compose(para({ an: 'up' }), { helper: true })));
  // sin animación no se añade nada
  assert.ok(!/ecos-ajs|ecos-anim/.test(compose(para())));
});

test('tipografía: interlineado, mayúsculas, degradado, resaltado y fuente de Google', () => {
  const h = compose(para({ lh: '1.6', tt: 'uppercase', spacing: '2px' }));
  assert.match(first(h), /"typography":\{"letterSpacing":"2px","lineHeight":"1.6","textTransform":"uppercase"\}/);
  assert.match(first(h), /line-height:1\.6;text-transform:uppercase/);
  const g = DK.GRADIENTS[1].css;
  const x = compose(para({ tg: g, hl: '#b3202a', gf: 'lora' }));
  assert.match(first(x), /ecos-d-tg-1 ecos-d-hl-b3202a ecos-font-lora/);
  assert.match(x, /\.ecos-font-lora[^{]*\{font-family:"Lora",system-ui,serif\}/);
  assert.match(x, /text-decoration-thickness:\.32em/);
  assert.match(x, /-webkit-background-clip:text/);
  // la fuente de Google sustituye a la de sistema
  const f = first(compose(para({ font: 'serif', gf: 'inter' })));
  assert.ok(!/font-family/.test(f) && /ecos-font-inter/.test(f));
  // un bloque que no es de texto lo pone con clases
  assert.match(compose({ id: 'g', type: 'group', children: [para()], lh: '1.4', tt: 'capitalize' }), /ecos-d-lh-14 ecos-d-tt-2/);
  // degradado de texto distinto de los de la lista: no se escribe
  assert.ok(!/ecos-d-tg/.test(compose(para({ tg: 'linear-gradient(red,blue)' }))));
});

test('fuentes de Google: las 20 del encargo, enlace solo con las usadas, y el complemento las conoce', () => {
  assert.deepEqual(D.FONTS.map((f) => f.name), ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Nunito', 'Raleway', 'Merriweather', 'Playfair Display', 'Lora', 'Source Serif', 'Work Sans', 'Rubik', 'Karla', 'DM Sans', 'Quicksand', 'Oswald', 'Bebas Neue', 'Caveat']);
  assert.equal(D.fontsUrl(['inter', 'playfair-display', 'inter', 'nope']), 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Playfair+Display:wght@400;700&display=swap');
  assert.equal(D.fontsUrl([]), '');
  const php = fs.readFileSync(path.join(ROOT, 'wp-plugin', 'ecos', 'ecos.php'), 'utf8');
  const map = Object.fromEntries([...php.matchAll(/'([a-z-]+)' => '([^']+)',/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(map), D.FONTS.map((f) => f.slug));
  for (const f of D.FONTS) assert.equal(map[f.slug], f.q, f.slug);
  assert.match(php, /ecos_wp_enqueue_fonts\( \$post->post_content \)/); // solo las familias de esa entrada
  assert.match(php, /ecos-anim\.js/);
});

test('el CSS común del complemento trae las clases de diseño y existe ecos-anim.js', () => {
  require('../scripts/build-wp-plugin').PLUGIN; // asegura que el módulo carga
  const B = require('../scripts/build-wp-plugin');
  B.build(path.join(require('os').tmpdir(), 'ecos-dz-test.zip'));
  const css = fs.readFileSync(path.join(B.PLUGIN, 'assets', 'ecos.css'), 'utf8');
  for (const c of ['ecos-hide-m', 'ecos-m-fs-20', 'ecos-anim-up', 'ecos-d-mt-16', 'ecos-font-caveat', 'ecos-d-sh-m']) assert.match(css, new RegExp(c));
  const js = fs.readFileSync(path.join(B.PLUGIN, 'assets', 'ecos-anim.js'), 'utf8');
  assert.match(js, /IntersectionObserver/); assert.match(js, /prefers-reduced-motion/);
});

test('la política de privacidad avisa de que Google Fonts conecta con Google', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'politica-privacidad-estadisticas.md'), 'utf8');
  assert.match(doc, /Google Fonts conecta con Google/);
  assert.match(doc, /fonts\.googleapis\.com/);
});

test('copiar estilo: solo el diseño, nunca el contenido', () => {
  const src = para({ html: 'Texto que NO se copia', mt: 16, bw: 2, bc: '#ff8800', rd: 16, sh: 'm', bg: '#fff9e0', size: '24px', align: 'center', hm: true, an: 'zoom' });
  const s = D.pick(src);
  assert.deepEqual(s, { mt: 16, bw: 2, bc: '#ff8800', rd: 16, sh: 'm', hm: true, an: 'zoom', fbg: '#fff9e0', size: '24px' });
  assert.ok(!JSON.stringify(s).includes('NO se copia') && !('html' in s) && !('id' in s) && !('type' in s));
});

test('pegar estilo: sustituye el diseño y conserva el contenido (también entre tipos distintos)', () => {
  const style = D.pick(para({ mt: 32, p: { t: 16, r: 16, b: 16, l: 16 }, bw: 4, rd: 8, fbg: undefined, bg: '#eeeeee', gf: 'lora', an: 'up' }));
  // a otra tarjeta con su propio diseño: el anterior desaparece
  const dst = { id: 'g', type: 'group', children: [para()], pad: 'm', radius: 24, shadow: true, border: '#000000', mb: 64, width: 'wide' };
  D.apply(dst, style);
  assert.equal(dst.children.length, 1);
  assert.ok(!('pad' in dst) && !('radius' in dst) && !('shadow' in dst) && !('border' in dst) && !('mb' in dst) && !('width' in dst));
  assert.equal(dst.mt, 32); assert.equal(dst.bw, 4); assert.equal(dst.rd, 8); assert.equal(dst.bg, '#eeeeee'); assert.equal(dst.gf, 'lora');
  // a un bloque cuyo fondo no es b.bg (imagen): el fondo va a fbg
  const img = { id: 'i', type: 'image', img: { id: 1, url: 'https://x.org/a.jpg' }, caption: 'Pie' };
  D.apply(img, style);
  assert.equal(img.fbg, '#eeeeee'); assert.ok(!('bg' in img)); assert.equal(img.caption, 'Pie');
  // el formato de texto (tamaño, fuente…) solo pasa a bloques de texto
  const withSize = D.pick(para({ size: '30px', color: '#123456' }));
  const h = { id: 'h', type: 'heading', level: 2, html: 'T' }; D.apply(h, withSize);
  assert.equal(h.size, '30px'); assert.equal(h.color, '#123456');
  const im2 = { id: 'i2', type: 'image', img: null }; D.apply(im2, withSize);
  assert.ok(!('size' in im2));
  // una sección con esquinas, sombra y borde de siempre se copia como diseño normal
  const grp = D.pick({ id: 'g2', type: 'group', pad: 's', radius: 12, shadow: true, border: '#e5e7eb', children: [] });
  assert.deepEqual(grp, { rd: 12, sh: 'm', bw: 1, bc: '#e5e7eb', p: { t: 24, r: 24, b: 24, l: 24 } });
  // y sale bien escrito en otro bloque
  const p2 = para(); D.apply(p2, grp);
  assert.match(first(compose(p2)), /"border":\{"width":"1px","style":"solid","color":"#e5e7eb","radius":"12px"\}/);
});

test('un estilo copiado o guardado se limpia: valores no permitidos se descartan', () => {
  const c = D.clean({ mt: 16, bw: 3, bc: 'url(x)', rd: -4, sh: 'xl', fbg: 'red;}', fgr: 'linear-gradient(red,blue)', an: 'spin', hm: 1, gf: 'comic', evil: 1, html: 'x', size: '99999px', color: '#abc', lh: '9' });
  assert.deepEqual(c, { mt: 16, hm: true, color: '#abc' });
});

test('estilos guardados: nombre, validación y aplicación', () => {
  const b = para({ bw: 2, bc: '#ff8800', rd: 16, hm: true });
  const s = D.makeSaved('  Tarjeta   naranja  ', b);
  assert.equal(s.name, 'Tarjeta naranja');
  assert.deepEqual(s.style, { bw: 2, bc: '#ff8800', rd: 16, hm: true });
  assert.equal(D.makeSaved('x'.repeat(100), b).name.length, 40);
  const list = D.validSaved([s, { name: '', style: {} }, { name: 'sin estilo' }, null, { name: 'Raro', style: { mt: 16, bc: 'url(javascript:1)' } }]);
  assert.deepEqual(list.map((x) => x.name), ['Tarjeta naranja', 'Raro']);
  assert.deepEqual(list[1].style, { mt: 16 });
  const dst = { id: 'q', type: 'quote', html: 'Cita', cite: 'Yo' };
  D.apply(dst, list[0].style);
  assert.equal(dst.html, 'Cita'); assert.equal(dst.bw, 2); assert.equal(dst.hm, true);
  assert.deepEqual(D.summary(s.style), ['bordes', 'dispositivos']);
  // el estilo guardado no lleva contenido ni identificadores
  assert.ok(!/Cita|html|"id"/.test(JSON.stringify(s)));
});

test('la salida con diseño es siempre un bloque que Ecos vuelve a reconocer', () => {
  const all = { mt: 16, mb: 32, p: { t: 8, r: 16, b: 8, l: 16 }, bw: 2, bs: 'dotted', bc: '#336699', rd: 8, sh: 's', hm: true, fsm: 16, an: 'fade', lh: '1.2', tt: 'lowercase', hl: '#fd9800', gf: 'karla' };
  for (const t of [para(), { id: 'h', type: 'heading', level: 3, html: 'T' }, { id: 'l', type: 'list', items: ['a', 'b'] }, { id: 'q', type: 'quote', html: 'c', cite: 'd' }]) {
    const b = { ...t }; D.apply(b, all);
    const back = PB.parseBlocks(compose(b))[0];
    assert.equal(back.type, t.type);
    const keys = Object.keys(D.pick(b)).sort();
    assert.deepEqual(Object.keys(D.pick(back)).sort(), keys, t.type);
  }
});
