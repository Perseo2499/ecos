// Recorrido por todas las pestañas + pantalla de arranque. Sin errores de página.
const test = require('node:test');
const { launch, newPage, shot, checker, openApp, INDEX_URL } = require('./helpers');
const { installMock } = require('./mock-api');

test('recorrido por las pestañas principales y el editor', async () => {
  const b = await launch();
  try {
    const p = await newPage(b);
    const check = checker();
    await installMock(p, { theme: 'dark', config: { wpUrl: 'https://www.example.org' } });
    await openApp(p);
    await shot(p, 'tour-0-inicio');
    await p.click('[data-tab="posts"]'); await p.click('#load');
    await p.waitForSelector('.post');
    check('publicaciones: se listan', (await p.locator('.post').count()) >= 12);
    await shot(p, 'tour-1-publicaciones');
    await p.click('[data-tab="blog"]'); await p.waitForTimeout(400);
    check('blog: aparece la lista de entradas', (await p.locator('#b-list').innerText()).includes('Entrada de ejemplo'));
    await shot(p, 'tour-2-blog');
    for (const [t, n] of [['calendar', '3-calendario'], ['media', '4-medios'], ['structure', '5-estructura']]) {
      await p.click(`#b-type [data-type="${t}"]`); await shot(p, 'tour-' + n);
    }
    check('estructura: muestra páginas del sitio', (await p.locator('body').innerText()).includes('Quiénes somos'));
    await p.click('[data-tab="connections"]'); await shot(p, 'tour-6-conexiones');
    await p.click('[data-tab="settings"]'); await shot(p, 'tour-7-ajustes');
    await p.click('[data-tab="posts"]'); await p.locator('.post').first().click(); await p.click('#make');
    await p.waitForSelector('#editor:not(.hidden)');
    check('el editor se abre', await p.locator('#d-blocks').count() === 1);
    await shot(p, 'tour-8-editor');
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});

test('pantalla de arranque con el color del tema', async () => {
  const b = await launch();
  try {
    const check = checker();
    for (const th of ['vinyl', 'light']) {
      const p = await newPage(b);
      await installMock(p);
      await p.goto(INDEX_URL + '?boot=' + th);
      await p.waitForTimeout(30);
      const early = await p.evaluate(() => [!!document.getElementById('boot-splash'), document.documentElement.dataset.boot]);
      check(th + ': hay pantalla de arranque al inicio', early[0] === true, early);
      await shot(p, 'splash-' + th);
      await p.waitForTimeout(1800);
      check(th + ': desaparece tras cargar', await p.evaluate(() => !document.getElementById('boot-splash')));
      check(th + ': sin errores', p.errs.length === 0, p.errs);
      await p.context().close();
    }
    check.done();
  } finally { await b.close(); }
});
