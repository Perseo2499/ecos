// Editor de páginas (fase 1): secciones, columnas, portada y estilos de imagen, texto y botón.
// composeBlocks → parseBlocks debe devolver lo mismo.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/transform');
const P = require('../src/parseblocks');

const IMG = { id: 7, url: 'https://x/a.jpg', alt: 'Una foto' };
const para = (html, extra = {}) => ({ id: 'p' + html, type: 'paragraph', html, ...extra });
// quita los identificadores para comparar estructuras
const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'id' && typeof x === 'string' ? undefined : x)));
const rt = (blocks) => P.parseBlocks(T.composeBlocks(blocks));

test('sección (core/group): ida y vuelta con fondo, margen, ancho, esquinas, sombra e hijos', () => {
  const g = { id: 'g', type: 'group', bg: '#f5f1ea', color: '#222222', pad: 'm', width: 'full', radius: 24, shadow: true, children: [para('Hola'), { id: 'h', type: 'heading', level: 3, html: 'Título' }] };
  const html = T.composeBlocks([g]);
  assert.match(html, /^<!-- wp:group \{[^\n]*"align":"full"/);
  assert.match(html, /"style":\{"color":\{"background":"#f5f1ea","text":"#222222"\},"spacing":\{"padding":\{"top":"48px","right":"32px","bottom":"48px","left":"32px"\}\},"border":\{"radius":"24px"\},"shadow":"/);
  assert.match(html, /<div class="wp-block-group alignfull has-background has-text-color"/);
  assert.match(html, /<!-- wp:paragraph -->\n<p>Hola<\/p>\n<!-- \/wp:paragraph -->/);
  assert.match(html, /<!-- \/wp:group -->$/);
  const back = rt([g]);
  assert.equal(back.length, 1);
  assert.deepEqual(strip(back[0]), strip({ ...g, children: [para('Hola'), { type: 'heading', level: 3, html: 'Título' }] }));
  // volver a componer da lo mismo
  assert.equal(T.composeBlocks(back), html);
});

test('sección sin estilos y sin hijos', () => {
  const back = rt([{ id: 'g', type: 'group', children: [] }]);
  assert.equal(back[0].type, 'group'); assert.deepEqual(back[0].children, []); assert.equal(back[0].pad, 'none');
});

test('columnas (core/columns + core/column): proporciones, alineación vertical y apilado', () => {
  const c = { id: 'c', type: 'columns', valign: 'center', stack: false, cols: [{ width: '33.33%', children: [para('Uno')] }, { width: '66.66%', children: [para('Dos'), { id: 'i', type: 'image', img: IMG, caption: '' }] }] };
  const html = T.composeBlocks([c]);
  assert.match(html, /<!-- wp:columns \{"verticalAlignment":"center","isStackedOnMobile":false\} -->/);
  assert.match(html, /<div class="wp-block-columns are-vertically-aligned-center is-not-stacked-on-mobile">/);
  assert.match(html, /<!-- wp:column \{"verticalAlignment":"center","width":"33\.33%"\} -->/);
  assert.match(html, /style="flex-basis:66\.66%"/);
  assert.match(html, /<!-- wp:image [^>]*-->[\s\S]*<!-- \/wp:column -->/);
  const back = rt([c]);
  assert.equal(back[0].type, 'columns');
  assert.equal(back[0].valign, 'center'); assert.equal(back[0].stack, false);
  assert.deepEqual(back[0].cols.map((x) => x.width), ['33.33%', '66.66%']);
  assert.deepEqual(back[0].cols.map((x) => x.children.map((b) => b.type)), [['paragraph'], ['paragraph', 'image']]);
  assert.equal(back[0].cols[1].children[1].img.url, IMG.url);
  assert.equal(T.composeBlocks(back), html);
});

test('columnas iguales no llevan ancho; al leerlas se reparten por igual', () => {
  const c = { id: 'c', type: 'columns', cols: [{ width: '50%', children: [para('A')] }, { width: '50%', children: [para('B')] }] };
  const html = T.composeBlocks([c]);
  assert.doesNotMatch(html, /flex-basis|"width"/);
  assert.deepEqual(rt([c])[0].cols.map((x) => x.width), ['50%', '50%']);
  const tres = { id: 'c3', type: 'columns', cols: [1, 2, 3].map(() => ({ width: '33.33%', children: [] })) };
  assert.deepEqual(rt([tres])[0].cols.map((x) => x.width), ['33.33%', '33.33%', '33.33%']);
});

test('contenedores anidados: sección con columnas y bloques dentro', () => {
  const nested = { id: 'g', type: 'group', pad: 's', children: [{ id: 'c', type: 'columns', cols: [{ width: '50%', children: [{ id: 'g2', type: 'group', bg: '#ffffff', children: [para('Dentro')] }] }, { width: '50%', children: [{ id: 'sp', type: 'spacer', height: 40 }, { id: 'sep', type: 'separator' }] }] }] };
  const back = rt([nested]);
  assert.equal(back[0].children[0].cols[0].children[0].children[0].html, 'Dentro');
  assert.deepEqual(back[0].children[0].cols[1].children.map((b) => b.type), ['spacer', 'separator']);
  assert.deepEqual(T.flatBlocks([nested]).map((b) => b.type), ['group', 'columns', 'group', 'paragraph', 'spacer', 'separator']);
});

test('portada (core/cover): imagen, capa de color con opacidad, altura e hijos', () => {
  const cv = { id: 'cv', type: 'cover', img: IMG, overlay: '#1a237e', dim: 60, height: 480, width: 'full', children: [{ id: 'h', type: 'heading', level: 2, html: 'Bienvenida', align: 'center' }, { id: 'b', type: 'buttons', html: 'Únete', url: 'https://x', align: 'center', variant: 'fill' }] };
  const html = T.composeBlocks([cv]);
  assert.match(html, /^<!-- wp:cover \{"url":"https:\/\/x\/a\.jpg","id":7,"dimRatio":60,"customOverlayColor":"#1a237e","minHeight":480,"minHeightUnit":"px","align":"full"/);
  assert.match(html, /wp-block-cover__background has-background-dim has-background-dim-60" style="background-color:#1a237e"/);
  assert.match(html, /<img class="wp-block-cover__image-background wp-image-7" alt="Una foto" src="https:\/\/x\/a\.jpg" data-object-fit="cover"\/>/);
  assert.match(html, /<div class="wp-block-cover__inner-container">/);
  const back = rt([cv]);
  assert.equal(back[0].type, 'cover');
  assert.equal(back[0].img.url, IMG.url); assert.equal(back[0].img.id, 7);
  assert.equal(back[0].overlay, '#1a237e'); assert.equal(back[0].dim, 60); assert.equal(back[0].height, 480); assert.equal(back[0].width, 'full');
  assert.deepEqual(back[0].children.map((b) => b.type), ['heading', 'buttons']);
  assert.equal(T.composeBlocks(back), html);
  // sin imagen: solo color
  const flat = rt([{ id: 'c2', type: 'cover', img: null, overlay: '#ffffff', dim: 100, height: 240, children: [para('x')] }]);
  assert.equal(flat[0].img, null); assert.equal(flat[0].dim, 100);
  assert.match(T.composeBlocks([{ id: 'c2', type: 'cover', img: null, overlay: '#ffffff', dim: 100, height: 240, children: [] }]), /is-light/);
});

test('lo que no se reconoce dentro de un contenedor sigue como raw, y un grupo con ajustes ajenos se conserva entero', () => {
  const inside = '<!-- wp:group {"layout":{"type":"constrained"}} -->\n<div class="wp-block-group"><!-- wp:paragraph -->\n<p>Hola</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:uagb/info-box {"block_id":"x"} /--></div>\n<!-- /wp:group -->';
  const b = P.parseBlocks(inside);
  assert.equal(b[0].type, 'group');
  assert.deepEqual(b[0].children.map((x) => x.type), ['paragraph', 'raw']);
  assert.match(T.composeBlocks(b), /wp:uagb\/info-box \{"block_id":"x"\} \/--/);
  const other = '<!-- wp:group {"className":"mi-clase","layout":{"type":"flex"}} -->\n<div class="wp-block-group mi-clase"><!-- wp:paragraph -->\n<p>x</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->';
  const r = P.parseBlocks(other);
  assert.equal(r[0].type, 'raw'); assert.equal(T.composeBlocks(r), other);
  const cover = '<!-- wp:cover {"url":"https://x/a.jpg","useFeaturedImage":true,"dimRatio":50} -->\n<div class="wp-block-cover has-parallax"><span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span><div class="wp-block-cover__inner-container"></div></div>\n<!-- /wp:cover -->';
  assert.equal(P.parseBlocks(cover)[0].type, 'raw');
});

test('imagen: recorte, marco, ancho libre y efectos hacen la ida y vuelta', () => {
  const casos = [
    { ratio: '16/9' }, { ratio: '1', frame: 'circle' }, { ratio: '4/3', frame: 'rounded' }, { frame: 'border', frameColor: '#c62828' }, { frame: 'shadow' },
    { w: '60%' }, { w: '320px', align: 'center' }, { fx: 'zoom' }, { fx: 'bw', frame: 'rounded' }, { align: 'right', width: 50, ratio: '3/2' },
  ];
  for (const extra of casos) {
    const b = { id: 'i', type: 'image', img: IMG, caption: 'Pie', ...extra };
    const back = rt([b])[0];
    const want = strip({ ...b }), got = strip(back);
    assert.deepEqual(got, want, JSON.stringify(extra));
  }
});

test('imagen: atributos estándar de core/image', () => {
  const html = T.composeBlocks([{ id: 'i', type: 'image', img: IMG, caption: '', ratio: '16/9', frame: 'rounded' }]);
  assert.match(html, /"aspectRatio":"16\/9","scale":"cover"/);
  assert.match(html, /"style":\{"border":\{"radius":"16px"\}\}/);
  assert.match(html, /style="aspect-ratio:16\/9;object-fit:cover;border-radius:16px"/);
  assert.match(html, /has-custom-border/);
  const circ = T.composeBlocks([{ id: 'i', type: 'image', img: IMG, ratio: '1', frame: 'circle' }]);
  assert.match(circ, /"className":"is-style-rounded"/); assert.match(circ, /class="wp-block-image size-large is-style-rounded"/);
  const bord = T.composeBlocks([{ id: 'i', type: 'image', img: IMG, frame: 'border', frameColor: '#336699' }]);
  assert.match(bord, /"border":\{"color":"#336699","style":"solid","width":"2px"\}/);
  const free = T.composeBlocks([{ id: 'i', type: 'image', img: IMG, w: '45%' }]);
  assert.match(free, /"width":"45%"/); assert.match(free, /style="width:45%"/); assert.match(free, /is-resized/);
  // un color de marco raro no se cuela
  assert.doesNotMatch(T.composeBlocks([{ id: 'i', type: 'image', img: IMG, frame: 'border', frameColor: 'red;x:y' }]), /red/);
});

test('efectos propios: el CSS mínimo solo se añade si se usan y no se duplica al volver a leer', () => {
  assert.doesNotMatch(T.composeBlocks([para('x'), { id: 'i', type: 'image', img: IMG }]), /ecos-fx/);
  const blocks = [{ id: 'i', type: 'image', img: IMG, fx: 'zoom' }, { id: 'j', type: 'image', img: IMG, fx: 'bw' }, para('Sombra', { shadow: true })];
  const html = T.composeBlocks(blocks);
  assert.equal((html.match(/<style class="ecos-fx">/g) || []).length, 1);
  assert.match(html, /\.ecos-zoom/); assert.match(html, /grayscale/); assert.match(html, /text-shadow/);
  const back = P.parseBlocks(html);
  assert.deepEqual(back.map((b) => b.type), ['image', 'image', 'paragraph']);
  assert.equal(back[2].shadow, true);
  assert.equal(T.composeBlocks(back), html);
  assert.doesNotMatch(T.composeBlocks([{ id: 'i', type: 'image', img: IMG, fx: 'zoom' }]), /grayscale/);
});

test('texto: alineación, resaltado con margen, tamaño, sombra y espaciado hacen la ida y vuelta', () => {
  for (const align of ['center', 'right', 'justify']) {
    assert.equal(rt([para('x', { align })])[0].align, align);
    assert.equal(rt([{ id: 'h', type: 'heading', level: 2, html: 'x', align }])[0].align, align);
  }
  assert.equal(rt([para('x', { align: 'left' })])[0].align, undefined);
  const p = para('Resaltado', { bg: '#fff3c4', size: '22px', shadow: true, spacing: '2px', color: '#1f1f1f', align: 'center' });
  const html = T.composeBlocks([p]);
  assert.match(html, /"spacing":\{"padding":\{"top":"14px","right":"18px","bottom":"14px","left":"18px"\}\}/);
  assert.match(html, /"letterSpacing":"2px"/); assert.match(html, /"className":"ecos-sombra"/);
  assert.match(html, /class="has-text-align-center ecos-sombra has-text-color has-background"|class="[^"]*ecos-sombra[^"]*"/);
  const back = rt([p])[0];
  assert.deepEqual(strip(back), strip(p));
  const h = { id: 'h', type: 'heading', level: 3, html: 'T', shadow: true, spacing: '4px', bg: '#e1bee7' };
  assert.deepEqual(strip(rt([h])[0]), strip(h));
});

test('botón: colores, esquinas, tamaño, ancho completo y alineación hacen la ida y vuelta', () => {
  const casos = [
    { bg: '#c62828', color: '#ffffff', radius: 'pill', size: 'l', align: 'center' },
    { radius: 'square', size: 's', align: 'right' },
    { radius: 'round', full: true },
    { variant: 'outline', color: '#1565c0', radius: 'pill' },
  ];
  for (const extra of casos) {
    const b = { id: 'b', type: 'buttons', html: 'Únete', url: 'https://x.org', align: 'left', variant: 'fill', ...extra };
    const back = rt([b])[0];
    const want = { ...b }; if (want.full) want.align = 'left';
    assert.deepEqual(strip(back), strip(want), JSON.stringify(extra));
  }
  const html = T.composeBlocks([{ id: 'b', type: 'buttons', html: 'Ok', url: 'https://x', bg: '#000000', color: '#ffffff', radius: 'pill', size: 'l', full: true, variant: 'fill' }]);
  assert.match(html, /"width":100/); assert.match(html, /wp-block-button__width-100/); assert.match(html, /"border":\{"radius":"9999px"\}/);
  assert.match(html, /style="border-radius:9999px;color:#ffffff;background-color:#000000;padding-top:18px/);
});

test('las imágenes dentro de contenedores cuentan para blockImages', () => {
  const ims = T.blockImages([{ id: 'g', type: 'group', children: [{ id: 'c', type: 'columns', cols: [{ width: '50%', children: [{ id: 'i', type: 'image', img: IMG }] }] }, { id: 'cv', type: 'cover', img: { id: 9, url: 'https://x/b.jpg' }, children: [] }] }]);
  assert.deepEqual(ims.map((i) => i.id), [7, 9]);
});

test('plantillas de página con secciones y columnas; guardar una plantilla quita ids y fotos de dentro', () => {
  const CT = require('../renderer/templates');
  const cont = CT.BUILTIN.find((x) => x.id === 'contacto');
  assert.equal(cont.blocks.find((b) => b.type === 'columns').cols.length, 2);
  assert.match(T.composeBlocks(cont.blocks.map((b, i) => ({ id: 'x' + i, ...b }))), /wp:columns/);
  const own = CT.blocksToTemplate([{ id: 'a', type: 'group', children: [{ id: 'b', type: 'cover', img: IMG, children: [{ id: 'c', type: 'image', img: IMG, caption: 'x' }] }, { id: 'd', type: 'columns', cols: [{ width: '50%', children: [{ id: 'e', type: 'paragraph', html: 'Hola' }] }, { width: '50%', children: [] }] }] }]);
  assert.doesNotMatch(JSON.stringify(own), /"id":"[a-e]"/);
  assert.equal(own[0].children[0].img, null); assert.equal(own[0].children[0].children[0].img, null);
  assert.equal(own[0].children[1].cols[0].children[0].html, 'Hola');
  assert.deepEqual(CT.sketch(cont.blocks).slice(0, 2), ['h', 'cols']);
});
