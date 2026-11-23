// Ecos · Editor de entradas: panel lateral, buscadores y redes, autoguardado, IA, envío, visor y vista previa.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

// El editor (y la terminal) son capas a pantalla completa: van directamente en <body> para que se vean
// desde cualquier pantalla (antes el editor estaba dentro de «Redes» y desde Blog no se veía).
for (const id of ['#editor', '#term']) { const el = $(id); if (el && el.parentElement !== document.body) document.body.appendChild(el); }

// ---------------------------------------------------------------- Editor visual
async function makeDraft({ unifyDialog = false } = {}) {
  const chosen = posts.filter((p) => selected.has(keyOf(p)));
  // Varias publicaciones desde «Juntar en una entrada»: se pregunta cómo juntarlas
  const unify = unifyDialog && chosen.length > 1 ? await unifyDialogFor(chosen) : null;
  if (unifyDialog && chosen.length > 1 && !unify) return;
  const already = chosen.filter(liveExport);
  if (already.length && !await ask(t('{n} de las publicaciones elegidas ya están en el blog. ¿Crear otra entrada de todos modos?', { n: already.length }))) return;
  toast(t('Subiendo fotos a WordPress…'));
  draft = (await window.api.buildDraft(chosen, unify || undefined)) || {};
  if (unify?.ai) await unifyIntro(chosen);
  renderWpState(null);
  draft.excerpt = ''; draft.postId = null; draft.extraMedia = []; // postId: borrador ya guardado en WordPress
  draftKeys = chosen.flatMap(keysOf);
  openEditor();
  if (draft.failed?.length) toast(t('No se pudieron subir {n} archivo(s): {e}', { n: draft.failed.length, e: draft.failed[0] }), true);
  else if (draft.notes?.includes('video')) toast(t('Tu plan de WordPress no admite subir vídeos: se insertará el vídeo original de la red social.'));
}
$('#make').onclick = (e) => busy(e.target, () => makeDraft({ unifyDialog: true }));

