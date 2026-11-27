// Validación de los bloques que genera Ecos contra el propio WordPress: se registran los bloques de serie
// (@wordpress/block-library) y se comprueba que el HTML de cada bloque coincide con lo que genera su save().
// Si no coincide, WordPress mostraría «Este bloque contiene contenido inesperado o no válido».
// Excluidos a propósito: core/html (HTML libre: estilos ecos-fx, carrusel, mosaico, mapa) y uagb/* (Spectra, no está
// en block-library).
const test = require('node:test');
const assert = require('node:assert/strict');

// Las librerías de WordPress esperan un navegador: jsdom global
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const k of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'CustomEvent', 'Event',
  'requestAnimationFrame', 'cancelAnimationFrame', 'SVGElement', 'HTMLIFrameElement', 'DocumentFragment', 'NodeFilter', 'Text']) {
  try { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }); } catch { /* ya existe */ }
}
const origWarn = console.warn, origError = console.error;
console.warn = () => {}; console.error = () => {}; // avisos de React/memo al cargar la librería
const WP = require('@wordpress/blocks');
const lib = require('@wordpress/block-library');
lib.registerCoreBlocks();
console.warn = origWarn; console.error = origError;

const T = require('../src/transform');
const DK = require('../renderer/sections');

const STRICT = process.env.ECOS_BLOCKS_STRICT === '1';
const nameOf = (b) => (b.name === 'core/missing' && b.attributes && b.attributes.originalName) || b.name;
const EXCLUDED = (name) => name === 'core/html' || name.startsWith('uagb/');
const IMG = { id: 7, url: 'https://x.org/a.jpg', alt: 'Una foto' };
const IMG2 = { id: 8, url: 'https://x.org/b.jpg', alt: 'Otra' };
const IMG3 = { url: 'https://x.org/c.jpg' }; // sin número de biblioteca
const VID = { id: 9, url: 'https://x.org/v.mp4' };
let n = 0;
const P = (html, extra = {}) => ({ id: 'p' + n++, type: 'paragraph', html, ...extra });

// validateBlock escribe en la consola: se silencia y se resume el motivo
const quiet = (fn) => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; try { return fn(); } finally { console.warn = w; console.error = e; } };
const why = (issues) => issues.map((i) => i.args || []).filter((a) => !/^Block validation failed/.test(String(a[0])))
  .map((a) => String(a[0]).replace(/%[osj]/g, () => JSON.stringify(a.splice(1, 1)[0]))).join(' | ');

// Recorre el árbol de bloques de WordPress y devuelve los problemas de los que no están excluidos
function problems(markup) {
  const found = [];
  const names = [];
  (function walk(blocks) {
    for (const b of blocks) {
      names.push(nameOf(b));
      if (b.name === 'core/freeform' || (b.name === 'core/missing' && !EXCLUDED(nameOf(b)))) found.push(`${b.name}: bloque no reconocido`);
      if (!EXCLUDED(nameOf(b)) && b.name !== 'core/freeform') {
        // válido = parse() lo acepta con el save() actual o con una de sus deprecaciones (WordPress lo migra en silencio).
        // ECOS_BLOCKS_STRICT=1 exige además que coincida con el save() actual (sin deprecaciones)
        const [okNow, issues] = quiet(() => WP.validateBlock(b, b.name));
        if (!b.isValid || (STRICT && !okNow)) found.push(`${b.name}: ${why(issues)}\n   original: ${b.originalContent}\n   guardado: ${WP.getSaveContent(b.name, b.attributes, b.innerBlocks)}`);
      }
      walk(b.innerBlocks || []);
    }
  })(quiet(() => WP.parse(markup)));
  return { found, names };
}
function check(label, blocks, expectNames, opts = {}) {
  test('WordPress valida: ' + label, () => {
    const html = T.composeBlocks(blocks, opts);
    const { found, names } = problems(html);
    assert.deepEqual(found, [], `\n${html}\n`);
    for (const e of expectNames) assert.ok(names.includes(e), `falta ${e} en ${names.join(',')}`);
  });
}

