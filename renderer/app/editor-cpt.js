// Ecos · Editor de entradas: tipos de contenido propios, panel «Campos» (ACF, Meta Box y metas) e «Idioma y traducciones» (Polylang, WPML).
// Sigue a app/editor-astra.js y comparte su ámbito global. La lógica pura está en renderer/cpt.js (con pruebas).
// El borrador guarda: draft.type = 'evento' (tipo propio), draft.cf = { fields, values, initial, acfRest, via }, draft.lang y draft.translationOf.

let CPT_TYPES = null; // tipos propios de la web [{ slug, name, singular, restBase, editor, … }]
async function cptTypes() {
  if (CPT_TYPES) return CPT_TYPES;
  if (CFG.wpMode !== 'selfhosted' || !CFG.wpConnected) return (CPT_TYPES = []);
  try { const r = await window.api.cptTypes(); CPT_TYPES = Array.isArray(r) ? r : []; } catch { CPT_TYPES = []; }
  return CPT_TYPES;
}
const cptInfo = (slug) => (CPT_TYPES || []).find((x) => x.slug === slug) || null;
const isCptDraft = () => !!draft?.type && !['post', 'page'].includes(draft.type);
const isCptSlug = (s) => !!s && !['post', 'page', 'calendar', 'media', 'structure'].includes(s);

// ---------------------------------------------------------------- Tipo del borrador (categorías propias, título de la barra, sin editor)
async function cptApplyType() {
  if (!isCptDraft()) { if (draft) draft.cptCats = null; $('#ed-canvas')?.classList.remove('cpt-noeditor'); return; }
  await cptTypes();
  const info = cptInfo(draft.type);
  $('#ed-bar-title').textContent = info?.singular || draft.type;
  $('#d-parent-field').classList.toggle('hidden', !info?.hierarchical);
  if (info?.hierarchical) fillParents(draft.parent || 0);
  draft.noEditor = !!info && !info.editor;
  $('#ed-canvas')?.classList.toggle('cpt-noeditor', !!draft.noEditor);
  if (draft.noEditor) toast(t('Este tipo de contenido no usa el editor de bloques: solo se envían el título y los campos.'));
  try {
    const r = await window.api.cptTerms(draft.type);
    draft.cptCats = r.terms.map((x) => ({ id: x.id, name: x.name }));
    $('#d-cats-label').textContent = r.taxonomy?.name || t('Categorías');
    $('#d-cats-label').classList.toggle('hidden', !r.taxonomy);
    $('#d-cats').classList.toggle('hidden', !r.taxonomy);
    $('#d-tags-field').classList.toggle('hidden', !r.hasTag);
    if (r.taxonomy) renderCats((draft.categories || []).map((c) => c.toLowerCase()));
  } catch { $('#d-cats-label').classList.add('hidden'); $('#d-cats').classList.add('hidden'); $('#d-tags-field').classList.add('hidden'); }
}

// ---------------------------------------------------------------- Campos
const CF_ICON = { text: 'text_fields', textarea: 'notes', number: 'pin', email: 'mail', url: 'link', date: 'event', datetime: 'event', time: 'schedule', bool: 'toggle_on', select: 'arrow_drop_down_circle', radio: 'radio_button_checked', checkbox: 'checklist', image: 'image', link: 'add_link', readonly: 'lock' };
const CF_SRC = () => ({ acf: 'ACF', metabox: 'Meta Box', meta: t('Metas') });
const cfFields = () => draft?.cf?.fields || [];
const cfClone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

async function loadCptPanels() {
  renderFields(); renderLang();
  if (CFG.wpMode !== 'selfhosted' || !CFG.wpConnected || !draft) return;
  const mine = draft;
  // campos (si el borrador cambia mientras llegan, se descartan)
  try {
    const r = await window.api.cptFields({ type: draft.type || 'post', postId: draft.postId || 0 });
    if (mine !== draft) return;
    const fields = (r.fields || []).map((f) => ({ ...f }));
    const values = {};
    for (const f of fields) values[f.id] = f.kind === 'readonly' ? r.values?.[f.id] : Cpt.toInput(f, r.values?.[f.id]);
    // lo que había escrito en un borrador nuevo (p. ej. una traducción) no se pierde
    for (const [k, v] of Object.entries(draft.cfPreset || {})) if (k in values) values[k] = v;
    draft.cf = { fields, values, initial: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, cfClone(v)])), acfRest: !!r.acfRest, via: r.via, plugins: r.plugins || {}, errors: {}, thumbs: r.thumbs || {} };
    if (draft.cfPreset) { for (const k of Object.keys(draft.cfPreset)) if (k in values) draft.cf.initial[k] = Cpt.toInput(fields.find((f) => f.id === k), undefined); delete draft.cfPreset; }
  } catch (e) { if (mine === draft) draft.cf = { fields: [], values: {}, initial: {}, acfRest: false, error: e.message }; }
  if (mine !== draft) return;
  renderFields();
  loadLangInfo();
}

