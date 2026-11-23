// Ecos · Editor de entradas (autoguardado, cerrar, pegar imágenes, categorías y plantillas). Sigue a app/editor.js y comparte su ámbito global (se cargan en orden desde index.html).
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

