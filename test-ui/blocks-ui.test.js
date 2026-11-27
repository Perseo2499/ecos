// Editor: inserta los 13 bloques «Más bloques», edita datos y comprueba menús, estilo e iconos (claro, oscuro, vinilo).
const test = require('node:test');
const { launch, newPage, shot, checker, openApp } = require('./helpers');
const { installMock } = require('./mock-api');

for (const theme of ['light', 'dark', 'vinyl']) test('bloques «Más bloques» en el editor (' + theme + ')', async () => {
  const b = await launch();
  try {
  const p = await newPage(b);
  const errs = p.errs; const check = checker();
  await installMock(p, { theme: 'dark' });
  await openApp(p);
  await p.click('[data-tab="posts"]'); await p.click('#load'); await p.locator('.post').first().click(); await p.click('#make'); await p.waitForTimeout(800);
  if (theme === 'light') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  if (theme === 'dark') await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  if (theme === 'vinyl') await p.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); document.documentElement.setAttribute('data-vinyl', 'on'); });

  // vaciar el borrador y dejar solo lo que se inserte
  await p.evaluate(() => { const E = window.BlockEditor; E.draft.blocks = []; E.draft.featuredImageId = null; E.draft.noAutoFeatured = true; E.render(); });
  const types = ['tabs', 'timeline', 'figures', 'testimonials', 'cards', 'cta', 'donate', 'event', 'audio', 'pdf', 'hotspots', 'compare', 'faq'];
  for (const ty of types) {
    await p.locator('#d-blocks > .ins .ins-btn').last().click();
    await p.waitForSelector('#ins-menu:not(.hidden)');
    await p.click(`#ins-menu button[data-type="${ty}"]`);
    await p.waitForTimeout(150);
  }
  const got = await p.evaluate(() => window.BlockEditor.draft.blocks.map((b) => b.type));
  check('se insertan los 13 tipos de bloque', got.join(',') === types.join(','), got);
  // menú abierto con el grupo «Más bloques»
  await p.locator('#d-blocks > .ins .ins-btn').first().click(); await p.waitForTimeout(300);
  await p.locator('#ins-menu').evaluate((m) => m.scrollIntoView());
  await shot(p, 'blocks-'+theme+'-0-menu');
  await p.keyboard.press('Escape'); await p.mouse.click(5, 5);
  // datos de ejemplo y edición
  const svg = (c1, c2, label) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><circle cx="200" cy="150" r="60" fill="rgba(255,255,255,.5)"/><text x="30" y="370" font-size="40" fill="#fff" font-family="sans-serif">${label}</text></svg>`);
  const imgs = [{ id: 9001, url: svg('#b5541c', '#f0b860', 'ANTES'), alt: 'Antes', type: 'image' }, { id: 9002, url: svg('#3b5ba9', '#8fb0ff', 'DESPUES'), alt: 'Después', type: 'image' }];
  await p.evaluate((imgs) => {
    const E = window.BlockEditor, B = E.draft.blocks, [a, z] = imgs;
    const get = (t) => B.find((b) => b.type === t);
    get('timeline').items = [{ date: '1999', title: 'Nace la asociación', html: 'Un grupo de vecinos se junta.', img: a }, { date: '2010', title: 'Primera sede', html: 'Abrimos las puertas.', img: null }, { date: '2024', title: 'Hoy', html: 'Más de 500 personas.', img: z }];
    const f = get('figures'); f.items = [{ value: '20', label: 'años de historia' }, { value: '+500', label: 'personas' }, { value: '3,5', label: 'millones de euros' }];
    get('testimonials').items = [{ html: 'Un sitio donde me siento en casa.', name: 'Ana Pérez', role: 'Voluntaria', img: a }, { html: 'Gracias a ellos aprendí un oficio.', name: 'Luis Gómez', role: 'Antiguo alumno', img: z }];
    const c = get('cards'); c.items[0] = { icon: 'school', title: 'Formación', html: 'Cursos y talleres', url: 'https://example.org', label: 'Ver cursos' }; c.items[1] = { icon: 'volunteer_activism', title: 'Voluntariado', html: 'Súmate', url: '', label: '' }; c.items[2] = { icon: '🍲', title: 'Comedor', html: 'Cada día', url: '', label: '' };
    const cta = get('cta'); cta.buttons.push({ html: 'Saber más', url: 'https://example.org/mas' });
    const d = get('donate'); d.value = '600 123 456'; d.html = 'Tu ayuda llega a quien más lo necesita.'; d.amounts = [5, 10, 25];
    const ev = get('event'); ev.title = 'Cena solidaria'; ev.start = '2026-12-12T21:00'; ev.end = '2026-12-12T23:30'; ev.place = 'Calle Mayor 1, Madrid'; ev.html = 'Trae a tu familia.';
    const au = get('audio'); au.title = 'Episodio 1: nuestros inicios'; au.html = 'Hablamos con los fundadores.'; au.url = 'https://example.org/ep1.mp3';
    const pdf = get('pdf'); pdf.title = 'Memoria 2025'; pdf.url = 'https://example.org/memoria.pdf'; pdf.name = 'memoria-2025.pdf';
    const h = get('hotspots'); h.img = a; h.points = [{ x: 25, y: 40, title: 'Entrada', html: 'Aquí se entra al centro.' }, { x: 70, y: 65, title: 'Aula', html: 'Se dan los talleres.' }];
    const cmp = get('compare'); cmp.before = a; cmp.after = z;
    const q = get('faq'); q.one = true; q.items = [{ q: '¿Cómo puedo colaborar?', html: 'Escríbenos y te contamos.' }, { q: '¿Se puede desgravar?', html: 'Sí, hasta el 80 %.' }];
    const tb = get('tabs'); tb.cols[0].title = 'Historia'; tb.cols[1].title = 'Equipo'; tb.cols[0].children[0].html = 'Texto de la primera pestaña.'; tb.cols[1].children[0].html = 'Texto de la segunda.';
    E.render();
  }, imgs);
  await p.waitForTimeout(500);
  // editar a mano un par de campos
  const title = p.locator('.blk-cta .mb-cta-t');
  await title.click(); await p.keyboard.press('Control+A'); await p.keyboard.type('Únete a nuestro equipo');
  await p.locator('.blk-faq .mb-q').first().click(); await p.keyboard.press('Control+A'); await p.keyboard.type('¿Cómo colaboro?');
  const edited = await p.evaluate(() => ({ cta: window.BlockEditor.draft.blocks.find((b) => b.type === 'cta').title, faq: window.BlockEditor.draft.blocks.find((b) => b.type === 'faq').items[0].q }));
  check('edición a mano de CTA y FAQ', edited.cta === 'Únete a nuestro equipo' && edited.faq === '¿Cómo colaboro?', edited);
  // pestaña activa
  await p.locator('.blk-tabs .mb-tab').nth(1).dispatchEvent('mousedown'); await p.waitForTimeout(200);
  // capturas de cada bloque
  for (const ty of types) {
    const el = p.locator(`#d-blocks .blk-${ty}`).first();
    await el.scrollIntoViewIfNeeded(); await el.hover(); await p.waitForTimeout(150);
    await shot(el, 'blocks-' + theme + '-' + ty);
  }
  // panel Estilo y Diseño de un bloque
  await p.locator('.blk-cards').first().hover();
  await p.locator('.blk-cards [data-sty]').first().click(); await p.waitForTimeout(300);
  await shot(p, 'blocks-'+theme+'-estilo');
  await p.keyboard.press('Escape');
  // icono
  await p.locator('.blk-cards .mb-ico').first().click(); await p.waitForTimeout(200);
  await shot(p, 'blocks-'+theme+'-iconos');
  await p.mouse.click(5, 5);
  // salida a WordPress y vuelta
  const rt = await p.evaluate(async () => {
    const E = window.BlockEditor;
    return JSON.parse(JSON.stringify(E.draft.blocks.map((b) => ({ type: b.type, keys: Object.keys(b) }))));
  });
  check('quedan los 13 bloques', rt.length === types.length, rt.length);
  const realErrs = errs.filter((e) => !/memoria\.pdf/.test(e)); // el PDF de ejemplo es externo y la CSP de la app lo bloquea a propósito
  check('sin errores de página', realErrs.length === 0, realErrs);
  check.done();
  } finally { await b.close(); }
});
