// Panel de capas y selección múltiple del editor de bloques (renderer/blocks/core.js + layers.js), con jsdom.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const R = path.join(__dirname, '..', 'renderer');
const SCRIPTS = ['i18n.js', 'sections.js', 'mosaic.js', 'vidq.js', 'blocks/kit.js', 'blocks/core.js', 'blocks/drag.js', 'blocks/block.js', 'blocks/body.js',
  'blocks/types/text.js', 'blocks/types/image.js', 'blocks/types/gallery.js', 'blocks/types/mediatext.js', 'blocks/types/video.js',
  'blocks/types/containers.js', 'blocks/types/misc.js', 'blocks/style.js', 'blocks/media.js', 'blocks/layers.js'];

function setup(blocks) {
  const dom = new JSDOM('<!doctype html><body><div id="editor"><button id="ed-layers-btn"></button><div id="ed-canvas"><div id="d-cover"></div><div id="d-blocks"></div></div>'
    + '<aside id="ed-layers" class="hidden"><span class="ly-count"></span><button class="ly-close"></button><div class="ly-list"></div></aside>'
    + '<button id="ed-undo"></button><button id="ed-redo"></button><div id="d-media"><p></p></div></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  w.CSS = { escape: (s) => String(s).replace(/[^\w-]/g, '\\$&') };
  w.toast = () => {};
  w.Element.prototype.scrollIntoView = function () {};
  for (const f of SCRIPTS) w.eval(fs.readFileSync(path.join(R, f), 'utf8'));
  const E = w.BlockEditor;
  E.wireLayers();
  const draft = { blocks: [], featuredImageId: null, noAutoFeatured: true };
  E.mount(draft, { media: [], onChange: () => {} });
  const made = blocks(E);
  E.change(() => draft.blocks.push(...made));
  return { w, E, draft, doc: w.document };
}
// los arrays de jsdom son de otro «realm»: se comparan por valor
const eq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);
const ids = (arr) => arr.map((b) => b.id);
const p = (E, html) => E.create('paragraph', { html });

test('árbol de capas: resumen, anidado y columnas', () => {
  const { E, draft } = setup((E) => {
    const col = E.create('columns');
    col.cols[0].children = [p(E, 'Texto <b>de</b> la primera columna con muchas palabras más de la cuenta')];
    col.cols[1].children = [E.create('image', { img: { id: 1, url: 'https://x.org/fotos/playa%20azul.jpg?w=3', alt: '' } })];
    const g = E.create('group'); g.children = [E.create('heading', { html: 'Título' }), E.create('gallery', { images: [{ id: 2, url: 'a' }, { id: 3, url: 'b' }] })];
    return [p(E, 'Hola'), g, col];
  });
  const tree = E.layerTree();
  eq(tree.map((n) => n.type), ['paragraph', 'group', 'columns']);
  assert.equal(tree[0].summary, 'Hola');
  eq(tree[1].kids.map((n) => [n.type, n.summary]), [['heading', 'Título'], ['gallery', '2 fotos']]);
  assert.equal(tree[1].summary, '2 bloques');
  const cols = tree[2].kids;
  eq(cols.map((c) => c.type), ['col', 'col']);
  assert.equal(cols[0].kids[0].summary, 'Texto de la primera columna con muchas…');
  assert.equal(cols[1].kids[0].summary, 'playa azul.jpg');
  assert.equal(E.flat().length, 7);
  assert.equal(draft.blocks.length, 3);
});

