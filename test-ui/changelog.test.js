// Novedades de cada versión: diálogo tras actualizar, historial en Ajustes, filtros y búsqueda, actualización desconocida, inglés.
const test = require('node:test');
const assert = require('assert');
const { launch, newPage, shot, INDEX_URL } = require('./helpers');
const { installMock } = require('./mock-api');

async function open(b, { version, lastSeen, wizardDone = true, prefs = {}, update = { state: 'latest' }, lang }) {
  const p = await newPage(b, { viewport: { width: 1200, height: 900 } });
  await p.addInitScript((d) => { window.__CL = d; }, { update, version });
  await installMock(p, {
    version, lang, config: { wizardDone, metaConnected: false, lastSeenVersion: lastSeen || null, prefs },
    patch: (api, H) => {
      window.__saved = [];
      const { update, version } = window.__CL;
      api.setConfig = async (c) => { window.__saved.push(c); Object.assign(H.cfg, c); return H.cfg; };
      api.updateStatus = async () => ({ ...update, version: update.version || version, channel: 'stable' });
      api.open = async (u) => { window.__opened = u; };
      api.wpCategories = async () => []; api.metaAccounts = async () => []; api.blogList = async () => ({ found: 0, items: [] });
    },
  });
  await p.goto(INDEX_URL); await p.waitForTimeout(700);
  return p;
}
const goUpdates = async (p) => { await p.click('[data-tab="settings"] >> visible=true', { force: true }); await p.waitForTimeout(300); await p.click('a[href="#set-updates"] >> visible=true', { force: true }); await p.evaluate(() => document.querySelector('#set-updates').scrollIntoView()); await p.waitForTimeout(300); };

