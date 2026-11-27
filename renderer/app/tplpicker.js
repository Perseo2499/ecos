// Selector de plantilla de contenido (al crear entradas y páginas) y «Guardar como plantilla».
// Las plantillas y su lógica pura están en renderer/templates.js; aquí solo la interfaz.

const tplLastKey = (ty) => 'ecos.tplLast.' + ty;
const sketchHtml = (rows) => `<span class="tp-sk">${rows.map((k) => `<i class="k-${k}"></i>`).join('')}</span>`;
const tplErr = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// Guarda la lista de plantillas propias y repinta lo que la muestra
async function setOwnTemplates(list) {
  CFG = await window.api.setConfig({ blockTemplates: list });
  if (typeof renderBlockTemplates === 'function') renderBlockTemplates();
}

// Miniatura de una plantilla propia: el render pequeño del editor (o, si no se puede, las barras esquemáticas)
function tplThumb(tp) {
  const BE = window.BlockEditor, PU = window.PatternsUI;
  if (BE && PU && tp.blocks && tp.blocks.length) {
    try { return PU.thumb(BE.fromTemplate(tp.blocks), { height: 96 }); } catch { /* sin miniatura de render */ }
  }
  return null;
}

// Devuelve una promesa: null si se cancela, o la plantilla elegida ({blocks:[]} = en blanco)
function pickTemplate(ty) {
  return new Promise((resolve) => {
    const CT = window.ContentTemplates;
    const builtin = CT.forType(ty, []).builtin;
    const cards = [
      { key: 'blank', icon: 'draft', name: t('En blanco'), desc: t('Empieza con un párrafo vacío.'), rows: ['p'], tpl: null },
      ...builtin.map((b) => ({ key: 'b:' + b.id, icon: b.icon, name: t(b.name), desc: t(b.desc), rows: CT.sketch(b.blocks, b.featured), tpl: b })),
    ];
    let all = cards, ownCards = [];
    const loadOwn = () => {
      ownCards = CT.forType(ty, CFG.blockTemplates).own.map(({ tp, index }) => ({ key: 'u:' + index, own: true, index, icon: 'bookmark', name: tp.name, desc: tp.desc || t('{n} bloques', { n: tp.blocks.length }), rows: CT.sketch(tp.blocks), tpl: tp }));
      all = [...cards, ...ownCards];
    };
    loadOwn();
    let last = '';
    try { last = localStorage.getItem(tplLastKey(ty)) || ''; } catch { /* sin almacenamiento: no se recuerda */ }
    let sel = all.some((c) => c.key === last) ? last : 'blank';
    const prev = document.activeElement;
    const d = document.createElement('div');
    d.className = 'dlg-scrim';
    const card = (c) => `<button type="button" class="tp-card" data-k="${escHtml(c.key)}"><span class="ms fill">${c.icon}</span>${sketchHtml(c.rows)}<b>${escHtml(c.name)}</b><small>${escHtml(c.desc)}</small></button>`;
    const ownCard = (c) => `<div class="tp-wrap"><button type="button" class="tp-card tp-own" data-k="${escHtml(c.key)}"><span class="tp-pv" data-i="${c.index}">${sketchHtml(c.rows)}</span><b>${escHtml(c.name)}</b><small>${escHtml(c.desc)}${c.tpl.structureOnly && !c.tpl.desc ? ' · ' + escHtml(t('Solo estructura')) : ''}</small></button>
      <span class="tp-acts"><button type="button" class="btn text icon-only" data-ren="${c.index}" title="${escHtml(t('Cambiar el nombre'))}" aria-label="${escHtml(t('Cambiar el nombre'))}"><span class="ms">edit</span></button><button type="button" class="btn text icon-only danger" data-del="${c.index}" title="${escHtml(t('Borrar plantilla'))}" aria-label="${escHtml(t('Borrar plantilla'))}"><span class="ms">delete</span></button></span></div>`;
    d.innerHTML = `<div class="dlg tp-dlg" role="dialog" aria-modal="true">
      <h2>${ty === 'page' ? t('Nueva página') : t('Nueva entrada')}</h2>
      <p class="hint">${t('Elige una plantilla para empezar con los bloques ya preparados.')}</p>
      <div class="tp-grid">${cards.map(card).join('')}</div>
      <div class="section-label tp-own-head"><span>${t('Mis plantillas')}</span><span class="spacer"></span><button type="button" class="btn text small" data-io="import"><span class="ms">upload_file</span>${t('Importar…')}</button><button type="button" class="btn text small" data-io="export"><span class="ms">download</span>${t('Exportar…')}</button></div>
      <div class="tp-grid tp-own-grid"></div>
      <div class="dlg-actions"><button class="btn text" data-r="x">${t('Cancelar')}</button><button class="btn tonal" data-r="blank">${t('Empezar en blanco')}</button><button class="btn filled" data-r="ok">${t('Usar plantilla')}</button></div></div>`;
    const mark = () => $$('.tp-card', d).forEach((b) => b.classList.toggle('on', b.dataset.k === sel));
    const key = (e) => {
      if ([...document.querySelectorAll('.dlg-scrim')].pop() !== d) return; // hay un diálogo encima (cambiar nombre, borrar)
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && !(e.target.closest && e.target.closest('[data-r],[data-io],[data-ren],[data-del]'))) { e.preventDefault(); e.stopPropagation(); choose(); }
      else if (/^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
        e.preventDefault();
        const i = all.findIndex((c) => c.key === sel), n = /Left|Up/.test(e.key) ? -1 : 1;
        sel = all[(i + n + all.length) % all.length].key; mark();
      }
    };
    function close(c) {
      d.classList.add('out'); setTimeout(() => d.remove(), 160);
      document.removeEventListener('keydown', key, true);
      if (prev && prev.focus) prev.focus();
      if (c) { try { localStorage.setItem(tplLastKey(ty), c.key); } catch { /* idem */ } }
      resolve(c ? c.tpl || { blocks: [] } : null);
    }
    function choose() { close(all.find((c) => c.key === sel)); }
    // «Mis plantillas»: tarjetas con miniatura, renombrar y borrar
    function paintOwn() {
      loadOwn();
      if (!all.some((c) => c.key === sel)) sel = 'blank';
      const grid = $('.tp-own-grid', d);
      const has = ownCards.length > 0;
      $('.tp-own-head', d).classList.toggle('empty', !has);
      $('[data-io="export"]', d).classList.toggle('hidden', !(CFG.blockTemplates || []).length);
      grid.innerHTML = has ? ownCards.map(ownCard).join('') : `<p class="hint">${t('Todavía no has guardado ninguna. Hazlo desde el editor con «Guardar como plantilla…».')}</p>`;
      $$('.tp-own', grid).forEach((b) => { b.onclick = () => { sel = b.dataset.k; mark(); }; b.ondblclick = choose; });
      ownCards.forEach((c) => { const th = tplThumb(c.tpl); const slot = $(`.tp-pv[data-i="${c.index}"]`, grid); if (th && slot) slot.replaceChildren(th); });
      $$('[data-ren]', grid).forEach((b) => (b.onclick = async () => {
        const i = Number(b.dataset.ren), tp = CFG.blockTemplates[i];
        const name = await askTemplateName(t('Nombre de la plantilla'), tp.name);
        if (!name || name === tp.name) return;
        await setOwnTemplates(CFG.blockTemplates.map((x, k) => (k === i ? { ...x, name } : x)));
        paintOwn();
      }));
      $$('[data-del]', grid).forEach((b) => (b.onclick = async () => {
        const i = Number(b.dataset.del), tp = CFG.blockTemplates[i];
        if (!await ask(t('¿Borrar la plantilla «{p}»? No se puede deshacer.', { p: tp.name }), { ok: t('Borrar'), danger: true })) return;
        await setOwnTemplates(CFG.blockTemplates.filter((_, k) => k !== i));
        paintOwn();
      }));
      mark();
    }
    $$('.tp-grid:not(.tp-own-grid) .tp-card', d).forEach((b) => { b.onclick = () => { sel = b.dataset.k; mark(); }; b.ondblclick = choose; });
    $('[data-io="export"]', d).onclick = () => exportTemplatesFile().catch((e) => toastError(e));
    $('[data-io="import"]', d).onclick = async () => { try { if (await importTemplatesFile()) paintOwn(); } catch (e) { toastError(e); } };
    $('[data-r="x"]', d).onclick = () => close(null);
    $('[data-r="blank"]', d).onclick = () => close(all[0]);
    $('[data-r="ok"]', d).onclick = choose;
    d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(d);
    paintOwn();
    $('[data-r="ok"]', d).focus();
  });
}

