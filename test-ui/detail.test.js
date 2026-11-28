// Publicaciones en modo Detalle: filas, texto con «Ver más», enlaces, visor, selección, rejilla, rendimiento, estrecho.
const test = require('node:test');
const { launch, newPage, shot: shotF, checker, INDEX_URL } = require('./helpers');
const { installMock } = require('./mock-api');

test('Publicaciones: modo Detalle y Cuadrícula', async () => {
  const b = await launch();
  try {
  const p = await newPage(b, { viewport: { width: 1300, height: 860 } });
  const errs = p.errs; const check = checker();
  await installMock(p, {
    config: { format: { status: 'draft', mergeDuplicates: true } },
    patch: (api, H) => {
      const pic = (c, w = 300, h = 300) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${c}"/><circle cx="${w / 2}" cy="${h / 2}" r="${h / 4}" fill="rgba(255,255,255,.35)"/></svg>`);
      const cols = ['#b5541c', '#3b5ba9', '#386a20', '#984061', '#7a6a2b', '#5b3b8c'];
      const short = 'Gracias a todos por venir ❤️';
    const mid = 'Ayer celebramos nuestra comida solidaria con más de cien personas.\nGracias a @voluntarios_elin y a todas las familias.\nMás información en https://www.ejemplo.org/comida-solidaria?id=12&x=<b> #solidaridad #Navidad2026';
    const long = Array.from({ length: 18 }, (_, i) => 'Línea ' + (i + 1) + ': un texto largo que sigue contando la historia de la jornada con muchos detalles, hashtags #ecos' + i + ' y menciones @amigo' + i + '.').join('\n');
    const xss = '<img src=x onerror="window.__xss=1"> <script>window.__xss=1<\/script> http://x.org/"onmouseover="window.__xss=1';
    const D = (y, m, d, h, mi) => new Date(y, m - 1, d, h, mi).toISOString();
    const photos = (n, o = 0) => Array.from({ length: n }, (_, i) => ({ type: 'image', url: pic(cols[(i + o) % 6]) }));
    window.__list = [
      { source: 'instagram', id: 'a1', text: mid, date: D(2026, 11, 25, 18, 30), permalink: 'https://instagram.com/p/a1', media: photos(10), alsoOn: [{ source: 'facebook', id: 'f1', permalink: 'https://facebook.com/f1', text: mid, media: [] }] },
      { source: 'instagram', id: 'a2', text: long, date: D(2026, 11, 25, 9, 5), permalink: 'https://instagram.com/p/a2', media: photos(3, 2) },
      { source: 'facebook', id: 'a3', text: short, date: D(2026, 11, 25, 8, 0), permalink: 'https://facebook.com/a3', media: photos(1, 4), likes: 12, comments: 1 },
      { source: 'instagram', id: 'b1', text: xss, date: D(2026, 11, 20, 12, 0), permalink: '', media: [{ type: 'video', url: pic('#222'), videoUrl: '', duration: 75 }, ...photos(2)] },
      { source: 'facebook', id: 'b2', text: '', date: D(2026, 11, 3, 10, 10), permalink: 'https://facebook.com/b2', media: [{ type: 'video', url: '', duration: 3725 }] },
      { source: 'instagram', id: 'c1', text: short + ' #corta', date: D(2026, 10, 30, 20, 0), permalink: 'https://instagram.com/p/c1', media: photos(2, 1) },
      { source: 'facebook', id: 'd1', text: mid, date: D(2026, 9, 12, 20, 0), permalink: 'https://facebook.com/d1', media: photos(1, 3) },
      ...Array.from({ length: 420 }, (_, i) => ({ source: i % 2 ? 'facebook' : 'instagram', id: 'z' + i, text: 'Publicación de relleno ' + i + (i % 3 ? '' : ' ' + mid), date: D(2025 - Math.floor(i / 120), 1 + (i % 12), 1 + (i % 27), 10, i % 60), permalink: 'https://x.org/' + i, media: photos(1 + (i % 4), i) })),
    ];
      Object.assign(api, {
      metaPosts: async () => ({ posts: window.__list, cursors: {} }),
      });
    },
  });
  const wait = (ms) => p.waitForTimeout(ms);
  const shot = (n) => shotF(p, 'detail-' + n);
  const open = async () => { await p.goto(INDEX_URL); await wait(500); };

  await open('light');
  await p.click('[data-tab="posts"]'); await p.click('#load'); await wait(700);
  check('modo Detalle por defecto', await p.evaluate(() => $('#feed').classList.contains('detail')) && await p.locator('#f-layout [data-l="detail"].active').count() === 1);
  const nRows = await p.locator('#feed .prow').count(), nCards = await p.locator('#feed .prow > .post').count();
  check('cada publicación es una fila con tarjeta + detalle', nRows === 427 && nCards === nRows && await p.locator('#feed .prow > .pdetail').count() === nRows, [nRows, nCards]);
  const sameDay = await p.evaluate(() => [...document.querySelectorAll('#feed .prow')].slice(0, 3).map((r) => r.querySelector('.pd-date').dateTime));
  check('el mismo día va en vertical y en orden (recientes primero)', sameDay[0] > sameDay[1] && sameDay[1] > sameDay[2], sameDay);
  const geo = await p.evaluate(() => { const r = document.querySelector('#feed .prow'), c = r.children[0].getBoundingClientRect(), d = r.children[1].getBoundingClientRect(), f = document.querySelector('#feed').getBoundingClientRect(); return { cw: c.width, dl: d.left - c.right, dw: d.width, fw: f.width, rowW: r.getBoundingClientRect().width }; });
  check('la tarjeta queda a la izquierda y el detalle ocupa el resto', geo.cw < 290 && geo.dw > 500 && Math.abs(geo.rowW - geo.fw) < 2, geo);
  // contenido del primer detalle (IG + FB duplicado, 10 fotos)
  const d0 = p.locator('#feed .prow').nth(0);
  check('fecha completa y «hace X»', /25 de noviembre de 2026/.test(await d0.locator('.pd-date').innerText()) && /hace|ayer|hoy/.test(await d0.locator('.pd-rel').innerText()), await d0.locator('.pd-date').innerText());
  check('duplicado: IG y FB con enlaces', await d0.locator('.pd-net').count() === 2 && await d0.locator('.pd-open').count() === 2);
  check('descripción con saltos de línea', await d0.locator('.pd-text br').count() >= 2);
  check('hashtags y menciones resaltados', await d0.locator('.pd-tag').count() === 2 && await d0.locator('.pd-men').count() === 1);
  check('enlace con & escapado', (await d0.locator('.pd-link').getAttribute('href')).includes('id=12&x=<b>') === false && (await d0.locator('.pd-link').getAttribute('href')).includes('&x='));
  check('tira de 10 miniaturas con loading=lazy', await d0.locator('.pd-th').count() === 10 && await d0.locator('.pd-th img[loading="lazy"]').count() === 10);
  check('texto corto: sin «Ver más»', await d0.locator('.pd-more').isHidden());
  // enlace abre fuera
  await d0.locator('.pd-link').click(); await d0.locator('.pd-open').first().click();
  const opened = await p.evaluate(() => window.__calls.open || []);
  check('enlaces se abren con window.api.open y no seleccionan', opened.length === 2 && /ejemplo\.org/.test(opened[0]) && opened[1] === 'https://instagram.com/p/a1' && await p.evaluate(() => window.selected ? 0 : 0) === 0 && await p.locator('#feed .post.sel').count() === 0, opened);
  // texto largo
  const d1 = p.locator('#feed .prow').nth(1);
  check('texto largo: «Ver más» visible y recortado a ~8 líneas', await d1.locator('.pd-more').isVisible() && await d1.locator('.pd-text').evaluate((e) => e.clientHeight < e.scrollHeight && e.clientHeight < 8 * 26));
  const el1 = await p.evaluate(() => document.querySelectorAll('#feed .prow')[1]);
  await p.evaluate(() => { window.__row1 = document.querySelectorAll('#feed .prow')[1]; });
  await d1.locator('.pd-more').click();
  check('«Ver más» despliega todo sin reconstruir la lista', await d1.locator('.pd-text').evaluate((e) => e.clientHeight >= e.scrollHeight - 1 && !e.classList.contains('clamp')) && await d1.locator('.pd-more').innerText() === 'Ver menos' && await p.evaluate(() => window.__row1 === document.querySelectorAll('#feed .prow')[1]));
  await shot('light-expandido');
  await d1.locator('.pd-more').click();
  check('«Ver menos» vuelve a recortar', await d1.locator('.pd-text.clamp').count() === 1);
  // red única, métricas
  const d2 = p.locator('#feed .prow').nth(2);
  check('métricas si existen', await d2.locator('.pd-metric').count() === 2);
  // XSS
  const d3 = p.locator('#feed .prow').nth(3);
  check('sin XSS (sin img ni script inyectados, sin ejecución)', await d3.locator('.pd-text img, .pd-text script').count() === 0 && await p.evaluate(() => !window.__xss));
  check('vídeo: icono y duración 1:15 y fotos', await d3.locator('.pd-th.vid .pd-play i').innerText() === '1:15' && await d3.locator('.pd-th').count() === 3);
  const d4 = p.locator('#feed .prow').nth(4);
  check('sin texto: aviso; vídeo largo 1:02:05 sin miniatura', await d4.locator('.pd-text.empty').count() === 1 && await d4.locator('.pd-th .pd-noimg').count() === 1 && await d4.locator('.pd-play i').innerText() === '1:02:05');
  // visor desde la tira
  await d0.locator('.pd-th').nth(4).click(); await wait(200);
  check('clic en miniatura abre el visor en esa foto', await p.locator('#lightbox:not(.hidden)').count() === 1 && /5 \/ 10/.test(await p.locator('#lightbox .lb-count').innerText()));
  await shot('light-visor'); await p.keyboard.press('Escape'); await p.click('#lightbox .lb-close').catch(() => {}); await wait(200);
  // selección
  const card0 = p.locator('#feed .prow > .post').nth(0);
  await card0.click(); await wait(200);
  check('seleccionar con la tarjeta', await card0.evaluate((e) => e.classList.contains('sel')) && /1 seleccionada/.test(await p.locator('#sel-count').innerText()));
  await d0.locator('.pd-text').click(); // no cambia la selección
  check('clic en el texto no cambia la selección', await card0.evaluate((e) => e.classList.contains('sel')));
  await p.evaluate(() => { document.querySelectorAll('#feed .prow > .post')[0].focus(); }); await p.keyboard.press('Space'); await wait(100);
  check('teclado: espacio alterna', !(await card0.evaluate((e) => e.classList.contains('sel'))));
  await p.locator('#feed .prow > .post').nth(5).click();
  await shot('light-seleccion');
  await p.locator('#feed .prow > .post').nth(5).click();
  await card0.dblclick(); await wait(200); check('doble clic en la tarjeta abre el visor', await p.locator('#lightbox:not(.hidden)').count() === 1); await p.click('#lightbox .lb-close'); await wait(150);
  await card0.click(); await p.click('#make'); await wait(900);
  check('seleccionar y crear entrada abre el editor', await p.evaluate(() => !document.querySelector('#editor').classList.contains('hidden')));
  await p.goto(INDEX_URL); await wait(500); await p.click('[data-tab="posts"]'); await p.click('#load'); await wait(700);
  // encabezados
  const dh = await p.$$eval('#feed .dl-d', (x) => x.map((h) => h.textContent)); check('encabezados de día siguen', dh.length > 3 && /^\p{L}+ \d+$/u.test(dh[0]), dh.slice(0, 3));
  await p.evaluate(() => scrollTo(0, 0));
  await shot('light-1');
  // orden ascendente
  await p.selectOption('#f-order', 'asc'); await wait(500);
  const asc = await p.evaluate(() => [...document.querySelectorAll('#feed .prow .pd-date')].slice(0, 6).map((x) => x.dateTime));
  check('«Más antiguas»: ascendente', asc.every((x, i) => !i || asc[i - 1] <= x), asc.slice(0, 3));
  await p.selectOption('#f-order', 'desc'); await wait(400);
  // Rejilla / Detalle
  await p.click('#f-layout [data-l="grid"]'); await wait(400);
  check('Rejilla: sin filas y recordado', await p.locator('#feed .prow').count() === 0 && await p.locator('#feed > .post').count() === 427 && await p.evaluate(() => localStorage.getItem('ecos-feed-layout')) === 'grid'); check('Cuadrícula: sin encabezados ni línea temporal', await p.locator('#feed .dl-head, #feed [class*=dl-month], #feed [class*=dl-day]').count() === 0, await p.evaluate(() => document.querySelector('#feed').firstElementChild.className));
  await shot('light-rejilla');
  await p.reload(); await wait(500); await p.click('[data-tab="posts"]'); await p.click('#load'); await wait(600);
  check('tras recargar sigue en Rejilla', await p.locator('#feed .prow').count() === 0 && await p.locator('#f-layout [data-l="grid"].active').count() === 1);
  await p.click('#f-layout [data-l="detail"]'); await p.waitForFunction(() => document.querySelectorAll('#feed .prow').length >= 427, null, { timeout: 15000 }).catch(() => {});
  check('vuelve a Detalle', await p.locator('#feed .prow').count() === 427);
  // calendario oculta el conmutador
  await p.click('#f-view [data-v="cal"]'); await wait(300); check('calendario: sin conmutador', await p.locator('#f-layout').isHidden());
  await p.click('#f-view [data-v="list"]'); await wait(300);
  // línea temporal: salto
  const lane = await p.locator('.dl:visible .dl-track').boundingBox();
  const y0 = await p.evaluate(() => scrollY);
  await p.mouse.move(lane.x + lane.width - 8, lane.y + lane.height * 0.5); await p.mouse.down(); await p.mouse.up(); await wait(1300);
  const y1 = await p.evaluate(() => scrollY), lbl = await p.locator('.dl:visible .dl-now span').innerText();
  check('línea temporal salta y marca el mes', y1 > y0 + 300 && /\d{4}/.test(lbl), [y0, y1, lbl]);
  check('la franja no tapa las filas', await p.evaluate((x) => document.querySelector('#feed .prow').getBoundingClientRect().right <= x, lane.x));
  await shot('light-salto');
  // rendimiento: scroll de 427 filas
  const perf = await p.evaluate(async () => { const t0 = performance.now(); let frames = 0, worst = 0, last = performance.now(); await new Promise((res) => { let y = 0; const step = () => { scrollTo(0, y += 400); const n = performance.now(); worst = Math.max(worst, n - last); last = n; frames++; if (y < 40000) requestAnimationFrame(step); else res(); }; step(); }); return { ms: Math.round(performance.now() - t0), frames, worst: Math.round(worst), imgs: document.querySelectorAll('#feed img').length, lazy: document.querySelectorAll('#feed img[loading="lazy"]').length }; });
  check('scroll sin tirones (peor fotograma < 120 ms) y todo lazy', perf.worst < 120 && perf.imgs === perf.lazy, perf);
  await p.evaluate(() => scrollTo(0, 0)); await wait(300);
  // dark, vinyl
  await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await wait(400); await p.evaluate(() => scrollTo(0, 0)); await shot('dark-1');
  await p.locator('#feed .prow > .post').nth(1).click(); await p.mouse.move(600, 400); await shot('dark-seleccion'); await p.locator('#feed .prow > .post').nth(1).click();
  await p.evaluate(() => { window.Vinyl.apply({ vinyl: true, silk: true }); }); await wait(500); await p.evaluate(() => scrollTo(0, 0)); await shot('vinyl-1');
  await p.evaluate(() => { window.Vinyl.apply({ vinyl: false }); document.documentElement.dataset.theme = 'light'; });
  // estrecho
  await p.setViewportSize({ width: 760, height: 860 }); await wait(500); await p.evaluate(() => scrollTo(0, 0));
  const nar = await p.evaluate(() => { const f = document.querySelector('#feed'); const r = f.querySelector('.prow'); return { w: f.clientWidth, narrow: f.classList.contains('pd-narrow'), stacked: r.children[1].getBoundingClientRect().top >= r.children[0].getBoundingClientRect().bottom - 2 }; });
  check('ventana estrecha: el detalle pasa debajo de la tarjeta', nar.narrow && nar.stacked, nar);
  check('estrecho: sin desbordamiento horizontal', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
  await shot('light-estrecho');
  await p.setViewportSize({ width: 420, height: 860 }); await wait(400); await shot('light-movil');
  await p.setViewportSize({ width: 1300, height: 860 }); await wait(600);
  check('al ensanchar vuelve a filas laterales', await p.evaluate(() => !document.querySelector('#feed').classList.contains('pd-narrow')));
  // buscar
  await p.fill('#f-search', 'relleno 1'); await wait(300); check('búsqueda filtra filas', (await p.locator('#feed .prow').count()) < 427 && (await p.locator('#feed .prow').count()) > 0);
  await p.fill('#f-search', '');
  // inglés
  check('sin errores de página', errs.length === 0, errs);
  check.done();
  } finally { await b.close(); }
});