// Diálogo «Juntar N publicaciones en una entrada». Devuelve las opciones de buildDraft (unify) o null si se cancela.
async function unifyDialogFor(chosen) {
  const sorted = [...chosen].sort((a, b) => new Date(a.date) - new Date(b.date));
  const title = await window.api.unifyTitle(chosen).catch(() => '');
  const seg = (name, items) => `<div class="seg full" data-seg="${name}">${items.map(([v, label], i) => `<label><input type="radio" name="un-${name}" value="${v}"${i ? '' : ' checked'}>${label}</label>`).join('')}</div>`;
  const row = (p) => {
    const f = p.media.find((m) => m.type === 'image') || p.media[0];
    const th = f && (f.url || (f.type === 'image' ? fileUrl(f.path) : null));
    return `<div class="un-row">${th ? `<img src="${escHtml(th)}" alt="">` : '<span class="un-noimg"><span class="ms">image</span></span>'}<span class="un-date">${fmtDate(p.date)}</span><span class="badge ${p.source}">${p.source === 'instagram' ? 'IG' : 'FB'}</span></div>`;
  };
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const d = document.createElement('div');
    d.className = 'dlg-scrim';
    d.innerHTML = `<div class="dlg un-dlg" role="dialog" aria-modal="true">
      <span class="ms fill dlg-ic">merge</span><p class="dlg-msg"></p>
      <div class="field"><label for="un-title">${t('Título')}</label><input id="un-title" type="text"></div>
      <div class="field"><label>${t('Estructura')}</label>${seg('layout', [['days', t('Por jornadas')], ['flow', t('Todo seguido')]])}</div>
      <div class="field"><label>${t('Fotos')}</label>${seg('photos', [['each', t('En cada jornada')], ['end', t('Todas al final en una galería')], ['carousel', t('Carrusel al principio')]])}</div>
      <label class="switch"><input type="checkbox" id="un-dedupe" checked><span>${t('Quitar lo repetido (hashtags, firmas y líneas iguales en todas)')}</span></label>
      ${CFG.aiConfigured ? `<label class="switch"><input type="checkbox" id="un-ai"><span>${t('Pedir a la IA una introducción')}</span></label>` : ''}
      <div class="un-list">${sorted.map(row).join('')}</div>
      <div class="dlg-actions"><button class="btn text" data-r="0">${t('Cancelar')}</button><button class="btn filled" data-r="1">${t('Crear entrada')}</button></div></div>`;
    $('.dlg-msg', d).textContent = t('Juntar {n} publicaciones en una entrada', { n: chosen.length });
    $('#un-title', d).value = title || '';
    const val = (n) => $(`input[name="un-${n}"]:checked`, d).value;
    const close = (v) => { d.classList.add('out'); setTimeout(() => d.remove(), 160); document.removeEventListener('keydown', key, true); prev?.focus?.(); resolve(v); };
    const done = () => close({ title: $('#un-title', d).value.trim(), layout: val('layout'), photos: val('photos'), dedupe: $('#un-dedupe', d).checked, ai: !!$('#un-ai', d)?.checked });
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); done(); } };
    $$('[data-r]', d).forEach((b) => (b.onclick = () => (b.dataset.r === '1' ? done() : close(null))));
    d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(d);
    $('[data-r="1"]', d).focus();
  });
}
// Párrafo introductorio escrito por la IA como primer bloque; si falla, se sigue sin él
async function unifyIntro(chosen) {
  try {
    toast(t('La IA está escribiendo la introducción…'));
    const text = [...chosen].sort((a, b) => new Date(a.date) - new Date(b.date)).map((p) => p.text.replace(/#[\p{L}\p{N}_]+/gu, '').trim()).join('\n\n');
    const html = await window.api.aiRewrite({ html: escHtml(text).replace(/\n/g, '<br>'), action: 'intro', title: draft.title, kind: 'paragraph' });
    const clean = String(html || '').replace(/<br\s*\/?>(\s*<br\s*\/?>)*/gi, ' ').trim();
    if (clean) draft.blocks = [window.BlockEditor.create('paragraph', { html: clean }), ...draft.blocks];
  } catch (e) { toast(t('No se pudo escribir la introducción con la IA; sigues sin ella.'), true); }
}

// Abre en el editor de Ecos una entrada que ya está en WordPress (desde una publicación o desde el Blog).
// Al enviar se actualiza esa misma entrada.
async function openFromWp(postId, keys, type = 'post', opts = {}) {
  toast(type === 'page' ? t('Abriendo la página de WordPress…') : t('Abriendo la entrada de WordPress…'));
  const r = (await window.api.pullPost(postId, type)) || {};
  r.blocks = Array.isArray(r.blocks) ? r.blocks : [];
  exported = r.exported || exported;
  const imgs = window.BlockEditor.flat(r.blocks).flatMap((b) => (b.img ? [b.img] : b.images || []));
  const vids = window.BlockEditor.flat(r.blocks).filter((b) => b.type === 'video' && b.video?.id).map((b) => ({ ...b.video, type: 'video' }));
  draft = {
    title: r.title, excerpt: r.excerpt || '', slug: r.slug || '', tags: r.tags || [], categories: r.categories || [], blocks: r.blocks,
    featuredImageId: r.featured || null, keepFeaturedInBody: true, date: r.date, postId, previewOnly: false, wpStatus: r.status, sections: [], sourceText: '',
    type: type === 'page' ? 'page' : 'post', parent: r.parent || 0, seoDesc: r.seoDesc || '', pageBg: r.pageBg || null,
    extraMedia: [...(r.featuredImg ? [{ ...r.featuredImg, type: 'image' }] : []), ...imgs.map((i) => ({ ...i, type: i.type || 'image' })), ...vids],
  };
  draftKeys = keys || Object.entries(exported).filter(([, v]) => v.postId === postId).map(([k]) => k);
  openEditor();
  renderWpState(r.status, r.url);
  // «Convertir en página de Ecos» desde el Blog o la pantalla Estructura: se abre y se convierte de una vez
  if (opts.convert) {
    if (spectraCount()) await convertSpectraDraft();
    else toast(type === 'page' ? t('Esta página no tiene bloques de Spectra: se ha abierto tal cual.') : t('Esta entrada no tiene bloques de Spectra: se ha abierto tal cual.'));
  }
}

// Abre el editor de Ecos con un borrador en blanco (entrada o página). La usan el Blog y la pantalla Estructura.
// Al enviar se crea en WordPress con el tipo correcto; la fecha es la de hoy (o la que se programe).
function newDraft(opts = {}) {
  // Antes de abrir el editor se elige una plantilla (o «En blanco»); si se cierra el selector, no se crea nada
  return pickTemplate(opts.type === 'page' ? 'page' : 'post').then((tpl) => { if (tpl) startDraft(opts, tpl); });
}
function startDraft({ type = 'post', title = '', categories: preCats = [], parent = 0, scheduleAt = '' } = {}, tpl = null) {
  const page = type === 'page';
  const BE = window.BlockEditor;
  const blocks = tpl && tpl.blocks && tpl.blocks.length ? BE.fromTemplate(tpl.blocks) : [BE.create('paragraph')];
  let cats = page ? [] : (preCats && preCats.length ? [...preCats] : undefined);
  // La plantilla marca su categoría solo si existe en el blog
  const hit = !page && tpl && tpl.category ? categories.find((c) => c.name.toLowerCase() === tpl.category.toLowerCase()) : null;
  if (hit && !(cats || []).some((c) => c.toLowerCase() === hit.name.toLowerCase())) cats = [...(cats || []), hit.name];
  draft = {
    title, excerpt: '', slug: '', tags: [], categories: cats,
    blocks, featuredImageId: null, keepFeaturedInBody: true, date: null, postId: null,
    previewOnly: false, wpStatus: null, sections: [], sourceText: '', extraMedia: [], type: page ? 'page' : 'post', parent: Number(parent) || 0, isNew: true,
  };
  draftKeys = [];
  renderWpState(null);
  openEditor();
  // Con scheduleAt («AAAA-MM-DDTHH:MM», hora local) la entrada nueva queda marcada para programar
  if (scheduleAt && !page) { $$('input[name="d-when"]').forEach((r) => (r.checked = r.value === 'future')); $('#d-schedule').value = scheduleAt; toggleSchedule(); }
  $('#d-title').focus();
}

// Fotos y vídeos disponibles para la entrada (subidos a WordPress): alimentan la bandeja del editor
// Al escribir en el título, el extracto u otro campo que no es un bloque, la barra de formato deja de
// apuntar al último bloque (si no, centrar «el título» centraba el párrafo de debajo)
document.addEventListener('focusin', (e) => {
  const E = window.BlockEditor;
  if (!E?.active || !e.target.closest('#editor') || e.target.closest('.blk') || e.target.closest('.fmt-bar, #fmt-bar, .format-bar')) return;
  if (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  E.active = null; window.FormatBar?.update();
});
function mediaPool() {
  const seen = new Set(), out = [];
  const add = (m) => { if (m && m.id && !seen.has(m.id)) { seen.add(m.id); out.push(m); } };
  for (const s of draft.sections || []) { s.images.forEach((i) => add({ ...i, type: 'image' })); s.videos.forEach((v) => add({ ...v, type: 'video' })); }
  for (const m of draft.extraMedia || []) add(m);
  const hidden = new Set(draft.hiddenMedia || []); // quitadas de la bandeja con su ✕
  return out.filter((m) => !hidden.has(m.id));
}

// Si WordPress o la IA devuelven un borrador sin algunos campos (bloques, etiquetas, categorías…), se rellenan
function fixDraftShape() {
  if (!draft || typeof draft !== 'object') draft = {};
  const A = (x) => (Array.isArray(x) ? x : []);
  draft.title = draft.title == null ? '' : String(draft.title);
  draft.blocks = A(draft.blocks); draft.tags = A(draft.tags).map(String); draft.sections = A(draft.sections); draft.extraMedia = A(draft.extraMedia);
  if (draft.categories != null) draft.categories = A(draft.categories).map(String);
  if (!draft.blocks.length && window.BlockEditor?.create) draft.blocks = [window.BlockEditor.create('paragraph')];
}
function openEditor() {
  fixDraftShape();
  $('#sent').classList.add('hidden'); $('#send').classList.remove('hidden');
  $('#d-title').value = draft.title;
  requestAnimationFrame(autoTitle); document.fonts?.ready.then(autoTitle);
  $('#d-excerpt').value = draft.excerpt || '';
  $('#d-slug').value = draft.slug || '';
  $('#d-seodesc').value = draft.seoDesc || ''; $('#d-kw').value = draft.focusKw || '';
  loadSeoInfo();
  renderPageBg();
  $('#d-tags').value = draft.tags.join(', ');
  const f = CFG.format || {};
  const defCats = (f.categories || '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
  renderCats(draft.categories ? draft.categories.map((c) => c.toLowerCase()) : defCats);
  const when = draft.wpStatus ? (draft.wpStatus === 'publish' ? 'publish' : draft.wpStatus === 'future' ? 'future' : 'draft') : f.status || 'draft';
  $$('input[name="d-when"]').forEach((r) => (r.checked = r.value === when));
  $('#d-schedule').value = '';
  // Fecha original: activada por defecto y con la fecha a la vista
  $('#d-keepdate').checked = prefs().keepDate !== false;
  $('#d-keepdate-label').textContent = t('Fecha original ({d})', { d: draft.date ? fmtDay(draft.date) : '' });
  // Borrador en blanco: no hay fecha original que conservar
  $('#d-keepdate').closest('label').classList.toggle('hidden', !!draft.isNew);
  applyDraftType();
  $('#d-template').innerHTML = `<option value="">${t('Sin plantilla')}</option>` + (CFG.templates || []).map((tp, i) => `<option value="${i}">${escHtml(tp.name)}</option>`).join('');
  // Sin IA configurada, los botones se muestran desactivados y explican por qué al pasar el ratón
  $$('#ai-article, #ai-alts').forEach((b) => { b.disabled = !CFG.aiConfigured; b.parentElement.title = CFG.aiConfigured ? '' : t('Configura una IA en «Conexiones» para usar estos botones.'); });
  toggleSchedule();
  if (!draft.blocks) draft.blocks = [];
  window.BlockEditor.mount(draft, {
    media: mediaPool(),
    onChange: () => { window.BlockEditor.renderMedia(); window.FormatBar.review(); autosaveSoon(); renderShare(); renderSpectraNote(); },
    onOpenMedia: (m) => {
      const pool = mediaPool();
      openLightbox(pool.map((x) => ({ type: x.type, src: x.url, poster: x.poster })), Math.max(0, pool.findIndex((x) => x.id === m.id)));
    },
    // Estilo «vecinas asomando»: se copia para pegarlo una vez en la web
    onPeekCss: async () => {
      navigator.clipboard.writeText(await window.api.peekCss());
      await ask(t('Estilo copiado. Pégalo una sola vez en tu WordPress: Apariencia → Personalizar → CSS adicional, y pulsa «Publicar». Desde entonces todos los carruseles con «Vecinas asomando» se verán así (sin él, se ven de foto en foto).'), { ok: t('Entendido'), cancel: null });
    },
  });
  $('#editor').classList.remove('hidden');
  document.body.classList.add('editing');
  $('#ed-canvas').scrollTop = 0;
  draftDirty = false;
  renderShare();
  updateCount();
  updateHistoryBtn();
  renderSpectraNote();
}
// Modo página: sin categorías ni etiquetas, con «Página superior»; la barra dice «Página»
const isPageDraft = () => draft?.type === 'page';
function applyDraftType() {
  const page = isPageDraft();
  ['#d-tags-field', '#d-cats-label', '#d-cats'].forEach((s) => $(s).classList.toggle('hidden', page));
  $('#d-parent-field').classList.toggle('hidden', !page);
  $('#ed-bar-title').textContent = page ? t('Página') : t('Entrada');
  // En una página el lienzo es más ancho para ver el diseño a lo ancho
  $('#editor').classList.toggle('page-mode', page);
  if (page) fillParents(draft.parent || 0);
}
let sitePagesCache = null;
async function fillParents(sel) {
  const box = $('#d-parent');
  const set = (list) => {
    const byId = new Map(list.map((p) => [p.id, p]));
    const depth = (p) => { let n = 0, q = p; while (q && q.parent && byId.has(q.parent) && n < 6) { q = byId.get(q.parent); n++; } return n; };
    box.innerHTML = `<option value="0">${t('(ninguna)')}</option>` + list.filter((p) => p.id !== draft.postId)
      .map((p) => `<option value="${p.id}">${'— '.repeat(depth(p))}${escHtml(decodeEntities(p.title))}</option>`).join('');
    box.value = String(sel || 0);
    if (box.value !== String(sel || 0)) box.value = '0';
  };
  set(sitePagesCache || []);
  try { sitePagesCache = await window.api.sitePages(); if (isPageDraft()) set(sitePagesCache || []); } catch (e) { toastError(e); }
}
$('#d-parent').onchange = () => autosaveSoon();
// El título crece en varias líneas (y no admite saltos de línea)
const autoTitle = () => { const el = $('#d-title'); el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
$('#d-title').oninput = () => { autoTitle(); autosaveSoon(); };
['#d-excerpt', '#d-tags', '#d-slug', '#d-seodesc', '#d-kw'].forEach((s) => $(s)?.addEventListener('input', () => { autosaveSoon(); renderShare(); }));
$('#d-title').addEventListener('input', () => renderShare());
$('#d-slug').addEventListener('blur', () => { $('#d-slug').value = slugify($('#d-slug').value); renderShare(); });

// ---------------------------------------------------------------- Buscadores y redes
// «¡Primer día en Rabat!» → «primer-dia-en-rabat» (como hace WordPress)
const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
// Bloque «Cómo se verá»: vista previa en Google y en redes, contadores, avisos, sugerencias de la IA.
// La lógica pura (cortes, niveles, avisos, mensajes) está en app/seo.js.
let seoInfo = { plugin: null, key: null, writable: false }; // plugin SEO de la web (si lo hay y deja escribir su campo)
let wpSt = null, wpUrl = ''; // estado y dirección de la entrada en WordPress
let shareTab = 'google', seoSugg = null;
async function loadSeoInfo() {
  seoInfo = { plugin: null, key: null, writable: false }; seoSugg = null;
  try { if (CFG.wpMode === 'selfhosted') seoInfo = (await window.api.wpSeoInfo()) || seoInfo; } catch { /* sin conexión: se usa el extracto */ }
  $('#seo-desc-field').classList.toggle('hidden', !seoInfo.writable);
  renderShare();
}
// Campo donde vive la descripción para buscadores
const seoField = () => (seoInfo.writable ? $('#d-seodesc') : $('#d-excerpt'));
const siteHost = () => (CFG.wpPublicUrl || 'https://' + (CFG.wpSite || 'tu-web.com')).replace(/\/$/, '').replace(/^https?:\/\//, '');
const shareImage = () => {
  const all = [...window.BlockEditor.flat(draft.blocks || []).flatMap((b) => (b.img ? [b.img] : b.images || [])), ...(window.BlockEditor?.media || []), ...(draft.extraMedia || [])];
  return all.find((i) => i.id === draft.featuredImageId) || all.find((i) => i.type !== 'video' && i.url);
};
const SEO_PLUGIN = { yoast: 'Yoast SEO', rankmath: 'Rank Math' };
function seoWarnTexts(w) {
  return w.map((x) => ({
    titleLong: t('El título tiene {n} caracteres: Google lo cortará a partir del 60.', { n: x.n }),
    noDesc: t('Falta la descripción: Google elegirá un trozo del texto.'),
    descLong: t('La descripción tiene {n} caracteres: Google la cortará a partir del 155.', { n: x.n }),
    kwTitle: t('La palabra clave no aparece en el título.'),
    noImage: t('Sin imagen destacada: al compartir no saldrá foto.'),
    slugLong: t('La dirección de la entrada es muy larga ({n} caracteres): mejor más corta.', { n: x.n }),
  }[x.code]));
}
function renderShare() {
  const box = $('#d-share'); if (!box || !draft) return;
  const host = siteHost();
  const title = $('#d-title').value.trim();
  const slug = slugify($('#d-slug').value) || slugify(title);
  $('#d-slug').placeholder = slugify(title) || 'direccion-de-la-entrada';
  $('#d-slug-base').textContent = host + '/…/';
  const img = shareImage();
  const plain = window.BlockEditor?.plainText?.() || '';
  const real = seoField().value.trim(); // lo que de verdad se guardará
  const desc = real || Seo.cut(plain, 200);
  const shownTitle = title || t('Sin título');
  const warn = seoWarnTexts(Seo.warnings({ title, desc: real, keyword: $('#d-kw').value, hasImage: !!draft.featuredImageId, slug }));
  const help = seoInfo.writable ? t('La descripción se guarda en el campo de {p}.', { p: SEO_PLUGIN[seoInfo.plugin] || 'SEO' })
    : seoInfo.plugin ? t('Tu web tiene {p}, pero no deja escribir su descripción desde Ecos: se usa el extracto de arriba.', { p: SEO_PLUGIN[seoInfo.plugin] })
      : t('Tu web no tiene un plugin de SEO: la descripción para buscadores es el extracto de arriba.');
  const cnt = (n, lv, max) => `<span class="seo-count ${lv}">${n}/${max}</span>`;
  const tl = Seo.clean(title).length, dl = Seo.clean(real).length;
  const sg = seoSugg ? `<div class="seo-sugg"><b>${t('Propuesta de la IA')}</b>
      ${seoSugg.title ? `<div class="seo-sg-row"><div><small>${t('Título')} · ${Seo.clean(seoSugg.title).length}</small><div>${escHtml(seoSugg.title)}</div></div><button class="btn tonal small" data-seo="use-title">${t('Usar')}</button></div>` : ''}
      ${seoSugg.description ? `<div class="seo-sg-row"><div><small>${t('Descripción')} · ${Seo.clean(seoSugg.description).length}</small><div>${escHtml(seoSugg.description)}</div></div><button class="btn tonal small" data-seo="use-desc">${t('Usar')}</button></div>` : ''}
      <button class="btn text small" data-seo="discard">${t('Descartar')}</button></div>` : '';
  const canShare = wpSt === 'publish' && CFG.metaConnected && wpUrl && CFG.shareFacebook === true;
  box.innerHTML = `<div class="section-label">${t('Cómo se verá')}</div>
    <div class="seo-tabs" role="tablist"><button role="tab" class="${shareTab === 'google' ? 'on' : ''}" data-seo="tab-google">Google</button><button role="tab" class="${shareTab === 'social' ? 'on' : ''}" data-seo="tab-social">${t('Redes')}</button></div>
    ${shareTab === 'google'
    ? `<div class="sc-google"><div class="sc-g-url">${escHtml(host)} › ${escHtml(slug)}</div><div class="sc-g-title">${escHtml(Seo.cut(shownTitle, 60))}</div><div class="sc-g-desc">${escHtml(Seo.cut(desc, 155))}</div></div>`
    : `<div class="sc-card">${img ? `<img src="${escHtml(img.url)}" alt="">` : '<div class="sc-noimg"><span class="ms">image</span></div>'}
      <div class="sc-body"><div class="sc-host">${escHtml(host.toUpperCase())}</div><div class="sc-title">${escHtml(shownTitle)}</div><div class="sc-desc">${escHtml(Seo.cut(desc, 160))}</div></div></div>`}
    <div class="seo-counts"><span>${t('Título')} ${cnt(tl, Seo.titleLevel(title), 60)}</span><span>${t('Descripción')} ${cnt(dl, Seo.descLevel(real), 155)}</span></div>
    <div class="hint seo-help">${escHtml(help)}</div>
    ${warn.length ? `<ul class="seo-warns">${warn.map((x) => `<li><span class="ms">warning</span>${escHtml(x)}</li>`).join('')}</ul>` : `<div class="seo-ok"><span class="ms">check_circle</span>${t('Todo en orden para buscadores.')}</div>`}
    ${sg}
    <div class="seo-actions">
      ${CFG.aiConfigured ? `<button class="btn tonal small" data-seo="ai"><span class="ms">auto_awesome</span>${t('Sugerir con IA')}</button>` : ''}
      ${canShare ? `<button class="btn tonal small" data-seo="fb"><span class="ms">share</span>${t('Compartir en Facebook')}</button>` : ''}
    </div>`;
}
$('#d-share').addEventListener('click', (e) => {
  const b = e.target.closest('[data-seo]'); if (!b) return;
  const act = b.dataset.seo;
  if (act === 'tab-google' || act === 'tab-social') { shareTab = act.slice(4); return renderShare(); }
  if (act === 'discard') { seoSugg = null; return renderShare(); }
  if (act === 'use-title') { $('#d-title').value = seoSugg.title; autoTitle(); seoSugg.title = ''; autosaveSoon(); }
  if (act === 'use-desc') { seoField().value = seoSugg.description; seoSugg.description = ''; autosaveSoon(); }
  if (act === 'use-title' || act === 'use-desc') { if (!seoSugg.title && !seoSugg.description) seoSugg = null; return renderShare(); }
  if (act === 'fb') return openFbShare();
  if (act === 'ai') {
    return busy(b, async () => {
      const r = await window.api.aiSeo({ title: $('#d-title').value.trim(), text: window.BlockEditor.plainText(), keyword: $('#d-kw').value.trim() });
      seoSugg = { title: r.title || '', description: r.description || '' }; renderShare();
    });
  }
});

// ---------------------------------------------------------------- Compartir en Facebook / Instagram
const copyText = async (s) => {
  try { await navigator.clipboard.writeText(s); return true; } catch { /* sin permiso: se prueba con un campo temporal */ }
  const ta = document.createElement('textarea'); ta.value = s; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* nada */ }
  ta.remove(); return ok;
};
async function openFbShare() {
  const link = wpUrl || lastSent?.url || '';
  if (!link) return toast(t('La entrada tiene que estar publicada para poder compartirla.'), true);
  let accs = [];
  try { accs = await window.api.metaAccounts(); } catch (e) { return toast(e.message || String(e), true); }
  if (!accs.length) return toast(t('Conecta primero con Meta en Conexiones.'), true);
  const title = $('#d-title').value.trim() || t('Sin título');
  const img = shareImage();
  const desc = $('#d-excerpt').value.trim() || Seo.cut(window.BlockEditor.plainText(), 160);
  const defId = $('#page')?.value;
  const prev = document.activeElement;
  const d = document.createElement('div');
  d.className = 'dlg-scrim';
  d.innerHTML = `<div class="dlg fbs" role="dialog" aria-modal="true">
    <h3>${t('Compartir en Facebook')}</h3>
    <div class="field"><label>${t('Página de Facebook')}</label><select id="fbs-page">${accs.map((a) => `<option value="${escHtml(a.pageId)}"${a.pageId === defId ? ' selected' : ''}>${escHtml(a.pageName)}</option>`).join('')}</select></div>
    <div class="field"><label>${t('Texto de la publicación')}</label><textarea id="fbs-text" rows="6"></textarea>
      <div class="hint">${t('El enlace de la entrada se añade solo y Facebook lo muestra como tarjeta.')}</div></div>
    <div class="sc-card">${img ? `<img src="${escHtml(img.url)}" alt="">` : '<div class="sc-noimg"><span class="ms">image</span></div>'}
      <div class="sc-body"><div class="sc-host">${escHtml(siteHost().toUpperCase())}</div><div class="sc-title">${escHtml(title)}</div><div class="sc-desc">${escHtml(Seo.cut(desc, 160))}</div></div></div>
    <div class="hint fbs-prev">${escHtml(link)}</div>
    <div class="hint fbs-ig">${t('Instagram no permite publicar enlaces: copia el texto y pégalo en Instagram («enlace en la bio»).')}</div>
    <div class="fbs-err hidden" role="alert"></div>
    <div class="dlg-actions"><button class="btn text" data-r="close">${t('Cancelar')}</button><button class="btn tonal" data-r="ig"><span class="ms">content_copy</span>${t('Copiar texto para Instagram')}</button><button class="btn filled" data-r="fb"><span class="ms">send</span>${t('Publicar en Facebook')}</button></div></div>`;
  $('#fbs-text', d).value = Seo.prefill($('#d-excerpt').value, window.BlockEditor.plainText());
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const close = () => { d.classList.add('out'); setTimeout(() => d.remove(), 160); document.removeEventListener('keydown', key, true); prev?.focus?.(); };
  d.addEventListener('mousedown', (e) => { if (e.target === d) close(); });
  document.addEventListener('keydown', key, true);
  $('[data-r="close"]', d).onclick = close;
  $('[data-r="ig"]', d).onclick = async () => {
    const txt = Seo.igText($('#fbs-text', d).value, t('Enlace en la bio'));
    toast(await copyText(txt) ? t('Texto copiado para Instagram.') : t('No se pudo copiar el texto.'), false);
  };
  $('[data-r="fb"]', d).onclick = (e) => busy(e.currentTarget, async () => {
    const err = $('.fbs-err', d); err.classList.add('hidden');
    const pageId = $('#fbs-page', d).value;
    const done = Object.values(exported || {}).find((x) => x.postId === draft.postId && x.sharedFb);
    if (done && !await ask(t('Esta entrada ya se compartió en Facebook ({p}) el {d}. ¿Compartirla otra vez?', { p: done.sharedFb.pageName || 'Facebook', d: fmtDate(done.sharedFb.at) }), { ok: t('Compartir otra vez') })) return;
    const m = Seo.fbMessage($('#fbs-text', d).value, link);
    try {
      const r = await window.api.metaShare({ pageId, message: m.message, link: m.link, postId: draft.postId });
      exported = r.exported || exported;
      close();
      toast(t('Compartido en Facebook.'));
      if (r.url && await ask(t('Entrada compartida en Facebook. ¿Quieres verla?'), { ok: t('Ver en Facebook'), cancel: t('Cerrar') })) window.api.open(r.url);
    } catch (ex) {
      const msg = String(ex.message || ex);
      if (/NEED_PUBLISH_PERMISSION/.test(msg)) {
        // falta el permiso de publicar: se pide aparte (y se explica qué hacer si la app de Meta no lo tiene)
        err.innerHTML = `${t('Para publicar en tu página, Ecos necesita el permiso de Meta «Publicar en la página» (pages_manage_posts).')}
          <button class="btn tonal small" data-perm>${t('Conceder permiso')}</button>
          <details><summary>${t('Si Meta dice «Invalid Scopes»')}</summary>${t('Tu app de Meta aún no tiene ese permiso. En developers.facebook.com → tu app → Casos de uso → «Administrar todo en tu página» (o Facebook Login) → Personalizar → Permisos, añade «pages_manage_posts». Después pulsa «Conceder permiso» otra vez.')}</details>`;
        err.classList.remove('hidden');
        $('[data-perm]', err).onclick = (ev) => busy(ev.currentTarget, async () => {
          await window.api.metaLogin({ publish: true });
          err.classList.add('hidden');
          toast(t('Permiso concedido. Pulsa «Publicar en Facebook» otra vez.'));
        });
      } else { err.textContent = msg; err.classList.remove('hidden'); }
    }
  });
  document.body.appendChild(d);
  $('#fbs-text', d).focus();
}

// ---------------------------------------------------------------- Autoguardado del borrador
let draftDirty = false, autosaveTimer = null;
const editorOpen = () => !$('#editor').classList.contains('hidden');
function autosaveSoon() { if (!editorOpen()) return; draftDirty = true; clearTimeout(autosaveTimer); autosaveTimer = setTimeout(autosaveNow, 2500); }
async function autosaveNow() {
  clearTimeout(autosaveTimer);
  if (!draft) return;
  const p = draftPayload($('input[name="d-when"]:checked')?.value || 'draft');
  try { await window.api.autosave({ draft: { ...draft, title: p.title, excerpt: p.excerpt, tags: p.tags, categories: p.categories, parent: p.parent, slug: $('#d-slug')?.value || '', seoDesc: $('#d-seodesc')?.value || '', focusKw: $('#d-kw')?.value || '' }, keys: draftKeys }); } catch { /* bloqueada o sin disco */ }
}
async function showRecoverBanner() {
  let a; try { a = await window.api.autosaved(); } catch { return; }
  $('#bn-recover')?.remove();
  if (!a?.draft) return;
  const when = fmtDate(a.savedAt);
  banner('recover', `<span class="ms">history</span><span>${t('Tienes una entrada sin enviar: «{t}» (guardada el {d}).', { t: escHtml(a.draft.title || t('Sin título')), d: when })}</span>`, [
    [t('Recuperar'), async () => { draft = a.draft; draftKeys = a.keys || []; renderWpState(null); openEditor(); if (draft.slug && $('#d-slug')) $('#d-slug').value = draft.slug; $('#bn-recover')?.remove(); draftDirty = true; toast(t('Entrada recuperada.')); }],
    [t('Descartar'), async () => { if (!await ask(t('¿Descartar la entrada guardada? No se podrá recuperar.'), { danger: true })) return; await window.api.autosaveClear(); $('#bn-recover')?.remove(); }],
  ]);
}
new ResizeObserver(() => autoTitle()).observe($('#ed-canvas')); // al cambiar el ancho, el título vuelve a encajar
$('#d-title').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const first = $('#d-blocks [contenteditable]'); first?.focus(); } };
const closeEditor = async () => {
  if (!$('#sent').classList.contains('hidden') || !draftDirty || await ask(t('¿Cerrar el editor? La entrada queda guardada en este ordenador y podrás recuperarla desde «Redes».'))) {
    if (draftDirty) { await autosaveNow(); showRecoverBanner(); }
    $('#editor').classList.add('hidden'); document.body.classList.remove('editing'); updateCount();
  }
};
$('#ed-close').onclick = closeEditor;
$('#ed-undo').onclick = () => window.BlockEditor.doUndo();
$('#ed-redo').onclick = () => window.BlockEditor.doRedo();
document.addEventListener('keydown', (e) => {
  if ($('#editor').classList.contains('hidden') || !(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  // Deshacer/rehacer de bloques fuera de los textos (dentro del texto actúa el del navegador)
  if (k === 'z' && !e.target.isContentEditable && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.shiftKey ? window.BlockEditor.doRedo() : window.BlockEditor.doUndo(); }
  if (k === 'y' && !e.target.isContentEditable) { e.preventDefault(); window.BlockEditor.doRedo(); }
  if (k === 's') { e.preventDefault(); $('#send').click(); }
});
$('#d-keepdate').onchange = () => savePrefs({ keepDate: $('#d-keepdate').checked });
const toggleSchedule = () => $('#d-schedule').classList.toggle('hidden', $('input[name="d-when"]:checked')?.value !== 'future');
$$('input[name="d-when"]').forEach((r) => (r.onchange = () => { toggleSchedule(); if (r.value === 'future') $('#d-schedule').focus(); }));

// Subir más fotos desde el ordenador a la bandeja
// Pegar imágenes (Ctrl+V, «Pegar» del botón derecho o el botón «Pegar imagen»): se suben a la biblioteca y
// entran como bloques de imagen debajo del bloque en el que se está escribiendo
async function pasteImages(files) {
  const E = window.BlockEditor;
  if (!files.length || !draft) return;
  toast(files.length === 1 ? t('Subiendo la imagen pegada…') : t('Subiendo {n} imágenes pegadas…', { n: files.length }));
  const ups = [];
  for (const f of files) {
    try { ups.push(await window.api.uploadPasted(new Uint8Array(await f.arrayBuffer()), f.name || '', f.type || 'image/png')); } catch (e) { toastError(e); }
  }
  if (!ups.length) return;
  draft.extraMedia = [...(draft.extraMedia || []), ...ups];
  E.media = mediaPool();
  const at = E.active?.b ? draft.blocks.indexOf(E.active.b) + 1 : draft.blocks.length;
  const blocks = ups.map((img) => E.create('image', { img: { id: img.id, url: img.url, alt: '' } }));
  E.change(() => draft.blocks.splice(at < 1 ? draft.blocks.length : at, 0, ...blocks));
  E.renderMedia();
  toast(ups.length === 1 ? t('Imagen añadida a la entrada') : t('{n} imágenes añadidas a la entrada', { n: ups.length }));
}
const clipImages = (dt) => [...(dt?.items || [])].filter((i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile()).filter(Boolean);
// antes que el pegado de texto de cada bloque (fase de captura)
$('#editor').addEventListener('paste', (e) => {
  const files = clipImages(e.clipboardData);
  if (!files.length) return; // texto: lo trata el bloque
  e.preventDefault(); e.stopPropagation();
  pasteImages(files);
}, true);
$('#d-media-paste').onclick = (e) => busy(e.currentTarget, async () => {
  let items;
  try { items = await navigator.clipboard.read(); } catch { throw new Error(t('No se ha podido leer el portapapeles.')); }
  const files = [];
  for (const it of items) { const type = it.types.find((x) => /^image\//.test(x)); if (type) files.push(new File([await it.getType(type)], '', { type })); }
  if (!files.length) throw new Error(t('No hay ninguna imagen copiada. Copia una imagen (por ejemplo con clic derecho → Copiar imagen, o Win+Mayús+S) y vuelve a intentarlo.'));
  await pasteImages(files);
});
$('#d-media-add').onclick = (e) => busy(e.target, async () => {
  const added = await window.api.uploadMedia();
  if (!added?.length) return;
  draft.extraMedia = [...(draft.extraMedia || []), ...added];
  window.BlockEditor.media = mediaPool(); window.BlockEditor.renderMedia();
  toast(t('{n} archivo(s) añadidos a la bandeja', { n: added.length }));
});

function renderCats(checkedNames) {
  const box = $('#d-cats');
  if (!categories.length) { box.innerHTML = `<span class="hint">${t('No se han podido cargar las categorías del blog.')}</span>`; return; }
  box.innerHTML = categories.map((c) => `<label class="chip"><input type="checkbox" value="${escHtml(c.name)}" ${checkedNames.includes(c.name.toLowerCase()) ? 'checked' : ''}>${escHtml(c.name)}</label>`).join('');
}

// Plantillas
$('#d-template').onchange = () => {
  const tp = (CFG.templates || [])[$('#d-template').value];
  if (!tp) return;
  if (tp.categories) renderCats(tp.categories.split(',').map((c) => c.trim().toLowerCase()));
  if (tp.tags) {
    const cur = $('#d-tags').value.split(',').map((x) => x.trim()).filter(Boolean);
    $('#d-tags').value = [...new Set([...cur, ...tp.tags.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean)])].join(', ');
  }
  if (tp.status) { $$('input[name="d-when"]').forEach((r) => (r.checked = r.value === tp.status)); toggleSchedule(); }
  toast(t('Plantilla «{p}» aplicada', { p: tp.name }));
};

// Opciones de «Convertir en artículo» (se configuran antes de pulsar y se recuerdan)
const AI_OPTS_DEF = { length: 'same', tone: 'same', web: false, headings: true, spelling: true, notes: '' };
const aiOpts = () => ({ ...AI_OPTS_DEF, ...(prefs().aiArticle || {}) });
function renderAiOpts() {
  const o = aiOpts();
  $$('#ai-opts [data-opt]').forEach((el) => {
    const k = el.dataset.opt;
    if (el.classList.contains('seg')) $$('button', el).forEach((b) => b.classList.toggle('active', b.dataset.v === o[k]));
    else if (el.type === 'checkbox') el.checked = !!o[k];
    else el.value = o[k] || '';
  });
  const L = { shorter: t('más breve'), longer: t('más extensa') }, T = { friendly: t('cercano'), formal: t('formal'), activist: t('reivindicativo') };
  $('#ai-opts-sum').textContent = [L[o.length], T[o.tone], o.web && t('con internet')].filter(Boolean).join(' · ');
}
const saveAiOpts = (patch) => savePrefs({ aiArticle: { ...aiOpts(), ...patch } }).then(renderAiOpts);
$$('#ai-opts [data-opt]').forEach((el) => {
  const k = el.dataset.opt;
  if (el.classList.contains('seg')) $$('button', el).forEach((b) => (b.onclick = () => saveAiOpts({ [k]: b.dataset.v })));
  else if (el.type === 'checkbox') el.onchange = () => saveAiOpts({ [k]: el.checked });
  else el.onchange = () => saveAiOpts({ [k]: el.value.trim() });
});
renderAiOpts();

// IA en el editor: el texto se reescribe con las opciones elegidas; las fotos, vídeos y su orden se conservan
$('#ai-article').onclick = (e) => busy(e.target, async () => {
  const TEXT = ['paragraph', 'heading', 'quote', 'list'];
  if (draft.blocks.some((b) => TEXT.includes(b.type)) && !await ask(t('La IA reescribirá los textos de la entrada (las fotos y vídeos se quedan). ¿Continuar?'))) return;
  const opts = { ...aiOpts(), notes: $('#ai-opts [data-opt="notes"]').value.trim() };
  const E0 = window.BlockEditor;
  // Hay texto en la entrada: se reescribe por tramos y cada bloque que no es texto se queda exactamente donde está
  const seg = aiSegments(draft.blocks, E0);
  if (seg.segments.length) {
    const r = await window.api.aiArticle({ title: $('#d-title').value, text: seg.segments.map((s) => s.text).join('\n\n'), segments: seg.segments, layout: seg.layout, opts });
    if (r.title) { $('#d-title').value = r.title; autoTitle(); }
    if (r.excerpt) $('#d-excerpt').value = r.excerpt;
    let missing = 0;
    E0.change(() => {
      // de atrás adelante, para que los índices de cada tramo sigan valiendo
      for (const run of [...seg.runs].reverse()) {
        const got = (r.sections || []).find((s) => s.id === run.id);
        const nb = got && aiBlocks(got.blocks, E0, run.blocks);
        if (!nb || !nb.length) { missing++; continue; }
        run.arr.splice(run.start, run.blocks.length, ...nb);
      }
      if (r.sources?.length) draft.blocks.push(E0.create('heading', { level: 3, html: escHtml(t('Fuentes')) }), E0.create('list', { items: r.sources.map((s) => `<a href="${escHtml(s.url)}">${escHtml(s.title || s.url)}</a>`) }));
    });
    const cur = $('#d-tags').value.split(',').map((x) => x.trim()).filter(Boolean);
    $('#d-tags').value = [...new Set([...cur, ...(r.tags || [])])].join(', ');
    toast(missing ? t('Listo. {n} tramo(s) se han dejado como estaban porque la IA no los devolvió. Revisa el texto antes de enviarlo.', { n: missing }) : t('Listo: el texto está reescrito y las fotos siguen en su sitio. Revísalo antes de enviarlo (Ctrl+Z para deshacer).'));
    return;
  }
  // Sin texto todavía (entrada recién creada desde redes): se escribe a partir de la publicación original
  const text = draft.sourceText || window.BlockEditor.plainText();
  const r = await window.api.aiArticle({ title: $('#d-title').value, text, opts });
  $('#d-title').value = r.title; autoTitle();
  $('#d-excerpt').value = r.excerpt;
  window.BlockEditor.change(() => {
    const media = draft.blocks.filter((b) => !TEXT.includes(b.type));
    const E = window.BlockEditor;
    const body = r.blocks.filter((b) => b.text.trim()).map((b) => (b.kind === 'h2' ? E.create('heading', { level: 2, html: escHtml(b.text) }) : E.create('paragraph', { html: escHtml(b.text) })));
    // las fotos se reparten tras el primer párrafo para que no queden todas al final
    const firstP = Math.max(0, body.findIndex((b) => b.type === 'paragraph'));
    let blocks = body.length ? [...body.slice(0, firstP + 1), ...media.slice(0, 1), ...body.slice(firstP + 1), ...media.slice(1)] : media;
    // fuentes de internet al final, como lista de enlaces
    if (r.sources?.length) {
      blocks = [...blocks, E.create('heading', { level: 3, html: escHtml(t('Fuentes')) }),
        E.create('list', { items: r.sources.map((s) => `<a href="${escHtml(s.url)}">${escHtml(s.title || s.url)}</a>`) })];
    }
    draft.blocks = blocks;
  });
  const cur = $('#d-tags').value.split(',').map((x) => x.trim()).filter(Boolean);
  $('#d-tags').value = [...new Set([...cur, ...r.tags])].join(', ');
  toast(t('Listo. Revisa el texto antes de enviarlo.'));
});
// Tramos de texto de la entrada (también dentro de secciones y columnas): bloques de texto seguidos entre dos bloques
// que no son texto. Devuelve { runs: [{ id, arr, start, blocks }], segments: [{ id, text }], layout }
function aiSegments(blocks, E) {
  const TEXT = ['paragraph', 'heading', 'quote', 'list'];
  const plain = (h) => { const d = document.createElement('div'); d.innerHTML = String(h || '').replace(/<br\s*\/?>/gi, '\n'); return d.textContent.replace(/\n{3,}/g, '\n\n').trim(); };
  const asText = (b) => b.type === 'heading' ? `## ${plain(b.html)}` : b.type === 'list' ? (b.items || []).map((x) => `- ${plain(x)}`).join('\n') : b.type === 'quote' ? `> ${plain(b.html)}` : plain(b.html);
  const runs = [], layout = [];
  const NAME = { image: 'foto', gallery: 'galería', carousel: 'carrusel', video: 'vídeo', embed: 'publicación insertada', mediatext: 'imagen con texto', separator: 'separador', buttons: 'botón', table: 'tabla', group: 'sección', columns: 'columnas', cover: 'portada' };
  const walk = (arr, depth) => {
    let cur = null;
    arr.forEach((b, i) => {
      if (TEXT.includes(b.type) && (b.html || b.items?.length)) {
        if (!cur) { cur = { id: 'T' + (runs.length + 1), arr, start: i, blocks: [] }; runs.push(cur); layout.push('  '.repeat(depth) + `[[${cur.id}]]`); }
        cur.blocks.push(b);
        return;
      }
      cur = null;
      layout.push('  '.repeat(depth) + `[· ${NAME[b.type] || b.type}]`);
      for (const k of E.kids(b)) walk(k, depth + 1);
    });
  };
  walk(blocks, 0);
  return { runs, segments: runs.map((r) => ({ id: r.id, text: r.blocks.map(asText).join('\n\n') })), layout: layout.join('\n') };
}
// Bloques del editor a partir de lo que devuelve la IA para un tramo (las listas seguidas van juntas; se conserva el
// formato del primer párrafo original: alineación, tamaño, color…)
function aiBlocks(list, E, orig = []) {
  const fmt = orig.find((b) => b.type === 'paragraph') || {};
  const keep = Object.fromEntries(['align', 'size', 'font', 'color', 'bg', 'spacing'].filter((k) => fmt[k]).map((k) => [k, fmt[k]]));
  const out = [];
  for (const x of list || []) {
    const txt = String(x.text || '').trim();
    if (!txt) continue;
    if (x.kind === 'li') { const last = out[out.length - 1]; if (last?.type === 'list') last.items.push(escHtml(txt)); else out.push(E.create('list', { items: [escHtml(txt)] })); continue; }
    if (x.kind === 'h2' || x.kind === 'h3') out.push(E.create('heading', { level: x.kind === 'h3' ? 3 : 2, html: escHtml(txt) }));
    else if (x.kind === 'quote') out.push(E.create('quote', { html: escHtml(txt) }));
    else out.push(E.create('paragraph', { html: escHtml(txt).replace(/\n/g, '<br>'), ...keep }));
  }
  return out;
}

// Normalizar formato: el formato habitual del blog sin tocar el texto (sin IA, al instante; se deshace con Ctrl+Z)
const NORM_LABEL = () => ({ 'títulos→párrafos': t('texto que estaba en títulos'), estilos: t('colores, tamaños y fuentes sueltos'), limpieza: t('código sobrante'), vacíos: t('bloques vacíos'),
  subtítulos: t('subtítulos'), mayúsculas: t('textos en MAYÚSCULAS'), niveles: t('niveles de los títulos'), listas: t('listas'), galerías: t('fotos seguidas → galería'), separadores: t('separadores repetidos') });
$('#d-normalize').onclick = () => {
  const E = window.BlockEditor;
  const r = window.Normalize.normalizeBlocks(draft.blocks, (type, extra) => E.create(type, extra));
  if (!r.changes) return toast(t('La entrada ya tiene el formato habitual.'));
  E.change(() => { draft.blocks = r.blocks; });
  const what = Object.keys(r.notes).map((k) => NORM_LABEL()[k] || k).join(', ');
  toast(t('Formato normalizado: {w}. Puedes deshacerlo con Ctrl+Z.', { w: what }));
};
// Importar en el editor una entrada/página exportada de WordPress: sustituye el contenido del borrador abierto
// (se conserva dónde está: la página padre, si ya existe en WordPress…). Si el archivo trae varias, se elige una.
$('#ed-import').onclick = (e) => busy(e.currentTarget, async () => {
  const list = await window.api.draftImportFile();
  if (!list) return;
  let it = list[0];
  if (list.length > 1) {
    it = await new Promise((res) => {
      const d = document.createElement('div');
      d.className = 'dlg-scrim';
      d.innerHTML = `<div class="dlg imp-dlg" role="dialog" aria-modal="true"><span class="ms fill dlg-ic">upload_file</span>
        <p class="dlg-msg">${escHtml(t('El archivo tiene {n} entradas o páginas. ¿Cuál quieres cargar en el editor?', { n: list.length }))}</p>
        <div class="imp-list">${list.map((x, i) => `<button class="imp-it" data-i="${i}"><span class="ms">${x.type === 'page' ? 'description' : 'article'}</span><b>${escHtml(x.title || t('(sin título)'))}</b><span class="hint">${escHtml(x.type === 'page' ? t('Página') : t('Entrada'))}</span></button>`).join('')}</div>
        <div class="dlg-actions"><button class="btn text" data-x>${escHtml(t('Cancelar'))}</button></div></div>`;
      document.body.appendChild(d);
      d.onclick = (ev) => { const b = ev.target.closest('.imp-it'); if (b) { d.remove(); res(list[Number(b.dataset.i)]); } else if (ev.target.closest('[data-x]') || ev.target === d) { d.remove(); res(null); } };
    });
    if (!it) return;
  }
  const E = window.BlockEditor;
  const hasText = E.plainText().trim().length > 0;
  if (hasText && !await ask(t('Se sustituirá el contenido del editor por «{x}». ¿Continuar? (Puedes deshacerlo con Ctrl+Z)', { x: it.title || t('(sin título)') }), { ok: t('Importar') })) return;
  E.change(() => { draft.blocks = it.blocks?.length ? it.blocks : [E.create('paragraph')]; });
  if (it.title && (!$('#d-title').value.trim() || await ask(t('¿Usar también su título, «{x}»?', { x: it.title }), { ok: t('Usar el título'), cancel: t('Dejar el actual') }))) { $('#d-title').value = it.title; autoTitle?.(); }
  if (it.excerpt && !$('#d-excerpt').value.trim()) $('#d-excerpt').value = it.excerpt.replace(/<[^>]+>/g, '').trim();
  if (it.pageBg && typeof setPageBg === 'function') setPageBg(it.pageBg);
  autosaveSoon?.(); renderShare?.();
  toast(t('Importado. Revísalo y pulsa «Enviar a WordPress» cuando quieras publicarlo.'));
});

// «Describir fotos»: de una en una (respuestas cortas y fiables), con progreso; cada descripción se ve al llegar.
// Si la IA no puede con una foto, se le pone una descripción básica (título de la página y pie de foto) para editar.
let altRun = null;
$('#ai-alts').onclick = async (e) => {
  const btn = e.currentTarget, E = window.BlockEditor;
  if (altRun) { altRun.stop = true; return; } // pulsar otra vez: detener
  const blocks = E.flat(draft.blocks);
  const all = blocks.flatMap((b) => (b.img ? [{ img: b.img, cap: b.caption }] : (b.images || []).map((img) => ({ img, cap: '' })))).filter((x) => x.img.type !== 'video');
  if (!all.length) return toast(t('Esta entrada no tiene fotos'), true);
  let list = all.filter((x) => !(x.img.alt || '').trim());
  if (!list.length) {
    if (!await ask(t('Todas las fotos ya tienen descripción. ¿Volver a describirlas todas?'), { ok: t('Describir de nuevo') })) return;
    list = all;
  }
  const title = $('#d-title').value.trim();
  const basic = (x, n) => [title, (x.cap || '').replace(/<[^>]+>/g, '').trim()].filter(Boolean).join(' — ') + (title || x.cap ? '' : t('Foto {n}', { n }));
  const label = btn.innerHTML;
  altRun = { stop: false };
  let ok = 0, fallback = 0;
  E.snapshot();
  try {
    for (let k = 0; k < list.length && !altRun.stop; k++) {
      btn.innerHTML = `<span class="ms">stop_circle</span>${escHtml(t('Describiendo {a} de {b}… (pulsa para parar)', { a: k + 1, b: list.length }))}`;
      const x = list[k];
      let alt = '';
      try { alt = await window.api.aiAlt(x.img.url, title); } catch { /* se sigue con la siguiente */ }
      if (alt) ok++; else { alt = basic(x, k + 1); fallback++; }
      x.img.alt = alt;
      // se ve al momento debajo de la foto (sin redibujar el editor)
      $$(`#ed-canvas .ph img[src="${CSS.escape(x.img.url)}"]`).forEach((im) => { const inp = im.closest('.ph')?.querySelector('.alt'); if (inp) inp.value = alt; });
    }
  } finally {
    const stopped = altRun.stop;
    altRun = null; btn.innerHTML = label;
    E.onChange();
    toast(fallback
      ? t('{a} fotos descritas con IA y {b} con una descripción básica (revísalas).', { a: ok, b: fallback })
      : stopped ? t('Parado: {a} fotos descritas.', { a: ok }) : t('{a} fotos descritas. Puedes corregirlas debajo de cada foto.', { a: ok }), !!fallback);
  }
};

// Dirección de la imagen destacada (por si en WordPress hay que buscarla o subirla)
function featuredUrl() {
  const all = [...window.BlockEditor.flat(draft.blocks || []).flatMap((b) => (b.img ? [b.img] : b.images || [])), ...(window.BlockEditor?.media || []), ...(draft.extraMedia || [])];
  return all.find((i) => i.id === draft.featuredImageId)?.url || '';
}
// Datos de la entrada para enviar o previsualizar
const draftPayload = (status) => ({
  postId: draft.postId, type: draft.type === 'page' ? 'page' : 'post', parent: isPageDraft() ? Number($('#d-parent').value) || 0 : 0,
  title: $('#d-title').value.trim(), excerpt: $('#d-excerpt').value.trim(), blocks: draft.blocks,
  tags: isPageDraft() ? [] : $('#d-tags').value.split(',').map((x) => x.trim()).filter(Boolean),
  categories: isPageDraft() ? [] : $$('#d-cats input:checked').map((i) => i.value),
  status, scheduleAt: status === 'future' ? $('#d-schedule').value : null,
  featuredImageId: draft.featuredImageId, featuredImageUrl: featuredUrl(), keepDate: draft.isNew ? false : $('#d-keepdate').checked, date: draft.date, keys: draftKeys,
  slug: slugify($('#d-slug').value),
  ...(seoInfo.writable ? { seoKey: seoInfo.key, seoDesc: $('#d-seodesc').value.trim() } : {}),
  recreate: !!draft.previewOnly,
  pageBg: PageBg.normalize(draft.pageBg),
});

// Actualizar desde WordPress (la app envía y también recibe cambios)
const WP_STATE = () => ({ publish: [t('Publicada'), 'public'], draft: [t('Borrador'), 'draft'], future: [t('Programada'), 'schedule'], pending: [t('Pendiente'), 'pending'], private: [t('Privada'), 'lock'], trash: [t('En la papelera'), 'delete'] });
function renderWpState(st, url) {
  updateHistoryBtn(); wpSt = st; wpUrl = url || ''; if (editorOpen()) renderShare();
  const el = $('#ed-wp');
  if (!st) { el.classList.add('hidden'); return; }
  const [name, ic] = WP_STATE()[st] || [st, 'help'];
  el.className = 'ed-wp st-' + st;
  el.innerHTML = `<span class="ms">${ic}</span>${escHtml(name)}${st === 'publish' && url ? ` · <a href="#">${t('Ver')}</a>` : ''}`;
  $('a', el)?.addEventListener('click', (e) => { e.preventDefault(); window.api.open(url); });
}
$('#ed-pull').onclick = (e) => busy(e.currentTarget, async () => {
  if (!draft.postId) return toast(isPageDraft() ? t('Esta página todavía no está en WordPress: envíala primero.') : t('Esta entrada todavía no está en WordPress: envíala primero.'), true);
  const r = await window.api.pullPost(draft.postId, draft.type);
  exported = r.exported || exported;
  renderWpState(r.status, r.url);
  if (r.status === 'trash') return toast(t('Esta entrada está en la papelera de WordPress.'), true);
  $$('input[name="d-when"]').forEach((x) => (x.checked = x.value === (r.status === 'publish' ? 'publish' : r.status === 'future' ? 'future' : 'draft')));
  const changes = [];
  if (r.title.trim() !== $('#d-title').value.trim()) changes.push(t('el título'));
  if ((r.excerpt || '').trim() !== $('#d-excerpt').value.trim()) changes.push(t('el extracto'));
  if (r.featured && r.featured !== draft.featuredImageId) changes.push(t('la imagen destacada'));
  if (r.contentChanged === null) { // enviada con una versión anterior de Ecos: se compara con lo que hay en el editor
    const norm = (x) => String(x || '').replace(/ecos-[cm]-[a-z0-9]+/g, '').replace(/\s+/g, ' ').trim();
    r.contentChanged = norm(await window.api.composeDraft(draft.blocks)) !== norm(await window.api.composeDraft(r.blocks));
  }
  if (r.contentChanged) changes.push(t('el contenido'));
  const stName = (WP_STATE()[r.status] || [r.status])[0];
  if (!changes.length) { toast(t('Al día. En WordPress: {s}.', { s: stName })); renderFeed(); return; }
  if (!await ask(t('En WordPress han cambiado {c}. ¿Traer esos cambios al editor? (Se puede deshacer con Ctrl+Z.)', { c: changes.join(', ') }), { ok: t('Traer cambios') })) return;
  $('#d-title').value = r.title; autoTitle();
  $('#d-excerpt').value = r.excerpt || '';
  window.BlockEditor.change(() => {
    if (r.contentChanged) { draft.blocks = r.blocks; draft.pageBg = r.pageBg || null; renderPageBg(); }
    if (r.featured) { draft.featuredImageId = r.featured; draft.keepFeaturedInBody = true; }
  });
  // las fotos que ahora usa la entrada, también en la bandeja
  const known = new Set(window.BlockEditor.media.map((m) => m.id));
  const extra = window.BlockEditor.bodyImages().filter((i) => !known.has(i.id)).map((i) => ({ ...i, type: 'image' }));
  if (extra.length) { draft.extraMedia = [...(draft.extraMedia || []), ...extra]; window.BlockEditor.media = mediaPool(); window.BlockEditor.renderMedia(); }
  renderFeed();
  toast(t('Cambios traídos de WordPress. En WordPress: {s}.', { s: stName }));
});

// Enviar
$('#send').onclick = (e) => busy(e.target, async () => {
  const when = $('input[name="d-when"]:checked').value;
  if (!$('#d-title').value.trim()) throw new Error(t('Escribe un título'));
  if (when === 'publish' && !await ask(t('Se publicará ahora y será visible en la web. ¿Continuar?'))) return;
  const res = await window.api.publish(draftPayload(when));
  exported = res.exported; lastSent = res; draft.postId = res.postId || draft.postId; draft.previewOnly = false; window.api.autosaveClear().catch(() => {}); draftDirty = false; renderWpState(res.status, res.url);
  const pg = isPageDraft();
  $('#sent-text').textContent = res.status === 'publish' ? (pg ? t('¡Página publicada!') : t('¡Entrada publicada!'))
    : res.status === 'future' ? (pg ? t('Página programada para el {d}.', { d: fmtDate(res.date) }) : t('Entrada programada para el {d}.', { d: fmtDate(res.date) })) : (pg ? t('Borrador de página creado en WordPress.') : t('Borrador creado en WordPress.'));
  if (res.status !== 'future' && res.date) $('#sent-text').textContent += ' ' + t('Fecha de la entrada: {d}.', { d: fmtDate(res.date) });
  $('#sent').classList.remove('hidden');
  $('#sent-share').classList.toggle('hidden', !(res.status === 'publish' && CFG.metaConnected && CFG.shareFacebook === true));
  selected.clear(); updateCount(); renderFeed(); blog.loaded = false;
});
$('#sent-edit').onclick = () => lastSent && window.api.open(lastSent.editUrl);
$('#sent-share').onclick = () => openFbShare();
$('#sent-view').onclick = () => lastSent && window.api.open(lastSent.url);
$('#sent-close').onclick = () => { $('#sent').classList.add('hidden'); $('#editor').classList.add('hidden'); document.body.classList.remove('editing'); updateCount(); };

// ---------------------------------------------------------------- Visor de fotos y vídeos
const mediaItemsOf = (p) => p.media.map((m) => (m.type === 'video'
  ? { type: 'video', src: m.videoUrl || fileUrl(m.path), poster: m.url && !m.path ? m.url : '', fallback: m.url }
  : { type: 'image', src: m.url || fileUrl(m.path) }));
let lb = { items: [], i: 0 };
function openLightbox(items, i) {
  if (!items.length) return;
  lb = { items, i: Math.max(0, Math.min(i, items.length - 1)) };
  $('#lightbox').classList.remove('hidden'); renderLightbox();
}
function renderLightbox() {
  const it = lb.items[lb.i], stage = $('#lightbox .lb-stage');
  stage.innerHTML = '';
  if (it.type === 'video' && it.src) {
    const v = document.createElement('video');
    v.src = it.src; v.controls = true; v.autoplay = true; if (it.poster) v.poster = it.poster;
    v.onerror = () => { stage.innerHTML = ''; const img = document.createElement('img'); img.src = it.poster || it.fallback || ''; stage.appendChild(img); toast(t('No se puede reproducir este vídeo aquí; se muestra su miniatura.')); };
    stage.appendChild(v);
  } else {
    const img = document.createElement('img'); img.src = it.src || it.fallback || ''; img.alt = ''; stage.appendChild(img);
  }
  $('#lightbox .lb-count').textContent = lb.items.length > 1 ? `${lb.i + 1} / ${lb.items.length}` : '';
  $$('#lightbox .lb-prev, #lightbox .lb-next').forEach((b) => (b.style.visibility = lb.items.length > 1 ? 'visible' : 'hidden'));
}
const closeLightbox = () => { $('#lightbox').classList.add('hidden'); $('#lightbox .lb-stage').innerHTML = ''; };
const stepLightbox = (d) => { lb.i = (lb.i + d + lb.items.length) % lb.items.length; renderLightbox(); };
$('#lightbox .lb-close').onclick = closeLightbox;
$('#lightbox .lb-prev').onclick = () => stepLightbox(-1);
$('#lightbox .lb-next').onclick = () => stepLightbox(1);
$('#lightbox').onclick = (e) => { if (e.target.id === 'lightbox' || e.target.classList.contains('lb-stage')) closeLightbox(); };
document.addEventListener('keydown', (e) => {
  if ($('#lightbox').classList.contains('hidden')) {
    if (e.key === 'Escape') { if (!$('#pv-modal').classList.contains('hidden')) $('#pv-modal').classList.add('hidden'); else if (!$('#summary-modal').classList.contains('hidden')) $('#summary-modal').classList.add('hidden'); }
    return;
  }
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') stepLightbox(-1);
  if (e.key === 'ArrowRight') stepLightbox(1);
});

// ---------------------------------------------------------------- Vista previa de la entrada
// Dentro de Ecos con los estilos reales de tu web (leídos de su portada); «Ver en mi web» guarda un
// borrador y abre la vista previa de WordPress.
// Ventana de vista previa con los estilos reales de la web (editor y entradas de una copia)
async function showPreview({ title, date: when, cats = [], featured, content, web = false, pageBg = null }) {
  // enlaces de vídeo solos en una línea: el reproductor, como hace WordPress
  content = content.replace(/<p>\s*(https?:\/\/[^\s<]+)\s*<\/p>/g, (m, url) => {
    const e = window.BlockEditor.detectEmbed(url.replace(/&amp;/g, '&'));
    return e?.player ? `<figure class="wp-block-embed"><iframe src="${escHtml(e.player)}" style="width:100%;aspect-ratio:16/9;border:0" allowfullscreen></iframe></figure>` : m;
  });
  const date = new Date(typeof when === 'string' ? when.replace(' ', 'T') : when).toLocaleDateString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  let site = { css: '', bodyClass: '' };
  try { site = await window.api.siteStyles(); } catch { /* sin conexión: estilo genérico */ }
  const generic = site.css ? '' : `body{font:18px/1.7 Georgia,serif;color:#1d1d1f}h1{font:700 40px/1.15 system-ui,sans-serif}
    .wp-block-gallery{display:grid;grid-template-columns:repeat(var(--c,3),1fr);gap:10px}.wp-block-gallery img{width:100%;aspect-ratio:1;object-fit:cover}
    .wp-block-media-text{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:center}.wp-block-media-text.has-media-on-the-right figure{order:2}
    blockquote{border-left:4px solid #ccc;margin:1.5em 0;padding-left:1em}`;
  // Fondo de la página: misma estructura que Astra (#page > #content > .ast-container > #primary) y el mismo CSS que se envía
  const bgCss = window.PageBg ? PageBg.css(pageBg) : '';
  const bgOpen = bgCss ? '<div id="page" class="hfeed site"><div id="content" class="site-content"><div class="ast-container"><div id="primary" class="content-area">' : '';
  const bgClose = bgCss ? '</div></div></div></div><div class="ecos-page-bg" hidden></div>' : '';
  $('#pv-frame').srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <style>${site.css}</style><style>${generic}
      .ecos-pv{max-width:760px;margin:0 auto;padding:40px 24px 80px}
      .ecos-pv img,.ecos-pv video{max-width:100%;height:auto}
      .ecos-pv .ecos-meta{opacity:.7;font-size:.9em;margin-bottom:1.5em}
      .ecos-pv .ecos-featured{width:100%;border-radius:12px;margin-bottom:1.5em}
      .ecos-pv .wp-block-embed:not(:has(iframe)){padding:18px;border:1px dashed #bbb;border-radius:10px;font-size:14px;word-break:break-all}
      .has-text-align-center{text-align:center}.has-text-align-right{text-align:right}.has-text-align-justify,.ecos-justify{text-align:justify}
      .has-background{padding:1.25em 2.375em}.has-drop-cap:first-letter{float:left;font-size:5.5em;line-height:.68;font-weight:100;margin:.05em .1em 0 0;text-transform:uppercase}
      mark.has-inline-color{padding:0 .1em}
      .wp-block-table table{width:100%;border-collapse:collapse}.wp-block-table td,.wp-block-table th{border:1px solid;padding:.5em}.wp-block-table.is-style-stripes tbody tr:nth-child(odd){background:#f0f0f0}
      .wp-block-buttons{display:flex;gap:.5em;flex-wrap:wrap;margin:1.5em 0}.wp-block-buttons.is-content-justification-center{justify-content:center}.wp-block-buttons.is-content-justification-right{justify-content:flex-end}
      .wp-block-button__link{display:inline-block;padding:.65em 1.4em;border-radius:9999px;background:#32373c;color:#fff;text-decoration:none}
      .is-style-outline .wp-block-button__link{background:transparent;color:inherit;border:2px solid}
      .wp-block-pullquote{text-align:center;border-block:4px solid;padding:2em 0;margin:2em 0;font-size:1.5em}.wp-block-pullquote blockquote{margin:0;border:0;padding:0}
      .wp-block-details{border:1px solid #ddd;border-radius:10px;padding:.8em 1.1em;margin:1.5em 0}.wp-block-details summary{cursor:pointer;font-weight:600}
      .wp-element-caption{font-size:.85em;opacity:.75;text-align:center}
    </style><style>${bgCss}</style></head>
    <body class="${escHtml(site.bodyClass.replace(/\bhome\b|\bblog\b|\bpage\b/g, ''))} single single-post wp-embed-responsive">
    ${bgOpen}<main class="site-main"><article class="post type-post status-publish hentry ecos-pv">
      <header class="entry-header">${cats.length ? `<div class="cat-links ecos-meta">${escHtml(cats.join(' · '))}</div>` : ''}
        <h1 class="entry-title wp-block-post-title">${escHtml(title)}</h1><div class="ecos-meta entry-meta">${date}</div></header>
      ${featured ? `<img class="ecos-featured wp-post-image" src="${escHtml(featured)}" alt="">` : ''}
      <div class="entry-content wp-block-post-content is-layout-constrained">${content}</div>
    </article></main>${bgClose}</body></html>`;
  $('#pv-frame').onload = () => $('#pv-frame').contentDocument.querySelectorAll('[data-ecos-carousel]').forEach((el) => window.ecosCarousel(el));
  $('#pv-web').classList.toggle('hidden', !web);
  $('#pv-modal').classList.remove('hidden');
  if (!site.css) toast(t('No se pudieron leer los estilos de tu web; la vista previa usa un estilo genérico.'));
}
$('#preview').onclick = (e) => busy(e.target, async () => {
  let content = await window.api.composeDraft(draft.blocks);
  // Lo que WordPress añade al mostrar la entrada: alineación de los botones y reproductores de vídeo
  content = content.replace(/<!-- wp:buttons \{"layout":\{"type":"flex","justifyContent":"(center|right)"\}\} -->\n<div class="wp-block-buttons/g, (_m, j) => `<div class="wp-block-buttons is-content-justification-${j}`)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<div class="wp-block-embed__wrapper">\n(\S+)\n<\/div>/g, (m, url) => {
      const e = window.BlockEditor.detectEmbed(url.replace(/&amp;/g, '&'));
      return e?.player ? `<div class="wp-block-embed__wrapper"><iframe src="${escHtml(e.player)}" style="width:100%;aspect-ratio:${/spotify/.test(e.player) ? '16/5' : '16/9'};border:0" allowfullscreen></iframe></div>` : m;
    });
  const featured = window.BlockEditor.flat(draft.blocks).flatMap((b) => (b.img ? [b.img] : b.images || [])).filter((i) => i.type !== 'video').find((i) => i.id === draft.featuredImageId);
  const cats = $$('#d-cats input:checked').map((i) => i.value);
  await showPreview({ title: $('#d-title').value, date: $('#d-keepdate').checked ? draft.date : Date.now(), cats, featured: featured?.url, content, web: true, pageBg: draft.pageBg });
});

$$('#pv-size button').forEach((b) => b.onclick = () => {
  $$('#pv-size button').forEach((x) => x.classList.toggle('active', x === b));
  $('#pv-frame').style.maxWidth = b.dataset.w + 'px';
});
$('#pv-close').onclick = () => $('#pv-modal').classList.add('hidden');
$('#pv-web').onclick = (e) => busy(e.target, async () => {
  const r = await window.api.previewDraft(draftPayload('draft'));
  draft.postId = r.postId; draft.previewOnly = true; // borrador solo para ver la vista previa
  window.api.open(r.previewUrl);
  toast(t('Guardado como borrador. La vista previa se abre en tu navegador.'));
});


// ---------------------------------------------------------------- Historial de versiones (WordPress propio)
function updateHistoryBtn() {
  const b = $('#ed-history');
  if (b) b.classList.toggle('hidden', !(typeof draft !== 'undefined' && draft && draft.postId));
}
const histText = (html) => String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
const histBlockTexts = (blocks) => (blocks || []).flatMap((b) => {
  const parts = b.items ? b.items.map((x) => (typeof x === 'string' ? x : x?.html || x?.text || '')) : [b.html ?? b.text ?? b.caption ?? ''];
  return parts.map((x) => decodeEntities(histText(x)).replace(/\s+/g, ' ').trim()).filter(Boolean);
});
const histWords = (blocks) => histBlockTexts(blocks).join(' ').split(/\s+/).filter(Boolean).length;
const histClean = (html) => String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  .replace(/<(iframe|object|embed)[\s\S]*?(<\/\1>|$)/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
  .replace(/<img\b/gi, '<img style="max-width:100%;height:auto"');
const histDate = (d) => new Date(d).toLocaleString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const histDelta = (n) => (n === 0 ? t('Mismas palabras') : n > 0 ? t('+{n} palabras', { n }) : t('−{n} palabras', { n: -n }));

async function openHistory() {
  if (!draft.postId) return;
  const scrim = document.createElement('div');
  scrim.className = 'dlg-scrim hist-scrim';
  scrim.innerHTML = `<div class="hist" role="dialog" aria-modal="true">
    <div class="hist-head"><span class="ms fill">history</span><h2>${t('Historial de versiones')}</h2><button class="btn text icon-only" id="hist-x" title="${t('Cerrar')}"><span class="ms">close</span></button></div>
    <div class="hist-body"><div class="hist-list"></div><div class="hist-prev"></div></div>
    <div class="hist-foot"><button class="btn text" id="hist-cancel">${t('Cerrar')}</button><button class="btn filled" id="hist-restore" disabled><span class="ms">restore</span><span id="hist-restore-t">${t('Recuperar esta versión')}</span></button></div></div>`;
  const list = $('.hist-list', scrim), prev = $('.hist-prev', scrim), restore = $('#hist-restore', scrim), restoreLbl = $('#hist-restore-t', scrim);
  const close = () => { scrim.remove(); document.removeEventListener('keydown', key, true); };
  const key = (e) => { if (e.key === 'Escape' && !document.querySelector('.dlg-scrim:not(.hist-scrim)')) { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', key, true);
  $('#hist-x', scrim).onclick = $('#hist-cancel', scrim).onclick = close;
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  document.body.appendChild(scrim);
  prev.innerHTML = `<p class="hist-msg">${t('Cargando versiones…')}</p>`;
  // Versiones de WordPress (revisiones) y copias que Ecos guardó en este ordenador antes de cada envío
  const [rr, bb] = await Promise.allSettled([window.api.postRevisions(draft.postId, draft.type), window.api.sendBackups(draft.postId, draft.type)]);
  if (!scrim.isConnected) return;
  const revs = rr.status === 'fulfilled' ? rr.value : [], bks = bb.status === 'fulfilled' ? bb.value : [];
  if (!revs.length && !bks.length) {
    if (rr.status === 'rejected') { close(); return toastError(rr.reason); }
    prev.innerHTML = `<p class="hist-msg">${isPageDraft() ? t('WordPress aún no ha guardado versiones anteriores de esta página.') : t('WordPress aún no ha guardado versiones anteriores de esta entrada.')}</p>`; scrim.classList.add('empty'); return;
  }
  const curTexts = histBlockTexts(draft.blocks), curWords = curTexts.join(' ').split(/\s+/).filter(Boolean).length;
  let sel = null;
  const STATUS = { publish: t('Publicada'), draft: t('Borrador'), future: t('Programada'), pending: t('Pendiente'), private: t('Privada') };
  list.innerHTML = (revs.length ? `<div class="hist-sec">${t('Versiones de WordPress')}</div>` + revs.map((r, i) => {
    const d = histWords(r.blocks) - curWords;
    return `<button class="hist-item" data-k="r" data-i="${i}"><b>${escHtml(histDate(r.date))}</b><span class="hist-t">${escHtml(decodeEntities(r.title) || t('(sin título)'))}</span>
      <span class="hist-m">${t('{n} palabras', { n: r.words })} · ${histDelta(d)}</span></button>`;
  }).join('') : '') + (bks.length ? `<div class="hist-sec">${t('Copias de Ecos antes de enviar')}</div>` + bks.map((r, i) => `<button class="hist-item bk" data-k="b" data-i="${i}"><b>${escHtml(histDate(r.at))}</b><span class="hist-t">${escHtml(decodeEntities(r.title) || (r.hasCurrent ? t('(sin título)') : t('Sin copia de lo que había')))}</span>
      <span class="hist-m">${r.hasCurrent ? `${t('{n} palabras', { n: r.words })} · ${histDelta(r.words - curWords)}${STATUS[r.status] ? ' · ' + STATUS[r.status] : ''}` : t('No se pudo leer WordPress en ese momento')}</span></button>`).join('') : '');
  const setSel = (rv, kind) => {
    sel = { ...rv, kind };
    const texts = histBlockTexts(sel.blocks), cur = new Set(curTexts), old = new Set(texts);
    const added = texts.filter((x) => !cur.has(x)).length, removed = curTexts.filter((x) => !old.has(x)).length;
    const sum = !added && !removed ? t('Tiene el mismo texto que el editor.')
      : t('Frente al editor: párrafos que trae esta versión y el editor no tiene: {a}. Párrafos del editor que esta versión no tiene (se perderían): {r}.', { a: added, r: removed });
    prev.innerHTML = `<div class="hist-sum"><span class="ms">compare_arrows</span><span></span></div><h3></h3><div class="hist-html"></div>`;
    $('.hist-sum span:last-child', prev).textContent = sum;
    $('h3', prev).textContent = decodeEntities(sel.title) || t('(sin título)');
    $('.hist-html', prev).innerHTML = histClean(sel.content);
    restoreLbl.textContent = kind === 'b' ? t('Restaurar en el editor') : t('Recuperar esta versión');
    restore.disabled = false;
  };
  const pick = async (k, i) => {
    $$('.hist-item', list).forEach((b) => b.classList.toggle('on', b.dataset.k === k && +b.dataset.i === i));
    restore.disabled = true; sel = null;
    if (k === 'r') return setSel(revs[i], 'r');
    prev.innerHTML = `<p class="hist-msg">${t('Cargando versiones…')}</p>`;
    try {
      const rec = await window.api.sendBackup(draft.postId, draft.type, bks[i].file);
      if (!scrim.isConnected) return;
      setSel({ title: rec.current.title, content: rec.current.content, excerpt: rec.current.excerpt, blocks: rec.current.blocks }, 'b');
    } catch (e) { prev.innerHTML = '<p class="hist-msg"></p>'; $('.hist-msg', prev).textContent = friendlyError(e).text; }
  };
  $$('.hist-item', list).forEach((b) => (b.onclick = () => pick(b.dataset.k, +b.dataset.i)));
  prev.innerHTML = `<p class="hist-msg">${t('Elige una versión de la lista para verla.')}</p>`;
  restore.onclick = async () => {
    if (!sel) return;
    if (!await ask(t('Se sustituirá el contenido del editor por esta versión. Podrás deshacerlo con Ctrl+Z. ¿Continuar?'), { ok: sel.kind === 'b' ? t('Restaurar en el editor') : t('Recuperar') })) return;
    const rv = sel;
    window.BlockEditor.change(() => { draft.blocks = rv.blocks; });
    if (rv.title) { $('#d-title').value = decodeEntities(rv.title); autoTitle(); }
    if (rv.excerpt) $('#d-excerpt').value = decodeEntities(histText(rv.excerpt)).trim();
    close();
    toast(rv.kind === 'b' ? t('Copia restaurada en el editor. No se ha enviado nada: revísala y pulsa «Enviar a WordPress» para guardarla; puedes deshacerlo con Ctrl+Z.')
      : t('Versión recuperada. Revísala y pulsa «Enviar a WordPress» para guardarla; puedes deshacerlo con Ctrl+Z.'));
  };
}
$('#ed-history').onclick = (e) => busy(e.currentTarget, openHistory);
// ---------------------------------------------------------------- Buscar y reemplazar en la entrada
// Ctrl+F / Ctrl+H abren una barra sobre el lienzo; busca en el texto visible de los bloques, el título y el extracto.
const FR = { hits: [], i: -1 };
const frOpts = () => ({ caseSensitive: $('#fr-case').checked, wholeWord: $('#fr-word').checked });
const frOpen = () => !$('#fr-bar').classList.contains('hidden');
const frClearMarks = () => {
  try { if (CSS.highlights) { CSS.highlights.clear(); } } catch { /* sin API */ }
  $$('.fr-flash').forEach((x) => x.classList.remove('fr-flash'));
  $$('#d-title, #d-excerpt').forEach((x) => x.classList.remove('fr-cur'));
};
// Todas las coincidencias: título, extracto y bloques (en ese orden)
function frCompute() {
  const q = $('#fr-q').value, o = frOpts();
  const hits = [];
  for (const [id, field] of [['d-title', 'title'], ['d-excerpt', 'excerpt']]) {
    for (const m of window.FindReplace.findInText($('#' + id).value, q, o)) hits.push({ ...m, blockId: field, field });
  }
  hits.push(...window.FindReplace.findInBlocks(draft.blocks, q, o));
  FR.hits = hits;
  if (FR.i >= hits.length) FR.i = hits.length - 1;
  if (FR.i < 0 && hits.length) FR.i = 0;
}
// Rangos de texto del DOM de un elemento editable para la consulta
function frRanges(root, q, o) {
  const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    for (const m of window.FindReplace.findInText(n.nodeValue, q, o)) { const r = new Range(); r.setStart(n, m.start); r.setEnd(n, m.end); out.push(r); }
  }
  return out;
}
function frPaint(scroll) {
  frClearMarks();
  const n = FR.hits.length, cur = FR.hits[FR.i];
  $('#fr-count').textContent = !$('#fr-q').value ? '' : n ? t('{a} de {b}', { a: FR.i + 1, b: n }) : t('Sin resultados');
  $('#fr-bar').classList.toggle('none', !!$('#fr-q').value && !n);
  if (!n) return;
  const q = $('#fr-q').value, o = frOpts();
  const all = [], curR = [];
  $$('#d-blocks .blk [contenteditable]').forEach((el) => all.push(...frRanges(el, q, o)));
  let target = null;
  if (cur.field === 'title' || cur.field === 'excerpt') {
    target = $(cur.field === 'title' ? '#d-title' : '#d-excerpt'); target.classList.add('fr-cur');
  } else {
    target = $(`.blk[data-id="${cur.blockId}"]`);
    if (target) {
      target.classList.add('fr-flash');
      if (cur.field !== 'alt') {
        const ord = FR.hits.filter((h) => h.blockId === cur.blockId && h.field !== 'alt').indexOf(cur);
        const rs = $$('[contenteditable]', target).flatMap((el) => frRanges(el, q, o));
        if (rs[ord]) curR.push(rs[ord]);
      }
    }
  }
  try {
    if (window.Highlight && CSS.highlights) {
      CSS.highlights.set('ecos-find', new Highlight(...all));
      if (curR.length) CSS.highlights.set('ecos-find-cur', new Highlight(...curR));
    }
  } catch { /* sin API de resaltado: queda el bloque marcado */ }
  if (scroll && target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function frRefresh(scroll) { frCompute(); frPaint(scroll); }
function frGo(d) {
  frCompute();
  if (!FR.hits.length) return frPaint();
  FR.i = (FR.i + d + FR.hits.length) % FR.hits.length;
  frPaint(true);
}
function frOpenBar() {
  if ($('#editor').classList.contains('hidden')) return;
  const sel = String(getSelection() || '').trim();
  $('#fr-bar').classList.remove('hidden');
  if (sel && sel.length < 80 && !sel.includes('\n')) $('#fr-q').value = sel;
  $('#fr-q').focus(); $('#fr-q').select();
  FR.i = 0; frRefresh(!!$('#fr-q').value);
}
function frCloseBar() { $('#fr-bar').classList.add('hidden'); frClearMarks(); FR.hits = []; }
function frReplace(all) {
  frCompute();
  if (!FR.hits.length) return;
  const q = $('#fr-q').value, rep = $('#fr-r').value, o = frOpts(), F = window.FindReplace;
  const one = all ? null : FR.hits[FR.i];
  let count = 0;
  for (const [id, field] of [['d-title', 'title'], ['d-excerpt', 'excerpt']]) {
    if (one && one.field !== field) continue;
    const el = $('#' + id), r = F.replaceInText(el.value, q, rep, o, one ? one.start : undefined);
    if (r.count) { el.value = r.text; count += r.count; el.dispatchEvent(new Event('input')); }
  }
  if ((!one || (one.field !== 'title' && one.field !== 'excerpt')) && F.findInBlocks(draft.blocks, q, o).length) {
    window.BlockEditor.change(() => { count += F.replaceInBlocks(draft.blocks, q, rep, o, one || undefined).count; });
  }
  if (all) toast(t('{n} cambios', { n: count }));
  requestAnimationFrame(() => frRefresh(!all));
}
$('#ed-find').onclick = () => (frOpen() ? frCloseBar() : frOpenBar());
$('#fr-close').onclick = frCloseBar;
$('#fr-prev').onclick = () => frGo(-1);
$('#fr-next').onclick = () => frGo(1);
$('#fr-one').onclick = () => frReplace(false);
$('#fr-all').onclick = () => frReplace(true);
['#fr-q', '#fr-case', '#fr-word'].forEach((s) => $(s).addEventListener(s === '#fr-q' ? 'input' : 'change', () => { FR.i = 0; frRefresh(true); }));
$('#fr-bar').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); frCloseBar(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (e.target.id === 'fr-r') frReplace(false); else frGo(e.shiftKey ? -1 : 1); }
});
document.addEventListener('keydown', (e) => {
  if ($('#editor').classList.contains('hidden') || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'f' || k === 'h') { e.preventDefault(); frOpenBar(); if (k === 'h') $('#fr-r').focus(); }
}, true);
// Si se edita a mano con la barra abierta, se vuelven a contar las coincidencias
$('#ed-canvas').addEventListener('input', (e) => { if (frOpen() && !e.target.closest('#fr-bar')) { clearTimeout(FR.t); FR.t = setTimeout(() => frRefresh(false), 300); } });

// --- Convertir bloques de Spectra en bloques de Ecos ---------------------------------------------------
// Las páginas montadas con Spectra (uagb/*) llegan al editor como bloques «raw» que no se pueden editar.
// El aviso de arriba ofrece convertirlos; se hace en el sitio con BlockEditor.change (Ctrl+Z lo deshace).
const SPECTRA_LABELS = {
  'post-carousel': 'carrusel de entradas', 'post-grid': 'cuadrícula de entradas', 'post-masonry': 'mosaico de entradas', 'post-timeline': 'línea de tiempo de entradas',
  forms: 'formulario', form: 'formulario', 'cf7-styler': 'formulario', 'gf-styler': 'formulario', slider: 'slider', tabs: 'pestañas', timeline: 'línea de tiempo', 'content-timeline': 'línea de tiempo',
  countdown: 'cuenta atrás', 'table-of-contents': 'índice', 'social-share': 'botones para compartir', 'star-rating': 'valoración con estrellas', review: 'reseña', lottie: 'animación',
  modal: 'ventana emergente', 'popup-builder': 'ventana emergente', 'price-list': 'lista de precios', 'how-to': 'guía paso a paso', 'inline-notice': 'aviso', 'marketing-button': 'botón de marketing', 'taxonomy-list': 'lista de categorías',
};
// Cuántos bloques de Spectra (también dentro de secciones y columnas) quedan sin convertir en el borrador
function spectraCount() {
  const BE = window.BlockEditor;
  if (!draft || !BE) return 0;
  return BE.flat(draft.blocks || []).filter((b) => b.type === 'raw' && /^\s*<!--\s+wp:uagb\//.test(b.markup || ''))
    .reduce((n, b) => n + (b.markup.match(/<!--\s+wp:uagb\/[a-z0-9-]+(?=[\s{/])/g) || []).length, 0);
}
function renderSpectraNote() {
  const box = $('#d-spectra');
  if (!box) return;
  const n = draft && !draft.previewOnly ? spectraCount() : 0;
  box.classList.toggle('hidden', !n);
  if (!n) { box.innerHTML = ''; return; }
  const page = isPageDraft();
  const head = n === 1
    ? (page ? t('Esta página tiene 1 bloque de Spectra que Ecos no puede editar.') : t('Esta entrada tiene 1 bloque de Spectra que Ecos no puede editar.'))
    : (page ? t('Esta página tiene {n} bloques de Spectra que Ecos no puede editar.', { n }) : t('Esta entrada tiene {n} bloques de Spectra que Ecos no puede editar.', { n }));
  box.innerHTML = `<span class="ms">view_quilt</span><div class="spx-txt"><b>${escHtml(head)}</b> ${escHtml(t('Al convertirlos se podrán editar aquí. Hasta que pulses «Enviar a WordPress» no cambia nada en la web, y la versión anterior queda en el Historial. Puedes deshacerlo con Ctrl+Z.'))}</div>`
    + `<button class="btn filled small spx-btn" type="button" id="spx-convert"><span class="ms">auto_fix_high</span>${escHtml(page ? t('Convertir en página de Ecos') : t('Convertir en entrada de Ecos'))}</button>`;
  $('#spx-convert').onclick = (e) => busy(e.currentTarget, convertSpectraDraft);
}
async function convertSpectraDraft() {
  const BE = window.BlockEditor;
  const r = await window.api.convertSpectra(JSON.parse(JSON.stringify(draft.blocks || [])));
  const kept = (r.kept || []).map((k) => {
    const name = String(k).replace(/^uagb\//, ''), label = SPECTRA_LABELS[name] ? t(SPECTRA_LABELS[name]) : name;
    return `${label} (${(r.keptCounts || {})[k] || 1})`;
  });
  if (!r.converted) { toast(kept.length ? t('Ecos no puede convertir estos bloques; se mantienen tal cual: {k}', { k: kept.join(', ') }) : t('No había nada que convertir.'), !!kept.length); return; }
  BE.change(() => { draft.blocks = r.blocks; });
  const base = r.converted === 1 ? t('Convertido 1 bloque') : t('Convertidos {n} bloques', { n: r.converted });
  toast(kept.length ? `${base}; ${t('se mantienen tal cual: {k}', { k: kept.join(', ') })}` : base + '.');
}
