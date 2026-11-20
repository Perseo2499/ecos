// Ecos · Editor de entradas: panel lateral, buscadores y redes, autoguardado, IA, envío, visor y vista previa.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

// El editor (y la terminal) son capas a pantalla completa: van directamente en <body> para que se vean
// desde cualquier pantalla (antes el editor estaba dentro de «Publicaciones» y desde Blog no se veía).
for (const id of ['#editor', '#term']) { const el = $(id); if (el && el.parentElement !== document.body) document.body.appendChild(el); }

// ---------------------------------------------------------------- Editor visual
async function makeDraft() {
  const chosen = posts.filter((p) => selected.has(keyOf(p)));
  const already = chosen.filter(liveExport);
  if (already.length && !await ask(t('{n} de las publicaciones elegidas ya están en el blog. ¿Crear otra entrada de todos modos?', { n: already.length }))) return;
  toast(t('Subiendo fotos a WordPress…'));
  draft = await window.api.buildDraft(chosen);
  renderWpState(null);
  draft.excerpt = ''; draft.postId = null; draft.extraMedia = []; // postId: borrador ya guardado en WordPress
  draftKeys = chosen.flatMap(keysOf);
  openEditor();
  if (draft.failed?.length) toast(t('No se pudieron subir {n} archivo(s): {e}', { n: draft.failed.length, e: draft.failed[0] }), true);
  else if (draft.notes?.includes('video')) toast(t('Tu plan de WordPress no admite subir vídeos: se insertará el vídeo original de la red social.'));
}
$('#make').onclick = (e) => busy(e.target, makeDraft);

// Abre en el editor de Ecos una entrada que ya está en WordPress (desde una publicación o desde el Blog).
// Al enviar se actualiza esa misma entrada.
async function openFromWp(postId, keys) {
  toast(t('Abriendo la entrada de WordPress…'));
  const r = await window.api.pullPost(postId);
  exported = r.exported || exported;
  const imgs = r.blocks.flatMap((b) => (b.img ? [b.img] : b.images || []));
  const vids = r.blocks.filter((b) => b.type === 'video' && b.video?.id).map((b) => ({ ...b.video, type: 'video' }));
  draft = {
    title: r.title, excerpt: r.excerpt || '', slug: r.slug || '', tags: r.tags || [], categories: r.categories || [], blocks: r.blocks,
    featuredImageId: r.featured || null, date: r.date, postId, previewOnly: false, wpStatus: r.status, sections: [], sourceText: '',
    extraMedia: [...(r.featuredImg ? [{ ...r.featuredImg, type: 'image' }] : []), ...imgs.map((i) => ({ ...i, type: i.type || 'image' })), ...vids],
  };
  draftKeys = keys || Object.entries(exported).filter(([, v]) => v.postId === postId).map(([k]) => k);
  openEditor();
  renderWpState(r.status, r.url);
}


// Fotos y vídeos disponibles para la entrada (subidos a WordPress): alimentan la bandeja del editor
function mediaPool() {
  const seen = new Set(), out = [];
  const add = (m) => { if (m && m.id && !seen.has(m.id)) { seen.add(m.id); out.push(m); } };
  for (const s of draft.sections || []) { s.images.forEach((i) => add({ ...i, type: 'image' })); s.videos.forEach((v) => add({ ...v, type: 'video' })); }
  for (const m of draft.extraMedia || []) add(m);
  return out;
}