function cfInput(f) {
  const v = draft.cf.values[f.id];
  const id = 'cf-' + f.id.replace(/\W+/g, '-');
  const wrap = document.createElement('div');
  wrap.className = 'cf-field' + (f.required ? ' req' : '') + (f.kind === 'readonly' ? ' ro' : '');
  wrap.dataset.field = f.id;
  const label = document.createElement('label');
  label.className = 'cf-label'; label.htmlFor = id;
  label.innerHTML = `<span class="ms">${CF_ICON[f.kind] || 'text_fields'}</span><span class="cf-name"></span>${f.required ? '<b class="cf-star" aria-hidden="true">*</b>' : ''}`;
  $('.cf-name', label).textContent = f.label;
  wrap.appendChild(label);
  const set = (val) => { draft.cf.values[f.id] = val; if (draft.cf.errors) delete draft.cf.errors[f.id]; wrap.classList.remove('bad'); $('.cf-err', wrap).textContent = ''; autosaveSoon?.(); };
  let ctl;
  if (f.kind === 'readonly') {
    ctl = document.createElement('div'); ctl.className = 'cf-ro';
    const val = v === undefined || v === null || v === '' ? '' : typeof v === 'object' ? (Array.isArray(v) ? t('{n} elementos', { n: v.length }) : t('(datos)')) : String(v).slice(0, 80);
    ctl.innerHTML = `<span class="hint"></span><button type="button" class="btn text small"><span class="ms">open_in_new</span>${escHtml(t('Editar en WordPress'))}</button>`;
    $('.hint', ctl).textContent = (f.type ? f.type + (val ? ' · ' : '') : '') + val;
    $('button', ctl).onclick = async () => { if (!draft.postId) return toast(t('Envía primero la entrada a WordPress.'), true); window.api.open(await window.api.blogEditUrl(draft.postId, draft.type)); };
  } else if (f.kind === 'textarea') {
    ctl = document.createElement('textarea'); ctl.rows = 3; ctl.value = v ?? ''; ctl.oninput = () => set(ctl.value);
  } else if (f.kind === 'bool') {
    ctl = document.createElement('label'); ctl.className = 'switch small cf-switch';
    ctl.innerHTML = `<input type="checkbox"><span></span>`; $('input', ctl).checked = !!v; $('span', ctl).textContent = t('Sí');
    $('input', ctl).onchange = (e) => set(e.target.checked);
  } else if (f.kind === 'select') {
    ctl = document.createElement('select'); if (f.multiple) { ctl.multiple = true; ctl.size = Math.min(5, Math.max(2, f.options.length)); }
    else ctl.innerHTML = `<option value="">${escHtml(t('(ninguno)'))}</option>`;
    ctl.insertAdjacentHTML('beforeend', f.options.map((o) => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join(''));
    if (f.multiple) [...ctl.options].forEach((o) => (o.selected = (v || []).includes(o.value))); else ctl.value = v ?? '';
    ctl.onchange = () => set(f.multiple ? [...ctl.selectedOptions].map((o) => o.value) : ctl.value);
  } else if (f.kind === 'radio' || f.kind === 'checkbox') {
    ctl = document.createElement('div'); ctl.className = 'cf-opts'; ctl.setAttribute('role', f.kind === 'radio' ? 'radiogroup' : 'group'); ctl.setAttribute('aria-label', f.label);
    const type = f.kind === 'radio' ? 'radio' : 'checkbox';
    ctl.innerHTML = f.options.map((o) => `<label class="chip"><input type="${type}" name="${escHtml(id)}" value="${escHtml(o.value)}"><span>${escHtml(o.label)}</span></label>`).join('');
    $$('input', ctl).forEach((i) => { i.checked = f.kind === 'radio' ? i.value === v : (v || []).includes(i.value); i.onchange = () => set(f.kind === 'radio' ? i.value : $$('input:checked', ctl).map((x) => x.value)); });
  } else if (f.kind === 'image') {
    ctl = document.createElement('div'); ctl.className = 'cf-img';
    ctl.innerHTML = `<span class="cf-thumb"><span class="ms">image</span></span><button type="button" class="btn tonal small" data-pick><span class="ms">photo_library</span>${escHtml(t('Elegir'))}</button><button type="button" class="btn text small" data-clear><span class="ms">close</span>${escHtml(t('Quitar'))}</button>`;
    const paint = () => {
      const cur = draft.cf.values[f.id], thumb = $('.cf-thumb', ctl), url = (draft.cf.thumbs || {})[cur];
      thumb.innerHTML = url ? `<img alt="" src="${escHtml(url)}">` : cur ? `<span class="hint">#${Number(cur)}</span>` : '<span class="ms">image</span>';
      $('[data-clear]', ctl).classList.toggle('hidden', !cur);
    };
    $('[data-pick]', ctl).onclick = async () => { const m = await cfPickMedia(); if (!m) return; (draft.cf.thumbs ||= {})[m.id] = m.url; set(m.id); paint(); };
    $('[data-clear]', ctl).onclick = () => { set(0); paint(); };
    paint();
  } else if (f.kind === 'link') {
    ctl = document.createElement('div'); ctl.className = 'cf-link';
    ctl.innerHTML = `<input data-k="url" type="url" placeholder="https://" aria-label="${escHtml(t('Dirección'))}"><input data-k="title" placeholder="${escHtml(t('Texto del enlace'))}" aria-label="${escHtml(t('Texto del enlace'))}"><label class="switch small"><input type="checkbox" data-k="target"><span>${escHtml(t('Abrir en otra pestaña'))}</span></label>`;
    const cur = () => ({ ...(draft.cf.values[f.id] || {}) });
    $$('input', ctl).forEach((i) => {
      const k = i.dataset.k; if (k === 'target') i.checked = cur().target === '_blank'; else i.value = cur()[k] || '';
      i.oninput = i.onchange = () => set({ ...cur(), [k]: k === 'target' ? (i.checked ? '_blank' : '') : i.value });
    });
  } else {
    ctl = document.createElement('input');
    ctl.type = { number: 'number', email: 'email', url: 'url', date: 'date', datetime: 'datetime-local', time: 'time' }[f.kind] || 'text';
    if (f.kind === 'number') { if (f.min !== undefined) ctl.min = f.min; if (f.max !== undefined) ctl.max = f.max; ctl.step = f.step !== undefined ? f.step : 'any'; }
    ctl.value = v ?? ''; ctl.oninput = () => set(ctl.value);
  }
  if (ctl.tagName !== 'DIV' && ctl.tagName !== 'LABEL') ctl.id = id;
  wrap.appendChild(ctl);
  if (f.help) { const h = document.createElement('small'); h.className = 'hint cf-help'; h.textContent = f.help; wrap.appendChild(h); }
  const err = document.createElement('small'); err.className = 'cf-err'; err.setAttribute('role', 'alert'); wrap.appendChild(err);
  return wrap;
}

// Selector de una sola foto de la biblioteca (reutiliza la rejilla de «De la biblioteca»)
function cfPickMedia() {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal mg-modal';
    m.innerHTML = `<div class="modal-box wide"><h2><span class="ms fill modal-icon">photo_library</span>${t('De la biblioteca')}</h2>
      <div class="mg-host"></div>
      <div class="modal-actions"><span class="spacer"></span><button class="btn text" data-r="0">${t('Cancelar')}</button><button class="btn filled" data-r="1" disabled><span class="ms">check</span>${t('Elegir')}</button></div></div>`;
    const ok = m.querySelector('[data-r="1"]');
    const g = mediaGrid(m.querySelector('.mg-host'), { usage: false, onChange: () => { ok.disabled = g.sel.size !== 1; } });
    const done = (v) => { m.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const key = (e) => { if (e.key === 'Escape' && !$('#lightbox:not(.hidden)')) { e.stopPropagation(); done(null); } };
    document.addEventListener('keydown', key, true);
    m.querySelector('[data-r="0"]').onclick = () => done(null);
    m.addEventListener('mousedown', (e) => { if (e.target === m) done(null); });
    ok.onclick = () => { const x = [...g.sel.values()][0]; done(x ? { id: x.id, url: x.thumb || x.url } : null); };
    document.body.appendChild(m);
    g.reload();
  });
}

