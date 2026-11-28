// Fotos destacadas a mano: estrella, filtro «Destacadas», filas del selector, recientes, imágenes destacadas de entradas
// y elegir la imagen destacada desde la biblioteca (claro, oscuro y vinilo).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { launch, newPage, shot, openApp } = require('./helpers');
const { installMock } = require('./mock-api');

const SHOTS = '/tmp/claude-0/-home-user/f18c4c3f-0baf-5edb-9c5a-5b17ea8aac80/scratchpad/';
async function snap(p, name) {
  await p.waitForTimeout(300);
  fs.mkdirSync(SHOTS, { recursive: true });
  await p.screenshot({ path: SHOTS + 'fav-' + name + '.png' });
  await shot(p, 'fav-' + name);
}

for (const theme of ['light', 'dark', 'vinilo']) test('fotos destacadas a mano (' + theme + ')', async () => {
  const b = await launch();
  try {
    const p = await newPage(b, { viewport: { width: 1300, height: 900 } });
    await installMock(p, {
      theme: theme === 'vinilo' ? 'dark' : theme,
      patch: (api, H) => {
        window.__missing = [];
        H.media.forEach((m, i) => { m.name = 'foto-' + i; m.large = m.url; });
        Object.assign(api, {
          // la 3 y la 5 son imagen destacada de entradas
          mediaFeatured: async () => ({ 3: [{ id: 101, title: 'Fiesta de primavera' }], 5: [{ id: 102, title: 'Taller de cocina' }, { id: 103, title: 'Otra entrada' }] }),
          mediaMissing: async (ids) => ids.filter((i) => window.__missing.includes(i)),
        });
      },
    });
    await openApp(p);

    // --- Biblioteca: marcar la estrella ---
    await p.click('[data-tab="blog"]');
    await p.click('#b-type button[data-type="media"]');
    if (theme === 'vinilo') await p.evaluate(() => { document.documentElement.dataset.vinyl = 'on'; });
    await p.waitForSelector('#b-media .mg-card');
    const card = (id) => p.locator(`#b-media .mg-grid .mg-card[data-id="${id}"]`);
    const star = card(1).locator('.mg-star');
    assert.equal(await star.getAttribute('aria-pressed'), 'false');
    await card(1).hover();
    await star.click();
    assert.equal(await star.getAttribute('aria-pressed'), 'true');
    assert.match(await star.getAttribute('aria-label'), /Quitar de destacadas/);
    // con el teclado: foco en la foto y tecla F
    await card(2).focus(); await p.keyboard.press('f');
    assert.equal(await card(2).locator('.mg-star').getAttribute('aria-pressed'), 'true');
    await card(4).focus(); await p.keyboard.press('f');
    const saved = await p.evaluate(() => window.__cfg.mediaFavs['example.org'].fav.map((m) => m.id));
    assert.deepEqual(saved, [4, 2, 1], 'guardadas por web, la última primero');
    const mini = await p.evaluate(() => window.__cfg.mediaFavs['example.org'].fav[0]);
    assert.deepEqual(Object.keys(mini).sort(), ['alt', 'id', 'large', 'name', 'thumb', 'type', 'url']);
    // quitar con la tecla
    await card(4).focus(); await p.keyboard.press('f');
    assert.equal(await card(4).locator('.mg-star').getAttribute('aria-pressed'), 'false');

    // --- Filtro «Destacadas» ---
    await p.click('#b-media .mg-view [data-v="fav"]');
    await p.waitForFunction(() => document.querySelectorAll('#b-media .mg-grid .mg-card').length === 2);
    assert.equal(await p.locator('#b-media .mg-view [data-v="fav"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await p.$$eval('#b-media .mg-grid .mg-card', (l) => l.map((c) => c.dataset.id)), ['2', '1']);
    assert.match(await p.locator('#b-media .mg-count').textContent(), /2 destacadas/);
    await snap(p, theme + '-1-biblioteca-destacadas');
    // quitar desde aquí la hace desaparecer
    await p.locator('#b-media .mg-grid .mg-card[data-id="2"] .mg-star').click();
    await p.waitForFunction(() => document.querySelectorAll('#b-media .mg-grid .mg-card').length === 1);

    // --- Fotos que son la imagen destacada de entradas ---
    await p.click('#b-media .mg-view [data-v="feat"]');
    await p.waitForFunction(() => document.querySelectorAll('#b-media .mg-grid .mg-card').length === 2);
    assert.deepEqual(await p.$$eval('#b-media .mg-grid .mg-card', (l) => l.map((c) => c.dataset.id).sort()), ['3', '5']);
    assert.match(await card(5).getAttribute('title'), /Taller de cocina · Otra entrada/);
    assert.match(await card(3).getAttribute('title'), /Fiesta de primavera/);
    assert.equal(await p.locator('#b-media .mg-view [data-v="fav"]').getAttribute('aria-pressed'), 'false');
    await snap(p, theme + '-2-biblioteca-de-entradas');
    await p.click('#b-media .mg-view [data-v="feat"]'); // apagar el filtro
    await p.waitForFunction(() => document.querySelectorAll('#b-media .mg-grid .mg-card').length === 30);

    // --- Editor: selector «De la biblioteca» con la fila Destacadas arriba ---
    await p.evaluate(() => document.querySelector('[data-tab="posts"]').click()); await p.click('#load'); await p.locator('.post').first().click(); await p.click('#make');
    await p.waitForSelector('#d-media-lib');
    await p.evaluate(() => { const E = window.BlockEditor; E.draft.blocks = []; E.draft.featuredImageId = null; E.draft.noAutoFeatured = true; E.render(); });
    await p.click('#d-media-lib');
    await p.waitForSelector('.mg-modal .mg-grid .mg-card');
    assert.equal(await p.locator('.mg-modal .mg-shelf[data-shelf="fav"] .mg-card').count(), 1);
    assert.equal(await p.locator('.mg-modal .mg-shelf[data-shelf="recent"]').count(), 0, 'aún no hay recientes');
    // la fila va ANTES de la rejilla
    assert.equal(await p.evaluate(() => { const sh = document.querySelector('.mg-modal .mg-shelves'), g = document.querySelector('.mg-modal .mg-slot'); return !!(sh.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING); }), true);
    // marcar una foto desde el selector
    await p.locator('.mg-modal .mg-grid .mg-card[data-id="7"]').hover();
    await p.locator('.mg-modal .mg-grid .mg-card[data-id="7"] .mg-star').click();
    await p.waitForFunction(() => document.querySelectorAll('.mg-modal .mg-shelf[data-shelf="fav"] .mg-card').length === 2);
    await snap(p, theme + '-3-selector-destacadas');
    // elegir dos y añadirlas: pasan a «Usadas recientemente»
    await p.locator('.mg-modal .mg-grid .mg-card[data-id="8"]').click();
    await p.locator('.mg-modal .mg-shelf[data-shelf="fav"] .mg-card[data-id="7"]').click();
    assert.match(await p.locator('.mg-modal .mg-picked').textContent(), /2 seleccionadas/);
    await p.click('.mg-modal [data-r="1"]');
    await p.waitForSelector('.mg-modal', { state: 'detached' });
    const rec = await p.evaluate(() => window.__cfg.mediaFavs['example.org'].recent.map((m) => m.id).sort());
    assert.deepEqual(rec, [7, 8]);
    await p.click('#d-media-lib');
    await p.waitForSelector('.mg-modal .mg-shelf[data-shelf="recent"] .mg-card');
    assert.equal(await p.locator('.mg-modal .mg-shelf[data-shelf="recent"] .mg-card').count(), 2);
    await snap(p, theme + '-4-selector-recientes');
    // filtro «De entradas» también en el selector
    await p.click('.mg-modal .mg-view [data-v="feat"]');
    await p.waitForFunction(() => document.querySelectorAll('.mg-modal .mg-grid .mg-card').length === 2);
    assert.equal(await p.locator('.mg-modal .mg-shelves').isVisible(), false, 'con un filtro activo no salen las filas');
    await p.keyboard.press('Escape');
    await p.waitForSelector('.mg-modal', { state: 'detached' });

    // --- Elegir la imagen destacada de la entrada desde la biblioteca ---
    await p.locator('#d-cover').scrollIntoViewIfNeeded();
    await p.locator('#d-cover').hover();
    await p.click('#d-cover .cover-pick');
    await p.waitForSelector('.mg-modal .mg-card');
    assert.equal(await p.locator('.mg-modal .mg-view [data-v="fav"]').getAttribute('aria-pressed'), 'true', 'abre en Destacadas');
    assert.equal(await p.locator('.mg-modal .mg-shelves').count(), 0, 'sin filas: ya está en Destacadas');
    const ids = await p.$$eval('.mg-modal .mg-grid .mg-card', (l) => l.map((c) => c.dataset.id));
    assert.deepEqual([...ids].sort(), ['1', '7']);
    await snap(p, theme + '-5-imagen-destacada');
    await p.locator('.mg-modal .mg-grid .mg-card[data-id="1"]').click();
    await p.locator('.mg-modal .mg-grid .mg-card[data-id="7"]').click(); // solo una
    assert.equal(await p.locator('.mg-modal .mg-card.sel').count(), 1);
    await p.click('.mg-modal [data-r="1"]');
    await p.waitForSelector('.mg-modal', { state: 'detached' });
    assert.equal(await p.evaluate(() => draft.featuredImageId), 7);
    await p.waitForSelector('#d-cover.has img');
    await snap(p, theme + '-6-editor-con-destacada');

    // --- Una foto que ya no existe en WordPress se quita sola con aviso ---
    await p.evaluate(() => { window.__missing.push(1); });
    await p.click('#d-cover .cover-pick', { force: true });
    await p.waitForSelector('.mg-modal .mg-grid .mg-card[data-id="1"]');
    await p.locator('.mg-modal .mg-grid .mg-card[data-id="1"]').click();
    await p.click('.mg-modal [data-r="1"]');
    await p.waitForFunction(() => /ya no existen en WordPress/.test(document.querySelector('#toast')?.textContent || ''));
    assert.equal(await p.locator('.mg-modal .mg-card.sel').count(), 0, 'la selección se vacía y el selector sigue abierto');
    await p.keyboard.press('Escape');
    await p.waitForSelector('.mg-modal', { state: 'detached' });
    assert.equal(await p.evaluate(() => draft.featuredImageId), 7, 'no se cambió a una foto inexistente');
    assert.deepEqual(await p.evaluate(() => window.__cfg.mediaFavs['example.org'].fav.map((m) => m.id)), [7]);

    // --- Visor: estrella ---
    await p.click('#d-media-lib');
    await p.waitForSelector('.mg-modal .mg-grid .mg-card');
    await p.locator('.mg-modal .mg-grid .mg-card[data-id="9"]').dblclick();
    await p.waitForSelector('#lightbox:not(.hidden) .lb-fav:not(.hidden)');
    await p.click('#lightbox .lb-fav');
    assert.equal(await p.locator('#lightbox .lb-fav').getAttribute('aria-pressed'), 'true');
    assert.ok(await p.evaluate(() => window.__cfg.mediaFavs['example.org'].fav.some((m) => m.id === 9)));
    await snap(p, theme + '-7-visor');
    await p.keyboard.press('Escape'); await p.keyboard.press('Escape');

    const real = p.errs.filter((e) => !/ERR_/.test(e));
    assert.deepEqual(real, [], 'sin errores de página');
  } finally { await b.close(); }
});