// --- Texto -------------------------------------------------------------------------------------------------------
check('párrafo simple y con formato en línea', [P('Hola <strong>mundo</strong> y <em>más</em> con <a href="https://x.org">enlace</a>'), P('Dos<br>líneas')], ['core/paragraph']);
for (const al of ['center', 'right', 'justify']) check('párrafo alineado ' + al, [P('Texto', { align: al })], ['core/paragraph']);
check('párrafo con tamaño', [P('Texto', { size: '24px' })], ['core/paragraph']);
check('párrafo con color y fondo (resaltado)', [P('Texto', { color: '#aa0000' }), P('Texto', { bg: '#ffeecc' }), P('Texto', { color: '#112233', bg: '#ffeecc', align: 'center' })], ['core/paragraph']);
for (const f of Object.keys(T.FONTS)) check('párrafo con fuente ' + f, [P('Texto', { font: f })], ['core/paragraph']);
check('párrafo con espaciado, sombra y todo junto', [P('Texto', { spacing: '1.5px' }), P('Texto', { shadow: true }),
  P('Texto', { align: 'justify', size: '18px', font: 'serif', color: '#333333', bg: '#fafafa', spacing: '2px', shadow: true })], ['core/paragraph']);
check('párrafo con capitular', [P('Texto', { dropCap: true }), P('Texto', { dropCap: true, align: 'right', size: '20px' })], ['core/paragraph']);
check('varios párrafos a partir de uno', [P('Uno\n\nDos\n\nTres')], ['core/paragraph']);

for (const level of [2, 3, 4, 5]) check('título nivel ' + level, [{ id: 'h' + level, type: 'heading', level, html: 'Qué hicimos' }], ['core/heading']);
check('títulos repetidos (anclas) y con formato', [
  { id: 'h1', type: 'heading', level: 2, html: 'Igual' }, { id: 'h2', type: 'heading', level: 2, html: 'Igual' },
  { id: 'h3', type: 'heading', level: 3, html: 'Con <em>cursiva</em>', align: 'center', size: '30px', font: 'serif', color: '#123456' },
  { id: 'h4', type: 'heading', level: 2, html: 'Justo', align: 'justify', bg: '#eeeeee', shadow: true }], ['core/heading']);

check('lista normal', [{ id: 'l1', type: 'list', items: ['Uno', 'Dos <strong>2</strong>', 'Tres'] }], ['core/list', 'core/list-item']);
check('lista numerada', [{ id: 'l2', type: 'list', ordered: true, items: ['Uno', 'Dos'] }], ['core/list']);
check('lista con formato (tamaño, fuente, color)', [{ id: 'l3', type: 'list', items: ['Uno'], size: '20px', font: 'mono', color: '#445566', bg: '#f0f0f0' }], ['core/list']);
check('lista con iconos', [{ id: 'l4', type: 'list', items: ['Uno', 'Dos'], icons: [DK.ICONS[0], DK.ICONS[1]] }, { id: 'l5', type: 'list', ordered: true, items: ['A', 'B'], icons: ['★', ''] }], ['core/list']);

check('cita', [{ id: 'q1', type: 'quote', html: 'Una cita', cite: 'Alguien' }, { id: 'q2', type: 'quote', html: 'Sin autor\n\nDos párrafos' },
  { id: 'q3', type: 'quote', html: 'Con estilo', cite: 'X', size: '22px', font: 'serif', color: '#224466', bg: '#eef' }], ['core/quote']);
check('cita destacada', [{ id: 'q4', type: 'quote', pull: true, html: 'Destacada', cite: 'Autor' }, { id: 'q5', type: 'quote', pull: true, html: 'Sin autor' }], ['core/pullquote']);

// --- Imagen ------------------------------------------------------------------------------------------------------
check('imagen a todo ancho (con y sin id, con pie)', [
  { id: 'i1', type: 'image', img: IMG, caption: '' }, { id: 'i2', type: 'image', img: IMG3, caption: 'Un <em>pie</em>' }, { id: 'i3', type: 'image', img: { ...IMG, alt: '' }, caption: 'Pie' }], ['core/image']);
