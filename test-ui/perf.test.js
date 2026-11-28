// Banco de rendimiento con webs grandes: 3.000 entradas, 15.000 fotos en la biblioteca, 2.000 publicaciones de redes
// y una entrada enorme (250 bloques, 110 fotos). Mide con Playwright (tiempo hasta pintar, tareas largas con
// PerformanceObserver «longtask», memoria JS) y falla si algo supera umbrales holgados (pensados para una CI lenta).
//
//   npm run test:ui                         (incluido; solo falla si hay regresiones grandes)
//   ECOS_PERF_OUT=/ruta/perf.json node --test test-ui/perf.test.js    guarda las cifras en JSON
//   ECOS_PERF_NOCHECK=1 …                   solo mide (para rellenar la tabla de docs/rendimiento.md)
//   ECOS_PERF_SCALE=0.3 …                   tamaños reducidos (prueba rápida)
const test = require('node:test');
const fs = require('fs');
const { launch, newPage, shot, assert, INDEX_URL } = require('./helpers');
const { installMock } = require('./mock-api');
const { perfPatch, hugeBlocks } = require('./perf-data');

const SCALE = Number(process.env.ECOS_PERF_SCALE || 1);
const SIZES = { entries: Math.round(3000 * SCALE), media: Math.round(15000 * SCALE), posts: Math.round(2000 * SCALE) };

// Umbrales (ms). `t`: hasta pintar o terminar la acción; `lt`: tarea larga más larga durante la acción.
// Holgados a propósito: sirven para detectar regresiones grandes, no para afinar.
const LIMITS = {
  'Inicio: abrir': { t: 3000, lt: 1500 },
  'Blog: lista (primera pintura)': { t: 1500, lt: 600 },
  'Blog: búsqueda': { t: 1500, lt: 400 },
  'Blog: cambio de filtro': { t: 1500, lt: 400 },
  'Blog: línea temporal (salto)': { t: 2000, lt: 400 },
  'Blog: scroll': { t: 4000, lt: 200 },
  'Publicaciones Detalle: primera pintura': { t: 2500, lt: 600 },
  'Publicaciones Detalle: todo listo': { t: 15000, lt: 600 },
  'Publicaciones Detalle: búsqueda': { t: 2500, lt: 600 },
  'Publicaciones Detalle: scroll': { t: 5000, lt: 300 },
  'Publicaciones Detalle: línea temporal (salto)': { t: 2500, lt: 600 },
  'Publicaciones Cuadrícula: cambio de vista': { t: 3000, lt: 600 },
  'Publicaciones Cuadrícula: scroll': { t: 5000, lt: 300 },
  'Medios: abrir biblioteca': { t: 3000, lt: 800 },
  'Medios: búsqueda': { t: 2000, lt: 500 },
  'Medios: filtro «Sin usar»': { t: 2500, lt: 600 },
  'Medios: siguiente página': { t: 1500, lt: 300 },
  'Calendario: mes': { t: 2000, lt: 400 },
  'Calendario: año': { t: 3000, lt: 500 },
  'Buscador Ctrl+K: abrir': { t: 1000, lt: 300 },
  'Buscador Ctrl+K: escribir': { t: 2500, lt: 300 },
  'Editor enorme: abrir (render)': { t: 3500, lt: 2500 },
  'Editor enorme: escribir en un párrafo': { t: 12000, lt: 800 },
  'Editor enorme: arrastrar un bloque': { t: 3000, lt: 1500 },
  'Editor enorme: deshacer': { t: 3000, lt: 1500 },
};
const MAX_KEY_MS = 300; // latencia media de una tecla en el editor enorme (tecla → siguiente fotograma)

const rows = [];
let memoryOut = {};
function fmtTable() {
  const l = ['| Escenario | Tiempo (ms) | Tarea larga máx. (ms) | Tareas largas |', '| --- | ---: | ---: | ---: |'];
  for (const r of rows) l.push(`| ${r.name} | ${r.t} | ${r.ltMax} | ${r.ltN} |`);
  return l.join('\n');
}