function openEditor() {
  $('#sent').classList.add('hidden'); $('#send').classList.remove('hidden');
  $('#d-title').value = draft.title;
  requestAnimationFrame(autoTitle); document.fonts?.ready.then(autoTitle);
  $('#d-excerpt').value = draft.excerpt || '';
  $('#d-slug').value = draft.slug || '';
  $('#d-tags').value = draft.tags.join(', ');
  const f = CFG.format || {};
  const defCats = (f.categories || '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
  renderCats(draft.categories ? draft.categories.map((c) => c.toLowerCase()) : defCats);
  const when = draft.wpStatus ? (draft.wpStatus === 'publish' ? 'publish' : draft.wpStatus === 'future' ? 'future' : 'draft') : f.status || 'draft';
  $$('input[name="d-when"]').forEach((r) => (r.checked = r.value === when));
  $('#d-schedule').value = '';
  // Fecha original: activada por defecto y con la fecha a la vista
  $('#d-keepdate').checked = prefs().keepDate !== false;
  $('#d-keepdate-label').textContent = t('Fecha original ({d})', { d: fmtDay(draft.date) });
  $('#d-template').innerHTML = `<option value="">${t('Sin plantilla')}</option>` + (CFG.templates || []).map((tp, i) => `<option value="${i}">${escHtml(tp.name)}</option>`).join('');
  // Sin IA configurada, los botones se muestran desactivados y explican por qué al pasar el ratón
  $$('#ai-article, #ai-alts').forEach((b) => { b.disabled = !CFG.aiConfigured; b.parentElement.title = CFG.aiConfigured ? '' : t('Configura una IA en «Conexiones» para usar estos botones.'); });
  toggleSchedule();
  if (!draft.blocks) draft.blocks = [];
  window.BlockEditor.mount(draft, {
    media: mediaPool(),
    onChange: () => { window.BlockEditor.renderMedia(); window.FormatBar.review(); autosaveSoon(); renderShare(); },
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
}
// El título crece en varias líneas (y no admite saltos de línea)
const autoTitle = () => { const el = $('#d-title'); el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
$('#d-title').oninput = () => { autoTitle(); autosaveSoon(); };
['#d-excerpt', '#d-tags', '#d-slug'].forEach((s) => $(s)?.addEventListener('input', () => { autosaveSoon(); renderShare(); }));
$('#d-title').addEventListener('input', () => renderShare());
$('#d-slug').addEventListener('blur', () => { $('#d-slug').value = slugify($('#d-slug').value); renderShare(); });

// ---------------------------------------------------------------- Buscadores y redes
// «¡Primer día en Rabat!» → «primer-dia-en-rabat» (como hace WordPress)
const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
// Vista de cómo se verá la entrada al compartirla (Facebook, WhatsApp, X…) y en Google
function renderShare() {
  const box = $('#d-share'); if (!box || !draft) return;
  const site = (CFG.wpPublicUrl || 'https://' + (CFG.wpSite || 'tu-web.com')).replace(/\/$/, '');
  const host = site.replace(/^https?:\/\//, '');
  const title = $('#d-title').value.trim() || t('Sin título');
  const slug = slugify($('#d-slug').value) || slugify(title);
  $('#d-slug').placeholder = slugify(title) || 'direccion-de-la-entrada';
  $('#d-slug-base').textContent = host + '/…/';
  const all = [...(draft.blocks || []).flatMap((b) => (b.img ? [b.img] : b.images || [])), ...(window.BlockEditor?.media || [])];
  const img = all.find((i) => i.id === draft.featuredImageId) || all.find((i) => i.type !== 'video' && i.url);
  const desc = $('#d-excerpt').value.trim() || (window.BlockEditor?.plainText?.() || '').slice(0, 200);
  const warn = [];
  if (title.length > 60) warn.push(t('Google corta los títulos de más de 60 caracteres.'));
  if (!$('#d-excerpt').value.trim()) warn.push(t('Sin extracto se usa el principio del texto.'));
  box.innerHTML = `<div class="section-label">${t('Al compartir')}</div>
    <div class="sc-card">${img ? `<img src="${escHtml(img.url)}" alt="">` : '<div class="sc-noimg"><span class="ms">image</span></div>'}
      <div class="sc-body"><div class="sc-host">${escHtml(host.toUpperCase())}</div><div class="sc-title">${escHtml(title)}</div><div class="sc-desc">${escHtml(desc.slice(0, 160))}</div></div></div>
    <div class="sc-google"><div class="sc-g-url">${escHtml(host)} › ${escHtml(slug)}</div><div class="sc-g-title">${escHtml(title.slice(0, 60))}${title.length > 60 ? '…' : ''}</div><div class="sc-g-desc">${escHtml(desc.slice(0, 155))}${desc.length > 155 ? '…' : ''}</div></div>
    ${warn.length ? `<div class="hint sc-warn">${warn.map(escHtml).join('<br>')}</div>` : ''}`;
}

// ---------------------------------------------------------------- Autoguardado del borrador
let draftDirty = false, autosaveTimer = null;
const editorOpen = () => !$('#editor').classList.contains('hidden');
function autosaveSoon() { if (!editorOpen()) return; draftDirty = true; clearTimeout(autosaveTimer); autosaveTimer = setTimeout(autosaveNow, 2500); }
async function autosaveNow() {
  clearTimeout(autosaveTimer);
  if (!draft) return;
  const p = draftPayload($('input[name="d-when"]:checked')?.value || 'draft');
  try { await window.api.autosave({ draft: { ...draft, title: p.title, excerpt: p.excerpt, tags: p.tags, categories: p.categories, slug: $('#d-slug')?.value || '' }, keys: draftKeys }); } catch { /* bloqueada o sin disco */ }
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
  if (!$('#sent').classList.contains('hidden') || !draftDirty || await ask(t('¿Cerrar el editor? La entrada queda guardada en este ordenador y podrás recuperarla desde «Publicaciones».'))) {
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
  const text = draft.sourceText || window.BlockEditor.plainText();
  const opts = { ...aiOpts(), notes: $('#ai-opts [data-opt="notes"]').value.trim() };
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
$('#ai-alts').onclick = (e) => busy(e.target, async () => {
  const imgs = draft.blocks.flatMap((b) => (b.img ? [b.img] : b.images || [])).filter((i) => i.type !== 'video');
  if (!imgs.length) throw new Error(t('Esta entrada no tiene fotos'));
  const alts = await window.api.aiAlts(imgs.map((i) => i.url), $('#d-title').value);
  window.BlockEditor.change(() => imgs.forEach((img, i) => { if (alts[i]) img.alt = alts[i]; }));
  toast(t('Descripciones añadidas. Puedes corregirlas debajo de cada foto.'));
});

// Datos de la entrada para enviar o previsualizar
const draftPayload = (status) => ({
  postId: draft.postId,
  title: $('#d-title').value.trim(), excerpt: $('#d-excerpt').value.trim(), blocks: draft.blocks,
  tags: $('#d-tags').value.split(',').map((x) => x.trim()).filter(Boolean),
  categories: $$('#d-cats input:checked').map((i) => i.value),
  status, scheduleAt: status === 'future' ? $('#d-schedule').value : null,
  featuredImageId: draft.featuredImageId, keepDate: $('#d-keepdate').checked, date: draft.date, keys: draftKeys,
  slug: slugify($('#d-slug').value),
  recreate: !!draft.previewOnly,
});

// Actualizar desde WordPress (la app envía y también recibe cambios)
const WP_STATE = () => ({ publish: [t('Publicada'), 'public'], draft: [t('Borrador'), 'draft'], future: [t('Programada'), 'schedule'], pending: [t('Pendiente'), 'pending'], private: [t('Privada'), 'lock'], trash: [t('En la papelera'), 'delete'] });
function renderWpState(st, url) {
  const el = $('#ed-wp');
  if (!st) { el.classList.add('hidden'); return; }
  const [name, ic] = WP_STATE()[st] || [st, 'help'];
  el.className = 'ed-wp st-' + st;
  el.innerHTML = `<span class="ms">${ic}</span>${escHtml(name)}${st === 'publish' && url ? ` · <a href="#">${t('Ver')}</a>` : ''}`;
  $('a', el)?.addEventListener('click', (e) => { e.preventDefault(); window.api.open(url); });
}
$('#ed-pull').onclick = (e) => busy(e.currentTarget, async () => {
  if (!draft.postId) return toast(t('Esta entrada todavía no está en WordPress: envíala primero.'), true);
  const r = await window.api.pullPost(draft.postId);
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
    if (r.contentChanged) draft.blocks = r.blocks;
    if (r.featured) { draft.featuredImageId = r.featured; window.BlockEditor.liftFeatured(); }
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
  $('#sent-text').textContent = res.status === 'publish' ? t('¡Entrada publicada!')
    : res.status === 'future' ? t('Entrada programada para el {d}.', { d: fmtDate(res.date) }) : t('Borrador creado en WordPress.');
  if (res.status !== 'future' && res.date) $('#sent-text').textContent += ' ' + t('Fecha de la entrada: {d}.', { d: fmtDate(res.date) });
  $('#sent').classList.remove('hidden');
  selected.clear(); updateCount(); renderFeed(); blog.loaded = false;
});
$('#sent-edit').onclick = () => lastSent && window.api.open(lastSent.editUrl);
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
async function showPreview({ title, date: when, cats = [], featured, content, web = false }) {
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
  $('#pv-frame').srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <style>${site.css}</style><style>${generic}
      .ecos-pv{max-width:760px;margin:0 auto;padding:40px 24px 80px}
      .ecos-pv img,.ecos-pv video{max-width:100%;height:auto}
      .ecos-pv .ecos-meta{opacity:.7;font-size:.9em;margin-bottom:1.5em}
      .ecos-pv .ecos-featured{width:100%;border-radius:12px;margin-bottom:1.5em}
      .ecos-pv .wp-block-embed:not(:has(iframe)){padding:18px;border:1px dashed #bbb;border-radius:10px;font-size:14px;word-break:break-all}
      .has-text-align-center{text-align:center}.has-text-align-right{text-align:right}.has-text-align-justify{text-align:justify}
      .has-background{padding:1.25em 2.375em}.has-drop-cap:first-letter{float:left;font-size:5.5em;line-height:.68;font-weight:100;margin:.05em .1em 0 0;text-transform:uppercase}
      mark.has-inline-color{padding:0 .1em}
      .wp-block-table table{width:100%;border-collapse:collapse}.wp-block-table td,.wp-block-table th{border:1px solid;padding:.5em}.wp-block-table.is-style-stripes tbody tr:nth-child(odd){background:#f0f0f0}
      .wp-block-buttons{display:flex;gap:.5em;flex-wrap:wrap;margin:1.5em 0}.wp-block-buttons.is-content-justification-center{justify-content:center}.wp-block-buttons.is-content-justification-right{justify-content:flex-end}
      .wp-block-button__link{display:inline-block;padding:.65em 1.4em;border-radius:9999px;background:#32373c;color:#fff;text-decoration:none}
      .is-style-outline .wp-block-button__link{background:transparent;color:inherit;border:2px solid}
      .wp-block-pullquote{text-align:center;border-block:4px solid;padding:2em 0;margin:2em 0;font-size:1.5em}.wp-block-pullquote blockquote{margin:0;border:0;padding:0}
      .wp-block-details{border:1px solid #ddd;border-radius:10px;padding:.8em 1.1em;margin:1.5em 0}.wp-block-details summary{cursor:pointer;font-weight:600}
      .wp-element-caption{font-size:.85em;opacity:.75;text-align:center}
    </style></head>
    <body class="${escHtml(site.bodyClass.replace(/\bhome\b|\bblog\b|\bpage\b/g, ''))} single single-post wp-embed-responsive">
    <main class="site-main"><article class="post type-post status-publish hentry ecos-pv">
      <header class="entry-header">${cats.length ? `<div class="cat-links ecos-meta">${escHtml(cats.join(' · '))}</div>` : ''}
        <h1 class="entry-title wp-block-post-title">${escHtml(title)}</h1><div class="ecos-meta entry-meta">${date}</div></header>
      ${featured ? `<img class="ecos-featured wp-post-image" src="${escHtml(featured)}" alt="">` : ''}
      <div class="entry-content wp-block-post-content is-layout-constrained">${content}</div>
    </article></main></body></html>`;
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
  const featured = draft.blocks.flatMap((b) => (b.img ? [b.img] : b.images || [])).filter((i) => i.type !== 'video').find((i) => i.id === draft.featuredImageId);
  const cats = $$('#d-cats input:checked').map((i) => i.value);
  await showPreview({ title: $('#d-title').value, date: $('#d-keepdate').checked ? draft.date : Date.now(), cats, featured: featured?.url, content, web: true });
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