for (const al of ['left', 'center', 'right']) for (const w of [33, 50, 75]) check(`imagen ${al} al ${w}%`, [{ id: 'ia' + al + w, type: 'image', img: IMG, align: al, width: w, caption: 'Pie' }], ['core/image']);
check('imagen con ancho libre', [{ id: 'iw', type: 'image', img: IMG, w: '320px' }, { id: 'iw2', type: 'image', img: IMG, align: 'center', w: '60%' }], ['core/image']);
for (const r of ['1', '4/3', '3/2', '16/9', '9/16']) check('imagen recortada ' + r, [{ id: 'ir' + r, type: 'image', img: IMG, ratio: r }, { id: 'ir2' + r, type: 'image', img: IMG, ratio: r, align: 'left', width: 50 }], ['core/image']);
for (const f of ['rounded', 'circle', 'border', 'shadow']) check('imagen con marco ' + f, [{ id: 'if' + f, type: 'image', img: IMG, frame: f, caption: 'Pie' },
  { id: 'if2' + f, type: 'image', img: IMG, frame: f, align: 'right', width: 33, frameColor: '#ff8800' }], ['core/image']);
for (const e of ['zoom', 'bw']) check('imagen con efecto ' + e, [{ id: 'ie' + e, type: 'image', img: IMG, fx: e }, { id: 'ie2' + e, type: 'image', img: IMG, fx: e, frame: 'rounded', ratio: '1', align: 'center', width: 75 }], ['core/image']);
check('imagen que rodea al texto (corte posterior)', [{ id: 'ifl', type: 'image', img: IMG, align: 'left', width: 33 }, P('Texto al lado'), { id: 'hs', type: 'heading', level: 2, html: 'Título' }], ['core/image', 'core/paragraph']);

check('galería (2, 3 y 6 columnas, con y sin id)', [
  { id: 'g1', type: 'gallery', images: [IMG, IMG2], columns: 2 }, { id: 'g2', type: 'gallery', images: [IMG, IMG2, IMG3], columns: 3 },
  { id: 'g3', type: 'gallery', images: [IMG, IMG2, IMG3, IMG, IMG2, IMG3], columns: 6 }, { id: 'g4', type: 'gallery', images: [IMG], columns: 1 }], ['core/gallery', 'core/image']);
check('mosaico (HTML libre: no se valida; solo que no rompe nada)', [{ id: 'm1', type: 'gallery', layout: 'mosaic', images: [IMG, IMG2, IMG3, IMG] }, P('Después')], ['core/paragraph']);

// --- Imagen y texto ----------------------------------------------------------------------------------------------
const MT = (extra) => ({ id: 'mt' + n++, type: 'mediatext', img: IMG, html: 'Texto de al lado', ...extra });
check('imagen y texto básico (izquierda y derecha, con y sin id)', [MT(), MT({ right: true }), MT({ img: IMG3 }), MT({ img: IMG3, right: true })], ['core/media-text']);
for (const mw of [20, 33, 75, 90]) for (const right of [false, true]) check(`imagen y texto mediaWidth ${mw} ${right ? 'derecha' : 'izquierda'}`, [MT({ mediaWidth: mw, right })], ['core/media-text']);
for (const v of ['top', 'center', 'bottom']) check('imagen y texto alineación vertical ' + v, [MT({ valign: v }), MT({ valign: v, right: true, mediaWidth: 40 })], ['core/media-text']);
check('imagen y texto con imageFill', [MT({ fill: true }), MT({ fill: true, right: true, mediaWidth: 60, valign: 'center' }), MT({ fill: true, img: IMG3 })], ['core/media-text']);
for (const r of ['1', '4/3', '3/2', '16/9', '9/16']) check('imagen y texto recorte ' + r, [MT({ ratio: r })], ['core/media-text']);
for (const f of ['rounded', 'circle', 'border', 'shadow']) check('imagen y texto marco ' + f, [MT({ frame: f }), MT({ frame: f, frameColor: '#00aa55', right: true, fill: true })], ['core/media-text']);
for (const e of ['zoom', 'bw']) check('imagen y texto efecto ' + e, [MT({ fx: e })], ['core/media-text']);
check('imagen y texto con texto con formato', [
  MT({ html: 'Uno\n\nDos <strong>negrita</strong>', align: 'justify', size: '20px', font: 'serif', color: '#334455', bg: '#f6f6f6', shadow: true }),
  MT({ align: 'center', spacing: '1px' })], ['core/media-text', 'core/paragraph']);
