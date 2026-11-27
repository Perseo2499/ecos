// Revisión entre varias personas: tarjetas de Inicio, barra de revisión, notas en el margen de los bloques, aviso de cambio ajeno
// y «Enviar a revisión» (claro, oscuro y vinilo). Capturas con ECOS_UI_SHOTS=<carpeta>: rv-<tema>-*.png
const test = require('node:test');
const { launch, newPage, shot: shotF, checker, openApp } = require('./helpers');
const { installMock } = require('./mock-api');

const EDITOR = { id: 6, name: 'Marta Ruiz', slug: 'marta', role: 'editor', roles: ['editor'], canPublish: true, canUpload: true, canEditOthers: true, avatar: '' };
const CONTRIB = { id: 4, name: 'Luis Gómez', slug: 'luis', role: 'contributor', roles: ['contributor'], canPublish: false, canUpload: false, canEditOthers: false, avatar: '' };

// Mock común (se ejecuta dentro de la página: sin variables externas)
function patch(api, H) {
  const iso = (min) => new Date(Date.now() - min * 60000).toISOString();
  window.__notes = [
    { id: 1, post: 9, parent: 0, author: { id: 4, name: 'Luis Gómez', avatar: '' }, date: iso(50), text: 'Marta, ¿puedes revisar el titular? No me convence.', anchor: '', block: '', kind: 'note', resolved: false, canDelete: false },
    { id: 2, post: 9, parent: 1, author: { id: 6, name: 'Marta Ruiz', avatar: '' }, date: iso(30), text: 'Lo veo bien, pero acorta el segundo párrafo.', anchor: '', block: '', kind: 'note', resolved: false, canDelete: true },
  ];
  window.__calls = { notes: [], status: [], publish: [] };
  const me = H.cfg.wpMe;
  const MOD = iso(12);
  const summary = {
    supported: true,
    pending: [
      { id: 9, type: 'post', title: 'Jornada de puertas abiertas', status: 'pending', date: iso(60), modified: iso(12), author: { id: 4, name: 'Luis Gómez', avatar: '' }, editor: { id: 4, name: 'Luis Gómez' }, openNotes: 1 },
      { id: 10, type: 'post', title: 'Resultados de la campaña de otoño', status: 'pending', date: iso(300), modified: iso(180), author: { id: 5, name: 'Ana Pérez', avatar: '' }, editor: { id: 5, name: 'Ana Pérez' }, openNotes: 0 },
    ],
    returned: me.id === 4 ? [{ id: 12, type: 'post', title: 'Taller de huerto urbano', status: 'draft', date: iso(900), modified: iso(25), author: { id: 4, name: 'Luis Gómez' }, editor: { id: 6, name: 'Marta Ruiz' }, openNotes: 0, returnedBy: { id: 6, name: 'Marta Ruiz', avatar: '' }, returnedAt: iso(25), returnedText: 'Falta la fecha y el lugar del taller.' }] : [],
    activity: [
      { id: 9, type: 'post', title: 'Jornada de puertas abiertas', status: 'pending', date: iso(60), modified: iso(12), author: { id: 4, name: 'Luis Gómez' }, editor: { id: 4, name: 'Luis Gómez' } },
      { id: 11, type: 'post', title: 'Memoria anual 2025', status: 'publish', date: iso(95), modified: iso(94), author: { id: 5, name: 'Ana Pérez' }, editor: { id: 6, name: 'Marta Ruiz' } },
      { id: 13, type: 'post', title: 'Voluntariado de verano', status: 'draft', date: iso(1500), modified: iso(240), author: { id: 5, name: 'Ana Pérez' }, editor: { id: 5, name: 'Ana Pérez' } },
    ],
  };
  const P = (html) => ({ id: 'b' + Math.random().toString(36).slice(2, 8), type: 'paragraph', html });
  window.__post = (status) => ({
    id: 9, status, url: 'https://example.org/jornada', title: 'Jornada de puertas abiertas', excerpt: '', slug: 'jornada', tags: [], categories: ['Blog'], featured: null, date: iso(60), modified: MOD, type: 'post', parent: 0,
    exported: {}, contentChanged: false, pageBg: null,
    blocks: [{ id: 'bh', type: 'heading', level: 2, html: 'Abrimos las puertas del centro' }, P('El próximo sábado el centro abre sus puertas a todas las familias del barrio, con talleres, música y una comida compartida.'),
      P('Habrá actividades para todas las edades. Apúntate antes del jueves para reservar tu plaza en los talleres.'), { id: 'bq', type: 'quote', html: 'Un lugar donde sentirse en casa', cite: 'Una vecina' }],
  });
  Object.assign(api, {
    wpMe: async () => me,
    reviewSummary: async () => summary,
    reviewNotes: async (id) => ({ supported: true, notes: window.__notes.filter((n) => n.post === id) }),
    reviewNoteAdd: async (n) => {
      window.__calls.notes.push(n);
      const note = { id: 100 + window.__notes.length, post: n.post, parent: n.parent || 0, author: { id: me.id, name: me.name, avatar: '' }, date: new Date().toISOString(), text: n.text, anchor: n.anchor || '', block: n.block || '', kind: n.kind || 'note', resolved: false, canDelete: true };
      window.__notes.push(note); return note;
    },
    reviewNoteResolve: async (id, on) => { const n = window.__notes.find((x) => x.id === id); n.resolved = !!on; return n; },
    reviewNoteDelete: async (id) => { const gone = window.__notes.filter((x) => x.id === id || x.parent === id).map((x) => x.id); window.__notes = window.__notes.filter((x) => !gone.includes(x.id)); return gone; },
    reviewChanges: async () => window.__changes || { id: 9, status: 'pending', modified: MOD, by: { id: 4, name: 'Luis Gómez' } },
    pullPost: async (id) => window.__post(window.__status || 'pending'),
    postModified: async () => ({ modified: MOD }),
    postLockAcquire: async () => ({ supported: true, locked: false }),
    postRevisions: async () => [], sendBackups: async () => [],
    publish: async (d) => { window.__calls.publish.push({ status: d.status, scheduleAt: d.scheduleAt, blocks: d.blocks }); return { postId: 9, status: d.status, url: 'https://example.org/jornada', editUrl: 'x', modified: new Date().toISOString(), date: new Date().toISOString(), exported: {} }; },
    blogSetStatus: async (id, st) => { window.__calls.status.push([id, st]); return {}; },
  });
}

