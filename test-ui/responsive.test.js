// Adaptación al tamaño de la ventana: ningún texto cortado en chips/botones/pestañas, sin desbordes horizontales,
// y el menú «⋯» (barra adaptable) funciona: se abre, se navega con teclado y sus acciones se ejecutan.
// Con ECOS_UI_SHOTS=<carpeta> guarda capturas rs-*.png.
const test = require('node:test');
const { launch, newPage, shot, checker, openApp } = require('./helpers');
const { installMock } = require('./mock-api');
const { auditInPage } = require('./responsive-audit');

const WIDTHS = [1280, 960, 760];

async function setup(b, theme, width) {
  const p = await newPage(b, { viewport: { width, height: 800 } });
  await installMock(p, { theme: theme === 'vinyl' ? 'dark' : theme, config: { wpUrl: 'https://www.example.org' } });
  await openApp(p);
  if (theme === 'vinyl') await p.evaluate(() => window.Vinyl.apply({ vinyl: true, silk: true }));
  return p;
}
const show = (p, tab) => p.evaluate((t) => window.showTab(t), tab);
async function openEditor(p) {
  await show(p, 'posts'); await p.click('#load'); await p.waitForSelector('.post');
  await p.locator('.post').first().click(); await p.click('#make'); await p.waitForSelector('#editor:not(.hidden)'); await p.waitForTimeout(500);
}