// Pide un nombre en un diálogo temático ('' si se cancela)
function askTemplateName(label, value = '') {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'dlg-scrim tp-sub';
    d.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><p class="dlg-msg"></p><input id="tp-name" maxlength="60" style="width:100%"><div class="dlg-actions"><button class="btn text" data-r="0">${t('Cancelar')}</button><button class="btn filled" data-r="1">${t('Guardar')}</button></div></div>`;
    $('.dlg-msg', d).textContent = label;
    const inp = $('#tp-name', d);
    inp.value = value;
    const close = (v) => { d.remove(); resolve(v ? inp.value.trim() : ''); };
    $$('[data-r]', d).forEach((b) => (b.onclick = () => close(b.dataset.r === '1')));
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') close(true); if (e.key === 'Escape') close(false); };
    d.addEventListener('mousedown', (e) => { if (e.target === d) close(false); });
    document.body.appendChild(d);
    inp.focus(); inp.select();
  });
}

// «Guardar como plantilla…»: nombre, descripción, tipo y si se incluyen los textos. null si se cancela
function askTemplateSave(ty) {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'dlg-scrim tp-sub';
    d.innerHTML = `<form class="dlg tp-save" role="dialog" aria-modal="true" autocomplete="off"><h2>${t('Guardar como plantilla')}</h2>
      <div class="field"><label for="tps-name">${t('Nombre')}</label><input id="tps-name" maxlength="60" style="width:100%"></div>
      <div class="field"><label for="tps-desc">${t('Descripción')} <small>(${t('opcional')})</small></label><input id="tps-desc" maxlength="140" style="width:100%"></div>
      <div class="field"><label>${t('Para')}</label><div class="seg mini" id="tps-type"><label><input type="radio" name="tps-t" value="post"${ty === 'page' ? '' : ' checked'}><span class="ms">article</span>${t('Entradas')}</label><label><input type="radio" name="tps-t" value="page"${ty === 'page' ? ' checked' : ''}><span class="ms">description</span>${t('Páginas')}</label></div></div>
      <div class="syn-kinds" role="radiogroup">
        <label class="syn-kind"><input type="radio" name="tps-m" value="texts" checked><span class="ms">text_fields</span><span><b>${t('Incluir los textos')}</b><small>${t('Se guarda el contenido tal cual (las fotos pasan a huecos).')}</small></span></label>
        <label class="syn-kind"><input type="radio" name="tps-m" value="structure"><span class="ms">wireframe</span><span><b>${t('Solo la estructura')}</b><small>${t('Vacía los textos y deja lo que decían como indicaciones.')}</small></span></label>
      </div>
      <p class="hint">${t('El título de la entrada no se guarda.')}</p>
      <div class="dlg-actions"><button type="button" class="btn text" data-r="0">${t('Cancelar')}</button><button type="submit" class="btn filled">${t('Guardar')}</button></div></form>`;
    const name = $('#tps-name', d);
    const close = (v) => { d.remove(); resolve(v); };
    $('[data-r="0"]', d).onclick = () => close(null);
    $('form', d).onsubmit = (e) => {
      e.preventDefault();
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      close({ name: n, desc: $('#tps-desc', d).value.trim(), type: $('input[name="tps-t"]:checked', d).value, texts: $('input[name="tps-m"]:checked', d).value === 'texts' });
    };
    d.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(null); }, true);
    d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
    document.body.appendChild(d);
    name.focus();
  });
}

// Guarda los bloques del borrador como plantilla propia: sin fotos concretas (pasan a huecos) y sin título
async function saveAsTemplate() {
  if (!draft || !draft.blocks || !draft.blocks.length) return toast(t('No hay bloques que guardar.'), true);
  const o = await askTemplateSave(draft.type);
  if (!o) return;
  const tp = window.ContentTemplates.makeUserTemplate(o.name, draft.blocks, o.type, { desc: o.desc, texts: o.texts });
  await setOwnTemplates([...(CFG.blockTemplates || []), tp]);
  toast(t('Plantilla «{p}» guardada. La tienes en «Mis plantillas» al crear una entrada o página.', { p: tp.name }));
}
$('#d-tpl-save').onclick = async () => { try { await saveAsTemplate(); } catch (e) { toastError(e); } };
$('#d-tpl-save2')?.addEventListener('click', async () => { try { await saveAsTemplate(); } catch (e) { toastError(e); } });

// Exportar / importar las plantillas propias (archivo .json)
async function exportTemplatesFile() {
  const list = CFG.blockTemplates || [];
  if (!list.length) return toast(t('No hay plantillas propias que exportar.'), true);
  const where = await window.api.templatesExport(window.ContentTemplates.exportTemplates(list));
  if (where) toast(t('Plantillas guardadas en {p}', { p: where }));
}
// Devuelve cuántas se han añadido (0 si se cancela)
async function importTemplatesFile() {
  const text = await window.api.templatesImport();
  if (!text) return 0;
  let r;
  try { r = window.ContentTemplates.parseImport(text, CFG.blockTemplates || []); } catch (e) { toast(t(e.message), true); return 0; }
  if (!r.templates.length) { toast(t('El archivo no tiene ninguna plantilla válida.'), true); return 0; }
  await setOwnTemplates([...(CFG.blockTemplates || []), ...r.templates]);
  toast(r.skipped ? t('{n} plantillas importadas ({s} no válidas, omitidas).', { n: r.templates.length, s: r.skipped }) : t('{n} plantillas importadas.', { n: r.templates.length }));
  return r.templates.length;
}
$('#btpl-export')?.addEventListener('click', () => exportTemplatesFile().catch((e) => toastError(e)));
$('#btpl-import')?.addEventListener('click', () => importTemplatesFile().catch((e) => toastError(e)));
