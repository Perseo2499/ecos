// Editor: patrones de la web, bloques sincronizados, plantillas propias (claro y vinilo).
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, newPage, shot, openApp, ROOT } = require('./helpers');
const { installMock } = require('./mock-api');
const { parseBlocks } = require(ROOT + '/src/parseblocks');

const PATTERNS = [
  { name: 'tema/portada', title: 'Portada con título', description: 'Una portada grande con botón', categories: ['banner'], content: '<!-- wp:heading {"level":2} -->\n<h2 class="wp-block-heading">Bienvenidas a nuestra casa</h2>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>Un lugar para todas las personas del barrio.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:acme/raro {"a":1} -->\n<div>bloque raro</div>\n<!-- /wp:acme/raro -->' },
  { name: 'tema/columnas', title: 'Tres columnas', description: 'Tres ideas en columnas', categories: ['columns'], content: '<!-- wp:columns -->\n<div class="wp-block-columns"><!-- wp:column -->\n<div class="wp-block-column"><!-- wp:paragraph -->\n<p>Uno</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:column -->\n\n<!-- wp:column -->\n<div class="wp-block-column"><!-- wp:paragraph -->\n<p>Dos</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:column --></div>\n<!-- /wp:columns -->' },
  { name: 'tema/cita', title: 'Cita destacada', description: '', categories: ['text'], content: '<!-- wp:quote -->\n<blockquote class="wp-block-quote"><p>Juntas llegamos más lejos</p></blockquote>\n<!-- /wp:quote -->' },
];
const CATS = [{ name: 'banner', label: 'Banners' }, { name: 'columns', label: 'Columnas' }, { name: 'text', label: 'Texto' }];
const WPB = {
  5: { id: 5, title: 'Aviso de horario', sync: '', content: '<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">Horario de verano</h3>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>De lunes a jueves, de 9 a 14 h.</p>\n<!-- /wp:paragraph -->' },
  6: { id: 6, title: 'Mi llamada a la acción', sync: 'unsynced', content: '<!-- wp:paragraph -->\n<p>Hazte socia hoy mismo.</p>\n<!-- /wp:paragraph -->' },
};