test('selección por rango, con Ctrl y con el ratón en el lienzo', () => {
  const { E, w, doc, draft } = setup((E) => ['A', 'B', 'C', 'D', 'E'].map((x) => p(E, x)));
  const [a, b, c, d] = draft.blocks;
  eq(E.rangeIds(b.id, d.id), ids([b, c, d]));
  eq(E.rangeIds(d.id, b.id), ids([b, c, d]));
  const click = (blk, mods) => blk && doc.querySelector(`#d-blocks .blk[data-id="${blk.id}"] .blk-body`).dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...mods }));
  click(b, { ctrlKey: true });
  eq(E.sel, [b.id]);
  click(d, { shiftKey: true });
  eq(E.sel, ids([b, c, d]));
  assert.equal(doc.querySelectorAll('#d-blocks .blk.sel').length, 3);
  assert.ok(!doc.getElementById('sel-bar').classList.contains('hidden'));
  click(c, { ctrlKey: true });
  eq(E.sel, ids([b, d]));
  click(a, {});
  eq(E.sel, []);
  assert.ok(doc.getElementById('sel-bar').classList.contains('hidden'));
  // Esc deselecciona
  E.setSel(ids([a, b]));
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  eq(E.sel, []);
  // el rango entre niveses distintos se reduce al bloque pulsado
  const g = E.create('group'); g.children = [p(E, 'dentro')];
  E.change(() => draft.blocks.push(g));
  eq(E.rangeIds(a.id, g.children[0].id), [g.children[0].id]);
});

test('mover varios, duplicar, borrar y agrupar: cada acción es un solo paso de deshacer', () => {
  const { E, draft } = setup((E) => ['A', 'B', 'C', 'D', 'E'].map((x) => p(E, x)));
  const txt = () => draft.blocks.map((b) => b.html).join('');
  const [, b, c, d] = draft.blocks;
  E.setSel(ids([b, d]));
  let n = E.undo.length;
  E.selMove(-1);
  assert.equal(txt(), 'BADCE'); assert.equal(E.undo.length, n + 1);
  E.selMove(1);
  assert.equal(txt(), 'ABCDE');
  E.selMove(1);
  assert.equal(txt(), 'ACBED');
  E.doUndo(); E.doUndo(); E.doUndo();
  assert.equal(txt(), 'ABCDE');
  // el seleccionado de arriba no pasa del borde
  E.setSel([draft.blocks[0].id, draft.blocks[1].id]);
  E.selMove(-1);
  assert.equal(txt(), 'ABCDE');
  // duplicar
  E.setSel(ids([draft.blocks[1], draft.blocks[2]]));
  n = E.undo.length;
  E.selDup();
  assert.equal(txt(), 'ABBCCDE'); assert.equal(E.undo.length, n + 1);
  assert.equal(new Set(E.flat().map((x) => x.id)).size, 7, 'ids únicos');
  E.doUndo(); assert.equal(txt(), 'ABCDE');
  // borrar
  E.setSel(ids([draft.blocks[0], draft.blocks[4]]));
  n = E.undo.length;
  E.selDel();
  assert.equal(txt(), 'BCD'); assert.equal(E.undo.length, n + 1);
  E.doUndo(); assert.equal(txt(), 'ABCDE');
  // agrupar
  E.setSel(ids([draft.blocks[1], draft.blocks[3]]));
  n = E.undo.length;
  E.selGroup();
  assert.equal(draft.blocks.length, 4);
  assert.equal(draft.blocks[1].type, 'group');
  eq(draft.blocks[1].children.map((x) => x.html), ['B', 'D']);
  assert.equal(E.undo.length, n + 1);
  E.doUndo();
  assert.equal(txt(), 'ABCDE');
  assert.ok(c && b);
});

test('agrupar solo si son del mismo nivel', () => {
  const { E, draft } = setup((E) => { const g = E.create('group'); g.children = [p(E, 'in')]; return [p(E, 'out'), g]; });
  E.setSel([draft.blocks[0].id, draft.blocks[1].children[0].id]);
  assert.equal(E.canGroup(), false);
  const n = E.undo.length;
  E.selGroup();
  assert.equal(E.undo.length, n, 'no se añade paso de deshacer');
  assert.equal(draft.blocks.length, 2);
});

