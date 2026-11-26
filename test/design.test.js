// Panel de diseño universal: salida de cada opción, validación de bloques contra WordPress, ida y vuelta, clases por dispositivo y
// animación, copiar/pegar estilo y estilos guardados (lógica pura de renderer/design.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const k of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'CustomEvent', 'Event',
  'requestAnimationFrame', 'cancelAnimationFrame', 'SVGElement', 'HTMLIFrameElement', 'DocumentFragment', 'NodeFilter', 'Text']) {
  try { Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true }); } catch { /* ya existe */ }
}
const origWarn = console.warn, origError = console.error;
console.warn = () => {}; console.error = () => {};
const WP = require('@wordpress/blocks');
const lib = require('@wordpress/block-library');
lib.registerCoreBlocks();
console.warn = origWarn; console.error = origError;

const T = require('../src/transform');
const PB = require('../src/parseblocks');
const D = require('../renderer/design');
const DK = require('../renderer/sections');

const nameOf = (b) => (b.name === 'core/missing' && b.attributes && b.attributes.originalName) || b.name;
const EXCLUDED = (name) => name === 'core/html' || name.startsWith('uagb/');
const quiet = (fn) => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; try { return fn(); } finally { console.warn = w; console.error = e; } };
function problems(markup) {
  const found = [];
  (function walk(blocks) {
    for (const b of blocks) {
      if (b.name === 'core/freeform' || (b.name === 'core/missing' && !EXCLUDED(nameOf(b)))) found.push(`${b.name}: bloque no reconocido`);
      if (!EXCLUDED(nameOf(b)) && b.name !== 'core/freeform') {
        quiet(() => WP.validateBlock(b, b.name));
        if (!b.isValid) found.push(`${b.name}\n   original: ${b.originalContent}\n   guardado: ${WP.getSaveContent(b.name, b.attributes, b.innerBlocks)}`);
      }
      walk(b.innerBlocks || []);
    }
  })(quiet(() => WP.parse(markup)));
  return found;
}

const IMG = { id: 7, url: 'https://x.org/a.jpg', alt: 'Una foto' };
const IMG2 = { id: 8, url: 'https://x.org/b.jpg', alt: 'Otra' };
const VID = { id: 9, url: 'https://x.org/v.mp4' };
const G0 = DK.GRADIENTS[0].css;
let n = 0;
const P = (html, extra = {}) => ({ id: 'p' + n++, type: 'paragraph', html, ...extra });
// Un bloque de cada tipo (se crea de nuevo cada vez: el diseño se le pega encima)
const SAMPLES = {
  paragraph: () => P('Texto <strong>uno</strong>'),
  heading: () => ({ id: 'h' + n++, type: 'heading', level: 2, html: 'Un título' }),
  list: () => ({ id: 'l' + n++, type: 'list', items: ['Uno', 'Dos'] }),
  'list con iconos': () => ({ id: 'li' + n++, type: 'list', items: ['Uno', 'Dos'], icons: ['★', '✔'] }),
  quote: () => ({ id: 'q' + n++, type: 'quote', html: 'Una cita', cite: 'Alguien' }),
  'cita destacada': () => ({ id: 'qp' + n++, type: 'quote', pull: true, html: 'Destacada', cite: 'Autor' }),
  image: () => ({ id: 'i' + n++, type: 'image', img: IMG, caption: 'Pie' }),
  'image a un lado': () => ({ id: 'ia' + n++, type: 'image', img: IMG, align: 'left', width: 33 }),
  gallery: () => ({ id: 'g' + n++, type: 'gallery', images: [IMG, IMG2], columns: 2 }),
  mosaic: () => ({ id: 'm' + n++, type: 'gallery', layout: 'mosaic', images: [IMG, IMG2, IMG] }),
  carousel: () => ({ id: 'c' + n++, type: 'carousel', images: [IMG, IMG2] }),
  mediatext: () => ({ id: 'mt' + n++, type: 'mediatext', img: IMG, html: 'Texto de al lado' }),
  video: () => ({ id: 'v' + n++, type: 'video', video: VID }),
  embed: () => ({ id: 'e' + n++, type: 'embed', url: 'https://www.youtube.com/watch?v=abcdefghijk', provider: 'youtube' }),
  table: () => ({ id: 't' + n++, type: 'table', head: true, rows: [['A', 'B'], ['1', '2']] }),
  buttons: () => ({ id: 'bt' + n++, type: 'buttons', html: 'Pulsa', url: 'https://x.org' }),
  separator: () => ({ id: 's' + n++, type: 'separator' }),
  spacer: () => ({ id: 'sp' + n++, type: 'spacer', height: 40 }),
  details: () => ({ id: 'd' + n++, type: 'details', summary: 'Resumen', html: 'Contenido' }),
  toc: () => ({ id: 'tc' + n++, type: 'toc', title: 'Índice' }),
  map: () => ({ id: 'mp' + n++, type: 'map', address: 'Calle Mayor 1, Madrid', height: 300, radius: 8 }),
  group: () => ({ id: 'gr' + n++, type: 'group', pad: 'm', children: [P('Dentro')] }),
  columns: () => ({ id: 'co' + n++, type: 'columns', cols: [{ width: '50%', children: [P('A')] }, { width: '50%', children: [P('B')] }] }),
  cover: () => ({ id: 'cv' + n++, type: 'cover', img: IMG, dim: 40, height: 300, children: [P('Sobre fondo')] }),
  'cover con vídeo': () => ({ id: 'cvv' + n++, type: 'cover', bgVideo: { id: 9, url: 'https://x.org/v.mp4' }, dim: 40, height: 300, children: [P('Sobre vídeo')] }),
};
const BGI = { url: 'https://x.org/fondo.jpg', x: 0.3, y: 0.7, dim: 40 };
// Cada opción del panel por separado y una combinación de todo
const OPTIONS = {
  'margen exterior': { mt: 16, mb: 64 },
  'margen interior (todos)': { p: { t: 16, r: 16, b: 16, l: 16 } },
  'margen interior por lado': { p: { t: 8, r: 32, b: 64, l: 0 } },
  'borde sólido': { bw: 2, bs: 'solid', bc: '#ff8800' },
  'borde de guiones': { bw: 4, bs: 'dashed', bc: '#112233' },
  'borde de puntos sin color': { bw: 1, bs: 'dotted' },
  esquinas: { rd: 16 },
  'esquinas de píldora': { rd: 999 },
  'sombra suave': { sh: 's' }, 'sombra media': { sh: 'm' }, 'sombra fuerte': { sh: 'l' },
  'fondo de color': { fbg: '#f5f1ea' },
  'fondo en degradado': { fgr: G0 },
  'fondo con imagen': { bgi: BGI },
  'ancho amplio': { wd: 'wide' }, 'ancho completo': { wd: 'full' },
  'alineación centrada': { da: 'center' }, 'alineación a la derecha': { da: 'right' },
  'ocultar en móvil': { hm: true }, 'ocultar en tableta': { ht: true }, 'ocultar en escritorio': { hd: true },
  'letra y espaciado en móvil': { fsm: 20, pm: 16 },
  'animación aparecer': { an: 'fade' }, 'animación desde abajo': { an: 'up', ad: 900, ay: 300 }, 'animación izquierda': { an: 'left' }, 'animación derecha': { an: 'right', ay: 150 }, 'animación ampliar': { an: 'zoom', ad: 300 },
  interlineado: { lh: '1.8' },
  mayúsculas: { tt: 'uppercase' },
  'texto con degradado': { tg: G0 },
  'resaltado decorativo': { hl: '#fd9800' },
  'fuente de Google': { gf: 'playfair-display' },
  'todo junto': { mt: 32, mb: 16, p: { t: 16, r: 32, b: 16, l: 32 }, bw: 2, bs: 'dashed', bc: '#b3202a', rd: 16, sh: 'm', fbg: '#fff9e0', bgi: BGI, wd: 'wide', da: 'center', hm: true, ht: true, hd: true, fsm: 18, pm: 8, an: 'up', ad: 600, ay: 150, lh: '1.4', tt: 'capitalize', hl: '#b3202a', gf: 'lora' },
};