for (const theme of ['light', 'vinyl']) test('sin textos cortados ni desbordes en todas las pantallas (' + theme + ')', async () => {
  const b = await launch();
  try {
    const check = checker();
    const p = await setup(b, theme, 1280);
    const screens = [
      ['inicio', () => show(p, 'home')],
      ['redes', async () => { await show(p, 'posts'); await p.click('#load'); await p.waitForSelector('.post'); }],
      ['blog', async () => { await show(p, 'blog'); await p.waitForTimeout(400); }],
      ['biblioteca', async () => { await p.click('#b-type [data-type="media"]'); await p.waitForTimeout(400); }],
      ['conexiones', () => show(p, 'connections')],
      ['ajustes', () => show(p, 'settings')],
      ['editor', async () => { await openEditor(p); }],
    ];
    for (const [name, go] of screens) {
      await p.setViewportSize({ width: 1280, height: 800 });
      await go(); await p.waitForTimeout(300);
      for (const w of WIDTHS) {
        await p.setViewportSize({ width: w, height: 800 }); await p.waitForTimeout(300);
        check(`${theme} ${name} ${w}px`, (await p.evaluate(auditInPage)).length === 0, await p.evaluate(auditInPage));
        await shot(p, `rs-${theme}-${name}-${w}`);
      }
      if (name === 'editor') { await p.click('#ed-close'); await p.waitForTimeout(300); }
    }
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});

test('el menú «⋯» de la barra del editor: abrir, teclado y ejecutar una acción oculta', async () => {
  const b = await launch();
  try {
    const check = checker();
    const p = await setup(b, 'light', 700);
    await openEditor(p);
    const more = p.locator('#editor .ov-more');
    check('aparece el botón «⋯» con la ventana estrecha', await more.isVisible());
    check('«⋯» es accesible (aria-haspopup/expanded)', (await more.getAttribute('aria-haspopup')) === 'menu' && (await more.getAttribute('aria-expanded')) === 'false');
    await p.setViewportSize({ width: 520, height: 800 }); await p.waitForTimeout(300);
    check('«Buscar y reemplazar» ha pasado al menú', await p.evaluate(() => !!document.querySelector('#editor .ov-menu #ed-find')));
    check('el botón principal «Enviar» sigue a la vista', await p.locator('#send').isVisible());
    check('«Enviar» conserva su etiqueta corta', ((await p.locator('#send .ov-short').innerText()) || '').trim() === 'Enviar');
    await shot(p, 'rs-menu-closed');
    await more.click(); await p.waitForTimeout(150);
    check('el menú se abre', await p.locator('#editor .ov-menu').isVisible() && (await more.getAttribute('aria-expanded')) === 'true');
    await shot(p, 'rs-menu-open');
    await p.keyboard.press('Escape');
    check('Escape cierra el menú y devuelve el foco', !(await p.locator('#editor .ov-menu').isVisible()) && await p.evaluate(() => document.activeElement.classList.contains('ov-more')));
    await more.focus(); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(100);
    check('ArrowDown abre el menú y enfoca la primera opción', await p.evaluate(() => !!document.activeElement.closest('.ov-menu')));
    await p.keyboard.press('ArrowDown');
    check('ArrowDown se mueve por las opciones', await p.evaluate(() => !!document.activeElement.closest('.ov-menu')));
    await p.keyboard.press('Escape');
    // la acción del botón real (que ya no está en la barra) se ejecuta
    await more.click();
    await p.locator('#editor .ov-menu #ed-find').click(); await p.waitForTimeout(250);
    check('elegir «Buscar y reemplazar» ejecuta su acción', await p.evaluate(() => !document.getElementById('fr-bar').classList.contains('hidden')));
    check('el menú se cierra tras elegir', !(await p.locator('#editor .ov-menu').isVisible()));
    // al ensanchar, el botón vuelve a su sitio en la barra
    await p.setViewportSize({ width: 1400, height: 800 }); await p.waitForTimeout(400);
    check('al ensanchar, «Buscar y reemplazar» vuelve a la barra', await p.evaluate(() => document.querySelector('#ed-find').parentElement.classList.contains('ed-bar')));
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});

test('cajón de ajustes del editor en ventana estrecha', async () => {
  const b = await launch();
  try {
    const check = checker();
    const p = await setup(b, 'light', 760);
    await openEditor(p);
    const vis = (s) => p.evaluate((q) => { const e = document.querySelector(q), r = e.getBoundingClientRect(); return getComputedStyle(e).visibility !== 'hidden' && r.right > 0 && r.left < innerWidth; }, s);
    check('el botón de ajustes está a la vista', await p.locator('#ed-side-btn').isVisible());
    check('el panel derecho está plegado', !(await vis('#ed-side')));
    check('el lienzo ocupa todo el ancho', await p.evaluate(() => document.querySelector('#ed-canvas').getBoundingClientRect().width > innerWidth - 4));
    await p.click('#ed-side-btn'); await p.waitForTimeout(450);
    check('se abre el panel derecho', await vis('#ed-side') && (await p.locator('#ed-side-btn').getAttribute('aria-pressed')) === 'true');
    await shot(p, 'rs-drawer-side');
    await p.click('#ed-media-btn'); await p.waitForTimeout(450);
    check('abrir las fotos cierra los ajustes', await vis('#ed-media') && !(await vis('#ed-side')));
    await shot(p, 'rs-drawer-media');
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    check('Escape cierra el cajón', !(await vis('#ed-media')));
    await p.setViewportSize({ width: 1280, height: 800 }); await p.waitForTimeout(300);
    check('en ventana ancha el panel vuelve a su columna', await vis('#ed-side') && !(await p.locator('#ed-side-btn').isVisible()));
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});

test('barras de filtros y pestañas del blog: etiquetas cortas, iconos y «⋯»', async () => {
  const b = await launch();
  try {
    const check = checker();
    const p = await setup(b, 'light', 1280);
    await show(p, 'blog'); await p.waitForTimeout(500);
    check('1280: pestañas con su texto completo', (await p.locator('#b-type button[data-type="menus"]').innerText()).includes('Menús y widgets'));
    await p.setViewportSize({ width: 760, height: 800 }); await p.waitForTimeout(400);
    const st = await p.evaluate(() => ({ s: document.getElementById('b-type').dataset.ov, label: document.querySelector('#b-type [data-type="post"]').getAttribute('aria-label') || document.querySelector('#b-type [data-type="post"]').title }));
    check('760: las pestañas pasan a solo icono con nombre accesible', /^[12]/.test(st.s) && /Entradas/.test(st.label), st);
    await p.setViewportSize({ width: 560, height: 800 }); await p.waitForTimeout(400);
    check('560: filtros recogidos en «⋯»', await p.locator('#b-bar .ov-more').isVisible());
    await p.locator('#b-bar .ov-more').click();
    const sel = p.locator('#b-bar .ov-menu #b-order');
    check('el orden se puede elegir desde el menú', await sel.count() === 1 && await sel.isVisible());
    await sel.selectOption('asc'); await p.waitForTimeout(300);
    check('el cambio se aplica (valor del select)', (await p.locator('#b-order').inputValue()) === 'asc');
    await shot(p, 'rs-blog-menu');
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});
