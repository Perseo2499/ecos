// Accesibilidad del editor: panel de revisión, «Ir al bloque», arreglos automáticos y aviso antes de publicar.
const test = require('node:test');
const { launch, newPage, shot, checker, openApp } = require('./helpers');
const { installMock } = require('./mock-api');

test('revisión de accesibilidad: panel, arreglos y aviso al publicar', async () => {
  const b = await launch();
  try {
  const p = await newPage(b, { viewport: { width: 1400, height: 900 } });
  const errs = p.errs; const check = checker();
  await installMock(p, {
    patch: (api) => {
      window.__published = 0; window.__aiAlt = 0;
      api.aiAlt = async () => { window.__aiAlt++; return 'Voluntarios recogiendo plásticos en la playa'; };
      api.publish = async () => { window.__published++; return { status: 'publish', postId: 5, url: 'https://x', editUrl: 'https://x', exported: {}, date: new Date().toISOString() }; };
    },
  });
  await openApp(p);
  await p.click('[data-tab="posts"]'); await p.click('#load'); await p.locator('.post').first().click(); await p.click('#make'); await p.waitForTimeout(600);
  await p.evaluate(() => {
    const pic = (c) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="${c}"/></svg>`);
    draft.title = 'Jornada de voluntariado'; $('#d-title').value = draft.title;
    draft.blocks = [
      { id: 'b1', type: 'heading', level: 2, html: 'Programa de la jornada' },
      { id: 'b2', type: 'paragraph', html: 'Nos reunimos el sábado en la playa para limpiar la orilla entre todos y todas.', color: '#aab0b5' },
      { id: 'b3', type: 'heading', level: 4, html: 'Qué traer' },
      { id: 'b4', type: 'paragraph', html: '- Guantes<br>- Una bolsa<br>- Agua' },
      { id: 'b5', type: 'image', img: { id: 11, url: pic('#3b5ba9'), alt: '', type: 'image' }, caption: '' },
      { id: 'b6', type: 'paragraph', html: 'Más información <a href="https://example.org/mapa" target="_blank">aquí</a>, o en el programa.', size: '12px' },
      { id: 'b7', type: 'buttons', html: 'Pincha aquí', url: 'https://example.org', bg: '#ffd54f', color: '#ffffff' },
      { id: 'b8', type: 'cover', img: { id: 12, url: pic('#d8c9a0'), alt: '' }, overlay: '#000000', dim: 0, height: 220, children: [{ id: 'b9', type: 'heading', level: 3, html: 'Te esperamos' }] },
      { id: 'b10', type: 'group', bg: '#1a237e', children: [{ id: 'b11', type: 'paragraph', html: 'Texto oscuro por defecto sobre un fondo azul marino.' }] },
      { id: 'b12', type: 'image', img: { id: 13, url: pic('#386a20'), alt: 'IMG_20240315_1022.jpg', type: 'image' }, caption: '' },
    ];
    draft.blocks.forEach((x) => { if (x.type === 'cover') x.img.alt = ''; });
    window.BlockEditor.render(); window.FormatBar.review();
  });
  await p.waitForTimeout(900);
  const shot2 = (n) => shot(p, 'a11y-' + n);
  const count = () => p.locator('.a11y-i').count();
  const score = () => p.locator('.a11y-score').innerText();
  const out = { };
  await p.evaluate(async () => { CFG = await window.api.setConfig({ prefs: { theme: 'light' } }); applyPrefs(); });
  await p.waitForTimeout(300);
  await p.locator('.a11y summary').scrollIntoViewIfNeeded();
  out.start = [await count(), await score()];
  await p.locator('#d-review').scrollIntoViewIfNeeded();
  await shot2('1-panel-claro');

  // Ir al bloque
  await p.locator('.a11y-i', { hasText: 'Salto de título' }).locator('[data-go]').click();
  await p.waitForTimeout(300);
  out.flash = await p.locator('.blk[data-id="b3"].a11y-flash').count();
  await shot2('2-ir-al-bloque');

  // Arreglar: título
  await p.locator('.a11y-i', { hasText: 'Salto de título' }).locator('[data-fix]').click(); await p.waitForTimeout(500);
  out.level = await p.evaluate(() => draft.blocks[2].level);
  // lista
  await p.locator('.a11y-i', { hasText: 'Lista hecha con guiones' }).locator('[data-fix]').click(); await p.waitForTimeout(500);
  out.list = await p.evaluate(() => [draft.blocks[3].type, draft.blocks[3].items]);
  // tamaño móvil
  await p.locator('.a11y-i', { hasText: 'Letra muy pequeña' }).locator('[data-fix]').click(); await p.waitForTimeout(400);
  out.fsm = await p.evaluate(() => draft.blocks[5].fsm);
  // color del párrafo
  await p.locator('.a11y-i', { hasText: 'Poco contraste' }).first().locator('[data-fix]').click(); await p.waitForTimeout(400);
  out.color = await p.evaluate(() => [draft.blocks[1].color, window.A11y.ratio(draft.blocks[1].color, '#ffffff')]);
  // alt con IA simulada
  await p.locator('.a11y-i', { hasText: 'Foto sin descripción' }).first().locator('[data-fix]').click(); await p.waitForTimeout(600);
  out.alt = await p.evaluate(() => [draft.blocks[4].img.alt, window.__aiAlt]);
  // ventana nueva
  await p.locator('.a11y-i', { hasText: 'ventana nueva' }).locator('[data-fix]').click(); await p.waitForTimeout(400);
  out.newwin = await p.evaluate(() => draft.blocks[5].html);
  out.after = [await count(), await score()];
  await shot2('3-tras-arreglar');

  // Diálogo antes de publicar
  await p.evaluate(() => { document.querySelector('input[name="d-when"][value="publish"]').checked = true; });
  await p.click('#send'); await p.waitForTimeout(500);
  out.dlg = await p.locator('.dlg-msg').innerText().catch(() => '');
  await shot2('4-dialogo-publicar');
  out.dlgBtns = await p.locator('.dlg-actions button').allInnerTexts();
  await p.locator('.dlg-actions [data-r="0"]').click(); await p.waitForTimeout(400);
  out.publishedAfterRevisar = await p.evaluate(() => window.__published);
  await p.click('#send'); await p.waitForTimeout(400);
  await p.locator('.dlg-actions [data-r="1"]').click(); await p.waitForTimeout(800);
  out.publishedAfterIgual = await p.evaluate(() => window.__published);
  await p.evaluate(() => { document.querySelector('#sent')?.classList.add('hidden'); });

  // preferencia desactivada: no pregunta por errores, solo la confirmación normal con la puntuación
  await p.evaluate(async () => { CFG = await window.api.setConfig({ prefs: { a11yWarn: false } }); });
  await p.click('#send'); await p.waitForTimeout(400);
  out.dlgOff = await p.locator('.dlg-msg').innerText().catch(() => '');
  await p.locator('.dlg-actions [data-r="0"]').click(); await p.waitForTimeout(300);
  await p.evaluate(async () => { CFG = await window.api.setConfig({ prefs: { a11yWarn: true } }); });

  // Ajustes
  await p.evaluate(() => { document.body.classList.remove('editing'); document.getElementById('editor').classList.add('hidden'); });
  await p.click('[data-tab="settings"]'); await p.waitForTimeout(300);
  await p.locator('#s-a11y-warn').scrollIntoViewIfNeeded(); await shot2('5-ajustes');
  out.setChecked = await p.locator('#s-a11y-warn').isChecked();

  // vinilo
  await p.evaluate(async () => { CFG = await window.api.setConfig({ prefs: { vinyl: true } }); applyPrefs(); });
  await p.evaluate(() => { document.body.classList.add('editing'); document.getElementById('editor').classList.remove('hidden'); });
  await p.evaluate(() => { document.getElementById('d-review').scrollIntoView(); });
  // vuelve a los errores para verlos en vinilo
  await p.evaluate(() => { draft.blocks[4].img.alt = ''; draft.blocks[1].color = '#aab0b5'; window.BlockEditor.render(); window.FormatBar.review(); });
  await p.waitForTimeout(800);
  await shot2('6-panel-vinilo');
  check('panel inicial con avisos', out.start[0] >= 8, out.start);
  check('«Ir al bloque» resalta el bloque', out.flash === 1);
  check('arreglo: salto de título', out.level === 3);
  check('arreglo: lista con guiones', out.list[0] === 'list' && out.list[1].length === 3, out.list);
  check('arreglo: letra pequeña en móvil', out.fsm >= 14, out.fsm);
  check('arreglo: contraste >= 4,5', out.color[1] >= 4.5, out.color);
  check('arreglo: texto alternativo con IA', out.alt[1] === 1 && /Voluntarios/.test(out.alt[0]), out.alt);
  check('arreglo: enlace en ventana nueva', /ventana nueva/.test(out.newwin), out.newwin);
  check('menos avisos tras arreglar', out.after[0] < out.start[0] && Number(out.after[1]) > Number(out.start[1]), [out.start, out.after]);
  check('diálogo al publicar con errores', /errores/.test(out.dlg) && out.dlgBtns.length === 2, out.dlg);
  check('«Revisar» no publica; «Publicar igualmente» sí', out.publishedAfterRevisar === 0 && out.publishedAfterIgual === 1);
  check('con el aviso desactivado solo hay confirmación normal', /Continuar/.test(out.dlgOff), out.dlgOff);
  check('ajuste a11yWarn marcado', out.setChecked === true);
  check('sin errores de página', errs.length === 0, errs);
  check.done();
  } finally { await b.close(); }
});