check('imagen y texto con todo', [MT({ right: true, mediaWidth: 35, valign: 'bottom', fill: true, ratio: '16/9', frame: 'border', fx: 'zoom', html: 'Todo junto' })], ['core/media-text']);

// --- Contenedores ------------------------------------------------------------------------------------------------
const COL = (children, width) => ({ width, children });
check('columnas (2, 3, 4; anchos iguales y distintos)', [
  { id: 'c1', type: 'columns', cols: [COL([P('A')], '50%'), COL([P('B')], '50%')] },
  { id: 'c2', type: 'columns', cols: [COL([P('A')], '33.33%'), COL([P('B')], '66.66%')] },
  { id: 'c3', type: 'columns', cols: [COL([P('A')], '25%'), COL([P('B')], '50%'), COL([P('C')], '25%')] },
  { id: 'c4', type: 'columns', cols: [COL([P('A')], '25%'), COL([P('B')], '25%'), COL([P('C')], '25%'), COL([P('D')], '25%')] }], ['core/columns', 'core/column']);
check('columnas con opciones (valign, sin apilar, fondo, separación, margen)', [
  { id: 'c5', type: 'columns', valign: 'center', stack: false, bg: '#eeeeee', gap: 30, mt: 20, mb: 40, cols: [COL([P('A'), { id: 'ci', type: 'image', img: IMG }], '50%'), COL([P('B')], '50%')] },
  { id: 'c6', type: 'columns', valign: 'top', gradient: DK.GRADIENTS[0] && (DK.GRADIENTS[0].css || DK.GRADIENTS[0].value || DK.GRADIENTS[0]), cols: [COL([P('A')]), COL([P('B')])] },
  { id: 'c7', type: 'columns', valign: 'bottom', cols: [COL([P('A')]), COL([])] }], ['core/columns']);
check('grupo/sección (todas las opciones)', [
  { id: 'gr1', type: 'group', children: [P('Dentro')] },
  { id: 'gr2', type: 'group', children: [] },
  { id: 'gr3', type: 'group', bg: '#f5f1ea', color: '#222222', pad: 'm', width: 'full', radius: 24, shadow: true, children: [P('Hola'), { id: 'grh', type: 'heading', level: 3, html: 'T' }] },
  { id: 'gr4', type: 'group', pad: 's', width: 'wide', border: '#ff0000', mt: 10, mb: 30, children: [P('x')] },
  { id: 'gr5', type: 'group', pad: 'l', radius: 8, border: '#00ff00', children: [{ id: 'gri', type: 'group', bg: '#ffffff', children: [P('anidado')] }] }], ['core/group']);
check('portada (cover) con y sin imagen y todas las opciones', [
  { id: 'cv1', type: 'cover', children: [P('Sobre fondo')] },
  { id: 'cv2', type: 'cover', img: IMG, dim: 30, height: 500, children: [{ id: 'cvh', type: 'heading', level: 2, html: 'Portada' }] },
  { id: 'cv3', type: 'cover', img: IMG3, dim: 70, overlay: '#112233', width: 'full', children: [P('x')] },
  { id: 'cv4', type: 'cover', img: IMG, parallax: true, focalPoint: { x: 0.25, y: 0.75 }, children: [P('x')] },
  { id: 'cv5', type: 'cover', img: IMG, focalPoint: { x: 0.2, y: 0.4 }, dim: 0, mt: 20, mb: 20, width: 'wide', children: [] },
  { id: 'cv6', type: 'cover', overlay: '#ffeeaa', dim: 80, children: [P('Claro')] },
  { id: 'cv7', type: 'cover', gradient: DK.GRADIENTS[0] && (DK.GRADIENTS[0].css || DK.GRADIENTS[0].value || DK.GRADIENTS[0]), children: [P('Degradado')] }], ['core/cover']);

