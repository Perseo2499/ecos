// Ecos · «Editar el original» de un bloque sincronizado: el contenido del wp_block se abre en el editor de Ecos como una
// entrada de tipo wp_block. Al guardar se actualiza el wp_block en WordPress y se vuelve a la entrada de antes.
// Sigue a app/editor-send.js y comparte su ámbito global.
const SyncedEdit = (() => {
  let parent = null; // la entrada que se estaba escribiendo: { draft, keys, st, url, dirty }

  const inMode = () => !!draft && draft.type === 'wp_block';
  const msg = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // El autoguardado de la entrada no debe recoger el bloque que se está editando
  const _autosaveNow = autosaveNow;
  autosaveNow = function (...a) { return inMode() ? undefined : _autosaveNow.apply(this, a); }; // eslint-disable-line no-global-assign

  function snapshotParent() {
    const p = draftPayload($('input[name="d-when"]:checked')?.value || 'draft');
    return {
      draft: { ...draft, title: p.title, excerpt: p.excerpt, tags: p.tags, categories: p.categories, parent: p.parent, slug: $('#d-slug')?.value || '', seoDesc: $('#d-seodesc')?.value || '', focusKw: $('#d-kw')?.value || '' },
      keys: draftKeys, st: wpSt, url: wpUrl, dirty: draftDirty,
    };
  }
  function mode(on) {
    $('#editor').classList.toggle('wpb-mode', on);
    let note = $('#wpb-note');
    if (on && !note) {
      note = document.createElement('div'); note.id = 'wpb-note'; note.className = 'wpb-note';
      $('.ed-side').prepend(note);
    }
    if (note) note.innerHTML = on ? `<span class="ms">sync</span><div><b>${escHtml(t('Estás editando un bloque sincronizado'))}</b><p>${escHtml(t('Al guardar, el cambio se verá en todas las páginas donde se use este bloque.'))}</p></div>` : '';
    $('#ed-bar-title').textContent = on ? t('Bloque sincronizado') : (draft?.type === 'page' ? t('Página') : t('Entrada'));
    const lab = $('#send span:not(.ms)') || $('#send');
    if (on) { lab.dataset.was = lab.textContent; lab.textContent = t('Guardar el original'); }
    else if (lab.dataset.was) { lab.textContent = lab.dataset.was; delete lab.dataset.was; }
  }

  async function open(b) {
    if (inMode()) return toast(t('Ya estás editando un bloque sincronizado: guárdalo o ciérralo primero.'), true);
    let r;
    try { r = await window.PatternsUI.getSynced(b.ref, true); } catch (e) { return toast(msg(e), true); }
    parent = snapshotParent();
    draft = {
      title: r.title, excerpt: '', slug: '', tags: [], categories: [], blocks: JSON.parse(JSON.stringify(r.blocks)),
      featuredImageId: null, keepFeaturedInBody: true, date: null, postId: null, previewOnly: false, wpStatus: null, sections: [], sourceText: '',
      extraMedia: [], type: 'wp_block', syncedId: r.id, isNew: true,
    };
    draftKeys = [];
    renderWpState(null);
    openEditor();
    mode(true);
    draftDirty = false;
  }

  // Vuelve a la entrada de antes (con lo que había escrito)
  function back() {
    const p = parent; parent = null;
    mode(false);
    if (!p) { $('#editor').classList.add('hidden'); document.body.classList.remove('editing'); return; }
    draft = p.draft; draftKeys = p.keys;
    openEditor();
    renderWpState(p.st, p.url);
    mode(false);
    draftDirty = p.dirty;
    window.BlockEditor.render();
  }

  async function save() {
    const title = $('#d-title').value.trim();
    if (!title) throw new Error(t('Escribe un título'));
    const res = await window.api.syncedSave({ id: draft.syncedId, title, blocks: draft.blocks });
    window.PatternsUI.invalidate(draft.syncedId);
    back();
    toast(t('Bloque sincronizado «{n}» guardado: se actualiza en todas las páginas.', { n: res.title || title }));
  }
  async function leave() {
    if (draftDirty && !await ask(t('¿Salir sin guardar los cambios del bloque sincronizado?'), { danger: true, ok: t('Salir') })) return;
    window.PatternsUI.invalidate(draft.syncedId);
    back();
  }

  // El botón «Enviar» guarda el original y la «X» sale (en lo demás, todo sigue como siempre)
  const send = $('#send'), prevSend = send.onclick;
  send.onclick = (e) => (inMode() ? busy(e.currentTarget || send, save) : prevSend.call(send, e));
  const close = $('#ed-close'), prevClose = close.onclick;
  close.onclick = (e) => (inMode() ? leave() : prevClose.call(close, e));
  return { open, inMode };
})();
window.SyncedEdit = SyncedEdit;
