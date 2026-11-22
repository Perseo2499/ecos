// Selector de plantilla de contenido (al crear entradas y páginas) y «Guardar como plantilla».
// Las plantillas y su lógica pura están en renderer/templates.js; aquí solo la interfaz.

const tplLastKey = (ty) => 'ecos.tplLast.' + ty;
const sketchHtml = (rows) => `<span class="tp-sk">${rows.map((k) => `<i class="k-${k}"></i>`).join('')}</span>`;

// Devuelve una promesa: null si se cancela, o la plantilla elegida ({blocks:[]} = en blanco)
function pickTemplate(ty) {
  return new Promise((resolve) => {
    const CT = window.ContentTemplates;
    const { builtin, own } = CT.forType(ty, CFG.blockTemplates);
    const cards = [
      { key: 'blank', icon: 'draft', name: t('En blanco'), desc: t('Empieza con un párrafo vacío.'), rows: ['p'], tpl: null },
      ...builtin.map((b) => ({ key: 'b:' + b.id, icon: b.icon, name: t(b.name), desc: t(b.desc), rows: CT.sketch(b.blocks, b.featured), tpl: b })),
    ];
    const ownCards = own.map(({ tp, index }) => ({ key: 'u:' + index, icon: 'bookmark', name: tp.name, desc: t('{n} bloques', { n: tp.blocks.length }), rows: CT.sketch(tp.blocks), tpl: tp }));
    const all = [...cards, ...ownCards];
    let last = '';
    try { last = localStorage.getItem(tplLastKey(ty)) || ''; } catch { /* sin almacenamiento: no se recuerda */ }
    let sel = all.some((c) => c.key === last) ? last : 'blank';
    const prev = document.activeElement;
    const d = document.createElement('div');
    d.className = 'dlg-scrim';
    const card = (c) => `<button type="button" class="tp-card" data-k="${escHtml(c.key)}"><span class="ms fill">${c.icon}</span>${sketchHtml(c.rows)}<b>${escHtml(c.name)}</b><small>${escHtml(c.desc)}</small></button>`;
    d.innerHTML = `<div class="dlg tp-dlg" role="dialog" aria-modal="true">
      <h2>${ty === 'page' ? t('Nueva página') : t('Nueva entrada')}</h2>
      <p class="hint">${t('Elige una plantilla para empezar con los bloques ya preparados.')}</p>
      <div class="tp-grid">${cards.map(card).join('')}</div>
      ${ownCards.length ? `<div class="section-label">${t('Mis plantillas')}</div><div class="tp-grid">${ownCards.map(card).join('')}</div>` : ''}
      <div class="dlg-actions"><button class="btn text" data-r="x">${t('Cancelar')}</button><button class="btn tonal" data-r="blank">${t('Empezar en blanco')}</button><button class="btn filled" data-r="ok">${t('Usar plantilla')}</button></div></div>`;
    const mark = () => $$('.tp-card', d).forEach((b) => b.classList.toggle('on', b.dataset.k === sel));
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && !(e.target.closest && e.target.closest('[data-r]'))) { e.preventDefault(); e.stopPropagation(); choose(); }
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
    $$('.tp-card', d).forEach((b) => { b.onclick = () => { sel = b.dataset.k; mark(); }; b.ondblclick = choose; });
    $('[data-r="x"]', d).onclick = () => close(null);
    $('[data-r="blank"]', d).onclick = () => close(all[0]);
    $('[data-r="ok"]', d).onclick = choose;
    d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(d);
    mark();
    $('[data-r="ok"]', d).focus();
  });
}

// Pide un nombre en un diálogo temático ('' si se cancela)
function askTemplateName(label) {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'dlg-scrim';
    d.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><p class="dlg-msg"></p><input id="tp-name" maxlength="60" style="width:100%"><div class="dlg-actions"><button class="btn text" data-r="0">${t('Cancelar')}</button><button class="btn filled" data-r="1">${t('Guardar')}</button></div></div>`;
    $('.dlg-msg', d).textContent = label;
    const inp = $('#tp-name', d);
    const close = (v) => { d.remove(); resolve(v ? inp.value.trim() : ''); };
    $$('[data-r]', d).forEach((b) => (b.onclick = () => close(b.dataset.r === '1')));
    inp.onkeydown = (e) => { if (e.key === 'Enter') close(true); if (e.key === 'Escape') close(false); };
    d.addEventListener('mousedown', (e) => { if (e.target === d) close(false); });
    document.body.appendChild(d);
    inp.focus();
  });
}

// Guarda los bloques del borrador como plantilla propia: sin fotos concretas (pasan a huecos) y sin título
async function saveAsTemplate() {
  if (!draft || !draft.blocks || !draft.blocks.length) return toast(t('No hay bloques que guardar.'), true);
  const name = await askTemplateName(t('Nombre de la plantilla'));
  if (!name) return;
  const tp = window.ContentTemplates.makeUserTemplate(name, draft.blocks, draft.type);
  CFG = await window.api.setConfig({ blockTemplates: [...(CFG.blockTemplates || []), tp] });
  if (typeof renderBlockTemplates === 'function') renderBlockTemplates();
  toast(t('Plantilla «{p}» guardada (sin fotos ni título)', { p: tp.name }));
}
$('#d-tpl-save').onclick = async () => { try { await saveAsTemplate(); } catch (e) { toastError(e); } };