test('rendimiento con webs grandes', { timeout: 600000 }, async () => {
  const b = await launch();
  const fails = [];
  try {
    const p = await newPage(b, { viewport: { width: 1300, height: 820 } });
    await p.addInitScript((sizes) => {
      window.__PERF = sizes; window.__lt = [];
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch { /* sin longtask */ }
    }, SIZES);
    await installMock(p, { config: { format: { status: 'draft', mergeDuplicates: false } }, patch: perfPatch });

    const raf2 = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    // Mide una acción: tiempo hasta que `fn` termina y se pinta, y las tareas largas ocurridas (también las diferidas, tras `settle` ms)
    async function measure(name, fn, { settle = 250 } = {}) {
      await p.evaluate(() => { if (window.__lt) window.__lt.length = 0; });
      const t0 = Date.now();
      await fn();
      await raf2();
      const t = Date.now() - t0;
      await p.waitForTimeout(settle);
      const lt = await p.evaluate(() => (window.__lt || []).slice());
      const r = { name, t, ltMax: Math.round(Math.max(0, ...lt)), ltN: lt.length };
      rows.push(r);
      const lim = LIMITS[name];
      if (lim) {
        if (r.t > lim.t) fails.push(`${name}: ${r.t} ms > ${lim.t} ms`);
        if (r.ltMax > lim.lt) fails.push(`${name}: tarea larga de ${r.ltMax} ms > ${lim.lt} ms`);
      }
      return r;
    }
    const scroll = async (n = 14, dy = 700) => { await p.mouse.move(650, 450); for (let i = 0; i < n; i++) { await p.mouse.wheel(0, dy); await p.waitForTimeout(40); } };
    const heap = () => p.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
    const memory = {};

    // ---------------------------------------------------------------- Inicio
    await measure('Inicio: abrir', async () => { await p.goto(INDEX_URL); await p.waitForFunction(() => document.querySelector('#home')?.children.length > 0); });
    await p.waitForTimeout(600);

    // ---------------------------------------------------------------- Blog
    await measure('Blog: lista (primera pintura)', async () => { await p.click('[data-tab="blog"]'); await p.waitForSelector('#b-list .b-row'); });
    await p.waitForTimeout(800); // llegan las fechas de todas las entradas y se pinta la línea temporal
    await measure('Blog: búsqueda', async () => {
      await p.fill('#b-search', 'número 12');
      await p.waitForFunction(() => /\d+ entradas/.test(document.querySelector('#b-info').textContent) && !/^3000 /.test(document.querySelector('#b-info').textContent) && !document.querySelector('#b-list .hint.pad'));
    });
    await p.fill('#b-search', ''); await p.waitForFunction((n) => document.querySelector('#b-info').textContent.startsWith(n + ' '), SIZES.entries);
    await measure('Blog: cambio de filtro', async () => {
      await p.selectOption('#b-status', 'draft');
      await p.waitForFunction((n) => { const s = document.querySelector('#b-info').textContent; return !s.startsWith(n + ' ') && document.querySelector('#b-list .b-row'); }, SIZES.entries);
    });
    await p.selectOption('#b-status', 'any'); await p.waitForTimeout(500);
    await measure('Blog: línea temporal (salto)', async () => {
      const box = await p.locator('.dl:visible .dl-track').boundingBox();
      const before = await p.locator('#b-list .b-row').first().getAttribute('data-id');
      await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.5);
      await p.waitForFunction((id) => document.querySelector('#b-list .b-row')?.dataset.id !== id, before);
    });
    await measure('Blog: scroll', () => scroll());
    memory.blog = await heap();

    // ---------------------------------------------------------------- Medios (biblioteca)
    await measure('Medios: abrir biblioteca', async () => { await p.click('#b-type [data-type="media"]'); await p.waitForSelector('#b-media .mg-card'); });
    await p.waitForTimeout(600);
    await measure('Medios: búsqueda', async () => {
      await p.fill('#b-media .mg-search', 'IMG_12');
      await p.waitForFunction(() => /archivos/.test(document.querySelector('#b-media .mg-count').textContent) && !/^15000/.test(document.querySelector('#b-media .mg-count').textContent));
    });
    await p.fill('#b-media .mg-search', ''); await p.waitForFunction((n) => document.querySelector('#b-media .mg-count').textContent.startsWith(String(n)), SIZES.media);
    await measure('Medios: filtro «Sin usar»', async () => { await p.locator('#b-media .mg-unused').click(); await p.waitForFunction(() => /sin usar/.test(document.querySelector('#b-media .mg-count').textContent)); });
    await p.locator('#b-media .mg-unused').click(); await p.waitForTimeout(600);
    await measure('Medios: siguiente página', async () => { await p.click('#b-media [data-pg="next"]'); await p.waitForFunction(() => /página 2 /.test(document.querySelector('#b-media .mg-info').textContent)); });
    memory.media = await heap();

    // ---------------------------------------------------------------- Calendario
    await measure('Calendario: mes', async () => { await p.click('#b-type [data-type="calendar"]'); await p.waitForSelector('#b-calendar .cal-grid'); });
    await measure('Calendario: año', async () => { await p.click('#b-calendar [data-mode="year"]'); await p.waitForSelector('#b-calendar .cal-month'); });

    // ---------------------------------------------------------------- Publicaciones
    await p.click('[data-tab="posts"]');
    await measure('Publicaciones Detalle: primera pintura', async () => { await p.click('#load'); await p.waitForSelector('#feed .prow'); });
    await measure('Publicaciones Detalle: todo listo', async () => { await p.waitForFunction((n) => document.querySelectorAll('#feed .prow').length >= n, SIZES.posts, { timeout: 60000 }); });
    await measure('Publicaciones Detalle: búsqueda', async () => {
      await p.fill('#f-search', 'Publicación 12');
      await p.waitForFunction((n) => { const c = document.querySelectorAll('#feed .prow').length; return c > 0 && c < n; }, SIZES.posts);
    });
    await p.fill('#f-search', ''); await p.waitForFunction((n) => document.querySelectorAll('#feed .prow').length >= n, SIZES.posts, { timeout: 60000 });
    await measure('Publicaciones Detalle: scroll', () => scroll());
    await measure('Publicaciones Detalle: línea temporal (salto)', async () => {
      const box = await p.locator('.dl:visible .dl-track').boundingBox();
      const y0 = await p.evaluate(() => document.scrollingElement.scrollTop + (document.querySelector('#tab-posts')?.scrollTop || 0));
      await p.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
      await p.waitForTimeout(600);
      void y0;
    });
    memory.posts = await heap();
    await measure('Publicaciones Cuadrícula: cambio de vista', async () => { await p.click('#f-layout [data-l="grid"]'); await p.waitForSelector('#feed .post'); });
    await measure('Publicaciones Cuadrícula: scroll', () => scroll());

    // ---------------------------------------------------------------- Buscador global (Ctrl+K)
    await measure('Buscador Ctrl+K: abrir', async () => { await p.keyboard.press('Control+k'); await p.waitForSelector('.gs-box input'); });
    await p.waitForTimeout(500);
    await measure('Buscador Ctrl+K: escribir', async () => { await p.keyboard.type('foto img', { delay: 25 }); await p.waitForTimeout(500); }, { settle: 400 });
    await p.keyboard.press('Escape');

    // ---------------------------------------------------------------- Editor con una entrada enorme
    await p.click('#f-layout [data-l="detail"]');
    await p.evaluate(() => window.scrollTo(0, 6000)); await p.waitForTimeout(300);
    const y0 = await p.evaluate(() => scrollY);
    await p.locator('#feed .post').first().evaluate((el) => el.click()); await p.click('#make'); await p.waitForSelector('#d-blocks');
    await p.waitForTimeout(600);
    const huge = `(${hugeBlocks})(${Math.round(250 * Math.max(SCALE, 0.4))}, ${Math.round(110 * Math.max(SCALE, 0.4))})`;
    await measure('Editor enorme: abrir (render)', async () => {
      await p.evaluate((src) => { const E = window.BlockEditor; E.draft.blocks = (0, eval)(src); E.draft.featuredImageId = null; E.draft.noAutoFeatured = true; E.render(); }, huge);
    }, { settle: 600 });
    const nBlocks = await p.locator('#d-blocks > .blk').count();
    assert.ok(nBlocks >= 100, 'la entrada enorme se pinta (' + nBlocks + ' bloques)');
    memory.editor = await heap();
    // escribir en un párrafo del medio: latencia tecla → siguiente fotograma
    await p.evaluate(() => {
      window.__keyLat = [];
      document.addEventListener('keydown', () => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => window.__keyLat.push(performance.now() - t0))); }, true);
    });
    const mid = p.locator('#d-blocks > .blk-paragraph .rt').nth(Math.floor((await p.locator('#d-blocks > .blk-paragraph .rt').count()) / 2));
    await mid.scrollIntoViewIfNeeded(); await mid.click();
    await measure('Editor enorme: escribir en un párrafo', async () => { await p.keyboard.type('Escribiendo una frase de prueba en un párrafo', { delay: 30 }); }, { settle: 800 });
    const lat = await p.evaluate(() => window.__keyLat.slice());
    const avgKey = Math.round(lat.reduce((a, c) => a + c, 0) / Math.max(1, lat.length));
    rows.push({ name: 'Editor enorme: latencia media por tecla', t: avgKey, ltMax: Math.round(Math.max(0, ...lat)), ltN: lat.length });
    if (avgKey > MAX_KEY_MS) fails.push(`Latencia por tecla ${avgKey} ms > ${MAX_KEY_MS} ms`);
    // arrastrar un bloque (asa → otro bloque)
    const before = await p.evaluate(() => window.BlockEditor.draft.blocks.map((x) => x.id).join(','));
    await measure('Editor enorme: arrastrar un bloque', async () => {
      // arrastre HTML5 simulado (asa del bloque 3 → mitad inferior del bloque 8)
      await p.evaluate(() => {
        const bl = [...document.querySelectorAll('#d-blocks > .blk')], src = bl[3], dst = bl[8];
        dst.scrollIntoView({ block: 'center' });
        const dt = new DataTransfer(), r = dst.getBoundingClientRect();
        const ev = (type, el, o = {}) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.bottom - 4, ...o }));
        ev('dragstart', src.querySelector('.blk-handle'));
        ev('dragover', dst.querySelector('.blk-body'));
        ev('drop', dst.querySelector('.blk-body'));
        ev('dragend', src.querySelector('.blk-handle'));
      });
    }, { settle: 600 });
    const after = await p.evaluate(() => window.BlockEditor.draft.blocks.map((x) => x.id).join(','));
    assert.notEqual(after, before, 'el arrastre reordena los bloques');
    await measure('Editor enorme: deshacer', async () => { await p.click('#ed-undo'); }, { settle: 600 });
    assert.equal(await p.evaluate(() => window.BlockEditor.draft.blocks.map((x) => x.id).join(',')), before, 'deshacer devuelve el orden');
    memory.final = await heap(); memoryOut = memory;
    // al cerrar el editor, la lista de Publicaciones sigue donde estaba (aunque estuviera sin maquetar mientras se editaba)
    await p.click('#ed-close'); await p.waitForTimeout(500);
    if (await p.locator('.dlg-actions .btn').count()) { await p.locator('.dlg-actions .btn').last().click(); await p.waitForTimeout(500); }
    const y1 = await p.evaluate(() => scrollY);
    assert.ok(Math.abs(y1 - y0) < 80 && y0 > 1000, 'la lista conserva su posición al cerrar el editor: ' + y0 + ' → ' + y1);
    await shot(p, 'perf-editor-enorme');

    assert.deepEqual(p.errs.filter((e) => !/Blocked script execution in 'about:blank'/.test(e)), [], 'sin errores de página'); // (avisos de los iframes con sandbox de la vista previa)
  } finally {
    await b.close();
    const table = fmtTable();
    console.log('\n' + table + '\n');
    if (process.env.ECOS_PERF_OUT) fs.writeFileSync(process.env.ECOS_PERF_OUT, JSON.stringify({ sizes: SIZES, rows, memoryMB: memoryOut }, null, 2));
  }
  if (!process.env.ECOS_PERF_NOCHECK) assert.deepEqual(fails, [], 'Umbrales superados:\n - ' + fails.join('\n - '));
});
