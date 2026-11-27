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
  if (r.cached) toast(t('Sin conexión: se abre la última versión guardada ({w}). Al enviar se avisará si ha cambiado en WordPress.', { w: Net.cacheNote(r.cached.at) }));
  exported = r.exported || exported;
  const imgs = window.BlockEditor.flat(r.blocks).flatMap((b) => (b.img ? [b.img] : b.images || []));
  const vids = window.BlockEditor.flat(r.blocks).filter((b) => b.type === 'video' && b.video?.id).map((b) => ({ ...b.video, type: 'video' }));
  draft = {
    title: r.title, excerpt: r.excerpt || '', slug: r.slug || '', tags: r.tags || [], categories: r.categories || [], blocks: r.blocks,
    featuredImageId: r.featured || null, keepFeaturedInBody: true, date: r.date, wpModified: r.modified || null, postId, previewOnly: false, wpStatus: r.status, sections: [], sourceText: '',
    type: type === 'page' ? 'page' : 'post', parent: r.parent || 0, seoDesc: r.seoDesc || '', pageBg: r.pageBg || null, astra: r.astra || undefined,
    extraMedia: [...(r.featuredImg ? [{ ...r.featuredImg, type: 'image' }] : []), ...imgs.map((i) => ({ ...i, type: i.type || 'image' })), ...vids],
  };
  draftKeys = keys || Object.entries(exported).filter(([, v]) => v.postId === postId).map(([k]) => k);
  openEditor();
  renderWpState(r.status, r.url);
  // «Convertir en página de Ecos» desde el Blog o la pantalla Estructura: se abre y se convierte de una vez
  if (opts.convert) {
    if (spectraCount() || spectraThird()) await convertSpectraDraft();
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
  window.SeoPanel?.load();
  renderPageBg();
  renderAstra(); loadWebStyles();
  $('#d-tags').value = draft.tags.join(', ');
  const f = CFG.format || {};
  const defCats = (f.categories || '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
  renderCats(draft.categories ? draft.categories.map((c) => c.toLowerCase()) : defCats);
  const when = draft.wpStatus ? (draft.wpStatus === 'publish' ? 'publish' : draft.wpStatus === 'future' ? 'future' : 'draft') : f.status || 'draft';
  $$('input[name="d-when"]').forEach((r) => (r.checked = r.value === when));
  multiApplyRole();
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
    // «Sustituir por el original»: del ordenador o de Google Fotos; el vídeo pasa por el mismo procesado (1080p + portada)
    onReplaceVideo: async (src) => {
      if (src === 'pc') {
        toast(t('Se abrirá el selector de vídeos; después se comprime a 1080p si hace falta y se sube (puede tardar).'));
        return window.api.videoPickLocal();
      }
      const got = await pickFromGPhotos();
      const v = (got || []).find((g) => g.type === 'video');
      if (!v) { if (got?.length) toast(t('No has elegido ningún vídeo'), true); return null; }
      toast(t('Preparando el vídeo (se comprime a 1080p si hace falta)…'));
      return window.api.videoFinish({ url: v.url, id: v.id });
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
  multiOnOpen();
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

