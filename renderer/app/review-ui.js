// Ecos · Revisión entre varias personas: barra de revisión («Aprobar y publicar», «Devolver con comentarios»), notas internas
// (de la entrada y ancladas a un bloque, con marca en el margen), aviso de «alguien ha cambiado esta entrada», y en Inicio las
// tarjetas «Pendientes de revisión», «Te han devuelto» y «Actividad reciente». Sigue a app/editor-multi.js y comparte su ámbito global.
// La lógica pura está en editorial.js; las notas las guarda el Complemento de Ecos (≥ 1.8.0) como comentarios privados «ecos_note».
const EDT = window.Editorial;
const ReviewUI = (() => {
  const rv = { postId: 0, supported: null, notes: [], built: EDT.buildThreads([]), panel: false, filter: 'open', focusAnchor: '', compose: null, dismissed: '', timer: 0, summary: null, prev: null };
  const selfOk = () => (CFG.wpMode || 'selfhosted') === 'selfhosted' && !!CFG.wpConnected;
  const me = () => (selfOk() ? CFG.wpMe || null : null);
  const editorOpen = () => !$('#editor').classList.contains('hidden');
  const curStatus = () => (typeof wpSt !== 'undefined' && wpSt) || draft?.wpStatus || '';
  const ago = (iso) => {
    const a = EDT.agoParts(iso);
    return a.unit === 'now' ? t('hace un momento') : a.unit === 'min' ? t('hace {n} min', { n: a.n }) : a.unit === 'h' ? t('hace {n} h', { n: a.n }) : t('hace {n} d', { n: a.n });
  };
  const person = (a, cls = '') => (a && a.name ? authorHtml(a, cls) : '');
  const when = (iso) => (iso ? new Date(iso).toLocaleString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

  // ---------------------------------------------------------------- Notas: carga y estado
  async function loadNotes() {
    if (!rv.postId) return;
    const id = rv.postId;
    try {
      const r = await window.api.reviewNotes(id);
      if (id !== rv.postId) return;
      rv.supported = !!r?.supported;
      rv.notes = r?.notes || [];
    } catch { rv.supported = rv.supported ?? false; }
    rebuild();
  }
  function anchorSet() { return new Set(EDT.collectAnchors(draft?.blocks || []).keys()); }
  function rebuild() {
    rv.built = EDT.buildThreads(rv.notes);
    const btn = $('#ed-notes-btn');
    btn.classList.toggle('hidden', !(rv.postId && rv.supported));
    btn.classList.toggle('active', rv.panel);
    btn.setAttribute('aria-pressed', String(rv.panel));
    let badge = $('.rv-badge', btn);
    if (rv.built.open) { if (!badge) { badge = document.createElement('i'); badge.className = 'rv-badge'; btn.appendChild(badge); } badge.textContent = String(rv.built.open); } else badge?.remove();
    if (rv.panel) renderPanel();
    decorate();
    renderBar();
  }

  // ---------------------------------------------------------------- Marcas en el margen de los bloques
  function decorate() {
    const wrap = $('#d-blocks');
    if (!wrap || !rv.postId || !rv.supported) { $$('.rv-mark, .rv-add', wrap || document).forEach((x) => x.remove()); return; }
    EDT.dedupeAnchors(draft?.blocks || []); // un bloque duplicado no se queda con el ancla del original
    for (const el of $$('.blk[data-id]', wrap)) {
      const b = window.BlockEditor.locate(el.dataset.id)?.b;
      if (!b) continue;
      const m = b.anc ? EDT.markCount(rv.built, b.anc) : { open: 0, total: 0 };
      let mark = $(':scope > .rv-mark', el);
      if (m.total) {
        const txt = m.open ? String(m.open) : '✓';
        if (!mark) { mark = document.createElement('button'); mark.className = 'rv-mark'; mark.type = 'button'; el.appendChild(mark); mark.innerHTML = '<span class="ms fill">chat_bubble</span><b></b>'; mark.onclick = (e) => { e.stopPropagation(); openPanel({ anchor: b.anc }); }; }
        const label = t('{n} notas en este bloque', { n: m.total });
        if ($('b', mark).textContent !== txt) $('b', mark).textContent = txt;
        mark.classList.toggle('done', !m.open);
        if (mark.title !== label) { mark.title = label; mark.setAttribute('aria-label', label); }
      } else mark?.remove();
      const tools = $(':scope > .blk-tools', el);
      if (tools && !$('.rv-add', tools)) {
        const add = document.createElement('button');
        add.className = 'rv-add'; add.type = 'button'; add.title = t('Añadir nota a este bloque'); add.innerHTML = '<span class="ms">add_comment</span>';
        add.onclick = (e) => { e.stopPropagation(); openPanel({ compose: { blockId: b.id } }); };
        tools.insertBefore(add, $('[data-a="del"]', tools) || null);
      }
    }
  }
  new MutationObserver(() => { if (rv.postId && rv.supported) requestAnimationFrame(decorate); }).observe($('#d-blocks'), { childList: true, subtree: true });

  // ---------------------------------------------------------------- Panel de notas
  function openPanel(opt = {}) {
    if (!rv.supported) return toast(t('Las notas necesitan el Complemento de Ecos 1.8.0 o posterior (Conexiones → Complemento).'), true);
    if ($('#ed-layers') && !$('#ed-layers').classList.contains('hidden')) $('#ed-layers-btn')?.click();
    rv.panel = true;
    rv.focusAnchor = opt.anchor || '';
    if (opt.anchor) rv.filter = 'all';
    rv.compose = opt.compose || null;
    renderPanel();
    rebuild();
    if (rv.compose || !rv.built.threads.length) $('#ed-notes textarea.rv-new')?.focus();
  }
  function closePanel() { rv.panel = false; rv.focusAnchor = ''; rv.compose = null; $('#ed-notes')?.classList.add('hidden'); $('#ed-notes-btn')?.classList.remove('active'); $('#ed-notes-btn')?.setAttribute('aria-pressed', 'false'); }
  function blockExcerpt(b) {
    const raw = b?.html ?? b?.text ?? b?.caption ?? (b?.items ? b.items.map((x) => (typeof x === 'string' ? x : x?.html || x?.text || '')).join(' ') : '') ?? '';
    const s = decodeEntities(String(raw).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    return s ? (s.length > 48 ? s.slice(0, 47) + '…' : s) : (b?.type || '');
  }
  function goToBlock(anc) {
    const b = EDT.collectAnchors(draft.blocks).get(anc);
    const el = b && $(`#d-blocks .blk[data-id="${CSS.escape(b.id)}"]`);
    if (!el) return toast(t('Ese bloque ya no está en la entrada, o la nota se anclará al enviar.'), true);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
  function noteHtml(n, isRoot) {
    const del = n.canDelete ? `<button class="rv-x" data-rv="del" data-id="${n.id}" title="${escHtml(t('Borrar'))}"><span class="ms">delete</span></button>` : '';
    return `<div class="rv-note${n.kind === 'return' ? ' ret' : ''}" data-id="${n.id}">
      <div class="rv-nh">${person(n.author)}<span class="rv-when" title="${escHtml(when(n.date))}">${escHtml(ago(n.date))}</span>${n.kind === 'return' ? `<span class="rv-tag"><span class="ms">undo</span>${t('Devuelta')}</span>` : ''}<span class="spacer"></span>${del}</div>
      <p class="rv-txt"></p></div>`;
  }
  function renderPanel() {
    let box = $('#ed-notes');
    if (!box) {
      box = document.createElement('aside');
      box.id = 'ed-notes'; box.className = 'ed-notes hidden'; box.setAttribute('aria-label', t('Notas de revisión'));
      $('.ed-body').appendChild(box);
      box.addEventListener('click', onPanelClick);
    }
    box.classList.toggle('hidden', !rv.panel);
    if (!rv.panel) return;
    const anchors = anchorSet();
    const all = rv.built.threads;
    const list = rv.focusAnchor ? all.filter((th) => th.anchor === rv.focusAnchor) : all.filter((th) => rv.filter === 'all' || !th.resolved);
    const nResolved = all.filter((th) => th.resolved).length;
    const comp = rv.compose;
    const cb = comp?.blockId ? window.BlockEditor.locate(comp.blockId)?.b : null;
    const prevText = $('textarea.rv-new', box)?.value || '';
    box.innerHTML = `<div class="ly-head"><span class="ms fill">forum</span><b>${t('Notas de revisión')}</b><span class="hint">${t('Solo las ve tu equipo')}</span><span class="spacer"></span><button class="btn text icon-only" data-rv="close" title="${escHtml(t('Cerrar'))}"><span class="ms">close</span></button></div>
      <div class="rv-filter" role="group">
        <button data-rv="f" data-f="open" class="${!rv.focusAnchor && rv.filter === 'open' ? 'on' : ''}">${t('Abiertas')}</button>
        <button data-rv="f" data-f="all" class="${!rv.focusAnchor && rv.filter === 'all' ? 'on' : ''}">${t('Todas')}${nResolved ? ` (${all.length})` : ''}</button>
        ${rv.focusAnchor ? `<button data-rv="f" data-f="all" class="on"><span class="ms">filter_alt</span>${t('Este bloque')} ✕</button>` : ''}</div>
      <div class="rv-list"></div>
      <div class="rv-compose">
        ${cb ? `<div class="rv-chip"><span class="ms">chat_bubble</span><span class="rv-chip-t"></span><button data-rv="unanchor" title="${escHtml(t('Quitar el bloque: nota general'))}"><span class="ms">close</span></button></div>` : ''}
        <textarea class="rv-new" rows="2" placeholder="${escHtml(cb ? t('Escribe una nota sobre este bloque…') : t('Escribe una nota para tu equipo…'))}" aria-label="${escHtml(t('Nueva nota'))}"></textarea>
        <div class="rv-compose-a"><span class="hint">${t('Pulsa el icono de nota de un bloque para anclarla a él.')}</span><span class="spacer"></span><button class="btn filled small" data-rv="add"><span class="ms">send</span>${t('Añadir nota')}</button></div>
      </div>`;
    if (cb) $('.rv-chip-t', box).textContent = blockExcerpt(cb);
    const ta = $('textarea.rv-new', box); ta.value = prevText;
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('[data-rv="add"]', box).click(); } });
    const L = $('.rv-list', box);
    if (!list.length) L.innerHTML = `<div class="home-empty"><span class="ms">forum</span><span>${rv.focusAnchor ? t('Este bloque no tiene notas.') : rv.filter === 'open' && nResolved ? t('No quedan notas abiertas.') : t('Todavía no hay notas.')}</span></div>`;
    for (const th of list) {
      const found = !th.anchor || anchors.has(th.anchor);
      const card = document.createElement('section');
      card.className = 'rv-thread' + (th.resolved ? ' done' : '') + (rv.focusAnchor && th.anchor === rv.focusAnchor ? ' focus' : '');
      card.dataset.id = th.id;
      const target = th.anchor ? `<button class="rv-anchor${found ? '' : ' gone'}" data-rv="go" data-anc="${escHtml(th.anchor)}"><span class="ms">${found ? 'my_location' : 'link_off'}</span><span class="rv-at"></span></button>` : '';
      card.innerHTML = `${target}${noteHtml(th.root, true)}${th.replies.map((r) => noteHtml(r, false)).join('')}
        <div class="rv-reply"><input type="text" class="rv-r" placeholder="${escHtml(t('Responder…'))}" aria-label="${escHtml(t('Responder'))}"><button class="btn text small" data-rv="reply" data-id="${th.id}">${t('Responder')}</button>
        <button class="btn text small" data-rv="resolve" data-id="${th.id}"><span class="ms">${th.resolved ? 'undo' : 'task_alt'}</span>${th.resolved ? t('Reabrir') : t('Resolver')}</button></div>`;
      const texts = [th.root, ...th.replies];
      $$('.rv-txt', card).forEach((p, i) => { p.textContent = texts[i].text; });
      if (th.anchor) {
        const blk = EDT.collectAnchors(draft.blocks).get(th.anchor);
        $('.rv-at', card).textContent = found ? t('Bloque: {x}', { x: blockExcerpt(blk) }) : t('Bloque no encontrado (se borró o aún no se ha enviado)');
      }
      const inp = $('.rv-r', card);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-rv="reply"]', card).click(); } });
      L.appendChild(card);
    }
  }
  async function onPanelClick(e) {
    const b = e.target.closest('[data-rv]');
    if (!b) return;
    const a = b.dataset.rv, box = $('#ed-notes');
    if (a === 'close') return closePanel();
    if (a === 'f') { rv.filter = b.dataset.f; rv.focusAnchor = ''; return renderPanel(); }
    if (a === 'go') return goToBlock(b.dataset.anc);
    if (a === 'unanchor') { rv.compose = null; return renderPanel(); }
    try {
      if (a === 'add') {
        const ta = $('textarea.rv-new', box), text = ta.value.trim();
        if (!text) return ta.focus();
        let body = { post: rv.postId, text };
        const bid = rv.compose?.blockId, blk = bid ? window.BlockEditor.locate(bid)?.b : null;
        if (blk) {
          // el ancla es una clase del bloque (ecos-a-<id>): se guarda con la entrada al enviar
          const had = !!blk.anc;
          if (!had) window.BlockEditor.changeBlock(bid, () => { EDT.ensureAnchor(blk, draft.blocks); });
          body = { ...body, anchor: blk.anc, block: blk.id };
          if (!had) toast(t('Nota anclada. El ancla se guarda en la entrada al enviarla.'));
        }
        await busy(b, async () => { const n = await window.api.reviewNoteAdd(body); rv.notes.push(n); });
        rv.compose = null; ta.value = '';
        rebuild();
      } else if (a === 'reply') {
        const inp = $('.rv-r', b.closest('.rv-thread')), text = inp.value.trim();
        if (!text) return inp.focus();
        await busy(b, async () => { const n = await window.api.reviewNoteAdd({ post: rv.postId, text, parent: Number(b.dataset.id) }); rv.notes.push(n); });
        rebuild();
      } else if (a === 'resolve') {
        const th = rv.built.threads.find((x) => x.id === Number(b.dataset.id));
        await busy(b, async () => { const n = await window.api.reviewNoteResolve(th.id, !th.resolved); const i = rv.notes.findIndex((x) => x.id === n.id); if (i >= 0) rv.notes[i] = n; });
        rebuild();
      } else if (a === 'del') {
        if (!await ask(t('¿Borrar esta nota? Si tiene respuestas, también se borran.'), { danger: true, ok: t('Borrar') })) return;
        const gone = await window.api.reviewNoteDelete(Number(b.dataset.id));
        rv.notes = rv.notes.filter((n) => !gone.includes(n.id));
        rebuild();
      }
    } catch (err) { toastError(err); }
  }
  $('#ed-notes-btn').onclick = () => (rv.panel ? (closePanel(), rebuild()) : openPanel());

  // ---------------------------------------------------------------- Barra de revisión
  function setWhen(v) { const r = $(`input[name="d-when"][value="${v}"]`); if (r) { r.checked = true; toggleSchedule(); } }
  const reviewEntry = () => (rv.summary?.pending || []).find((x) => x.id === rv.postId) || null;
  const returnedEntry = () => (rv.summary?.returned || []).find((x) => x.id === rv.postId) || null;
  function renderBar() {
    const bar = $('#ed-review');
    const st = curStatus(), m = me();
    let mode = '';
    if (rv.postId && selfOk() && !draft?.previewOnly) {
      if (st === 'pending' && EDT.canReview(m)) mode = 'review';
      else if (st === 'pending') mode = 'waiting';
      else if (st === 'draft' && returnedEntry()) mode = 'returned';
    }
    bar.dataset.mode = mode;
    bar.classList.toggle('hidden', !mode);
    if (!mode) { bar.innerHTML = ''; return; }
    const pend = reviewEntry(), ret = returnedEntry();
    const open = rv.built.open;
    const notes = rv.supported ? `<button class="btn text small" data-rv-bar="notes"><span class="ms">forum</span>${open ? (open === 1 ? t('1 nota abierta') : t('{n} notas abiertas', { n: open })) : t('Notas')}</button>` : '';
    if (mode === 'review') {
      bar.innerHTML = `<span class="ms fill rv-ic">rate_review</span><span class="rv-t"><b>${t('Pendiente de revisión')}</b><span class="rv-by"></span></span>
        <span class="rv-a">${notes}<button class="btn text small" data-rv-bar="return"><span class="ms">undo</span>${t('Devolver con comentarios')}</button>
        <button class="btn tonal small" data-rv-bar="schedule"><span class="ms">schedule</span>${t('Aprobar y programar…')}</button>
        <button class="btn filled small" data-rv-bar="publish"><span class="ms">check_circle</span>${t('Aprobar y publicar')}</button></span>
        <span class="rv-sched hidden"><input type="datetime-local" id="rv-when" aria-label="${escHtml(t('Fecha y hora de publicación'))}"><button class="btn filled small" data-rv-bar="schedule-ok">${t('Programar')}</button><button class="btn text small" data-rv-bar="schedule-x">${t('Cancelar')}</button></span>`;
      const by = $('.rv-by', bar); if (pend?.author?.name) by.innerHTML = ' · ' + t('de') + ' ' + person(pend.author);
    } else if (mode === 'waiting') {
      bar.innerHTML = `<span class="ms fill rv-ic">hourglass_top</span><span class="rv-t"><b>${t('Enviada a revisión')}</b> · ${t('esperando a que alguien con permiso la publique.')}</span><span class="rv-a">${notes}</span>`;
    } else {
      bar.innerHTML = `<span class="ms fill rv-ic">undo</span><span class="rv-t"><b>${t('Te la han devuelto con comentarios')}</b>${ret.returnedBy?.name ? ' · ' + escHtml(ret.returnedBy.name) : ''}${ret.returnedText ? `<span class="rv-quote"></span>` : ''}</span><span class="rv-a">${notes}</span>`;
      if (ret.returnedText) $('.rv-quote', bar).textContent = '«' + ret.returnedText + '»';
    }
  }
  $('#ed-review').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rv-bar]');
    if (!b) return;
    const a = b.dataset.rvBar;
    if (a === 'notes') return openPanel();
    if (a === 'publish') { setWhen('publish'); return $('#send').click(); }
    if (a === 'schedule') { $('#ed-review .rv-sched').classList.remove('hidden'); const i = $('#rv-when'); if (!i.value) { const d = new Date(Date.now() + 86400000); d.setMinutes(0, 0, 0); i.value = calLocalInput ? calLocalInput(d) : d.toISOString().slice(0, 16); } return i.focus(); }
    if (a === 'schedule-x') return $('#ed-review .rv-sched').classList.add('hidden');
    if (a === 'schedule-ok') {
      const v = $('#rv-when').value, tr = EDT.transition('pending', 'approveSchedule', me(), { date: v });
      if (!tr.ok) return toast(tr.reason === 'past' ? t('Elige una fecha futura para programarla.') : t('Elige la fecha y hora de publicación.'), true);
      setWhen('future'); $('#d-schedule').value = v; return $('#send').click();
    }
    if (a === 'return') return busy(b, returnWithComments);
  });
  // «Devolver con comentarios»: se pide el motivo, se guarda la versión del editor como borrador y se deja la nota para quien la envió
  function askReason() {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const d = document.createElement('div');
      d.className = 'dlg-scrim';
      d.innerHTML = `<div class="dlg multi-dlg rv-dlg" role="dialog" aria-modal="true" aria-label="${escHtml(t('Devolver con comentarios'))}"><span class="ms fill dlg-ic">undo</span>
        <p class="dlg-msg">${t('Devolver con comentarios')}</p><p class="dlg-sub hint">${t('La entrada vuelve a borrador y quien la envió verá tu comentario.')}</p>
        <textarea class="rv-new" rows="4" placeholder="${escHtml(t('Qué hay que cambiar…'))}"></textarea>
        <div class="dlg-actions"><button class="btn text" data-x="0">${t('Cancelar')}</button><button class="btn filled" data-x="1"><span class="ms">undo</span>${t('Devolver')}</button></div></div>`;
      const ta = $('textarea', d);
      const close = (v) => { d.classList.add('out'); setTimeout(() => d.remove(), 160); document.removeEventListener('keydown', key, true); prev?.focus?.(); resolve(v); };
      const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } };
      $$('[data-x]', d).forEach((b) => (b.onclick = () => { if (b.dataset.x === '1') { if (!ta.value.trim()) return ta.focus(); close(ta.value.trim()); } else close(null); }));
      d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
      document.addEventListener('keydown', key, true);
      document.body.appendChild(d); ta.focus();
    });
  }
  async function returnWithComments() {
    const text = await askReason();
    if (!text) return;
    const id = rv.postId;
    // 1) la nota (con permiso de revisión) 2) la versión del editor, con las anclas, como borrador
    const n = await window.api.reviewNoteAdd({ post: id, text, kind: 'return' });
    EDT.dedupeAnchors(draft.blocks);
    const res = await window.api.publish(draftPayload('draft'));
    if (res?.queued) { toast(t('No se ha podido enviar ahora: queda en la cola y se reintentará solo.'), true); return; }
    draft.wpModified = res?.modified || draft.wpModified; draftDirty = false;
    rv.notes.push(n);
    renderWpState('draft', res?.url);
    rv.summary = null; blog.loaded = false;
    toast(t('Devuelta con comentarios. Quien la envió verá tu nota.'));
    $('#ed-close').click();
    ReviewUI.refreshHome?.();
  }

  // ---------------------------------------------------------------- Aviso: otra persona ha cambiado la entrada
  async function checkChanged() {
    const box = $('#ed-changed');
    if (!rv.postId || !editorOpen() || draft?.previewOnly || !selfOk()) return box.classList.add('hidden');
    let cur = null;
    try { cur = await window.api.reviewChanges(rv.postId, draft.type); } catch { return; }
    if (!editorOpen() || !cur) return;
    const fc = EDT.foreignChange({ opened: draft.wpModified, cur, meId: me()?.id, dismissed: rv.dismissed });
    if (!fc) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    box.innerHTML = `<span class="ms fill">group</span><span class="rv-t"></span><span class="rv-a"><button class="btn text small" data-ch="diff"><span class="ms">compare_arrows</span>${t('Ver cambios')}</button><button class="btn tonal small" data-ch="reload"><span class="ms">sync</span>${t('Recargar')}</button><button class="btn text icon-only small" data-ch="x" title="${escHtml(t('Ignorar'))}"><span class="ms">close</span></button></span>`;
    $('.rv-t', box).textContent = t('{n} ha cambiado esta entrada {w}', { n: fc.who || t('Alguien'), w: ago(fc.at) });
    box.dataset.at = fc.at;
  }
  $('#ed-changed').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch]');
    if (!b) return;
    if (b.dataset.ch === 'diff') return openHistory();
    if (b.dataset.ch === 'reload') return $('#ed-pull').click();
    rv.dismissed = $('#ed-changed').dataset.at || ''; $('#ed-changed').classList.add('hidden');
  });
  function startWatch() {
    clearInterval(rv.timer);
    rv.timer = setInterval(() => { if (!editorOpen()) { clearInterval(rv.timer); return; } checkChanged(); }, 60000);
    checkChanged();
  }
  window.addEventListener('focus', () => { if (editorOpen() && rv.postId) checkChanged(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && editorOpen() && rv.postId) checkChanged(); });
  // «Actualizar» trae los cambios: el aviso ya no tiene sentido
  new MutationObserver(() => { if (editorOpen()) { renderBar(); if (rv.postId) checkChanged(); } }).observe($('#ed-wp'), { childList: true, attributes: true });

  // ---------------------------------------------------------------- Al abrir / cerrar el editor
  async function onOpen() {
    clearInterval(rv.timer);
    Object.assign(rv, { postId: selfOk() && draft?.postId && !draft.previewOnly ? draft.postId : 0, supported: null, notes: [], panel: false, focusAnchor: '', compose: null, dismissed: '' });
    EDT.dedupeAnchors(draft?.blocks || []);
    $('#ed-notes')?.classList.add('hidden');
    $('#ed-changed').classList.add('hidden');
    syncSendLabel();
    rebuild();
    if (!rv.postId) return;
    rv.supported = !!CFG.ecosHelper?.installed && !!rv.postId; // se confirma al cargar
    startWatch();
    if (!rv.summary) { try { rv.summary = await window.api.reviewSummary(); } catch { /* sin conexión */ } }
    await loadNotes();
    if (rv.supported === false) $('#ed-notes-btn').classList.add('hidden');
    renderBar();
  }
  new MutationObserver(() => { if (!editorOpen()) { clearInterval(rv.timer); rv.postId = 0; rv.panel = false; $('#ed-review').classList.add('hidden'); $('#ed-changed').classList.add('hidden'); } }).observe($('#editor'), { attributes: true, attributeFilter: ['class'] });
  // El botón de enviar dice «Enviar a revisión» cuando la persona no puede publicar
  function syncSendLabel() {
    const v = $('input[name="d-when"]:checked')?.value, lbl = $('#send > span:last-child');
    if (!lbl) return;
    lbl.textContent = v === 'pending' ? t('Enviar a revisión') : t('Enviar a WordPress');
    lbl.removeAttribute('data-i18n');
  }
  document.addEventListener('change', (e) => { if (e.target.name === 'd-when') syncSendLabel(); });

  // ---------------------------------------------------------------- Inicio: pendientes, devueltas y actividad reciente
  const hh = { loading: false, at: 0, err: null, fallback: false, items: null };
  const noteCount = (p) => (p.openNotes ? `<span class="rv-pill" title="${escHtml(t('{n} notas abiertas', { n: p.openNotes }))}"><span class="ms fill">chat_bubble</span>${p.openNotes}</span>` : '');
  const homeCard = (cls, icon, head, body, count = '') => `<section class="home-card ${cls}"><header><span class="ms fill">${icon}</span><h2>${head}${count !== '' ? ` <span class="rv-n">(${count})</span>` : ''}</h2></header>${body}</section>`;
  const KIND = () => ({ review: ['rate_review', t('envió a revisión')], published: ['public', t('publicó')], scheduled: ['schedule', t('programó')], returned: ['undo', t('devolvió')], changed: ['edit', t('cambió')] });
  function homeCards() {
    if (!selfOk() || !CFG.wpMe?.id) return '';
    const s = rv.summary;
    if (!s) return '';
    let out = '';
    const m = me();
    if (EDT.canReview(m)) {
      const list = s.pending || [];
      const body = list.length
        ? `<ul class="home-list">${list.slice(0, 5).map((p) => `<li><div class="home-li-t"><b>${escHtml(decodeEntities(p.title) || t('(sin título)'))}</b><span>${person(p.author)}${t('Enviada {w}', { w: ago(p.modified) })}</span></div>${noteCount(p)}
            <button class="btn tonal small" data-rv-home="review" data-id="${p.id}" data-type="${p.type}"><span class="ms">rate_review</span>${t('Revisar')}</button></li>`).join('')}</ul>${list.length > 5 ? `<div class="home-acts"><button class="btn text small" data-rv-home="all">${t('Ver las {n}', { n: list.length })}</button></div>` : ''}`
        : `<div class="home-empty ok"><span class="ms fill">task_alt</span><span>${t('No hay nada pendiente de revisión.')}</span></div>`;
      out += homeCard('home-pending', 'rate_review', t('Pendientes de revisión'), body, list.length);
    }
    if ((s.returned || []).length) {
      out += homeCard('home-returned', 'undo', t('Te han devuelto'), `<ul class="home-list">${s.returned.map((p) => `<li><div class="home-li-t"><b>${escHtml(decodeEntities(p.title) || t('(sin título)'))}</b><span>${person(p.returnedBy)}${p.returnedText ? escHtml('«' + p.returnedText + '»') : t('Devuelta {w}', { w: ago(p.returnedAt || p.modified) })}</span></div>${noteCount(p)}
        <button class="btn tonal small" data-rv-home="review" data-id="${p.id}" data-type="${p.type}"><span class="ms">edit</span>${t('Abrir')}</button></li>`).join('')}</ul>`, s.returned.length);
    }
    const act = EDT.activityFeed(s.activity || [], m?.id, { limit: 6 });
    if (act.length) {
      const K = KIND();
      out += homeCard('home-activity', 'history', t('Actividad reciente'), `<ul class="home-list sm rv-act">${act.map((x) => {
        const [ic, verb] = K[x.kind] || K.changed;
        const who = x.who ? (x.mine ? t('Tú') : escHtml(x.who)) : t('Alguien');
        return `<li><span class="wk-st"><span class="ms">${ic}</span></span><div class="home-li-t"><b>${escHtml(decodeEntities(x.title) || t('(sin título)'))}</b><span>${who} ${verb} · ${escHtml(ago(x.at))}</span></div>
          <button class="btn text small" data-rv-home="review" data-id="${x.id}" data-type="post" title="${escHtml(t('Abrir'))}"><span class="ms">open_in_new</span></button></li>`;
      }).join('')}</ul>`);
    }
    return out;
  }
  // Datos de Inicio: con el complemento, su resumen; sin él, lo que se pueda sacar de la lista de entradas
  async function loadHome(draw) {
    if (!selfOk() || hh.loading) return;
    hh.loading = true;
    try {
      let s = await window.api.reviewSummary();
      if (s && !s.supported) {
        const m = me();
        const [pend, rec] = await Promise.all([
          EDT.canReview(m) ? window.api.blogList({ type: 'post', status: 'pending', number: 20, orderby: 'modified' }).catch(() => ({ items: [] })) : { items: [] },
          window.api.blogList({ type: 'post', status: 'any', number: 8, orderby: 'modified' }).catch(() => ({ items: [] })),
        ]);
        s = { supported: false, pending: pend.items || [], returned: [], activity: rec.items || [] };
      }
      if (s) { rv.summary = s; hh.err = null; }
    } catch (e) { hh.err = e; } finally { hh.loading = false; hh.at = Date.now(); }
    draw?.();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rv-home]');
    if (!b) return;
    const a = b.dataset.rvHome;
    if (a === 'all') { Home.goBlog('post'); const sel = $('#b-status'); sel.value = 'pending'; sel.dispatchEvent(new Event('change')); return; }
    busy(b, () => openFromWp(Number(b.dataset.id), null, b.dataset.type === 'page' ? 'page' : 'post'));
  });

  // ---------------------------------------------------------------- Avisos del sistema (opcionales: Ajustes → Avisos)
  async function pollAlerts() {
    if (prefs().reviewNotify !== true || !selfOk() || !CFG.wpMe?.id || document.body.classList.contains('editing')) return;
    let s;
    try { s = await window.api.reviewSummary(); } catch { return; }
    if (!s || !s.supported) return;
    const al = EDT.reviewAlerts(rv.prev, s, CFG.wpMe.id);
    rv.prev = EDT.snapshot(s); rv.summary = s;
    if ($('#tab-home').classList.contains('active')) Home.render();
    const say = (body) => { if (typeof Notification !== 'undefined' && !document.hasFocus()) { try { new Notification('Ecos', { body }); return; } catch { /* sin notificaciones */ } } toast(body); };
    if (al.returned.length) say(al.returned.length === 1 ? t('Te han devuelto «{x}» con comentarios.', { x: decodeEntities(al.returned[0].title) }) : t('Te han devuelto {n} entradas con comentarios.', { n: al.returned.length }));
    if (al.pending.length && EDT.canReview(me())) say(al.pending.length === 1 ? t('Hay una entrada pendiente de revisión: «{x}».', { x: decodeEntities(al.pending[0].title) }) : t('Hay {n} entradas pendientes de revisión.', { n: al.pending.length }));
  }
  setInterval(pollAlerts, 5 * 60 * 1000);
  setTimeout(pollAlerts, 20000);
  $('#s-review-notify')?.addEventListener('change', async (e) => { await savePrefs({ reviewNotify: e.target.checked }); rv.prev = null; if (e.target.checked) pollAlerts(); });

  return { onOpen, homeCards, loadHome, state: rv, hh, refreshHome: () => loadHome(() => { if ($('#tab-home').classList.contains('active')) Home.render(); }), rebuild, openPanel };
})();

window.ReviewUI = ReviewUI;