function renderFields() {
  const box = $('#d-fields');
  if (!box) return;
  const fields = cfFields();
  box.classList.toggle('hidden', !fields.length);
  if (!fields.length) return;
  const body = $('#d-fields-body');
  body.innerHTML = '';
  const editable = fields.filter((f) => f.kind !== 'readonly').length;
  $('#fields-sum').textContent = t('{n} campos', { n: fields.length });
  if (draft.cf.via === 'rest') body.insertAdjacentHTML('beforeend', `<p class="hint cf-note"><span class="ms">info</span>${escHtml(t('Sin el Complemento de Ecos (1.8.0) solo se ven los campos que la API de WordPress publica.'))}</p>`);
  if (draft.cf.plugins?.acf && !draft.cf.acfRest && fields.some((f) => f.source === 'acf' && f.kind !== 'readonly')) body.insertAdjacentHTML('beforeend', `<p class="hint cf-note"><span class="ms">info</span>${escHtml(t('Los campos de ACF se guardan con el complemento (ACF no los publica en la API).'))}</p>`);
  let group = null, grp = body;
  for (const f of fields) {
    const key = f.source + '|' + f.group;
    if (key !== group) {
      group = key;
      grp = document.createElement('div'); grp.className = 'cf-group';
      grp.innerHTML = `<div class="cf-gt"><b></b><span class="cf-src"></span></div>`;
      $('b', grp).textContent = f.group || CF_SRC()[f.source]; $('.cf-src', grp).textContent = CF_SRC()[f.source];
      body.appendChild(grp);
    }
    grp.appendChild(cfInput(f));
  }
  if (isCptDraft() && editable) box.open = true;
}
// Valida los campos antes de enviar; marca los errores y lanza el primero
function cfValidate() {
  if (!draft?.cf?.fields?.length) return;
  const r = Cpt.validateAll(draft.cf.fields, draft.cf.values);
  draft.cf.errors = r.errors;
  $$('#d-fields .cf-field').forEach((w) => { const code = r.errors[w.dataset.field]; w.classList.toggle('bad', !!code); $('.cf-err', w).textContent = code ? t(Cpt.ERRORS[code] || code) : ''; });
  if (r.ok) return;
  $('#d-fields').open = true;
  $('#d-fields .cf-field.bad')?.scrollIntoView({ block: 'center' });
  const f = draft.cf.fields.find((x) => r.errors[x.id]);
  throw new Error(t('Revisa el campo «{f}»: {e}', { f: f.label, e: t(Cpt.ERRORS[r.errors[f.id]]) }));
}
// Lo que se envía con la entrada: { post: { acf, meta }, helper: { acf, metabox } } o nada si no cambió
function cfPayload() {
  const cf = draft?.cf;
  if (!cf?.fields?.length) return undefined;
  const r = Cpt.buildFieldsPost(cf.fields, cf.values, cf.initial, { acfRest: cf.acfRest });
  return r.empty ? undefined : { post: r.post, helper: r.helper };
}
const cfSent = () => { if (draft?.cf?.fields?.length) draft.cf.initial = Object.fromEntries(Object.entries(draft.cf.values).map(([k, v]) => [k, cfClone(v)])); };

