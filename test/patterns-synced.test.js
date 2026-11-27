// Patrones de la web, bloques sincronizados y plantillas propias: lógica pura (sin DOM ni WordPress)
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../renderer/patterns');
const CT = require('../renderer/templates');
const T = require('../src/transform');
const { parseBlocks } = require('../src/parseblocks');

const para = (html, extra = {}) => ({ id: 'p' + Math.random(), type: 'paragraph', html, ...extra });

test('wp:block: salida y lectura de vuelta', () => {
  const out = T.composeBlocks([para('Hola'), { id: 's1', type: 'synced', ref: 42, title: 'Aviso' }, para('Adiós')]);
  assert.match(out, /<!-- wp:block \{"ref":42\} \/-->/);
  const back = parseBlocks(out);
  assert.deepEqual(back.map((b) => b.type), ['paragraph', 'synced', 'paragraph']);
  assert.equal(back[1].ref, 42);
  // ida y vuelta: lo que se vuelve a escribir es igual
  assert.equal(T.composeBlocks(back), out);
  // referencia no válida: no se escribe; con otros atributos se conserva como bloque de WordPress
  assert.equal(T.composeBlocks([{ id: 'x', type: 'synced', ref: 0 }]), '');
  const odd = parseBlocks('<!-- wp:block {"ref":7,"className":"x"} /-->');
  assert.equal(odd[0].type, 'raw');
  assert.equal(parseBlocks('<!-- wp:block /-->')[0].type, 'raw');
});

test('wp:block dentro de una sección y de columnas se conserva', () => {
  const blocks = [{ id: 'g', type: 'group', pad: 'm', children: [{ id: 's', type: 'synced', ref: 9 }] }];
  const back = parseBlocks(T.composeBlocks(blocks));
  assert.equal(back[0].type, 'group');
  assert.equal(back[0].children[0].type, 'synced');
  assert.equal(back[0].children[0].ref, 9);
});

test('patrones: normalizar la respuesta de WordPress, buscar y categorías', () => {
  const raw = [
    { name: 'twentytwentyfive/hero', title: 'Portada &amp; título', description: 'Una gran portada', categories: ['banner', 'featured'], keywords: ['hero'], content: '<!-- wp:paragraph --><p>Hola</p><!-- /wp:paragraph -->', viewport_width: 1400, inserter: true },
    { name: 'a/b', title: 'Tres columnas', categories: ['columns'], content: '<!-- wp:columns --><div class="wp-block-columns"></div><!-- /wp:columns -->' },
    { name: 'oculto', title: 'No va', content: 'x', inserter: false },
    { name: 'vacío', title: 'Sin contenido', content: '  ' },
    null, { title: 'sin nombre', content: 'x' },
  ];
  const list = P.normalizePatterns(raw);
  assert.deepEqual(list.map((p) => p.name), ['twentytwentyfive/hero', 'a/b']);
  assert.equal(list[0].title, 'Portada & título');
  assert.equal(list[0].viewport, 1400);
  assert.deepEqual(P.filterPatterns(list, { q: 'portada' }).map((p) => p.name), ['twentytwentyfive/hero']);
  assert.deepEqual(P.filterPatterns(list, { q: 'hero' }).length, 1, 'busca también en palabras clave');
  assert.deepEqual(P.filterPatterns(list, { cat: 'columns' }).map((p) => p.name), ['a/b']);
  assert.equal(P.filterPatterns(list, { q: 'zzz' }).length, 0);
  const cats = P.normalizeCategories([{ name: 'banner', label: 'Banners' }, { name: 'columns', label: 'Columnas' }, { name: 'vacia', label: 'Sin patrones' }, {}]);
  const used = P.usedCategories(list, cats);
  assert.deepEqual(used.map((c) => [c.name, c.count]), [['banner', 1], ['columns', 1], ['featured', 1]]);
  assert.equal(used[0].label, 'Banners');
});

