// Muestras de TODOS los tipos de bloque que genera Ecos, para enviarlas a un WordPress real.
// Parte de las de test/moreblocks-samples.js («Más bloques») y añade los bloques de serie (texto, imagen, galería, columnas…).
// Las fotos de ejemplo se sustituyen por la foto real subida a esa web (para que existan en su biblioteca).
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { samples: more } = require(path.join(ROOT, 'test', 'moreblocks-samples'));

let n = 0;
const P = (html, extra = {}) => ({ id: 'wp' + n++, type: 'paragraph', html, ...extra });

// img = { id, url, alt } de la foto subida; vid = misma forma para un vídeo (puede ser una URL cualquiera: el bloque solo la enlaza)
function coreSamples(img, vid) {
  const I2 = { ...img };
  const COL = (children, width) => ({ width, children });
  return {
    paragraph: [P('Hola <strong>mundo</strong> y <em>más</em> con <a href="https://example.org">enlace</a>'), P('Texto', { align: 'center', size: '24px', color: '#aa0000' }), P('Texto con fondo', { bg: '#ffeecc', dropCap: true })],
    heading: [{ id: 'wh1', type: 'heading', level: 2, html: 'Qué hicimos' }, { id: 'wh2', type: 'heading', level: 3, html: 'Con <em>cursiva</em>', align: 'center' }, { id: 'wh3', type: 'heading', level: 2, html: 'Qué hicimos' }],
    list: [{ id: 'wl1', type: 'list', items: ['Uno', 'Dos <strong>2</strong>', 'Tres'] }, { id: 'wl2', type: 'list', ordered: true, items: ['Uno', 'Dos'] }],
    quote: [{ id: 'wq1', type: 'quote', html: 'Una cita', cite: 'Alguien' }, { id: 'wq2', type: 'quote', pull: true, html: 'Destacada', cite: 'Autor' }],
    image: [{ id: 'wi1', type: 'image', img, caption: 'Un <em>pie</em>' }, { id: 'wi2', type: 'image', img: I2, align: 'left', width: 33 }, P('Texto al lado de la foto'), { id: 'wi3', type: 'image', img: I2, frame: 'rounded', fx: 'zoom', ratio: '16/9' }],
    gallery: [{ id: 'wg1', type: 'gallery', images: [img, I2], columns: 2 }, { id: 'wg2', type: 'gallery', layout: 'mosaic', images: [img, I2, img, I2] }],
    mediatext: [{ id: 'wm1', type: 'mediatext', img, html: 'Texto de al lado', right: true, mediaWidth: 40, frame: 'shadow' }],
    columns: [{ id: 'wc1', type: 'columns', cols: [COL([P('A')], '50%'), COL([P('B')], '50%')] }],
    group: [{ id: 'wgr1', type: 'group', bg: '#f5f1ea', color: '#222222', pad: 'm', radius: 24, children: [P('Dentro'), { id: 'wgr2', type: 'heading', level: 3, html: 'T' }] }],
    cover: [{ id: 'wcv1', type: 'cover', img, dim: 40, height: 400, children: [{ id: 'wcv2', type: 'heading', level: 2, html: 'Portada' }] }],
    buttons: [{ id: 'wb1', type: 'buttons', html: 'Pulsa', url: 'https://example.org', align: 'center', variant: 'outline' }],
    separator: [{ id: 'ws1', type: 'separator' }],
    spacer: [{ id: 'wsp1', type: 'spacer', height: 40 }],
    table: [{ id: 'wt1', type: 'table', head: true, stripes: true, rows: [['A', 'B'], ['1', '2']], caption: 'Pie de tabla' }],
    details: [{ id: 'wd1', type: 'details', summary: 'Resumen', html: 'Contenido' }],
    toc: [{ id: 'wtc1', type: 'toc', title: 'Índice' }],
    video: [{ id: 'wv1', type: 'video', video: vid, caption: 'Pie del vídeo' }],
    embed: [{ id: 'we1', type: 'embed', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', provider: 'youtube', caption: 'Pie' }],
    carousel: [{ id: 'wca1', type: 'carousel', images: [img, I2] }],
  };
}

// Sustituye en las muestras de «Más bloques» las fotos de ejemplo (x.org) por la real
function swapImages(x, img) {
  if (Array.isArray(x)) return x.map((v) => swapImages(v, img));
  if (x && typeof x === 'object') {
    if (typeof x.url === 'string' && /^https:\/\/x\.org\/[ab]\.jpg$/.test(x.url)) return { ...x, id: img.id, url: img.url };
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, swapImages(v, img)]));
  }
  return x;
}

// → { nombre: [bloques] }
function buildSamples(img, vid) {
  const out = coreSamples(img, vid);
  for (const [k, mk] of Object.entries(more)) out['more-' + k] = [swapImages(mk(), img)];
  return out;
}

module.exports = { buildSamples };