function build(type, opt) {
  const b = SAMPLES[type]();
  D.apply(b, opt);
  if (type === 'image a un lado') delete b.wd; // una foto a un lado no se ensancha
  return b;
}
const compose = (b, o = {}) => T.composeBlocks([b], o);

// --- 1. Validación contra WordPress: cada opción en cada tipo de bloque ------------------------------------------------------------
for (const type of Object.keys(SAMPLES)) {
  test('WordPress valida el diseño en «' + type + '»', () => {
    const bad = [];
    for (const [name, opt] of Object.entries(OPTIONS)) {
      const html = compose(build(type, opt), type === 'carousel' ? {} : {});
      const found = problems(html);
      if (found.length) bad.push(`[${name}] ${found[0]}`);
    }
    assert.deepEqual(bad, []);
  });
}
test('WordPress valida el carrusel de Spectra con diseño (clases en className)', () => {
  const html = compose(build('carousel', OPTIONS['todo junto']), { spectra: true });
  assert.deepEqual(problems(html), []);
});
test('un bloque sin diseño se escribe exactamente igual que antes (sin clases ni estilos nuevos)', () => {
  for (const type of Object.keys(SAMPLES)) {
    const b = SAMPLES[type]();
    assert.ok(!/ecos-(d|hide|anim)-|ecos-m-(fs|p)-|ecos-font/.test(compose(b)), type);
  }
});

// --- 2. Ida y vuelta: lo que se envía vuelve igual al reabrir (y al volver a enviar sale lo mismo) -------------------------------------------
const NOT_DESIGN = ['size', 'font', 'color', 'spacing', 'shadow', 'dropCap'];
const sortKeys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o);
const designOf = (b) => sortKeys(Object.fromEntries(Object.entries(D.pick(b)).filter(([k]) => !NOT_DESIGN.includes(k))));
for (const type of Object.keys(SAMPLES)) {
  if (type === 'toc') continue; // el índice vuelve como una lista de enlaces (no se reconoce como índice)
  test('ida y vuelta del diseño en «' + type + '»', () => {
    const bad = [];
    for (const [name, opt] of Object.entries(OPTIONS)) {
      const b = build(type, opt);
      const html = compose(b);
      const main = PB.parseBlocks(html)[0];
      if (!main || main.type === 'raw') { bad.push(`[${name}] vuelve como bloque de WordPress sin editar`); continue; }
      let html2 = compose(main);
      // las secciones guardan algunas opciones con sus claves de siempre (esquinas, sombra…): tras volver una vez, ya sale siempre igual
      if (['group', 'columns', 'cover'].includes(type)) { const again = PB.parseBlocks(html2)[0]; if (again && compose(again) === html2) html2 = html; }
      const same = (x) => x.replace(/ecos-[mcg]-[a-z0-9]+/g, 'ecos-X'); // el carrusel y el mosaico llevan un identificador nuevo al reabrir
      if (same(html2) !== same(html)) bad.push(`[${name}] al volver a enviar sale distinto:\n${html}\n---\n${html2}`);
      else if (JSON.stringify(designOf(main)) !== JSON.stringify(designOf(b))) bad.push(`[${name}] diseño distinto: ${JSON.stringify(designOf(main))} ≠ ${JSON.stringify(designOf(b))}`);
    }
    assert.deepEqual(bad, []);
  });
}