// --- Botones, separador, espaciador, tabla, detalles, índice -------------------------------------------------------
check('botones', [
  { id: 'bt1', type: 'buttons', html: 'Pulsa', url: 'https://x.org' }, { id: 'bt2', type: 'buttons', html: 'Sin enlace' },
  { id: 'bt3', type: 'buttons', html: 'Centro', url: 'https://x.org', align: 'center', variant: 'outline', radius: 'pill' },
  { id: 'bt4', type: 'buttons', html: 'Derecha', url: '#ancla', align: 'right', bg: '#ff8800', color: '#ffffff', radius: 'square', size: 's' },
  { id: 'bt5', type: 'buttons', html: 'Completo', url: 'mailto:a@b.org', full: true, size: 'l', radius: 'round', bg: '#003366', color: '#fff' },
  { id: 'bt6', type: 'buttons', html: 'Contorno color', url: 'https://x.org', variant: 'outline', color: '#cc0000', size: 'l' }], ['core/buttons', 'core/button']);
check('separador', [{ id: 'sp1', type: 'separator' }], ['core/separator']);
check('espaciador', [{ id: 'sc1', type: 'spacer', height: 40 }, { id: 'sc2', type: 'spacer', height: 8 }, { id: 'sc3', type: 'spacer', height: 200 }, { id: 'sc4', type: 'spacer' }], ['core/spacer']);
check('tabla', [
  { id: 't1', type: 'table', head: true, rows: [['A', 'B'], ['1', '2'], ['3', '<strong>4</strong>']] },
  { id: 't2', type: 'table', rows: [['1', '2']], stripes: true, caption: 'Pie de tabla' },
  { id: 't3', type: 'table', head: true, stripes: true, rows: [['Uno'], ['Dos']], caption: 'Con <em>pie</em>' }], ['core/table']);
check('detalles e índice', [{ id: 'd1', type: 'details', summary: 'Resumen', html: 'Contenido\n\nMás' }, { id: 'hh', type: 'heading', level: 2, html: 'Uno' }, { id: 'hh2', type: 'heading', level: 3, html: 'Dos' },
  { id: 'tc1', type: 'toc', title: 'Índice' }, { id: 'tc2', type: 'toc' }], ['core/details', 'core/list']);

// --- Vídeo y embeds ----------------------------------------------------------------------------------------------
check('vídeo suelto (autoplay, loop, muted, playsInline, controls:false)', [
  { id: 'v1', type: 'video', video: VID }, { id: 'v2', type: 'video', video: { url: 'https://x.org/w.mp4' } }, { id: 'v3', type: 'video', video: VID, caption: 'Pie del <em>vídeo</em>' }], ['core/video']);