test('patrón → bloques de Ecos: lo que Ecos sabe editar se convierte y el resto queda como «De WordPress»', () => {
  const content = '<!-- wp:heading {"level":2} -->\n<h2 class="wp-block-heading">Título</h2>\n<!-- /wp:heading -->\n\n'
    + '<!-- wp:paragraph -->\n<p>Texto</p>\n<!-- /wp:paragraph -->\n\n'
    + '<!-- wp:acme/raro {"a":1} -->\n<div>cosa rara</div>\n<!-- /wp:acme/raro -->\n\n'
    + '<!-- wp:block {"ref":5} /-->';
  const blocks = parseBlocks(content);
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'raw', 'synced']);
  assert.equal(blocks[0].html, 'Título');
  assert.match(blocks[2].markup, /acme\/raro/);
  assert.equal(blocks[3].ref, 5);
});

test('bloques sincronizados de la web: normalizar wp_block y cuerpo para crearlos', () => {
  const list = P.normalizeSynced([
    { id: 5, title: { raw: 'Aviso de cierre', rendered: 'Aviso de cierre' }, content: { raw: '<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->' }, wp_pattern_sync_status: '' },
    { id: 6, title: { rendered: 'Mi patrón' }, content: { raw: 'y' }, wp_pattern_sync_status: 'unsynced' },
    { id: 'x', title: 'raro' }, null,
  ]);
  assert.deepEqual(list.map((s) => [s.id, s.title, s.sync]), [[5, 'Aviso de cierre', ''], [6, 'Mi patrón', 'unsynced']]);
  const body = P.syncedPayload('  Mi bloque ', T.composeBlocks([para('Hola')]), '');
  assert.equal(body.title, 'Mi bloque'); assert.equal(body.status, 'publish'); assert.equal(body.meta.wp_pattern_sync_status, '');
  assert.match(body.content, /<!-- wp:paragraph -->/);
  assert.equal(P.syncedPayload('x', '', 'unsynced').meta.wp_pattern_sync_status, 'unsynced');
  assert.equal(P.normalizeSynced([{ id: 7, title: 'm', content: { raw: '' }, meta: { wp_pattern_sync_status: 'unsynced' } }])[0].sync, 'unsynced');
  assert.equal(P.syncedPayload('', '', '').title, 'Bloque');
  assert.deepEqual(P.syncedRef(5, 'Aviso'), { type: 'synced', ref: 5, title: 'Aviso' });
});

test('sincronizado: desvincular sustituye la referencia por bloques normales (también dentro de secciones y columnas)', () => {
  const tree = [
    para('a'), { id: 's1', type: 'synced', ref: 5 },
    { id: 'g', type: 'group', children: [{ id: 's2', type: 'synced', ref: 5 }, { id: 's3', type: 'synced', ref: 6 }] },
    { id: 'c', type: 'columns', cols: [{ width: '50%', children: [{ id: 's4', type: 'synced', ref: 5 }] }, { width: '50%', children: [] }] },
  ];
  const content = () => [para('uno'), para('dos')];
  // solo uno
  assert.equal(P.unlinkIn(tree, (b) => b.id === 's1', content), 1);
  assert.deepEqual(tree.slice(0, 4).map((b) => b.type), ['paragraph', 'paragraph', 'paragraph', 'group']);
  assert.equal(tree[1].html, 'uno'); assert.equal(tree[2].html, 'dos');
  // todos los de una referencia
  assert.equal(P.unlinkIn(tree, 5, content), 2);
  assert.deepEqual(tree[3].children.map((b) => b.type), ['paragraph', 'paragraph', 'synced']);
  assert.equal(tree[3].children[2].ref, 6);
  assert.equal(tree[4].cols[0].children.length, 2);
  // sin referencias: no hace nada
  assert.equal(P.unlinkIn([para('x')], null, content), 0);
  // el resultado ya no lleva wp:block
  assert.doesNotMatch(T.composeBlocks(tree.slice(0, 3)), /wp:block/);
});

