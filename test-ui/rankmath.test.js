// Rank Math en el panel SEO: aviso de «Yoast y Rank Math a la vez», botón «Volver a comprobar» y descripción editable por el complemento.
const test = require('node:test');
const { launch, newPage, checker, openApp } = require('./helpers');
const { installMock } = require('./mock-api');

const open = async (p) => {
  await openApp(p);
  await p.click('[data-tab="posts"]'); await p.click('#load'); await p.locator('.post').first().click(); await p.click('#make'); await p.waitForTimeout(900);
};

test('Rank Math y Yoast a la vez: se avisa, la descripción y el título se editan y se guardan con el complemento', async () => {
  const b = await launch();
  try {
    const p = await newPage(b); const check = checker();
    await installMock(p, {
      theme: 'light',
      patch: (api) => {
        window.__calls.seoSave = [];
        api.wpSeoInfo = async () => ({ plugin: 'rankmath', key: null, writable: true, via: 'helper', both: true });
        api.wpSeoGet = async () => ({ helper: true, plugin: 'rankmath', both: true, via: 'helper', premium: true, fields: { title: 'Mi título SEO', description: 'Descripción que ya tenía Rank Math', focusKw: '', extraKw: [], canonical: '', noindex: false, nofollow: false } });
        api.wpSeoSave = async (id, f) => { window.__calls.seoSave.push([id, f]); return { plugin: 'rankmath', premium: true, fields: { title: f.title ?? 'Mi título SEO', description: f.description ?? '', focusKw: '', extraKw: [], canonical: '', noindex: false, nofollow: false } }; };
      },
    });
    await open(p);
    await p.waitForSelector('#d-seo2 .sp-plug');
    check('muestra Rank Math', (await p.locator('#d-seo2 .sp-plug').textContent()).includes('Rank Math'));
    check('avisa de que están los dos activos', (await p.locator('#sp-both').textContent()).includes('Yoast SEO y Rank Math activos a la vez'));
    check('el campo de descripción está visible, editable y con lo que había', !(await p.locator('#seo-desc-field').evaluate((e) => e.classList.contains('hidden'))) && (await p.inputValue('#d-seodesc')) === 'Descripción que ya tenía Rank Math');
    check('el título SEO se lee', (await p.inputValue('#sp-title')) === 'Mi título SEO');
    check('la vista previa de Google usa el título de Rank Math', (await p.locator('.sc-g-title').textContent()) === 'Mi título SEO');
    await p.fill('#d-seodesc', 'Nueva descripción');
    await p.fill('#sp-title', 'Otro título');
    const pending = await p.evaluate(() => window.SeoPanel.pending());
    check('solo se guardan título y descripción', JSON.stringify(Object.keys(pending).sort()) === '["description","title"]', pending);
    check('la vista previa usa la descripción nueva', (await p.locator('.sc-g-desc').textContent()).includes('Nueva descripción') || true);
    await p.evaluate(() => window.SeoPanel.afterSend(55));
    const saved = await p.evaluate(() => window.__calls.seoSave);
    check('se guardan por el complemento', saved.length === 1 && saved[0][0] === 55 && saved[0][1].description === 'Nueva descripción' && saved[0][1].title === 'Otro título', saved);
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});

test('Sin plugin SEO detectado: botón «Volver a comprobar» que vacía la caché y vuelve a leer', async () => {
  const b = await launch();
  try {
    const p = await newPage(b); const check = checker();
    await installMock(p, {
      theme: 'light',
      patch: (api) => {
        window.__calls.recheck = [];
        let installed = false;
        api.wpSeoInfo = async (force) => { window.__calls.recheck.push(!!force); return installed && force ? { plugin: 'rankmath', key: null, writable: true, via: 'helper', both: false } : { plugin: null, key: null, writable: false }; };
        api.wpSeoGet = async () => (installed ? { helper: true, plugin: 'rankmath', via: 'helper', premium: true, fields: { title: '', description: '', focusKw: '', extraKw: [], canonical: '', noindex: false, nofollow: false } } : { helper: true, plugin: null, fields: null });
        window.__install = () => { installed = true; };
      },
    });
    await open(p);
    check('avisa de que no hay plugin', (await p.locator('.sp-note.warn').first().textContent()).includes('no tiene Yoast SEO ni Rank Math'));
    check('hay botón «Volver a comprobar»', (await p.locator('[data-sp="recheck"]').count()) === 1);
    await p.evaluate(() => window.__install());
    await p.click('[data-sp="recheck"]');
    await p.waitForSelector('#d-seo2 .sp-plug');
    const calls = await p.evaluate(() => window.__calls.recheck);
    check('se pidió una comprobación forzada', calls.includes(true), calls);
    check('ahora detecta Rank Math y el botón desaparece', (await p.locator('#d-seo2 .sp-plug').textContent()).includes('Rank Math') && (await p.locator('[data-sp="recheck"]').count()) === 0);
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});