test('novedades y registro de cambios (diálogo tras actualizar, Ajustes, filtros, inglés)', async () => {
  const b = await launch();
  try {
  const themes = { light: { theme: 'light' }, dark: { theme: 'dark' }, vinyl: { theme: 'dark', vinyl: true } };
  for (const [name, prefs] of Object.entries(themes)) {
    // 1) ajustes con actualización 3.5.0 lista, instalada 3.4.1
    const p = await open(b, { version: '3.4.1', lastSeen: '3.4.1', prefs, update: { state: 'ready', version: '3.5.0' } });
    assert.strictEqual(await p.locator('.cl-modal').count(), 0, 'no hay diálogo si es la misma versión');
    await goUpdates(p);
    assert.ok(await p.locator('#cl-incoming:not(.hidden)').count(), 'novedades de la actualización');
    assert.ok((await p.locator('#cl-incoming').innerText()).includes('3.5.0'));
    assert.ok((await p.locator('#cl-now').innerText()).includes('Instalada'));
    assert.ok((await p.locator('#cl-now').innerText()).includes('3.4.1'));
    assert.strictEqual(await p.locator('#cl-list .cl-badge').count(), 0, 'la instalada solo arriba'); assert.strictEqual(await p.locator('#cl-hist').evaluate((e) => e.open), false, 'historial plegado'); assert.ok(await p.locator('.version-row #update-check').isVisible(), 'buscar arriba'); await shot(p, 'cl-' + name + '-plegado'); await p.click('#cl-hist-h');
    await shot(p, 'cl-' + name + '-ajustes'); await shot(p.locator('#set-updates'), 'cl-' + name + '-tarjeta');
    if (name === 'light') {
      const total = await p.locator('#cl-list details').count();
      assert.ok(total > 20);
      const d = p.locator('#cl-list details').nth(1);
      assert.strictEqual(await d.evaluate((e) => e.open), false);
      await d.locator('summary').click(); assert.strictEqual(await d.evaluate((e) => e.open), true);
      await d.locator('summary').click(); assert.strictEqual(await d.evaluate((e) => e.open), false);
      await p.click('#cl-filters [data-s="fixed"]');
      const n = await p.locator('#cl-list details').count(); assert.ok(n > 0 && n < total, 'filtro Corregido ' + n);
      assert.strictEqual(await p.locator('#cl-list .cl-sec:not(.cl-fixed)').count(), 0);
      await shot(p, 'cl-' + name + '-filtro');
      await p.click('#cl-filters [data-s="fixed"]');
      await p.fill('#cl-q', 'accesibilidad');
      const m = await p.locator('#cl-list details').count(); assert.ok(m >= 1 && m < total, 'búsqueda ' + m);
      await p.fill('#cl-q', 'zzzz'); assert.strictEqual(await p.locator('#cl-list details').count(), 0);
      assert.ok(await p.locator('#cl-empty:not(.hidden)').count());
      await p.fill('#cl-q', '');
    }
    assert.deepStrictEqual(p.errs, [], name + ' errores de página');
    await p.close();

    // 2) tras actualizar de 3.2.0 a 3.5.0: el diálogo acumula
    const q = await open(b, { version: '3.5.0', lastSeen: '3.2.0', prefs });
    assert.strictEqual(await q.locator('.cl-modal').count(), 1);
    const txt = await q.locator('.cl-modal').innerText();
    assert.ok(txt.includes('Novedades de Ecos 3.5.0') && txt.includes('Línea temporal') && txt.includes('13 bloques nuevos') && txt.includes('Editor de WordPress') && txt.includes('1.6.0'));
    assert.ok(!txt.includes('Panel de diseño para cualquier bloque'), 'no incluye la 3.2.0, que ya conocía');
    assert.deepStrictEqual(await q.evaluate(() => window.__saved), [{ lastSeenVersion: '3.5.0' }]);
    await shot(q, 'cl-' + name + '-dialogo');
    if (name === 'light') {
      await q.click('#cl-all'); await q.waitForTimeout(300);
      assert.strictEqual(await q.locator('.cl-modal').count(), 0);
      assert.ok(await q.locator('#set-updates').isVisible(), 'ver todo el historial abre Ajustes');
      await q.close();
      const q2 = await open(b, { version: '3.5.0', lastSeen: '3.2.0', prefs });
      await q2.keyboard.press('Escape'); assert.strictEqual(await q2.locator('.cl-modal').count(), 0);
      await q2.close();
    } else await q.close();
  }

  // 3) instalación nueva: no sale, solo se guarda
  const f = await open(b, { version: '3.5.0', lastSeen: null, wizardDone: false });
  await f.waitForTimeout(300);
  assert.strictEqual(await f.locator('.cl-modal').count(), 0, 'no sale en instalación nueva');
  assert.deepStrictEqual(await f.evaluate(() => window.__saved.filter((c) => c.lastSeenVersion)), [{ lastSeenVersion: '3.5.0' }]);
  await f.close();
  // 3b) quien ya usaba Ecos y no tenía versión guardada: parte de la 3.4.1
  const g = await open(b, { version: '3.5.0', lastSeen: null, wizardDone: true });
  assert.strictEqual(await g.locator('.cl-modal').count(), 1);
  assert.ok(!(await g.locator('.cl-modal').innerText()).includes('13 bloques'));
  await g.close();

  // 4) actualización de una versión que esta app no conoce: notas de la release o enlace
  const h = await open(b, { version: '3.5.0', lastSeen: '3.5.0', update: { state: 'ready', version: '3.9.0', notes: '<h2>Novedades</h2><ul><li>Algo nuevo de la 3.9</li><li>Otra cosa</li></ul>' } });
  await goUpdates(h);
  const it = await h.locator('#cl-incoming').innerText();
  assert.ok(it.includes('Qué trae la 3.9.0') && it.includes('Algo nuevo de la 3.9'));
  await h.click('#cl-rel'); assert.ok((await h.evaluate(() => window.__opened)).endsWith('/v3.9.0'));
  await shot(h, 'cl-light-desconocida');
  await h.close();
  const h2 = await open(b, { version: '3.5.0', lastSeen: '3.5.0', update: { state: 'downloading', version: '3.9.0', percent: 10 } });
  await goUpdates(h2); assert.ok((await h2.locator('#cl-incoming').innerText()).includes('Todavía no tenemos'));
  await h2.close();

  // 5) inglés
  const e = await open(b, { version: '3.4.1', lastSeen: '3.4.1', lang: 'en' });
  await goUpdates(e);
  assert.ok((await e.locator('#cl-now').innerText()).includes('Installed'));
  assert.ok((await e.locator('#cl-now').innerText()).includes('AI'));
  await shot(e, 'cl-en-ajustes');
  await e.close();
  } finally { await b.close(); }
});
