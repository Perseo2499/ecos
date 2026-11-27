// Línea temporal (Publicaciones y Blog): saltos, arrastre, teclado, orden, filtros, temas y ventana estrecha.
const test = require('node:test');
const { launch, newPage, shot: shotF, checker, INDEX_URL } = require('./helpers');
const { installMock } = require('./mock-api');

test('línea temporal de Publicaciones y Blog', async () => {
  const b = await launch();
  try {
  const p = await newPage(b, { reducedMotion: 'no-preference' });
  const errs = p.errs; const check = checker();
  await installMock(p, {
    config: { format: { status: 'draft', mergeDuplicates: false } },
    patch: (api) => {
      const ok = async (v) => v;
      const pic = (c) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="${c}"/></svg>`);
      const cols = ['#b5541c', '#3b5ba9', '#386a20', '#984061', '#7a6a2b'];
      // Datos simulados: meses con muy distinta densidad desde 2019 hasta nov 2026
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const mkDates = (n, from, to) => Array.from({ length: n }, () => new Date(from + rnd() * (to - from))).map((d) => { d.setHours(8 + Math.floor(rnd() * 12), Math.floor(rnd() * 60)); return d; }).sort((a, b) => b - a);
    const start = new Date(2019, 2, 1).getTime(), endT = new Date(2026, 10, 26).getTime();
    const blogDatesAll = mkDates(320, start, endT);
    const blogAll = blogDatesAll.map((d, i) => ({ id: 1000 + i, type: 'post', title: 'Entrada de ejemplo ' + i, excerpt: 'Resumen de la entrada ' + i, status: ['publish', 'publish', 'draft', 'future'][i % 4], date: d.toISOString(), modified: d.toISOString(), url: 'https://x/' + i, image: i % 5 ? pic(cols[i % 5]) : '', categories: ['Blog'], author: { id: 1, name: 'Ana', avatar: '' } }));
    const postDates = mkDates(420, new Date(2021, 0, 1).getTime(), endT);
    const allPosts = postDates.map((d, i) => ({ source: i % 2 ? 'facebook' : 'instagram', id: 'p' + i, text: 'Publicación de ejemplo número ' + i + ' con un texto algo más largo para ver cómo queda en la tarjeta.', date: d.toISOString(), permalink: '', media: [{ type: 'image', url: pic(cols[i % 5]) }] }));
    window.__calls = { blogList: [], blogDates: 0, metaPosts: 0 };
    const FIRST = 150;
      Object.assign(api, {
      metaPosts: async (page, srcs, cur) => { window.__calls.metaPosts++; return cur ? { posts: allPosts.slice(FIRST), cursors: {} } : { posts: allPosts.slice(0, FIRST), cursors: { facebook: 'x' } }; },
      blogList: async (o) => {
        window.__calls.blogList.push({ page: o.page, order: o.order });
        let l = blogAll.slice();
        if (o.after) l = l.filter((x) => x.date >= o.after);
        if (o.before) l = l.filter((x) => x.date < o.before);
        if (o.status && o.status !== 'any') l = l.filter((x) => x.status === o.status);
        if (o.order === 'asc') l.reverse();
        const per = o.number || 20;
        return { found: l.length, items: l.slice((o.page - 1) * per, o.page * per) };
      },
      blogDates: async (o) => { window.__calls.blogDates++; let l = blogAll.slice(); if (o.after) l = l.filter((x) => x.date >= o.after); if (o.before) l = l.filter((x) => x.date < o.before); if (o.status && o.status !== 'any') l = l.filter((x) => x.status === o.status); return l.map((x) => x.date); },
      blogHealth: async () => ({ noCat: [], noImg: [], total: 320, at: Date.now() }),
      });
    },
  });
  const open = async (theme) => {
    await p.evaluate((t) => { window.__theme = t; }, theme).catch(() => {});
    await p.goto(INDEX_URL); await p.waitForTimeout(500);
  };
  const shot = (n) => shotF(p, 'timeline-' + n);
  const lane = (name) => p.locator('.dl:visible');
  const nowLabel = () => p.locator('.dl:visible .dl-now span').innerText();
  const headers = (sel) => p.$$eval(sel + ' .dl-h', (hs) => hs.map((h) => [h.dataset.dl, h.textContent]));
  const laneBox = async () => (await p.locator('.dl:visible .dl-track').boundingBox());
  const wait = (ms) => p.waitForTimeout(ms);

  await open('light');
  // ------------------------------------------------ REDES
  await p.click('[data-tab="posts"]'); await p.click('#load'); await wait(600);
  let hs = await headers('#feed');
  check('posts: encabezados por mes, más recientes primero', hs.length > 20 && hs[0][0] > hs[1][0] && hs[0][0] === '2026-11', hs.slice(0, 3));
  check('posts: texto del encabezado «noviembre 2026»', /^noviembre 2026$/i.test(hs[0][1]), hs[0][1]);
  const keysDesc = hs.map((h) => h[0]); check('posts: orden estrictamente descendente', keysDesc.every((k, i) => !i || keysDesc[i - 1] > k));
  const dayH = await p.$$eval('#feed .dl-d', (d) => d.map((x) => x.textContent)); check('posts: encabezados de día («miércoles 25»…)', dayH.length > 10 && /^\p{L}+ \d{1,2}$/u.test(dayH[0]), dayH.slice(0, 3));
  check('posts: línea temporal visible', await lane().count() === 1);
  check('posts: botón «cargar más» en la línea (quedan páginas de Meta)', await p.locator('.dl:visible .dl-more').count() === 1);
  const years = await p.$$eval('.dl:visible .dl-y', (y) => y.map((x) => x.textContent)); check('posts: años en la franja', years.length >= 2 && years[0] === '2026', years);
  const r = await laneBox(); check('posts: franja no tapa el contenido', await p.evaluate((x) => { const c = document.querySelector('#feed .post').parentElement.getBoundingClientRect(); return c.right <= x; }, r.x), r);
  await shot('posts-light');
  if (0) console.log('DBG', await p.evaluate(() => JSON.stringify({ more: postsMoreAvailable(), cur: typeof cursors, cm: CFG.metaConnected, cap: !!document.querySelector('.dl-more'), lane: document.querySelector('.dl').outerHTML.slice(0, 700) })));
  // hover
  await p.mouse.move(r.x + r.width - 8, r.y + r.height * 0.5); await wait(250);
  const hov = await p.locator('.dl:visible .dl-hover').innerText(); check('posts: hover muestra «mes año»', /^\p{L}+ \d{4}$/u.test(hov), hov);
  await shot('posts-hover');
  // clic a mitad: salta y el indicador marca ese mes
  const y0 = await p.evaluate(() => scrollY);
  await p.mouse.down(); await p.mouse.up(); await wait(1200);
  const y1 = await p.evaluate(() => scrollY); check('posts: clic en la franja hace scroll', y1 > y0 + 300, [y0, y1]);
  const lbl = await nowLabel(); const want = hov.toLowerCase().slice(0, 3);
  check('posts: el indicador marca el mes elegido', lbl.toLowerCase().startsWith(want) && lbl.includes(hov.slice(-4)), [lbl, hov]);
  const topH = await p.evaluate(() => { const h = [...document.querySelectorAll('#feed .dl-h')].find((x) => x.getBoundingClientRect().top > 100); return h ? h.getBoundingClientRect().top : null; });
  await shot('posts-jump');
  // scroll a mano: el indicador cambia
  await p.mouse.move(400, 400); await p.mouse.wheel(0, -2500); await wait(500);
  const lbl2 = await nowLabel(); check('posts: indicador sigue al scroll', lbl2 !== lbl, [lbl, lbl2]);
  check('posts: indicador visible mientras se hace scroll', await p.evaluate(() => document.querySelector('.dl:not([hidden])').classList.contains('show')));
  await p.evaluate(() => document.activeElement.blur()); await wait(2000); check('posts: indicador se oculta tras reposo', await p.evaluate(() => !document.querySelector('.dl:not([hidden])').classList.contains('show')));
  // arrastre
  const r2 = await laneBox();
  await p.mouse.move(r2.x + r2.width - 8, r2.y + 6); await p.mouse.down();
  await p.mouse.move(r2.x + r2.width - 8, r2.y + r2.height * 0.4, { steps: 8 }); await wait(250);
  await shot('posts-drag');
  await p.mouse.move(r2.x + r2.width - 8, r2.y + r2.height * 0.8, { steps: 8 }); await p.mouse.up(); await wait(500);
  const lbl3 = await nowLabel(); check('posts: arrastrar lleva a otro mes', lbl3 !== lbl2, lbl3);
  // teclado
  await p.locator('.dl:visible').focus();
  check('posts: role=scrollbar', await p.locator('.dl:visible').getAttribute('role') === 'scrollbar');
  await p.keyboard.press('Home'); await wait(1500);
  check('posts: Inicio lleva al primer mes', (await nowLabel()).toLowerCase().startsWith('nov') && await p.evaluate(() => scrollY) < 400, await nowLabel());
  await p.keyboard.press('ArrowDown'); await wait(1500);
  const vt = await p.locator('.dl:visible').getAttribute('aria-valuetext'); check('posts: ↓ pasa al mes siguiente', /^\p{L}+ \d{4}$/u.test(vt) && vt !== 'noviembre 2026', vt);
  await p.keyboard.press('PageDown'); await wait(1500);
  const vt2 = await p.locator('.dl:visible').getAttribute('aria-valuetext'); check('posts: AvPág pasa de año', vt2.slice(-4) !== vt.slice(-4), [vt, vt2]);
  await p.keyboard.press('PageUp'); await wait(600); await p.keyboard.press('End'); await wait(900);
  await shot('posts-kbd-end');
  // más antiguas
  await p.selectOption('#f-order', 'asc'); await wait(500);
  hs = await headers('#feed'); const ka = hs.map((h) => h[0]);
  check('posts: «Más antiguas» ordena ascendente', ka.every((k, i) => !i || ka[i - 1] < k) && ka[0] <= '2025-02', ka.slice(0, 2));
  check('posts: el orden se recuerda', await p.evaluate(() => localStorage.getItem('ecos-order-posts')) === 'asc');
  await p.evaluate(() => scrollTo(0, 0)); await shot('posts-asc');
  // cargar más desde la franja
  const before = await p.$$eval('#feed .post', (x) => x.length);
  await p.click('.dl:visible .dl-more'); await wait(900);
  const after = await p.$$eval('#feed .post', (x) => x.length); check('posts: «…» de la franja carga más publicaciones', after > before, [before, after]);
  check('posts: tras cargarlo todo, la franja ya no ofrece más', await p.locator('.dl:visible .dl-more').count() === 0);
  await p.selectOption('#f-order', 'desc');
  // vista calendario: la franja se oculta
  await p.click('#f-view [data-v="cal"]'); await wait(500);
  check('posts: en el calendario no hay franja', await p.locator('.dl:visible').count() === 0);
  await p.click('#f-view [data-v="list"]'); await wait(400);
  check('posts: al volver a la lista reaparece', await p.locator('.dl:visible').count() === 1);
  // filtro de búsqueda reduce la franja
  await p.fill('#f-search', 'número 1'); await wait(300);
  const nm = await p.$$eval('.dl:visible .dl-y', (y) => y.length); check('posts: la franja sigue al filtro', nm >= 1);
  await p.fill('#f-search', '');
  // editor abierto
  await p.locator('.post').first().click(); await p.click('#make'); await wait(900);
  check('posts: con el editor abierto no hay franja', await p.locator('.dl:visible').count() === 0);
  await open('light');

  // ------------------------------------------------ BLOG
  await p.click('[data-tab="blog"]'); await wait(900);
  hs = await headers('#b-list');
  check('blog: encabezados por mes, página 1', hs.length >= 1 && hs[0][0] === '2026-11' || hs[0][0] === '2026-10', hs.slice(0, 2));
  check('blog: una sola petición ligera de fechas', await p.evaluate(() => window.__calls.blogDates) === 1);
  check('blog: franja visible', await p.locator('.dl:visible').count() === 1);
  await shot('blog-light');
  let br = await laneBox();
  await p.mouse.move(br.x + br.width - 8, br.y + br.height * 0.62); await wait(250);
  const bh = await p.locator('.dl:visible .dl-hover').innerText(); check('blog: hover con etiqueta', /^\p{L}+ \d{4}$/u.test(bh), bh);
  await shot('blog-hover');
  await p.mouse.down(); await p.mouse.up(); await wait(1800);
  const info = await p.locator('#b-info').innerText();
  const pg = Number((info.match(/página (\d+)/) || [])[1]); check('blog: clic carga la página que contiene ese mes', pg > 1, info);
  const first = (await headers('#b-list'))[0]; check('blog: aparece el encabezado del mes elegido', first && (first[1].toLowerCase() === bh.toLowerCase() || (await p.$$eval('#b-list .dl-h', (h) => h.map((x) => x.textContent.toLowerCase()))).includes(bh.toLowerCase())), [first, bh]);
  const nowB = await nowLabel(); check('blog: indicador marca un mes de esa página', /^\p{L}+\.? \d{4}$/u.test(nowB), [nowB, bh]);
  check('blog: el encabezado elegido está a la vista', await p.evaluate((k) => { const h = [...document.querySelectorAll('#b-list .dl-h')].find((x) => x.textContent.toLowerCase() === k); if (!h) return false; const r = h.getBoundingClientRect(); return r.top > 60 && r.top < innerHeight; }, bh.toLowerCase()));
  await shot('blog-jump');
  // teclado
  await p.locator('.dl:visible').focus(); await p.keyboard.press('End'); await wait(1800);
  const info2 = await p.locator('#b-info').innerText(); check('blog: Fin lleva a la última página', /página 16 de 16/.test(info2), info2);
  await p.keyboard.press('Home'); await wait(1800);
  check('blog: Inicio vuelve a la primera página', /página 1 de 16/.test(await p.locator('#b-info').innerText()));
  // más antiguas
  await p.selectOption('#b-order', 'asc'); await wait(1000);
  hs = await headers('#b-list'); check('blog: «Más antiguas» empieza por 2019', hs[0][0] === '2019-03' || hs[0][0].startsWith('2019'), hs.slice(0, 2));
  check('blog: la petición lleva order=asc', await p.evaluate(() => window.__calls.blogList.at(-1).order) === 'asc');
  check('blog: orden recordado', await p.evaluate(() => localStorage.getItem('ecos-order-blog')) === 'asc');
  const yrs = await p.$$eval('.dl:visible .dl-y', (y) => y.map((x) => x.textContent)); check('blog: años de la franja en orden ascendente', yrs[0] === '2019' && yrs.at(-1) <= '2026', yrs);
  await shot('blog-asc');
  await p.selectOption('#b-order', 'desc'); await wait(800);
  // filtro por fechas: la franja se recalcula
  await p.selectOption('#b-preset', 'y2024'); await wait(1200);
  const y24 = await p.$$eval('.dl:visible .dl-y', (y) => y.map((x) => x.textContent)); check('blog: filtrando por 2024 la franja solo tiene 2024', y24.length === 1 && y24[0] === '2024', y24);
  await p.selectOption('#b-preset', 'all'); await wait(1200);
  // Calendario del blog: sin franja
  await p.click('#b-type [data-type="calendar"]'); await wait(600);
  check('blog: en el calendario no hay franja', await p.locator('.dl:visible').count() === 0);
  await p.click('#b-type [data-type="post"]'); await wait(900);
  check('blog: al volver a Entradas reaparece', await p.locator('.dl:visible').count() === 1);

  // ------------------------------------------------ temas, vinilo y estrecho
  for (const [name, fn] of [
    ['dark', async () => { await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); }],
    ['vinyl', async () => { await p.evaluate(() => { window.Vinyl.apply({ vinyl: true, silk: true }); }); }],
  ]) {
    await fn(); await wait(500);
    await p.evaluate(() => { scrollTo(0, 0); showTab('posts'); }); await wait(500);
    if (!(await p.locator('#feed .post').count())) { await p.click('#load'); await wait(700); }
    await p.mouse.move(400, 500); await p.mouse.wheel(0, 1400); await wait(400);
    const rr = await laneBox(); if (rr) { await p.mouse.move(rr.x + rr.width - 8, rr.y + rr.height * 0.45); await wait(250); }
    await shot('posts-' + name);
    await p.evaluate(() => { scrollTo(0, 0); showTab('blog'); }); await wait(700);
    await p.mouse.wheel(0, 600); await wait(300);
    const rb = await laneBox(); if (rb) { await p.mouse.move(rb.x + rb.width - 8, rb.y + rb.height * 0.3); await wait(250); }
    await shot('blog-' + name);
  }
  await p.evaluate(() => { document.documentElement.dataset.vinyl = 'off'; window.Vinyl.apply({ vinyl: false }); document.documentElement.dataset.theme = 'light'; });
  await p.setViewportSize({ width: 640, height: 820 }); await wait(500);
  await p.evaluate(() => { showTab('posts'); scrollTo(0, 0); }); await wait(300); await p.mouse.wheel(0, 900); await wait(400);
  const nw = await laneBox(); check('estrecho (640): franja mínima', nw && nw.width <= 30, nw);
  check('estrecho (640): sin etiquetas de año', await p.locator('.dl:visible .dl-y').count() === 0 || !(await p.locator('.dl:visible .dl-y').first().isVisible()));
  check('estrecho (640): la lista y la franja no desbordan (la barra superior ya lo hacía antes)', await p.evaluate(() => [...document.querySelectorAll('main *, .dl, .dl *')].every((e) => !e.offsetParent || e.getBoundingClientRect().right <= innerWidth + 1 || e.closest('.sources, .chips, .row'))));
  await shot('posts-narrow');
  await p.evaluate(() => { showTab('blog'); }); await wait(600); await shot('blog-narrow');
  await p.setViewportSize({ width: 420, height: 820 }); await wait(400);
  check('muy estrecho (420): franja oculta', await p.locator('.dl:visible').count() === 0);
  await p.setViewportSize({ width: 1300, height: 820 });

  check('sin errores de página', errs.length === 0, errs);
  check.done();
  } finally { await b.close(); }
});