for (const al of ['left', 'center', 'right']) check('vídeo ' + al, [{ id: 'va' + al, type: 'video', video: VID, align: al, width: 33 }, { id: 'va2' + al, type: 'video', video: VID, align: al }], ['core/video']);
for (const r of ['1', '4/3', '3/2', '16/9', '9/16']) check('vídeo recorte ' + r, [{ id: 'vr' + r, type: 'video', video: VID, ratio: r }], ['core/video']);
for (const f of ['rounded', 'border', 'shadow']) check('vídeo marco ' + f, [{ id: 'vf' + f, type: 'video', video: VID, frame: f }], ['core/video']);
for (const e of ['zoom', 'bw']) check('vídeo efecto ' + e, [{ id: 've' + e, type: 'video', video: VID, fx: e, frame: 'rounded', align: 'right', width: 75, ratio: '16/9' }], ['core/video']);
check('galería de una sola pieza que es un vídeo', [{ id: 'gv', type: 'gallery', images: [{ ...VID, type: 'video' }], columns: 1 }], ['core/video']);
for (const prov of ['youtube', 'vimeo', 'dailymotion', 'tiktok', 'videopress', 'spotify', 'twitter']) check('embed ' + prov, [{ id: 'e' + prov, type: 'embed', url: 'https://example.org/watch?v=1&t=2', provider: prov, caption: 'Pie' }, { id: 'e2' + prov, type: 'embed', url: 'https://example.org/x', provider: prov }], ['core/embed']);
check('embed de Instagram y Facebook', [{ id: 'ei', type: 'embed', url: 'https://www.instagram.com/p/abc/', provider: 'instagram' }, { id: 'ef', type: 'embed', url: 'https://www.facebook.com/x/posts/1', provider: 'facebook' },
  { id: 'en', type: 'embed', url: 'https://www.instagram.com/p/def/' }], ['core/embed']);

// --- Carrusel en la web propia (Spectra): excluido, pero debe convivir con bloques válidos ------------------------
check('carrusel (HTML y Spectra) junto a bloques válidos', [{ id: 'ca1', type: 'carousel', images: [IMG, IMG2] }, P('Texto')], ['core/paragraph']);
check('carrusel Spectra junto a bloques válidos', [{ id: 'ca2', type: 'carousel', images: [IMG, IMG2], view: 'peek' }, P('Texto')], ['uagb/image-gallery', 'core/paragraph'], { spectra: true });

// --- Documento completo ------------------------------------------------------------------------------------------
check('entrada completa (como la que genera Ecos)', [
  { id: 'f1', type: 'heading', level: 2, html: 'Resumen' }, P('Texto <strong>importante</strong>', { align: 'justify' }),
  { id: 'f2', type: 'image', img: IMG, caption: 'Pie' }, { id: 'f3', type: 'gallery', images: [IMG, IMG2, IMG3], columns: 3 },
  { id: 'f4', type: 'separator' }, { id: 'f5', type: 'video', video: VID }, { id: 'f6', type: 'embed', url: 'https://www.instagram.com/p/z/', provider: 'instagram' }], ['core/heading', 'core/gallery']);

// --- Colores, tamaños y fuentes de la web (clases estándar de WordPress: has-<slug>-color, textColor, fontSize…) ---------
const TH = (o) => ({ th: Object.fromEntries(Object.entries(o).map(([k, [slug, v]]) => [k, { slug, v }])) });
check('párrafo con color, fondo, tamaño y fuente del tema', [
  P('Texto', { color: '#e04400', ...TH({ color: ['ast-global-color-0', '#e04400'] }) }),
  P('Texto', { bg: '#fff3e0', ...TH({ bg: ['accent', '#fff3e0'] }) }),
  P('Texto', { size: '1.5rem', ...TH({ size: ['large', '1.5rem'] }) }),
  P('Texto', { font: 'wp:body-font', align: 'center' }),
  P('Texto', { color: '#112233', bg: '#ffeecc', size: '2rem', font: 'wp:heading-font', ...TH({ color: ['contrast', '#112233'], bg: ['base', '#ffeecc'], size: ['x-large', '2rem'] }), dropCap: true, shadow: true }),
  P('Texto', { font: 'heading', ...TH({ font: ['heading', "'Playfair Display', serif"] }) }),
  P('Texto', { color: '#aa0000', ...TH({ color: ['accent', '#00aa00'] }) })], ['core/paragraph']);
check('títulos, listas y citas con colores del tema', [
  { id: 'th1', type: 'heading', level: 3, html: 'Título', color: '#222222', size: '2rem', ...TH({ color: ['contrast', '#222222'], size: ['x-large', '2rem'] }) },
  { id: 'th2', type: 'list', items: ['Uno', 'Dos'], bg: '#eeeeee', ...TH({ bg: ['base-2', '#eeeeee'] }) },
  { id: 'th3', type: 'quote', html: 'Cita', color: '#333333', ...TH({ color: ['contrast', '#333333'] }) },
  { id: 'th4', type: 'quote', pull: true, html: 'Destacada', cite: 'Alguien', color: '#333333', ...TH({ color: ['contrast', '#333333'] }) }], ['core/heading', 'core/list', 'core/quote', 'core/pullquote']);