test('copiar, cortar y pegar con identificadores nuevos (también los de dentro)', () => {
  const { E, draft } = setup((E) => { const g = E.create('group'); g.children = [p(E, 'uno'), p(E, 'dos')]; return [g, p(E, 'fin')]; });
  const g = draft.blocks[0], before = new Set(E.flat().map((x) => x.id));
  E.setSel([g.id, g.children[0].id]); // el hijo no se copia aparte
  assert.equal(E.selCopy(), 1);
  E.setSel([draft.blocks[1].id]);
  const n = E.undo.length;
  E.selPaste();
  assert.equal(E.undo.length, n + 1);
  assert.equal(draft.blocks.length, 3);
  const copy = draft.blocks[2];
  assert.equal(copy.type, 'group');
  eq(copy.children.map((x) => x.html), ['uno', 'dos']);
  for (const x of E.flat([copy])) assert.ok(!before.has(x.id), 'id nuevo ' + x.id);
  eq(E.sel, [copy.id]);
  // pegar otra vez: otro juego de ids
  E.selPaste();
  assert.notEqual(draft.blocks[3].id, copy.id);
  assert.equal(new Set(E.flat().map((x) => x.id)).size, E.flat().length);
  // cortar
  E.setSel([draft.blocks[1].id]);
  E.selCut();
  assert.equal(draft.blocks.length, 3);
  assert.equal(E.clip[0].html, 'fin');
  E.doUndo();
  assert.equal(draft.blocks.length, 4);
});

test('moveBlocks: dentro y fuera de contenedores; un contenedor no entra en sí mismo', () => {
  const { E, draft } = setup((E) => {
    const g = E.create('group'); g.children = [p(E, 'g1')];
    const g2 = E.create('group'); g2.children = [p(E, 'h1')]; g.children.push(g2);
    return [p(E, 'A'), g, p(E, 'B')];
  });
  const [A, g, B] = draft.blocks, g2 = g.children[1];
  assert.equal(E.canMoveTo([g.id], g2.children), false);
  assert.equal(E.canMoveTo([g.id], g.children), false);
  assert.equal(E.canMoveTo([A.id], g2.children), true);
  E.change(() => assert.equal(E.moveBlocks([g.id], g2.children), false));
  // varios a la vez hacia dentro, en el orden del documento
  E.change(() => E.moveBlocks([B.id, A.id], g.children, g.children[0].id));
  eq(g.children.map((x) => x.html || x.type), ['A', 'B', 'g1', 'group']);
  eq(draft.blocks.map((x) => x.type), ['group']);
  // sacarlos y que el bloque de referencia sea uno de los que se mueven
  E.change(() => E.moveBlocks([A.id, g.children[2].id], draft.blocks, A.id));
  assert.equal(draft.blocks[0].html, 'A');
  assert.equal(new Set(E.flat().map((x) => x.id)).size, E.flat().length);
});

