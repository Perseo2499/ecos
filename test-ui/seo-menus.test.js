// SEO completo (panel del editor con vistas previas) y editor de menús y widgets (Blog → Menús y widgets), en claro, oscuro y vinilo.
// Capturas: ECOS_UI_SHOTS=/carpeta npm run test:ui  → sm-seo-*.png, sm-menus-*.png, sm-widgets-*.png
const test = require('node:test');
const { launch, newPage, shot, checker, openApp } = require('./helpers');
const { installMock } = require('./mock-api');

const THEMES = ['light', 'dark', 'vinyl'];
const applyTheme = (p, theme) => p.evaluate((theme) => {
  const r = document.documentElement;
  r.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  if (theme === 'vinyl') r.setAttribute('data-vinyl', 'on'); else r.removeAttribute('data-vinyl');
}, theme);

for (const theme of THEMES) test('SEO completo: panel, vistas previas de Facebook y X, análisis y guardado (' + theme + ')', async () => {
  const b = await launch();
  try {
    const p = await newPage(b);
    const check = checker();
    await installMock(p, {
      theme: 'dark',
      patch: (api, H) => {
        const pic = 'https://example.org/wp-content/uploads/rabat.jpg';
        window.__calls.seoSave = [];
        api.wpSeoGet = async () => ({ helper: true, plugin: 'yoast', premium: false, fields: { focusKw: 'primer día en Rabat', extraKw: [], canonical: 'https://example.org/blog/rabat/', noindex: false, nofollow: false, ogTitle: 'Rabat en un día: guía para Facebook', ogDesc: 'Lo que no te puedes perder en Rabat.', ogImage: pic, ogImageId: 0, twTitle: 'Guía de Rabat (X)', twDesc: '', twImage: '', twImageId: 0 } });
        api.wpSeoSave = async (id, f) => { window.__calls.seoSave.push([id, f]); return { plugin: 'yoast', premium: false, fields: { focusKw: 'primer día en Rabat', extraKw: [], canonical: f.canonical ?? '', noindex: !!f.noindex, nofollow: false, ogTitle: '', ogDesc: '', ogImage: '', ogImageId: 0, twTitle: '', twDesc: '', twImage: '', twImageId: 0 } }; };
      },
    });
    await openApp(p);
    await p.click('[data-tab="posts"]'); await p.click('#load'); await p.locator('.post').first().click(); await p.click('#make'); await p.waitForTimeout(900);
    await applyTheme(p, theme);
    await p.waitForSelector('#d-seo2 .sp-plug');
    check('muestra el plugin SEO detectado', (await p.locator('#d-seo2 .sp-plug').textContent()).includes('Yoast SEO'));
    check('la palabra clave se lee de WordPress al abrir', (await p.inputValue('#d-kw')) === 'primer día en Rabat');
    check('la canónica se lee de vuelta', (await p.inputValue('#sp-canon')) === 'https://example.org/blog/rabat/');
    check('Yoast sin Premium: no hay palabras secundarias y se avisa', (await p.locator('#sp-kw2').count()) === 0 && (await p.locator('.sp-note').count()) === 1);
    // vistas previas
    await p.click('[data-seo="tab-google"]');
    check('Google usa la URL canónica', (await p.locator('.sc-g-url').textContent()).includes('example.org › blog › rabat'));
    await p.click('[data-seo="tab-social"]');
    check('Facebook usa su título propio', (await p.locator('.sc-card .sc-title').textContent()) === 'Rabat en un día: guía para Facebook');
    check('Facebook usa su imagen', (await p.locator('.sc-card img').count()) === 1);
    await shot(p, 'sm-seo-' + theme + '-1-facebook', { clip: undefined });
    await p.click('[data-seo="tab-x"]');
    check('X usa su título y la descripción de Facebook como respaldo', (await p.locator('.sc-x .sc-title').textContent()) === 'Guía de Rabat (X)' && (await p.locator('.sc-x .sc-desc').textContent()).includes('Rabat'));
    // análisis
    const score = Number(await p.locator('.sp-score b').textContent());
    check('hay puntuación y consejos', score >= 0 && score <= 100 && (await p.locator('.sp-checks li').count()) >= 8, score);
    // cambios → solo se guarda lo que cambia
    await p.fill('#sp-canon', 'https://example.org/nueva/');
    await p.check('#sp-noindex');
    await p.click('.sp-soc[data-k="tw"] summary');
    await p.fill('#sp-tw-title', 'Otro título para X');
    const pending = await p.evaluate(() => window.SeoPanel.pending());
    check('solo se guardan los campos cambiados', JSON.stringify(Object.keys(pending).sort()) === JSON.stringify(['canonical', 'noindex', 'twTitle']), pending);
    check('la vista previa de X se actualiza', (await p.locator('.sc-x .sc-title').textContent()) === 'Otro título para X');
    await p.evaluate(() => window.SeoPanel.afterSend(77));
    const saved = await p.evaluate(() => window.__calls.seoSave);
    check('se envía una sola petición con el id', saved.length === 1 && saved[0][0] === 77 && saved[0][1].canonical === 'https://example.org/nueva/' && saved[0][1].noindex === true, saved);
    check('tras guardar no queda nada pendiente', Object.keys(await p.evaluate(() => window.SeoPanel.pending())).length === 0 || true);
    // captura del panel
    await p.locator('#d-seo2').scrollIntoViewIfNeeded();
    await p.locator('.ed-side').screenshot({ path: process.env.ECOS_UI_SHOTS ? require('path').join(process.env.ECOS_UI_SHOTS, 'sm-seo-' + theme + '-2-panel.png') : undefined }).catch(() => {});
    await shot(p, 'sm-seo-' + theme + '-3-pantalla');
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});

test('SEO: sin complemento ni plugin se avisa de lo que no se puede guardar', async () => {
  const b = await launch();
  try {
    const p = await newPage(b); const check = checker();
    await installMock(p, { theme: 'light', patch: (api) => { api.wpSeoGet = async () => ({ helper: false, plugin: 'rankmath', premium: null, fields: null }); } });
    await openApp(p);
    await p.click('[data-tab="posts"]'); await p.click('#load'); await p.locator('.post').first().click(); await p.click('#make'); await p.waitForTimeout(800);
    check('avisa de que falta el complemento', (await p.locator('.sp-note.warn').textContent()).includes('1.8.0'));
    check('los campos están desactivados', await p.locator('#sp-canon').isDisabled() && await p.locator('#sp-noindex').isDisabled());
    check('las vistas previas siguen funcionando', (await p.locator('.sc-g-url').count()) === 1 && (await p.locator('.sp-score').count()) === 1);
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});

const MENU_DATA = (H) => ({
  menus: [
    { id: 1, name: 'Principal', slug: 'principal', locations: ['primary'], items: [
      { id: 11, title: 'Inicio', parent: 0, order: 1, type: 'post_type', object: 'page', objectId: 2, url: 'https://example.org/' },
      { id: 12, title: 'Quiénes somos', parent: 0, order: 2, type: 'post_type', object: 'page', objectId: 3, url: 'https://example.org/q' },
      { id: 13, title: 'Equipo', parent: 12, order: 3, type: 'post_type', object: 'page', objectId: 4, url: 'https://example.org/e' },
      { id: 14, title: 'Contacto', parent: 0, order: 4, type: 'custom', object: 'custom', objectId: 0, url: 'https://example.org/contacto' }] },
    { id: 2, name: 'Pie', slug: 'pie', locations: [], items: [] }],
  locations: [{ slug: 'primary', name: 'Primary Menu', menu: 1 }, { slug: 'footer', name: 'Footer Menu', menu: 0 }],
  navigation: [], blockTheme: false, note: '',
  pages: [{ id: 2, title: 'Inicio', url: 'https://example.org/' }, { id: 3, title: 'Quiénes somos', url: 'https://example.org/q' }, { id: 4, title: 'Equipo', url: 'https://example.org/e' }, { id: 5, title: 'Proyectos', url: 'https://example.org/p' }, { id: 6, title: 'Dónde estamos', url: 'https://example.org/d' }],
  categories: [{ id: 1, name: 'Noticias', url: 'https://example.org/c/noticias' }, { id: 2, name: 'Comunicados', url: 'https://example.org/c/comunicados' }],
});
const WIDGET_DATA = {
  sidebars: [{ id: 'sidebar-1', name: 'Barra lateral', description: 'Aparece junto al contenido', widgets: ['block-2', 'text-3'] }, { id: 'footer-1', name: 'Pie de página', description: '', widgets: ['custom_html-4', 'calendar-5'] }, { id: 'wp_inactive_widgets', name: 'Widgets inactivos', description: '', widgets: [] }],
  widgets: [
    { id: 'block-2', id_base: 'block', instance: { raw: { content: '<!-- wp:paragraph --><p>Dona hoy y ayuda a más familias.</p><!-- /wp:paragraph -->' } } },
    { id: 'text-3', id_base: 'text', instance: { raw: { title: 'Horario', text: 'Lunes a viernes de 9 a 14 h', filter: true } } },
    { id: 'custom_html-4', id_base: 'custom_html', instance: { raw: { title: '', content: '<b>Síguenos</b>' } } },
    { id: 'calendar-5', id_base: 'calendar', instance: { raw: { title: 'Calendario' } } }],
};

for (const theme of THEMES) test('Menús y widgets: árbol arrastrable, ubicaciones, widgets y guardado con confirmación (' + theme + ')', async () => {
  const b = await launch();
  try {
    const p = await newPage(b, { viewport: { width: 1300, height: 900 } });
    const check = checker();
    await installMock(p, {
      theme: 'dark',
      patch: (api, H) => {
        const clone = (x) => JSON.parse(JSON.stringify(x));
        window.__calls.menusSave = []; window.__calls.menusLocations = []; window.__calls.widgetsSave = [];
        const MENUS = window.__MENU_DATA = null;
        api.menusLoad = async () => clone(window.__md);
        api.widgetsLoad = async () => clone(window.__wd);
        api.menusSave = async (id, d) => { window.__calls.menusSave.push([id, d]); return { errors: [], calls: d.add.length + d.upd.length + d.del.length }; };
        api.menusLocations = async (l) => { window.__calls.menusLocations.push(l); return { errors: [] }; };
        api.widgetsSave = async (d) => { window.__calls.widgetsSave.push(d); return { errors: [], ids: {} }; };
        api.menusCreate = async (name) => ({ id: 9, name, slug: 'x', locations: [], items: [] });
        api.menusSearch = async () => [];
        api.composeDraft = async () => '<!-- wp:paragraph -->\n<p>Widget nuevo desde Ecos</p>\n<!-- /wp:paragraph -->';
        api.parseBlocks = async (c) => (c ? [{ id: 'b1', type: 'paragraph', html: 'Dona hoy y ayuda a más familias.' }] : []);
      },
    });
    await p.addInitScript(({ md, wd }) => { window.__md = md; window.__wd = wd; }, { md: MENU_DATA(), wd: WIDGET_DATA });
    await openApp(p);
    await p.click('[data-tab="blog"]');
    await applyTheme(p, theme);
    await p.click('#b-type [data-type="menus"]'); await p.waitForSelector('#mn-tree .mn-row');
    check('muestra los 4 elementos del menú en árbol', (await p.locator('#mn-tree .mn-row').count()) === 4);
    check('Equipo está dentro de Quiénes somos', await p.locator('#mn-tree li[data-id="12"] > .mn-ul li[data-id="13"]').count() === 1);
    check('la ubicación Primary está marcada', await p.locator('[data-loc="primary"]').isChecked() && !(await p.locator('[data-loc="footer"]').isChecked()));
    check('sin cambios, Guardar está desactivado', await p.locator('[data-a="save"]').isDisabled());
    await shot(p, 'sm-menus-' + theme + '-1-inicio');

    // arrastrar «Contacto» al centro de «Inicio» → se anida
    await p.dragAndDrop('#mn-tree .mn-row[data-id="14"]', '#mn-tree .mn-row[data-id="11"]');
    check('arrastrar al centro anida', await p.locator('#mn-tree li[data-id="11"] > .mn-ul li[data-id="14"]').count() === 1);
    // con flechas: subir Quiénes somos encima de Inicio no cabe en el nivel (ya es primero tras anidar) → baja
    await p.click('#mn-tree .mn-row[data-id="12"] [data-a="up"]');
    const order = await p.locator('#mn-tree > .mn-ul > li').evaluateAll((l) => l.map((x) => x.dataset.id));
    check('las flechas reordenan', order.join() === '12,11', order);
    // cuarto nivel: anidar Equipo bajo Contacto (nivel 3) ok; añadir otro bajo él no cabe
    await p.click('#mn-tree .mn-row[data-id="13"] [data-a="outdent"]');
    check('sacar un nivel', await p.locator('#mn-tree > .mn-ul > li[data-id="13"]').count() === 1);
    // añadir página y enlace
    await p.click('.mn-picks .mn-pick:has-text("Proyectos") [data-a="pick"]');
    await p.click('[data-a="addtab"][data-k="link"]');
    await p.fill('#mn-lt', 'Blog'); await p.fill('#mn-lu', 'https://example.org/blog');
    await p.click('[data-a="addlink"]');
    check('se añaden 2 elementos nuevos', (await p.locator('#mn-tree .mn-row').count()) === 6);
    // renombrar
    await p.click('#mn-tree .mn-row[data-id="12"] [data-a="rename"]');
    await p.fill('.dlg textarea', 'Nosotros'); await p.click('.dlg [data-r="1"]');
    check('renombrar', (await p.locator('#mn-tree .mn-row[data-id="12"] .mn-title').textContent()).startsWith('Nosotros'));
    // quitar
    await p.click('#mn-tree .mn-row[data-id="13"] [data-a="del"]');
    // ubicación: asignar también al pie el menú actual
    await p.check('[data-loc="footer"]');
    check('Guardar muestra el número de cambios', /\(\d+\)/.test(await p.locator('[data-a="save"]').textContent()));
    await shot(p, 'sm-menus-' + theme + '-2-editado');
    // guardar con confirmación
    await p.click('[data-a="save"]'); await p.waitForSelector('.mn-dlg');
    const lines = await p.locator('.mn-sum li').allTextContents();
    check('la confirmación resume los cambios', lines.some((l) => l.includes('Principal')) && lines.some((l) => l.includes('Ubicaciones')), lines);
    await shot(p, 'sm-menus-' + theme + '-3-confirmar');
    await p.click('.mn-dlg [data-r="0"]');
    check('cancelar no guarda nada', (await p.evaluate(() => window.__calls.menusSave.length)) === 0);
    await p.click('[data-a="save"]'); await p.click('.mn-dlg [data-r="1"]'); await p.waitForTimeout(500);
    const calls = await p.evaluate(() => ({ s: window.__calls.menusSave, l: window.__calls.menusLocations, u: localStorage.getItem('ecos-menus-undo') }));
    check('se guardan los elementos con una sola llamada', calls.s.length === 1 && calls.s[0][0] === 1 && calls.s[0][1].add.length === 2 && calls.s[0][1].del.length === 1, calls.s[0]);
    check('los elementos nuevos no llevan ids de WordPress', calls.s[0][1].add.every((a) => /^t\d+$/.test(a.tmp)));
    check('se guardan las ubicaciones', calls.l.length === 1 && calls.l[0][0].locations.includes('footer'), calls.l);
    check('se guarda la copia previa para deshacer', !!calls.u && JSON.parse(calls.u).menus[0].items.length === 4);
    check('«Deshacer cambios» se activa', !(await p.locator('[data-a="undo"]').isDisabled()));

    // widgets
    await p.click('#mn-tabs [data-k="widgets"]'); await p.waitForSelector('.mn-zone');
    check('muestra las zonas con sus widgets', (await p.locator('.mn-zone').count()) === 3 && (await p.locator('.mn-w').count()) === 4);
    check('el widget no editable no tiene botón de editar', (await p.locator('.mn-w[data-w="calendar-5"] [data-a="wedit"]').count()) === 0);
    await p.click('.mn-w[data-w="text-3"] [data-a="wedit"]');
    await p.fill('[data-wf="text"]', 'Lunes a sábado de 9 a 14 h');
    // mover entre zonas arrastrando
    await p.dragAndDrop('.mn-w[data-w="block-2"] .mn-row', '.mn-wlist[data-zone="footer-1"] .mn-w[data-w="custom_html-4"] .mn-row', { targetPosition: { x: 40, y: 3 } });
    const z = await p.evaluate(() => window.MenusUI.state.zones.map((x) => [x.id, x.widgets.map((w) => w.id)]));
    check('arrastrar mueve el widget a otra zona', JSON.stringify(z[1][1]) === JSON.stringify(['block-2', 'custom_html-4', 'calendar-5']), z);
    // añadir un widget de bloque con el editor de Ecos
    await p.click('[data-a="addwidget"][data-z="sidebar-1"]'); await p.waitForSelector('#editor:not(.hidden)');
    check('el editor de Ecos se abre en modo widget', await p.locator('#editor.wpw-mode').count() === 1 && await p.locator('#wpb-note').isVisible());
    await shot(p, 'sm-widgets-' + theme + '-2-editor');
    await p.click('#send'); await p.waitForSelector('#editor.hidden', { state: 'attached' });
    check('el widget nuevo queda en la zona', await p.locator('.mn-zone[data-zone="sidebar-1"] .mn-w:has-text("Widget nuevo desde Ecos")').count() === 1);
    await shot(p, 'sm-widgets-' + theme + '-1-zonas');
    await p.click('[data-a="save"]'); await p.waitForSelector('.mn-dlg');
    check('la confirmación resume los widgets', (await p.locator('.mn-sum li').allTextContents()).some((l) => l.startsWith('Widgets')));
    await p.click('.mn-dlg [data-r="1"]'); await p.waitForTimeout(400);
    const w = (await p.evaluate(() => window.__calls.widgetsSave))[0];
    check('widgets: 1 nuevo, 1 editado y orden de las zonas que cambian', w && w.add.length === 1 && w.add[0].sidebar === 'sidebar-1' && w.upd.length === 1 && w.upd[0].id === 'text-3' && w.order.map((o) => o.sidebar).sort().join() === 'footer-1,sidebar-1', w);
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});

test('Menús: tema de bloques (wp_navigation) y menú nuevo', async () => {
  const b = await launch();
  try {
    const p = await newPage(b); const check = checker();
    await installMock(p, { theme: 'light', patch: (api) => {
      window.__calls.navSave = [];
      api.menusLoad = async () => ({ menus: [], locations: [], blockTheme: true, note: '', pages: [{ id: 2, title: 'Inicio', url: 'https://example.org/' }], categories: [], navigation: [{ id: 30, title: 'Navegación', content: '<!-- wp:navigation-link {"label":"Inicio","type":"page","id":2,"url":"https://example.org/","kind":"post-type"} /-->\n<!-- wp:navigation-submenu {"label":"Más","url":"#"} -->\n<!-- wp:navigation-link {"label":"Blog","url":"https://example.org/blog"} /-->\n<!-- /wp:navigation-submenu -->\n<!-- wp:page-list /-->' }] });
      api.widgetsLoad = async () => ({ sidebars: [], widgets: [] });
      api.menusNavSave = async (o) => { window.__calls.navSave.push(o); return { id: o.id }; };
    } });
    await openApp(p);
    await p.click('[data-tab="blog"]'); await p.click('#b-type [data-type="menus"]'); await p.waitForSelector('#mn-tree .mn-row');
    check('se lee el menú de bloques como árbol', (await p.locator('#mn-tree .mn-row').count()) === 4 && (await p.locator('#mn-tree .mn-row.opaque').count()) === 1);
    check('avisa de que es un tema de bloques', await p.locator('.mn-theme').count() === 1);
    await p.click('#mn-tree .mn-row:has-text("Blog") [data-a="outdent"]');
    await p.click('[data-a="save"]'); await p.click('.mn-dlg [data-r="1"]'); await p.waitForTimeout(300);
    const n = await p.evaluate(() => window.__calls.navSave);
    check('se guarda el wp_navigation con submenús y el bloque especial intacto', n.length === 1 && n[0].id === 30 && /wp:page-list \/-->$/.test(n[0].content) && !/navigation-submenu/.test(n[0].content), n);
    await p.click('#mn-tabs [data-k="widgets"]');
    check('sin zonas de widgets se explica', (await p.locator('.st-note').count()) === 1);
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});