async function run(b, theme) {
  const p = await newPage(b, { viewport: { width: 1380, height: 860 } });
  await p.exposeFunction('nodeParse', (c) => parseBlocks(c));
  await p.exposeFunction('nodeBlocks', (id) => parseBlocks(WPB[id].content));
  await p.addInitScript((d) => { window.__DATA = d; }, { PATTERNS, CATS, WPB });
  await installMock(p, {
    theme: theme === 'vinilo' ? 'dark' : theme,
    config: { metaConnected: true },
    patch: (api, H) => {
      const { PATTERNS, CATS, WPB } = window.__DATA;
      window.__calls = { syncedSave: [], export: [], parse: 0 };
      let nextId = 100;
      Object.assign(api, {
        blockPatterns: async () => ({ patterns: PATTERNS.map((x) => ({ ...x, keywords: [], viewport: 0 })), categories: CATS }),
        parseBlocks: async (c) => { window.__calls.parse++; return window.nodeParse(c); },
        syncedList: async () => Promise.all(Object.values(WPB).map(async (s) => ({ ...s, blocks: await window.nodeBlocks(s.id) }))),
        syncedGet: async (id) => ({ ...WPB[id], blocks: WPB[id].blocks || await window.nodeBlocks(id) }),
        syncedSave: async (o) => { window.__calls.syncedSave.push(o); if (o.id) { WPB[o.id].title = o.title; WPB[o.id].blocks = o.blocks; return { id: o.id, title: o.title }; } const id = nextId++; WPB[id] = { id, title: o.title, sync: o.sync, content: '' }; return { id, title: o.title }; },
        templatesExport: async (json) => { window.__calls.export.push(json); return '/tmp/plantillas.json'; },
        templatesImport: async () => window.__importText || null,
      });
    },
  });
  await openApp(p);

  // abre el editor con una entrada
  await p.click('[data-tab="posts"]'); await p.click('#load'); await p.locator('.post').first().click(); await p.click('#make');
  await p.waitForSelector('#editor:not(.hidden)');
  await p.evaluate(() => { window.BlockEditor.change(() => { window.BlockEditor.draft.blocks.length = 0; window.BlockEditor.draft.blocks.push(window.BlockEditor.create('paragraph', { html: 'Primer párrafo de la entrada' }), window.BlockEditor.create('paragraph', { html: 'Segundo párrafo' })); }); });
  await p.waitForTimeout(200);
  if (theme === 'vinilo') await p.evaluate(() => { document.documentElement.dataset.vinyl = 'on'; });

  // --- Patrones de tu web ---
  await p.locator('#d-blocks .ins-btn').first().click({ force: true });
  await p.waitForSelector('#ins-menu:not(.hidden)');
  await shot(p, 'f2a-'+theme+'-1-menu-insertar');
  await p.click('#ins-menu [data-type="webpatterns"]');
  await p.waitForSelector('.pat-dlg .pat-card');
  await p.waitForTimeout(700);
  assert.equal(await p.locator('.pat-card').count(), 3);
  assert.ok(await p.locator('.pat-card .pv .blk').count() >= 3, 'miniaturas renderizadas con el editor');
  assert.equal(await p.locator('.pat-cat').count(), 4, 'Todos + 3 categorías');
  await shot(p, 'f2a-'+theme+'-2-patrones');
  await p.fill('#pat-q', 'columnas'); await p.waitForTimeout(200);
  assert.equal(await p.locator('.pat-card').count(), 1);
  await p.fill('#pat-q', ''); await p.click('.pat-cat[data-c="banner"]');
  assert.equal(await p.locator('.pat-card').count(), 1);
  await shot(p, 'f2a-'+theme+'-3-patrones-categoria');
  await p.locator('.pat-card').first().click();
  await p.click('.pat-dlg [data-r="ok"]');
  await p.waitForSelector('.pat-dlg', { state: 'detached' });
  const types1 = await p.evaluate(() => window.BlockEditor.draft.blocks.map((b) => b.type));
  assert.deepEqual(types1, ['heading', 'paragraph', 'raw', 'paragraph', 'paragraph']);
  assert.ok(await p.locator('.raw-box').count() >= 1, 'lo que Ecos no sabe editar queda como «De WordPress»');

  // --- Insertar un bloque sincronizado como referencia ---
  await p.locator('#d-blocks .ins-btn').last().click({ force: true });
  await p.click('#ins-menu [data-type="webpatterns"]');
  await p.waitForSelector('.pat-dlg .pat-card');
  await p.click('.pat-tabs [data-tab="mine"]');
  await p.waitForSelector('.pat-badge'); await p.waitForTimeout(600);
  assert.equal(await p.locator('.pat-card').count(), 2);
  await shot(p, 'f2a-'+theme+'-4-mis-bloques');
  await p.locator('.pat-card', { hasText: 'Aviso de horario' }).click();
  assert.match(await p.locator('.pat-dlg [data-r="ok"]').textContent(), /vinculado/);
  await p.click('.pat-dlg [data-r="ok"]');
  await p.waitForSelector('.syn-box');
  await p.waitForSelector('.syn-body .blk');
  const syn = await p.evaluate(() => window.BlockEditor.draft.blocks.filter((b) => b.type === 'synced'));
  assert.equal(syn.length, 1); assert.equal(syn[0].ref, 5);
  assert.match(await p.locator('.syn-note').textContent(), /Bloque sincronizado: si lo cambias, cambia en todas las páginas/);
  assert.equal(await p.locator('.syn-note [data-a="edit"]').count(), 1);
  assert.equal(await p.locator('.syn-note [data-a="unlink"]').count(), 1);
  assert.match(await p.locator('.syn-body').textContent(), /Horario de verano/);
  assert.equal(await p.locator('.syn-body [contenteditable="true"]').count(), 0, 'no editable en línea');
  await p.locator('.syn-box').scrollIntoViewIfNeeded();
  await shot(p, 'f2a-'+theme+'-5-sincronizado');

  // --- Editar el original ---
  await p.click('.syn-note [data-a="edit"]');
  await p.waitForSelector('#editor.wpb-mode');
  assert.equal(await p.inputValue('#d-title'), 'Aviso de horario');
  assert.equal(await p.evaluate(() => window.BlockEditor.draft.type), 'wp_block');
  await shot(p, 'f2a-'+theme+'-6-editar-original');
  await p.evaluate(() => { window.BlockEditor.change(() => { window.BlockEditor.draft.blocks[1].html = 'De lunes a viernes, de 9 a 15 h.'; }); });
  await p.fill('#d-title', 'Aviso de horario 2');
  await p.click('#send');
  await p.waitForSelector('#editor:not(.wpb-mode)');
  const sv = await p.evaluate(() => window.__calls.syncedSave);
  assert.equal(sv.length, 1); assert.equal(sv[0].id, 5); assert.equal(sv[0].title, 'Aviso de horario 2'); assert.equal(sv[0].blocks[1].html, 'De lunes a viernes, de 9 a 15 h.');
  assert.ok((await p.evaluate(() => window.BlockEditor.draft.blocks.some((b) => b.type === 'synced' && b.ref === 5))), 'se vuelve a la entrada con la referencia');
  await p.waitForSelector('.syn-body .blk');
  assert.match(await p.locator('.syn-body').textContent(), /de 9 a 15 h/);

  // --- Desvincular ---
  const before = await p.evaluate(() => window.BlockEditor.draft.blocks.length);
  await p.click('.syn-note [data-a="unlink"]');
  await p.waitForFunction(() => !window.BlockEditor.draft.blocks.some((b) => b.type === 'synced'));
  assert.equal(await p.locator('.syn-box').count(), 0);
  assert.equal(await p.evaluate(() => window.BlockEditor.draft.blocks.length), before - 1 + 2);

  // --- Guardar como bloque sincronizado (selección múltiple) ---
  await p.evaluate(() => { const E = window.BlockEditor; E.setSel([E.draft.blocks[0].id, E.draft.blocks[1].id]); });
  await p.waitForSelector('#sel-bar [data-a="sync"]');
  await shot(p, 'f2a-'+theme+'-7-seleccion');
  const n0 = await p.evaluate(() => window.BlockEditor.draft.blocks.length);
  await p.click('#sel-bar [data-a="sync"]');
  await p.waitForSelector('#syn-name');
  await shot(p, 'f2a-'+theme+'-8-guardar-sincronizado');
  await p.fill('#syn-name', 'Cabecera de la portada');
  await p.click('form.dlg button[type="submit"]');
  await p.waitForSelector('.syn-box');
  const s2 = await p.evaluate(() => window.__calls.syncedSave[1]);
  assert.equal(s2.title, 'Cabecera de la portada'); assert.equal(s2.sync, ''); assert.equal(s2.blocks.length, 2); assert.equal(s2.id, undefined);
  const after = await p.evaluate(() => window.BlockEditor.draft.blocks.map((b) => b.type + (b.ref ? ':' + b.ref : '')));
  assert.equal(after.length, n0 - 1); assert.equal(after[0], 'synced:100');
  // desde el menú «⋯» de un bloque, como patrón sin sincronizar
  await p.evaluate(() => { const E = window.BlockEditor; E.sel = []; });
  await p.locator('#d-blocks .blk-paragraph:not(.syn-in .blk)').first().hover();
  await p.locator('#d-blocks .blk-paragraph:not(.syn-in .blk) [data-dz]').first().click({ force: true });
  await p.click('#dz-menu [data-a="synced"]');
  await p.fill('#syn-name', 'Mi patrón suelto');
  await p.locator('input[name="syn-k"][value="unsynced"]').check({ force: true });
  await p.click('form.dlg button[type="submit"]');
  await p.waitForFunction(() => window.__calls.syncedSave.length === 3);
  const s3 = await p.evaluate(() => window.__calls.syncedSave[2]);
  assert.equal(s3.sync, 'unsynced'); assert.equal(s3.title, 'Mi patrón suelto'); assert.equal(s3.blocks.length, 1);
  assert.equal(await p.evaluate(() => window.BlockEditor.draft.blocks.filter((b) => b.type === 'synced').length), 1, 'el patrón sin sincronizar no reemplaza el bloque');

  // --- Guardar como plantilla ---
  await p.click('#d-tpl-save2');
  await p.waitForSelector('#tps-name');
  await shot(p, 'f2a-'+theme+'-9-guardar-plantilla');
  await p.fill('#tps-name', 'Esqueleto de actividad'); await p.fill('#tps-desc', 'Solo la estructura');
  await p.locator('input[name="tps-m"][value="structure"]').check({ force: true });
  await p.click('.tp-save button[type="submit"]');
  await p.waitForFunction(() => window.__cfg.blockTemplates.length === 1);
  let tp = await p.evaluate(() => window.__cfg.blockTemplates[0]);
  assert.equal(tp.name, 'Esqueleto de actividad'); assert.equal(tp.structureOnly, true); assert.equal(tp.desc, 'Solo la estructura'); assert.equal(tp.type, 'post');
  assert.ok(tp.blocks.every((x) => !('id' in x)));
  assert.ok(tp.blocks.filter((x) => x.type === 'paragraph').every((x) => x.html === ''));
  await p.click('#d-tpl-save2'); await p.waitForSelector('#tps-name');
  await p.fill('#tps-name', 'Completa'); await p.click('.tp-save label:has(input[value="page"])');
  await p.click('.tp-save button[type="submit"]');
  await p.waitForFunction(() => window.__cfg.blockTemplates.length === 2);
  tp = await p.evaluate(() => window.__cfg.blockTemplates[1]);
  assert.equal(tp.type, 'page'); assert.ok(!tp.structureOnly);

  // --- Mis plantillas en el selector ---
  await p.evaluate(() => { window.__done = false; newDraft({ type: 'post' }); });
  await p.waitForSelector('.tp-dlg .tp-own');
  await p.waitForTimeout(500);
  assert.equal(await p.locator('.tp-own').count(), 1, 'la de páginas no se ofrece en entradas');
  assert.ok(await p.locator('.tp-own .pv').count() >= 1, 'miniatura de render');
  await p.locator('.tp-wrap').hover();
  await shot(p, 'f2a-'+theme+'-10-selector-mis-plantillas');
  // renombrar
  await p.click('[data-ren]');
  await p.fill('#tp-name', 'Esqueleto renombrado'); await p.click('.tp-sub [data-r="1"]');
  await p.waitForFunction(() => window.__cfg.blockTemplates[0].name === 'Esqueleto renombrado');
  // exportar
  await p.click('[data-io="export"]');
  await p.waitForFunction(() => window.__calls.export.length === 1);
  const exp = JSON.parse(await p.evaluate(() => window.__calls.export[0]));
  assert.equal(exp.ecos, 'ecos-plantillas'); assert.equal(exp.templates.length, 2);
  // importar (con nombre repetido)
  await p.evaluate((t) => { window.__importText = t; }, JSON.stringify(exp));
  await p.click('[data-io="import"]');
  await p.waitForFunction(() => window.__cfg.blockTemplates.length === 4);
  assert.equal(await p.locator('.tp-own').count(), 2, 'dos entradas (las de página no salen)');
  // borrar
  await p.locator('.tp-wrap').first().hover();
  await p.locator('[data-del]').first().click();
  await p.click('.dlg-scrim:last-of-type [data-r="1"], .dlg-scrim:last-of-type .btn.filled');
  await p.waitForFunction(() => window.__cfg.blockTemplates.length === 3);
  // usar la plantilla
  await p.locator('.tp-own').first().click(); await p.click('.tp-dlg [data-r="ok"]');
  await p.waitForSelector('.tp-dlg', { state: 'detached' });
  assert.ok(await p.evaluate(() => window.BlockEditor.draft.blocks.length) >= 2);
  await shot(p, 'f2a-'+theme+'-11-editor-desde-plantilla');


  assert.deepEqual(p.errs, [], theme + ': errores de página');
}
for (const th of ['light', 'vinilo']) test('patrones, sincronizados y plantillas (' + th + ')', async () => { const b = await launch(); try { await run(b, th); } finally { await b.close(); } });