// ---------------------------------------------------------------- Idioma y traducciones
let LANGS = null; // { plugin, languages, default } de la web
async function loadLangInfo() {
  if (CFG.wpMode !== 'selfhosted' || !CFG.wpConnected || !draft) return;
  const mine = draft;
  try {
    const r = await window.api.langInfo({ postId: draft.postId || 0 });
    if (mine !== draft) return;
    LANGS = { plugin: r.plugin, languages: r.languages || [], default: r.default || '' };
    if (r.post) { draft.lang = draft.lang || r.post.lang; draft.translations = r.post.translations || {}; }
    else if (!draft.lang && !draft.postId) draft.lang = draft.lang || '';
  } catch { LANGS = null; }
  renderLang();
}
function renderLang() {
  const box = $('#d-lang');
  if (!box) return;
  const on = !!LANGS?.plugin && LANGS.languages.length > 0 && CFG.wpMode === 'selfhosted';
  box.classList.toggle('hidden', !on);
  if (!on) return;
  const sel = $('#d-lang-sel');
  sel.innerHTML = `<option value="">${escHtml(t('(sin idioma)'))}</option>` + LANGS.languages.map((l) => `<option value="${escHtml(l.code)}">${escHtml(l.name)} (${escHtml(l.code)})</option>`).join('');
  sel.value = draft.lang || '';
  const cur = LANGS.languages.find((l) => l.code === draft.lang);
  $('#lang-sum').textContent = cur ? cur.name : '';
  const list = $('#d-lang-list');
  list.innerHTML = '';
  const tr = draft.translations || {};
  const miss = Cpt.missingLangs(LANGS, { translations: tr });
  for (const l of LANGS.languages) {
    const id = tr[l.code];
    if (!id) continue;
    const row = document.createElement('div'); row.className = 'lang-row';
    row.innerHTML = `<span class="lang-code"></span><span class="lang-name"></span>`;
    $('.lang-code', row).textContent = l.code.toUpperCase(); $('.lang-name', row).textContent = l.name;
    if (id === draft.postId) row.insertAdjacentHTML('beforeend', `<span class="hint">${escHtml(t('esta'))}</span>`);
    else { const b = document.createElement('button'); b.className = 'btn tonal small'; b.type = 'button'; b.innerHTML = `<span class="ms">edit</span>${escHtml(t('Abrir'))}`; b.onclick = () => busy(b, () => openTranslation(id)); row.appendChild(b); }
    list.appendChild(row);
  }
  if (draft.postId) for (const l of miss) {
    const row = document.createElement('div'); row.className = 'lang-row missing';
    row.innerHTML = `<span class="lang-code"></span><span class="lang-name"></span>`;
    $('.lang-code', row).textContent = l.code.toUpperCase(); $('.lang-name', row).textContent = l.name;
    const b = document.createElement('button'); b.className = 'btn outlined small'; b.type = 'button'; b.innerHTML = `<span class="ms">add</span>${escHtml(t('Crear traducción al {l}', { l: l.name }))}`;
    b.onclick = () => busy(b, () => createTranslation(l));
    row.appendChild(b); list.appendChild(row);
  }
  if (!draft.postId) list.insertAdjacentHTML('beforeend', `<p class="hint">${escHtml(t('Envía la entrada a WordPress para poder crear sus traducciones.'))}</p>`);
}
$('#d-lang-sel')?.addEventListener('change', (e) => { draft.lang = e.target.value; renderLang(); autosaveSoon?.(); });

