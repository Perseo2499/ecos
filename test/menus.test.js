// Menús (árbol, orden, padres, diferencias, ubicaciones, menús de bloques) y widgets: lógica pura.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../renderer/menutree');
const W = require('../renderer/widgetlogic');

const items = [
  { id: 11, title: 'Inicio', parent: 0, order: 1, type: 'post_type', object: 'page', objectId: 2, url: '/' },
  { id: 12, title: 'Quiénes somos', parent: 0, order: 2, type: 'post_type', object: 'page', objectId: 3, url: '/q' },
  { id: 13, title: 'Equipo', parent: 12, order: 3, type: 'post_type', object: 'page', objectId: 4, url: '/e' },
  { id: 14, title: 'Contacto', parent: 0, order: 4, type: 'custom', object: 'custom', objectId: 0, url: 'https://x.org/c' },
];
const names = (tree) => tree.map((n) => n.title + (n.children.length ? '[' + names(n.children) + ']' : '')).join(',');

test('nest / flatten: ida y vuelta y orden consecutivo', () => {
  const t = M.nest(items);
  assert.equal(names(t), 'Inicio,Quiénes somos[Equipo],Contacto');
  const back = M.flatten(t);
  assert.deepEqual(back.map((x) => [x.id, x.parent, x.order]), [[11, 0, 1], [12, 0, 2], [13, 12, 3], [14, 0, 4]]);
  assert.equal(M.diff(items, back).count, 0, 'sin cambios no hay peticiones');
  // desordenado y con un padre inexistente o un ciclo
  const odd = M.nest([{ id: 1, title: 'a', parent: 9, order: 5 }, { id: 2, title: 'b', parent: 3, order: 1 }, { id: 3, title: 'c', parent: 2, order: 1 }, { id: 4, title: 'd', parent: 0, order: 2 }]);
  assert.equal(M.count(odd), 4);
});
test('mover, anidar y respetar los 3 niveles', () => {
  let t = M.nest(items);
  let r = M.move(t, 14, 11, 0); assert.ok(r.ok); t = r.tree;
  assert.equal(names(t), 'Inicio[Contacto],Quiénes somos[Equipo]');
  r = M.indent(t, 12); assert.ok(r.ok); t = r.tree; // Quiénes somos pasa a hijo de Inicio, tras Contacto
  assert.equal(names(t), 'Inicio[Contacto,Quiénes somos[Equipo]]');
  assert.equal(M.depth(t), 3);
  // un cuarto nivel no cabe
  const four = M.add(t, { id: 'n1', title: 'Nuevo' }, 13);
  assert.equal(four.ok, false); assert.equal(four.why, 'depth');
  assert.equal(M.move(t, 11, 13, 0).why, 'cycle', 'no se puede meter un elemento dentro de sí mismo');
  const mv = M.move(M.nest([...items, { id: 15, title: 'X', parent: 0, order: 9 }]), 11, 13, 0); // Inicio dentro de Equipo: nivel 3 → ok
  assert.ok(mv.ok);
  assert.equal(M.move(M.nest(items), 12, 14, 0).ok, true);
  r = M.outdent(t, 13); assert.ok(r.ok); assert.equal(names(r.tree), 'Inicio[Contacto,Quiénes somos,Equipo]');
  assert.equal(M.outdent(M.nest(items), 11).why, 'top');
  assert.equal(M.indent(M.nest(items), 11).why, 'first');
  assert.equal(names(M.up(M.nest(items), 12).tree), 'Quiénes somos[Equipo],Inicio,Contacto');
  assert.equal(names(M.down(M.nest(items), 12).tree), 'Inicio,Contacto,Quiénes somos[Equipo]');
  assert.equal(M.up(M.nest(items), 11).why, 'edge');
});
test('quitar sube a los hijos y renombrar', () => {
  const t = M.nest(items);
  assert.equal(names(M.remove(t, 12)), 'Inicio,Equipo,Contacto');
  assert.equal(names(M.rename(t, 11, { title: 'Portada' })), 'Portada,Quiénes somos[Equipo],Contacto');
});
test('diff: lo mínimo para guardar', () => {
  const o = items;
  // renombrar uno
  let t = M.rename(M.nest(o), 13, { title: 'Nuestro equipo' });
  assert.deepEqual(M.diff(o, M.flatten(t)), { del: [], add: [], upd: [{ id: 13, title: 'Nuestro equipo' }], count: 1 });
  // mover el último al final de otro nivel solo toca lo necesario: Contacto como hijo de Inicio
  t = M.move(M.nest(o), 14, 11, 0).tree;
  const d = M.diff(o, M.flatten(t));
  assert.deepEqual(d.upd.map((u) => u.id).sort(), [12, 13, 14]); // 11 conserva padre y orden
  assert.deepEqual(d.upd.find((u) => u.id === 14), { id: 14, parent: 11, order: 2 });
  // quitar + añadir (con un hijo del nuevo)
  t = M.remove(M.nest(o), 11);
  t = M.add(t, M.newItem('t1', 'custom', { title: 'Blog', url: 'https://x.org/blog' })).tree;
  t = M.add(t, M.newItem('t2', 'page', { title: 'Noticias', objectId: 9, url: '/n' }), 't1').tree;
  const e = M.diff(o, M.flatten(t));
  assert.deepEqual(e.del, [11]);
  assert.deepEqual(e.add.map((a) => [a.tmp, a.parent, a.type, a.object, a.objectId]), [['t1', 0, 'custom', 'custom', 0], ['t2', 't1', 'post_type', 'page', 9]]);
  assert.ok(e.add[0].order < e.add[1].order, 'los padres van antes que los hijos');
  assert.equal(M.newItem('c', 'category', { title: 'Cat', objectId: 5 }).type, 'taxonomy');
  assert.equal(M.newItem('p', 'post', { objectId: 5 }).object, 'post');
  // un cambio de dirección de un enlace personalizado
  const f = M.flatten(M.nest(o)); f.find((x) => x.id === 14).url = 'https://x.org/nuevo';
  assert.deepEqual(M.diff(o, f).upd, [{ id: 14, url: 'https://x.org/nuevo' }]);
});
test('ubicaciones: una ubicación solo tiene un menú y se guardan solo los menús que cambian', () => {
  const menus = [{ id: 1, locations: ['primary'] }, { id: 2, locations: [] }, { id: 3, locations: ['footer'] }];
  const now = M.assign(menus, 2, 'primary');
  assert.deepEqual(now.map((m) => m.locations), [[], ['primary'], ['footer']]);
  assert.deepEqual(M.locationsDiff(menus, now).map((x) => x.id), [1, 2]);
  assert.deepEqual(M.locationsDiff(menus, menus), []);
  assert.deepEqual(M.assign(now, 2, 'primary', false)[1].locations, []);
});
test('menús de bloques: leer y escribir core/navigation-link y submenu sin perder otros bloques', () => {
  const src = '<!-- wp:navigation-link {"label":"Inicio","type":"page","id":2,"url":"https://x.org/","kind":"post-type"} /-->\n'
    + '<!-- wp:navigation-submenu {"label":"Más","url":"#","kind":"custom","type":"custom"} -->\n<!-- wp:navigation-link {"label":"Blog &amp; <b>","url":"https://x.org/blog","opensInNewTab":true} /-->\n<!-- /wp:navigation-submenu -->\n'
    + '<!-- wp:page-list /-->';
  const tree = M.parseNav(src);
  assert.equal(tree.length, 3);
  assert.equal(tree[0].title, 'Inicio'); assert.equal(tree[0].objectId, 2);
  assert.equal(tree[1].children.length, 1); assert.equal(tree[1].children[0].newTab, true);
  assert.equal(tree[2].opaque, true); assert.equal(tree[2].raw, '<!-- wp:page-list /-->');
  const out = M.serializeNav(tree);
  assert.match(out, /<!-- wp:navigation-submenu \{"label":"Más"/);
  assert.match(out, /<!-- \/wp:navigation-submenu -->/);
  assert.ok(out.endsWith('<!-- wp:page-list /-->'));
  assert.ok(!/<b>/.test(out), 'los atributos escapan < y >');
  assert.deepEqual(M.parseNav(out).map((n) => [n.title, n.children.length, !!n.opaque]), tree.map((n) => [n.title, n.children.length, !!n.opaque]));
  // un enlace con hijos pasa a submenú; un submenú sin hijos, a enlace
  const t2 = M.add(M.parseNav(src), M.toNavNode(M.newItem('n9', 'page', { title: 'Nueva', objectId: 7, url: '/nueva' })), 'n1').tree;
  assert.match(M.serializeNav(t2), /<!-- wp:navigation-submenu \{"label":"Inicio"/);
  assert.match(M.serializeNav(M.remove(tree, 'n2')), /<!-- wp:navigation-link \{"label":"Más"/);
  assert.equal(M.serializeNav([]), '');
});

// ------------------------------------------------------------------ widgets
const sidebars = [{ id: 'sidebar-1', name: 'Barra lateral', description: '<p>Principal</p>', widgets: ['block-2', 'text-3'] }, { id: 'footer-1', name: 'Pie', widgets: ['custom_html-4'] }, { id: 'wp_inactive_widgets', name: 'Inactivos', widgets: [] }];
const widgets = [
  { id: 'block-2', id_base: 'block', instance: { raw: { content: '<!-- wp:paragraph --><p>Hola <b>mundo</b></p><!-- /wp:paragraph -->' } }, rendered: '<p>Hola</p>' },
  { id: 'text-3', id_base: 'text', instance: { raw: { title: 'Aviso', text: 'Texto', filter: true } } },
  { id: 'custom_html-4', id_base: 'custom_html', instance: { raw: { title: '', content: '<b>x</b>' } } },
  { id: 'calendar-5', id_base: 'calendar', instance: { raw: { title: 'Cal' } } },
];
test('widgets: zonas, tipos y etiquetas', () => {
  const z = W.normalize(sidebars, widgets);
  assert.deepEqual(z.map((x) => x.id), ['sidebar-1', 'footer-1', 'wp_inactive_widgets']);
  assert.equal(z[0].description, 'Principal');
  assert.deepEqual(z[0].widgets.map((w) => w.kind), ['block', 'text']);
  assert.equal(W.label(z[0].widgets[0]), 'Hola mundo');
  assert.equal(W.label(z[0].widgets[1]), 'Aviso');
  assert.equal(W.kindOf({ idBase: 'calendar' }), 'other');
  assert.equal(W.kindOf({ idBase: 'media_image' }), 'image');
});
test('widgets: mover entre zonas, añadir uno de bloque y diferencias mínimas', () => {
  const orig = W.normalize(sidebars, widgets);
  assert.equal(W.diff(orig, orig).count, 0);
  // mover dentro de la misma zona: solo cambia el orden de esa zona
  let z = W.move(orig, 'text-3', 'sidebar-1', 0).zones;
  assert.deepEqual(W.diff(orig, z), { del: [], add: [], upd: [], order: [{ sidebar: 'sidebar-1', widgets: ['text-3', 'block-2'] }], count: 1 });
  // entre zonas: cambian las dos
  z = W.move(orig, 'block-2', 'footer-1', 1).zones;
  const d = W.diff(orig, z);
  assert.deepEqual(d.order.map((o) => [o.sidebar, o.widgets]), [['sidebar-1', ['text-3']], ['footer-1', ['custom_html-4', 'block-2']]]);
  assert.equal(d.add.length + d.del.length + d.upd.length, 0);
  // editar el contenido de uno de bloque y de uno de texto
  z = W.setRaw(orig, 'block-2', { content: 'nuevo' }); z = W.setRaw(z, 'text-3', { text: 'otro' });
  assert.deepEqual(W.diff(orig, z).upd.map((u) => u.id), ['block-2', 'text-3']);
  // añadir al final de una zona: se crea con su zona y no hace falta ordenar
  const a = W.addBlock(orig, 'footer-1', '<!-- wp:paragraph --><p>Nuevo</p><!-- /wp:paragraph -->', 'new-1');
  const da = W.diff(orig, a.zones);
  assert.deepEqual(da.add, [{ tmp: 'new-1', idBase: 'block', sidebar: 'footer-1', raw: { content: '<!-- wp:paragraph --><p>Nuevo</p><!-- /wp:paragraph -->' } }]);
  assert.deepEqual(da.order, []);
  // añadir y subirlo al principio: se crea y luego se ordena
  const up = W.move(a.zones, 'new-1', 'footer-1', 0).zones;
  assert.deepEqual(W.diff(orig, up).order, [{ sidebar: 'footer-1', widgets: ['new-1', 'custom_html-4'] }]);
  // quitar
  const r = W.diff(orig, W.remove(orig, 'custom_html-4'));
  assert.deepEqual([r.del, r.order.length], [['custom_html-4'], 0]);
});

test('deshacer: se vuelven a crear los elementos y widgets quitados y se quitan los añadidos', () => {
  const now = M.flatten(M.add(M.remove(M.nest(items), 12), M.newItem(77, 'custom', { title: 'Extra', url: 'https://x.org' })).tree);
  const d = M.diff(now, M.revert(items, now));
  assert.deepEqual(d.del, [77]);
  assert.deepEqual(d.add.map((a) => a.title), ['Quiénes somos']);
  assert.ok(M.isNew(d.add[0].tmp));
  const zs = W.normalize(sidebars, widgets), cur = W.remove(zs, 'text-3');
  const dw = W.diff(cur, W.revert(zs, cur));
  assert.deepEqual(dw.add.map((a) => [a.idBase, a.sidebar]), [['text', 'sidebar-1']]);
}
);