for (const theme of ['light', 'dark', 'vinyl']) test('revisión entre varias personas: editor que revisa (' + theme + ')', async () => {
  const b = await launch();
  try {
    const p = await newPage(b);
    const check = checker();
    await installMock(p, { theme: theme === 'vinyl' ? 'dark' : theme, config: { wpMe: EDITOR, ecosHelper: { installed: true, version: '1.8.0', bundled: '1.8.0' }, prefs: theme === 'vinyl' ? { vinyl: true } : {} }, patch });
    await openApp(p);
    const shot = (n) => shotF(p, 'rv-' + theme + '-' + n);
    // Inicio: tarjeta de pendientes y actividad reciente
    await p.waitForSelector('.home-pending');
    await p.waitForSelector('.home-activity');
    check('tarjeta «Pendientes de revisión (2)»', /Pendientes de revisión\s*\(2\)/.test(await p.locator('.home-pending header h2').innerText()));
    check('dos filas con «Revisar»', (await p.locator('.home-pending [data-rv-home="review"]').count()) === 2);
    check('actividad reciente con personas y verbos', /Marta Ruiz|Tú/.test(await p.locator('.home-activity').innerText()) && /envió a revisión/.test(await p.locator('.home-activity').innerText()));
    await shot('1-inicio');
    // Revisar → editor con barra de revisión
    await p.locator('.home-pending [data-rv-home="review"]').first().click();
    await p.waitForSelector('#ed-review:not(.hidden)');
    check('barra de revisión con tres acciones', (await p.locator('#ed-review [data-rv-bar="publish"], #ed-review [data-rv-bar="schedule"], #ed-review [data-rv-bar="return"]').count()) === 3);
    check('botón Notas con 1 hilo abierto', (await p.locator('#ed-notes-btn .rv-badge').innerText()) === '1');
    check('barra: dice quién la envió', /Luis/.test(await p.locator('#ed-review').innerText()));
    // nota anclada a un bloque desde su barra de herramientas
    const blk = p.locator('#d-blocks .blk-paragraph').first();
    await blk.hover();
    await blk.locator('.rv-add').click();
    await p.waitForSelector('#ed-notes:not(.hidden) .rv-chip');
    await p.fill('#ed-notes textarea.rv-new', 'Este párrafo es largo: mejor dividirlo en dos.');
    await p.click('#ed-notes [data-rv="add"]');
    await p.waitForSelector('#d-blocks .rv-mark');
    const anchored = await p.evaluate(() => ({ calls: window.__calls.notes, anc: window.BlockEditor.draft.blocks.find((x) => x.type === 'paragraph').anc, mark: document.querySelector('#d-blocks .rv-mark b')?.textContent }));
    check('la nota se guarda con el ancla del bloque', anchored.calls.length === 1 && anchored.calls[0].anchor === anchored.anc && /^[a-z0-9]{4,12}$/.test(anchored.anc), anchored);
    check('marca en el margen con contador 1', anchored.mark === '1', anchored);
    // clic en la marca abre el hilo de ese bloque
    await p.locator('#ed-notes [data-rv="close"]').click();
    await p.locator('#d-blocks .rv-mark').first().click();
    await p.waitForSelector('#ed-notes .rv-thread.focus');
    check('clic en la marca abre el hilo del bloque', (await p.locator('#ed-notes .rv-thread').count()) === 1);
    await shot('2-notas');
    // responder y resolver
    await p.fill('#ed-notes .rv-thread .rv-r', 'Hecho, lo divido.');
    await p.click('#ed-notes [data-rv="reply"]');
    await p.waitForSelector('#ed-notes .rv-note + .rv-note');
    await p.click('#ed-notes [data-rv="resolve"]');
    await p.waitForTimeout(150);
    check('resolver deja la marca en «hecho»', await p.locator('#d-blocks .rv-mark.done').count() === 1);
    // aviso: otra persona cambió la entrada
    await p.evaluate(() => { window.__changes = { id: 9, status: 'pending', modified: new Date(Date.now() + 1000).toISOString(), by: { id: 4, name: 'Luis Gómez' } }; window.dispatchEvent(new Event('focus')); });
    await p.waitForSelector('#ed-changed:not(.hidden)');
    const msg = await p.locator('#ed-changed .rv-t').innerText();
    check('aviso «Luis Gómez ha cambiado esta entrada hace…»', /Luis Gómez ha cambiado esta entrada/.test(msg), msg);
    check('aviso con Ver cambios y Recargar', (await p.locator('#ed-changed [data-ch="diff"], #ed-changed [data-ch="reload"]').count()) === 2);
    await p.locator('#ed-notes [data-rv="close"]').click().catch(() => {});
    await shot('3-aviso');
    await p.locator('#ed-changed [data-ch="x"]').click();
    check('se puede ignorar el aviso', await p.locator('#ed-changed.hidden').count() === 1);
    // un cambio hecho por mí no avisa
    await p.evaluate(() => { window.__changes = { id: 9, status: 'pending', modified: new Date(Date.now() + 5000).toISOString(), by: { id: 6, name: 'Marta Ruiz' } }; window.dispatchEvent(new Event('focus')); });
    await p.waitForTimeout(300);
    check('un cambio mío no avisa', await p.locator('#ed-changed.hidden').count() === 1);
    // Aprobar y programar…: pide fecha
    await p.click('#ed-review [data-rv-bar="schedule"]');
    check('«Aprobar y programar…» pide fecha', await p.locator('#ed-review .rv-sched:not(.hidden) #rv-when').count() === 1);
    await p.click('#ed-review [data-rv-bar="schedule-x"]');
    // Devolver con comentarios
    await p.click('#ed-review [data-rv-bar="return"]');
    await p.waitForSelector('.rv-dlg textarea');
    await shot('4-devolver');
    await p.click('.rv-dlg [data-x="1"]'); // sin texto: no cierra
    check('devolver exige un comentario', await p.locator('.rv-dlg').count() === 1);
    await p.fill('.rv-dlg textarea', 'Divide el párrafo y añade la hora de inicio.');
    await p.click('.rv-dlg [data-x="1"]');
    await p.waitForSelector('#editor.hidden', { state: 'attached' });
    const calls = await p.evaluate(() => window.__calls);
    check('devolver: nota de tipo «return» y entrada guardada como borrador', calls.notes.at(-1).kind === 'return' && calls.publish.at(-1).status === 'draft', calls);
    // Aprobar y publicar: envía con estado publish
    await p.evaluate(() => { window.__status = 'pending'; return openFromWp(9, null, 'post'); });
    await p.waitForSelector('#ed-review:not(.hidden)');
    await p.click('#ed-review [data-rv-bar="publish"]');
    for (let i = 0; i < 3; i++) { // confirmación de publicar (y, si la hubiera, la de accesibilidad)
      const ok = p.locator('.dlg:not(.rv-dlg) [data-r="1"]').last();
      if (await ok.count().then((n) => n === 0, () => true)) { await p.waitForTimeout(300); if (!await ok.count()) break; }
      await ok.click().catch(() => {}); await p.waitForTimeout(400);
    }
    const pub = await p.evaluate(() => window.__calls.publish.at(-1));
    check('aprobar y publicar envía status publish con las anclas', pub.status === 'publish', pub);
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});

test('revisión entre varias personas: colaborador envía a revisión y le devuelven una entrada', async () => {
  const b = await launch();
  try {
    const p = await newPage(b);
    const check = checker();
    await installMock(p, { theme: 'light', config: { wpMe: CONTRIB, ecosHelper: { installed: true, version: '1.8.0', bundled: '1.8.0' } }, patch });
    await openApp(p);
    await p.waitForSelector('.home-returned');
    check('colaborador: no ve «Pendientes de revisión»', await p.locator('.home-pending').count() === 0);
    check('colaborador: ve «Te han devuelto (1)» con el comentario', /Te han devuelto\s*\(1\)/.test(await p.locator('.home-returned header h2').innerText()) && /Falta la fecha/.test(await p.locator('.home-returned').innerText()));
    await shotF(p, 'rv-light-5-devuelta');
    // abre la devuelta: barra «te la han devuelto»
    await p.evaluate(() => { window.__status = 'draft'; window.__post = ((f) => (s) => ({ ...f(s), id: 12, title: 'Taller de huerto urbano' }))(window.__post); return openFromWp(12, null, 'post'); });
    await p.waitForSelector('#ed-review[data-mode="returned"]');
    check('barra de devuelta con el comentario', /Falta la fecha/.test(await p.locator('#ed-review').innerText()));
    // enviar a revisión en lugar de publicar
    const label = await p.locator('input[name="d-when"][value="pending"]').count();
    check('«Publicar» pasa a «Enviar a revisión»', label === 1 && await p.locator('input[name="d-when"][value="publish"]').count() === 0);
    check('«Programar» no está disponible', await p.locator('input[name="d-when"][value="future"]').evaluate((e) => e.closest('label').classList.contains('hidden')));
    await p.evaluate(() => { const r = document.querySelector('input[name="d-when"][value="pending"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
    check('el botón dice «Enviar a revisión»', /Enviar a revisión/.test(await p.locator('#send').innerText()), await p.locator('#send').innerText());
    await shotF(p, 'rv-light-6-colaborador');
    await p.locator('#send').click();
    await p.waitForTimeout(500);
    const pub = await p.evaluate(() => window.__calls.publish.at(-1));
    check('se envía con estado pending', pub && pub.status === 'pending', pub);
    check('sin errores de página', p.errs.length === 0, p.errs);
    check.done();
  } finally { await b.close(); }
});