test('panel de capas: filas, teclado, ocultar, plegar y arrastrar', () => {
  const { E, w, doc, draft } = setup((E) => {
    const g = E.create('group'); g.children = [p(E, 'dentro')];
    return [p(E, 'Uno'), g, p(E, 'Tres')];
  });
  E.toggleLayers(true);
  const rows = () => [...doc.querySelectorAll('#ed-layers .ly-row')];
  assert.equal(rows().length, 4);
  eq(rows().map((r) => r.getAttribute('aria-level')), ['1', '1', '2', '1']);
  assert.equal(doc.querySelector('#ed-layers .ly-count').textContent, '4');
  const row = (b) => rows().find((r) => r.dataset.id === b.id);
  const [uno, g, tres] = draft.blocks;
  // pulsar selecciona
  row(tres).click();
  eq(E.sel, [tres.id]);
  assert.ok(row(tres).classList.contains('sel'));
  // Ctrl y Mayús
  row(uno).dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true }));
  eq(E.sel, ids([uno, g, tres]));
  // plegar con la flecha izquierda
  row(g).focus();
  row(g).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  assert.equal(rows().length, 3);
  assert.equal(row(g).getAttribute('aria-expanded'), 'false');
  row(g).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(rows().length, 4);
  // flecha abajo mueve el foco
  row(g).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  assert.equal(doc.activeElement.dataset.id, g.children[0].id);
  // ocultar: solo vista, el documento no cambia
  const before = JSON.stringify(draft.blocks), n = E.undo.length;
  row(uno).querySelector('[data-a="eye"]').click();
  assert.ok(doc.querySelector(`#d-blocks .blk[data-id="${uno.id}"]`).classList.contains('ed-hidden'));
  assert.equal(JSON.stringify(draft.blocks), before); assert.equal(E.undo.length, n);
  row(uno).querySelector('[data-a="eye"]').click();
  assert.ok(!doc.querySelector(`#d-blocks .blk[data-id="${uno.id}"]`).classList.contains('ed-hidden'));
  // al cambiar el documento el árbol se actualiza
  const rowBefore = row(uno);
  E.change(() => { uno.align = 'center'; });
  assert.equal(row(uno), rowBefore, 'una repintada sin cambios en el árbol no reconstruye el panel');
  E.change(() => draft.blocks.push(p(E, 'Cuatro')));
  assert.equal(rows().length, 5);
  // Supr en una fila borra el bloque
  E.setSel([]);
  row(tres).dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  eq(draft.blocks.map((b) => b.html || b.type), ['Uno', 'group', 'Cuatro']);
  // duplicar desde la fila
  row(uno).querySelector('[data-a="dup"]').click();
  assert.equal(draft.blocks.length, 4);
  // arrastrar la fila de «Cuatro» dentro de la sección (zona central) y fuera de ella
  const cuatro = draft.blocks[3], grp = draft.blocks[2];
  assert.equal(grp.type, 'group');
  const rect = (r, top, h) => { r.getBoundingClientRect = () => ({ top, height: h, bottom: top + h, left: 0, right: 100, width: 100 }); };
  const ev = (type, row, y) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); e.clientY = y; e.dataTransfer = { setData() {}, setDragImage() {}, effectAllowed: '', dropEffect: '' }; row.dispatchEvent(e); };
  rect(row(grp), 100, 40);
  ev('dragstart', row(cuatro), 0);
  ev('dragover', row(grp), 120);
  assert.ok(row(grp).classList.contains('drop-inside'));
  ev('drop', row(grp), 120);
  eq(grp.children.map((b) => b.html || b.type), ['dentro', 'Cuatro']);
  // un contenedor no entra en sí mismo: arrastrar el grupo sobre su propio hijo
  const hijo = grp.children[1];
  rect(row(hijo), 200, 40);
  ev('dragstart', row(grp), 0);
  ev('dragover', row(hijo), 205);
  assert.ok(![...doc.querySelectorAll('.ly-row')].some((r) => /drop-/.test(r.className)), 'no se puede soltar un contenedor en sí mismo');
  ev('drop', row(hijo), 205);
  assert.equal(draft.blocks.includes(grp), true);
  ev('dragend', row(grp), 0);
});

test('Ctrl+C / Ctrl+X / Ctrl+V fuera de un texto', () => {
  const { E, w, doc, draft } = setup((E) => ['A', 'B', 'C'].map((x) => p(E, x)));
  const key = (k, extra = {}) => doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...extra }));
  E.setSel([draft.blocks[0].id, draft.blocks[1].id]);
  key('c');
  assert.equal(E.clip.length, 2);
  key('v');
  eq(draft.blocks.map((b) => b.html), ['A', 'B', 'A', 'B', 'C']);
  E.setSel([draft.blocks[0].id, draft.blocks[1].id]);
  key('x');
  eq(draft.blocks.map((b) => b.html), ['A', 'B', 'C']);
  // dentro de un texto no actúa
  const ed = doc.querySelector('#d-blocks .rt');
  E.setSel([draft.blocks[0].id, draft.blocks[1].id]);
  ed.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(draft.blocks.length, 3);
});