check('texto en línea con colores del tema', [P('Hola <mark style="background-color:rgba(0, 0, 0, 0)" class="has-inline-color has-vivid-red-color">rojo</mark> y <mark style="background-color:rgba(0, 0, 0, 0)" class="has-inline-color has-base-background-color">fondo</mark>')], ['core/paragraph']);
check('sección, columnas y botón con colores del tema', [
  { id: 'tg1', type: 'group', bg: '#fafafa', color: '#111111', pad: 'm', children: [P('Dentro')], ...TH({ bg: ['base', '#fafafa'], color: ['contrast', '#111111'] }) },
  { id: 'tc1', type: 'columns', bg: '#eeeeee', cols: [{ width: '50%', children: [P('A')] }, { width: '50%', children: [P('B')] }], ...TH({ bg: ['base-2', '#eeeeee'] }) },
  { id: 'tb1', type: 'buttons', html: 'Pulsa', url: 'https://x.org', bg: '#e04400', color: '#ffffff', ...TH({ bg: ['accent', '#e04400'], color: ['base', '#ffffff'] }) },
  { id: 'tb2', type: 'buttons', html: 'Contorno', url: 'https://x.org', variant: 'outline', color: '#e04400', ...TH({ color: ['accent', '#e04400'] }) }], ['core/group', 'core/columns', 'core/button']);

check('bloque sincronizado (wp:block con ref, bloque dinámico)', [P('Antes'), { id: 'sy1', type: 'synced', ref: 42, title: 'Aviso' }], ['core/paragraph', 'core/block']);
// --- Más bloques (pestañas, línea de tiempo, cifras, testimonios, tarjetas, llamada a la acción, donación, evento, audio, PDF…) ---
const MORE = require('./moreblocks-samples').samples;
const MORE_NAMES = { tabs: ['core/group', 'core/heading'], tabsPill: ['core/group'], timelineV: ['core/group', 'core/image'], timelineH: ['core/group'], figures: ['core/group', 'core/paragraph'], figuresNoCount: ['core/group'],
  testimonials: ['core/quote', 'core/image'], testimonialsSlider: ['core/quote'], cards: ['core/heading', 'core/paragraph'], cta: ['core/group', 'core/buttons', 'core/button'], ctaGradient: ['core/buttons'],
  donateBizum: ['core/buttons'], donatePaypal: ['core/buttons'], donateHosted: ['core/button'], donateTransfer: ['core/button'], donateLink: ['core/button'],
  event: ['core/buttons'], eventMap: ['core/group'], audioFile: ['core/audio'], audioEmbed: ['core/embed'], pdf: ['core/file'], pdfNoPreview: ['core/file'], pdfViewerOnly: ['core/file'],
  hotspots: ['core/image'], compare: ['core/image'], faq: ['core/details'], faqMany: ['core/details'] };
for (const [k, mk] of Object.entries(MORE)) check('más bloques: ' + k, [mk()], MORE_NAMES[k] || ['core/group']);

test('el validador detecta de verdad un bloque mal formado', () => {
  const { found } = problems('<!-- wp:embed {"url":"https://a.b/x","type":"rich","providerNameSlug":"instagram"} -->\n<figure class="wp-block-embed is-type-rich is-provider-instagram"><div class="wp-block-embed__wrapper">\nhttps://a.b/x\n</div></figure>\n<!-- /wp:embed -->');
  assert.ok(found.length >= 1, 'a un embed sin su clase wp-block-embed-* debe invalidarlo');
  const bad = problems('<!-- wp:separator -->\n<hr class="otra-clase"/>\n<!-- /wp:separator -->').found;
  assert.ok(bad.length >= 1, 'una clase distinta en un separador debe invalidarlo');
});
