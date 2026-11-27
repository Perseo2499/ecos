// Salida de composeBlocks para los bloques «Más bloques»: se carga como página y se prueban pestañas, preguntas, puntos, comparador, donación, evento, contador, sin JS y móvil.
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, shot, ROOT: R, assert } = require('./helpers');
const T = require(R + '/src/transform');
const { samples } = require(R + '/test/moreblocks-samples');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-web-'));
const S = path.join(TMP, 'web-');
const svg = (c1, c2, label) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><circle cx="200" cy="150" r="60" fill="rgba(255,255,255,.5)"/><text x="30" y="370" font-size="40" fill="#fff" font-family="sans-serif">${label}</text></svg>`);
const A = { id: 7, url: svg('#b5541c', '#f0b860', 'ANTES'), alt: 'Antes' }, Z = { id: 8, url: svg('#3b5ba9', '#8fb0ff', 'DESPUES'), alt: 'Después' };
const P = (html) => ({ id: 'p' + Math.random(), type: 'paragraph', html });
const blocks = [
  { ...samples.tabs() }, { ...samples.timelineV(), items: samples.timelineV().items.map((x) => ({ ...x, img: x.img && A })) },
  { ...samples.figures() }, { ...samples.testimonials(), items: [{ html: 'Un sitio donde me siento en casa.', name: 'Ana Pérez', role: 'Voluntaria', img: A }, { html: 'Gracias a ellos aprendí un oficio.', name: 'Luis', role: 'Antiguo alumno', img: Z }] },
  { ...samples.cards() }, { ...samples.cta() }, { ...samples.donateBizum() }, { ...samples.donatePaypal() }, { ...samples.donateTransfer() }, { ...samples.event(), showMap: false },
  { ...samples.audioFile() }, { ...samples.audioEmbed() }, { ...samples.pdf() }, { ...samples.hotspots(), img: A }, { ...samples.compare(), before: A, after: Z }, { ...samples.faq() }, { ...samples.timelineH() },
];
const out = T.composeBlocks(blocks, {});
// WordPress pinta los bloques con sus clases wp-block-*: aquí, estilos mínimos parecidos a los de un tema
const page = (scheme) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Salida</title><style>
body{margin:0;font:17px/1.6 system-ui,sans-serif;background:${scheme === 'dark' ? '#14161a' : '#fff'};color:${scheme === 'dark' ? '#e8e8e8' : '#1b1b1b'}}main{max-width:820px;margin:0 auto;padding:24px}
.wp-block-group{box-sizing:border-box}.wp-block-heading{line-height:1.2}.wp-block-buttons{display:flex;gap:12px;flex-wrap:wrap}.wp-block-button__link{display:inline-block;padding:.7em 1.4em;border-radius:6px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600}.is-style-outline .wp-block-button__link{background:transparent;border:2px solid currentColor;color:inherit}
.wp-block-quote{margin:0}figure{margin:0 0 1em}img{max-width:100%}.wp-block-details summary{cursor:pointer}</style><main>${out}</main></html>`;
test('HTML que genera Ecos para WordPress: efectos y accesibilidad en la web', async () => {
  const b = await launch();
  try {
  const errs = [];
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 900, height: 900 }, colorScheme: scheme, permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    fs.writeFileSync(S + 'page-' + scheme + '.html', page(scheme));
    await p.goto('file://' + S + 'page-' + scheme + '.html');
    await p.waitForTimeout(400);
    if (scheme === 'light') {
      // pestañas
      ok(await p.locator('.ecos-tabs [role=tablist] [role=tab]').count() === 2, 'pestañas: role=tablist con 2 pestañas');
      ok(await p.locator('.ecos-tab:not([hidden])').count() === 1, 'pestañas: solo una visible');
      await p.locator('.ecos-tab-btn').nth(1).click();
      ok(await p.locator('.ecos-tab-btn').nth(1).getAttribute('aria-selected') === 'true' && await p.locator('#' + await p.locator('.ecos-tab-btn').nth(1).getAttribute('aria-controls')).isVisible(), 'pestañas: al pulsar se cambia de panel');
      await p.locator('.ecos-tab-btn').nth(1).focus(); await p.keyboard.press('ArrowLeft');
      ok(await p.locator('.ecos-tab-btn').first().getAttribute('aria-selected') === 'true', 'pestañas: flechas del teclado');
      // preguntas frecuentes: solo una abierta
      const d = p.locator('.ecos-faq details');
      await d.nth(0).locator('summary').click(); await d.nth(1).locator('summary').click(); await p.waitForTimeout(100);
      ok(await p.locator('.ecos-faq details[open]').count() === 1, 'preguntas: solo una abierta a la vez');
      // puntos
      const btn = p.locator('.ecos-pt-btn').first();
      await btn.scrollIntoViewIfNeeded();
      ok(await p.locator('.ecos-pt-btn').count() === 2, 'puntos: dos puntos sobre la foto');
      await btn.focus(); await p.keyboard.press('Enter');
      ok(await btn.getAttribute('aria-expanded') === 'true' && await p.locator('.ecos-pt-pop:not([hidden])').count() === 1, 'puntos: se abre con el teclado');
      await shot(p, 'web-puntos');
      await p.keyboard.press('Escape');
      ok(await p.locator('.ecos-pt-pop:not([hidden])').count() === 0, 'puntos: Escape cierra');
      // comparador
      const rg = p.locator('.ecos-cmp-range');
      await rg.scrollIntoViewIfNeeded();
      ok(await rg.getAttribute('aria-label') !== null && await rg.getAttribute('type') === 'range', 'comparador: input range accesible');
      await rg.focus(); for (let i = 0; i < 20; i++) await p.keyboard.press('ArrowRight');
      ok(/inset\(0px 2\d(\.\d+)?% 0px 0px\)|inset\(0(px)? [0-9.]+% 0(px)? 0(px)?\)/.test(await p.locator('.ecos-cmp-top').evaluate((e) => e.style.clipPath)), 'comparador: el teclado mueve la línea');
      await shot(p.locator('.ecos-cmp-stage'), 'web-comparador');
      // donación: copiar
      const copy = p.locator('a[href^="#ecos-copy-"]').first();
      await copy.scrollIntoViewIfNeeded(); await copy.click(); await p.waitForTimeout(200);
      ok((await copy.textContent()).includes('Copiado'), 'donación: el botón avisa «¡Copiado!»');
      ok(await p.evaluate(() => navigator.clipboard.readText()) === '600000000', 'donación: copia el número de Bizum');
      // evento
      const ics = p.locator('a[href^="data:text/calendar"]');
      ok(await ics.getAttribute('download') === 'evento.ics', 'evento: enlace .ics con descarga');
      const href = decodeURIComponent((await ics.getAttribute('href')).split(',')[1]);
      ok(/BEGIN:VEVENT[\s\S]*SUMMARY:Cena ben/.test(href), 'evento: el .ics trae el evento');
      const [dl] = await Promise.all([p.waitForEvent('download'), ics.click()]);
      ok(dl.suggestedFilename() === 'evento.ics', 'evento: se descarga evento.ics');
      ok((await p.locator('a[href^="https://calendar.google.com"]').count()) === 1, 'evento: enlace a Google Calendar');
      // contador
      const num = p.locator('.ecos-count .ecos-cifra-num').nth(1);
      await num.scrollIntoViewIfNeeded();
      await p.waitForTimeout(300);
      const mid = await num.textContent();
      await p.waitForTimeout(1900);
      ok((await num.textContent()) === '+1.200', 'contador: termina en +1.200 (a mitad: ' + mid + ')');
    }
    await p.evaluate(() => window.scrollTo(0, 0));
    await shot(p, 'web-' + scheme + '-arriba', { fullPage: true });
    await ctx.close();
  }
  // reducir movimiento: el contador no anima
  const rctx = await b.newContext({ viewport: { width: 900, height: 900 }, reducedMotion: 'reduce' });
  const rp = await rctx.newPage();
  await rp.goto('file://' + S + 'page-light.html');
  const n0 = rp.locator('.ecos-count .ecos-cifra-num').nth(1);
  await n0.scrollIntoViewIfNeeded(); await rp.waitForTimeout(150);
  ok((await n0.textContent()) === '+1.200', 'contador: con «reducir movimiento» se ve el número final al instante');
  await rctx.close();
  // sin JavaScript: todo se ve seguido
  const jctx = await b.newContext({ viewport: { width: 900, height: 900 }, javaScriptEnabled: false });
  const jp = await jctx.newPage();
  await jp.goto('file://' + S + 'page-light.html');
  ok(await jp.locator('.ecos-tab').evaluateAll((l) => l.every((e) => e.offsetParent !== null)), 'sin JavaScript: todas las pestañas se ven seguidas');
  ok(await jp.locator('.ecos-punto').first().isVisible(), 'sin JavaScript: los puntos se ven como lista');
  await shot(jp, 'web-sin-js', { fullPage: true });
  await jctx.close();
  // móvil
  const mctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  const mp = await mctx.newPage();
  await mp.goto('file://' + S + 'page-light.html'); await mp.waitForTimeout(300);
  ok(await mp.evaluate(() => document.documentElement.scrollWidth <= 392), 'móvil: sin desplazamiento horizontal de la página');
  await shot(mp, 'web-movil', { fullPage: true });
  await mctx.close();
  ok(errs.length === 0, 'sin errores de página ' + JSON.stringify(errs));
  assert.deepEqual(fails, []);
  } finally { await b.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
});