async function openTranslation(id) {
  if (draftDirty && !await ask(t('Tienes cambios sin enviar en esta entrada. ¿Abrir la traducción de todos modos?'))) return;
  await openFromWp(id, null, draft.type || 'post');
}
// Duplica la entrada como borrador en otro idioma y la enlaza con la original. Con IA configurada ofrece traducir los textos
// (título, extracto y bloques de texto): la estructura y las fotos no se tocan.
async function createTranslation(lang) {
  if (!draft.postId) return toast(t('Envía primero la entrada a WordPress.'), true);
  const useAi = CFG.aiConfigured && await ask(t('¿Traducir los textos al {l} con la IA? Se traducen el título, el extracto y los textos; la estructura y las fotos se quedan como están. Si no, la traducción será una copia para traducir a mano.', { l: lang.name }), { ok: t('Traducir con IA'), cancel: t('Solo copiar') });
  const E = window.BlockEditor;
  const blocks = cfClone(draft.blocks);
  const fresh = blocks.map((b) => E.cloneBlock(b)); // ids nuevos para los bloques copiados
  let title = $('#d-title').value.trim(), excerpt = $('#d-excerpt').value.trim();
  if (useAi) {
    const col = Cpt.collectTexts(fresh, (b) => E.kids(b));
    toast(t('La IA está traduciendo…'));
    const r = await window.api.aiTranslate({ title, excerpt, items: col.items, lang: `${lang.name} (${lang.code})` });
    if (r.title) title = r.title; if (r.excerpt || !excerpt) excerpt = r.excerpt || excerpt;
    col.apply(Object.fromEntries((r.items || []).map((x) => [x.id, x.html])));
  } else title = `${title} (${lang.code.toUpperCase()})`;
  const payload = {
    ...draftPayload('draft'), postId: null, title, excerpt, blocks: fresh, status: 'draft', scheduleAt: null, keepDate: false, date: null, slug: '', recreate: false, baseModified: null, keys: [],
    lang: lang.code, translationOf: draft.postId, offline: false,
  };
  const res = await window.api.publish(payload);
  if (res.queued) return toast(t('No se ha podido crear ahora: queda en la cola de envíos.'), true);
  toast(res.langError ? t('Traducción creada, pero WordPress no la ha enlazado: {e}', { e: res.langError }) : t('Traducción creada como borrador y enlazada a la original.'));
  exported = res.exported || exported; draftDirty = false;
  await openFromWp(res.postId, null, draft.type || 'post');
}