test('plantillas propias: solo la estructura vacía los textos y deja indicaciones', () => {
  const blocks = [
    { id: 'a', type: 'heading', level: 2, html: 'Qué <b>hicimos</b>' },
    { id: 'b', type: 'paragraph', html: 'Un texto bastante largo '.repeat(8) },
    { id: 'c', type: 'list', items: ['uno', 'dos', 'tres'] },
    { id: 'd', type: 'quote', html: 'Cita', cite: 'Alguien' },
    { id: 'e', type: 'buttons', html: 'Colabora', url: 'https://x.org', align: 'center', variant: 'fill' },
    { id: 'f', type: 'group', pad: 'm', children: [{ id: 'g', type: 'paragraph', html: 'Dentro' }] },
    { id: 'h', type: 'columns', stack: true, cols: [{ width: '50%', children: [{ id: 'i', type: 'details', summary: 'Pregunta', html: 'Respuesta' }] }, { width: '50%', children: [] }] },
    { id: 'j', type: 'image', img: { id: 1, url: 'https://x/a.jpg' }, caption: 'pie' },
  ];
  const copy = JSON.stringify(blocks);
  const e = CT.emptyTexts(blocks);
  assert.equal(JSON.stringify(blocks), copy, 'no modifica el original');
  assert.equal(e[0].html, ''); assert.equal(e[0].ph, 'Qué hicimos');
  assert.equal(e[1].html, ''); assert.ok(e[1].ph.length <= 80 && e[1].ph.endsWith('…'));
  assert.deepEqual(e[2].items, ['', '', '']); assert.equal(e[2].ph, 'uno');
  assert.equal(e[3].html, ''); assert.equal(e[3].cite, ''); assert.equal(e[3].ph, 'Cita');
  assert.equal(e[4].html, 'Colabora'); assert.equal(e[4].url, '');
  assert.equal(e[5].children[0].html, ''); assert.equal(e[5].children[0].ph, 'Dentro');
  assert.equal(e[6].cols[0].children[0].summary, ''); assert.equal(e[6].cols[0].children[0].ph, 'Pregunta');

  const full = CT.makeUserTemplate('Completa', blocks, 'post', { desc: ' Con todo ' });
  assert.equal(full.desc, 'Con todo'); assert.ok(!full.structureOnly);
  assert.equal(full.blocks[0].html, 'Qué <b>hicimos</b>'); assert.equal(full.blocks[7].img, null);
  const shell = CT.makeUserTemplate('Esqueleto', blocks, 'page', { texts: false });
  assert.equal(shell.type, 'page'); assert.equal(shell.structureOnly, true);
  assert.equal(shell.blocks[0].html, ''); assert.ok(shell.blocks.every((b) => !('id' in b)));
  // la plantilla vacía sigue saliendo como bloques válidos de WordPress
  assert.doesNotThrow(() => T.composeBlocks(shell.blocks.map((b, k) => ({ ...b, id: 'x' + k }))));
});

test('plantillas propias: exportar e importar archivo .json', () => {
  const a = CT.makeUserTemplate('Mi plantilla', [{ type: 'heading', level: 2, html: 'T' }], 'post', { desc: 'd' });
  const b = CT.makeUserTemplate('Otra', [{ type: 'paragraph', html: '' }], 'page', { texts: false });
  const file = CT.exportTemplates([a, b, { name: '', blocks: [] }, { name: 'rota', blocks: [{ nada: 1 }] }]);
  const data = JSON.parse(file);
  assert.equal(data.ecos, 'ecos-plantillas'); assert.equal(data.templates.length, 2, 'las no válidas no se exportan');
  const r = CT.parseImport(file, [a]);
  assert.deepEqual(r.templates.map((x) => x.name), ['Mi plantilla (2)', 'Otra'], 'los nombres repetidos se renombran');
  assert.equal(r.templates[0].desc, 'd'); assert.equal(r.templates[1].structureOnly, true); assert.equal(r.skipped, 0);
  // archivo con alguna no válida
  const mixed = JSON.stringify({ ecos: 'ecos-plantillas', templates: [a, { name: 'x' }, 7] });
  const m = CT.parseImport(mixed);
  assert.equal(m.templates.length, 1); assert.equal(m.skipped, 2);
  // archivos que no son de plantillas
  assert.throws(() => CT.parseImport('no es json'), /plantillas de Ecos/);
  assert.throws(() => CT.parseImport('{"ecos":"otra-cosa","templates":[]}'), /plantillas de Ecos/);
  assert.throws(() => CT.parseImport('{"templates":[]}'), /plantillas de Ecos/);
  // las fotos concretas no viajan en el archivo
  const withPhoto = JSON.stringify({ ecos: 'ecos-plantillas', templates: [{ name: 'F', blocks: [{ type: 'image', img: { id: 3, url: 'u' }, caption: 'c' }] }] });
  assert.equal(CT.parseImport(withPhoto).templates[0].blocks[0].img, null);
});
