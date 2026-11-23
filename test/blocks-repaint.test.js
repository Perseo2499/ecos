// Repintado parcial del editor de bloques: una opción de la barra de un bloque (colocación, tamaño, columnas, vistas…)
// solo vuelve a pintar ESE bloque; los demás no se tocan (así no pierden foco, selección ni desplazamiento).
// Se carga el editor real (renderer/blocks/*.js, scripts clásicos) en un jsdom y se vigila el DOM con MutationObserver.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const R = path.join(__dirname, '..', 'renderer');
// el mismo orden que en renderer/index.html
const SCRIPTS = ['i18n.js', 'sections.js', 'mosaic.js', 'vidq.js', 'blocks/kit.js', 'blocks/core.js', 'blocks/drag.js', 'blocks/block.js', 'blocks/body.js',
  'blocks/types/text.js', 'blocks/types/image.js', 'blocks/types/gallery.js', 'blocks/types/mediatext.js', 'blocks/types/video.js',
  'blocks/types/containers.js', 'blocks/types/misc.js', 'blocks/style.js', 'blocks/media.js'];

function editor() {
  const dom = new JSDOM('<!doctype html><body><div id="editor"><div id="ed-canvas"><div id="d-cover"></div><div id="d-blocks"></div></div>'
    + '<button id="ed-undo"></button><button id="ed-redo"></button><div id="d-media"><p></p></div></div></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  w.CSS = { escape: (s) => String(s).replace(/[^\w-]/g, '\\$&') };
  w.toast = () => {};
  for (const f of SCRIPTS) w.eval(fs.readFileSync(path.join(R, f), 'utf8'));
  return w;
}

test('el editor se carga repartido en módulos y registra todos los tipos de bloque', () => {
  const w = editor(), E = w.BlockEditor;
  for (const t of ['paragraph', 'heading', 'quote', 'list', 'image', 'gallery', 'carousel', 'mediatext', 'video', 'embed', 'table', 'buttons', 'spacer',
    'details', 'toc', 'group', 'columns', 'cover', 'map', 'separator', 'raw']) assert.equal(typeof E.types[t], 'function', t);
});

test('una opción de la barra de un bloque repinta solo ese bloque', () => {
  const w = editor(), E = w.BlockEditor, doc = w.document;
  const img = (n) => ({ id: n, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', alt: '' });
  const draft = { blocks: [], featuredImageId: null, noAutoFeatured: true };
  E.mount(draft, { media: [], onChange: () => {} });
  const p1 = E.create('paragraph', { html: 'Uno' }), mt = E.create('mediatext', { img: img(1), html: 'Texto' }), gal = E.create('gallery', { images: [img(2), img(3)], columns: 3 });
  const p2 = E.create('paragraph', { html: 'Dos' });
  E.change(() => draft.blocks.push(p1, mt, gal, p2)); // añadir bloques: render completo
  const el = (b) => doc.querySelector(`#d-blocks .blk[data-id="${b.id}"]`);
  const before = [p1, mt, gal, p2].map(el);
  const mo = new w.MutationObserver(() => {});
  mo.observe(doc.getElementById('d-blocks'), { childList: true, subtree: true, attributes: true, characterData: true });
  // todo lo que cambia en el DOM tiene que ser el propio bloque (o su sustitución dentro de #d-blocks): ningún otro bloque
  const outside = (recs, b) => recs.filter((m) => {
    const t = m.target.nodeType === 1 ? m.target : m.target.parentNode;
    if (el(b).contains(t)) return false;
    return !(t === doc.getElementById('d-blocks') && [...m.addedNodes, ...m.removedNodes].every((n) => n.dataset?.id === b.id));
  });
  const touched = () => mo.takeRecords();

  // «Imagen y texto»: lado, tamaño, alineación vertical y «rellenar»
  const opciones = [
    () => doc.querySelector(`.blk[data-id="${mt.id}"] .blk-extra [data-side="1"]`).click(),
    () => doc.querySelector(`.blk[data-id="${mt.id}"] .blk-extra [data-mw="33"]`).click(),
    () => doc.querySelector(`.blk[data-id="${mt.id}"] .blk-extra [data-va="top"]`).click(),
    () => doc.querySelector(`.blk[data-id="${mt.id}"] .blk-extra [data-fill]`).click(),
  ];
  for (const op of opciones) {
    mo.takeRecords();
    op();
    const recs = touched();
    assert.ok(recs.length > 0, 'el bloque cambiado se repinta');
    assert.equal(el(mt) === before[1], false, 'el bloque cambiado es un elemento nuevo');
    before[1] = el(mt);
    assert.equal(el(p1), before[0], 'el párrafo anterior no se ha tocado');
    assert.equal(el(gal), before[2], 'la galería no se ha tocado');
    assert.equal(el(p2), before[3], 'el párrafo siguiente no se ha tocado');
    assert.deepEqual(outside(recs, mt), [], 'ningún cambio del DOM fuera del bloque repintado');
  }
  assert.equal(mt.right, true); assert.equal(mt.mediaWidth, 33); assert.equal(mt.valign, 'top'); assert.equal(mt.fill, true);

  // galería: columnas
  const gOld = el(gal);
  doc.querySelector(`.blk[data-id="${gal.id}"] .blk-extra [data-c="2"]`).click();
  assert.equal(gal.columns, 2);
  assert.notEqual(el(gal), gOld);
  assert.equal(el(p1), before[0]); assert.equal(el(mt), before[1]); assert.equal(el(p2), before[3]);

  // cada opción es un paso de «deshacer»
  assert.equal(E.undo.length, 1 + 4 + 1);
  E.doUndo();
  assert.equal(E.locate(gal.id).b.columns, 3);
});

test('añadir, quitar o mover bloques sigue redibujando todo el editor', () => {
  const w = editor(), E = w.BlockEditor, doc = w.document;
  const draft = { blocks: [], featuredImageId: null, noAutoFeatured: true };
  E.mount(draft, { media: [], onChange: () => {} });
  const a = E.create('paragraph', { html: 'A' }), b = E.create('paragraph', { html: 'B' });
  E.change(() => draft.blocks.push(a, b));
  const before = doc.querySelector(`.blk[data-id="${a.id}"]`);
  doc.querySelector(`.blk[data-id="${b.id}"] [data-a="up"]`).click();
  assert.deepEqual(draft.blocks.map((x) => x.html), ['B', 'A']);
  assert.notEqual(doc.querySelector(`.blk[data-id="${a.id}"]`), before, 'mover repinta todo');
});

test('change(fn, id): FULL pide el repintado completo y false no repinta', () => {
  const w = editor(), E = w.BlockEditor, doc = w.document;
  const draft = { blocks: [], featuredImageId: null, noAutoFeatured: true };
  E.mount(draft, { media: [], onChange: () => {} });
  const a = E.create('paragraph', { html: 'A' }), b = E.create('paragraph', { html: 'B' });
  E.change(() => draft.blocks.push(a, b));
  const ea = doc.querySelector(`.blk[data-id="${a.id}"]`);
  E.change(() => { a.align = 'center'; return E.FULL; }, b.id);
  assert.notEqual(doc.querySelector(`.blk[data-id="${a.id}"]`), ea, 'FULL repinta los demás bloques');
  const ea2 = doc.querySelector(`.blk[data-id="${a.id}"]`);
  E.change(() => { a.align = 'right'; }, false);
  assert.equal(doc.querySelector(`.blk[data-id="${a.id}"]`), ea2, 'false no repinta');
});
