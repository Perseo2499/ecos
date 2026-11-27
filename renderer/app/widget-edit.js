// Ecos · Editar un widget de bloque con el editor de bloques de Ecos. El contenido (instance.raw.content) se abre como un
// borrador de tipo «wp_widget»; al guardar no se envía nada a WordPress: el contenido vuelve a Menús y widgets, que lo guarda
// junto con el resto de cambios. Sigue a app/synced.js y comparte su ámbito global.
const WidgetEdit = (() => {
  let cb = null, parent = null;
  const inMode = () => !!draft && draft.type === 'wp_widget';

  const _autosaveNow = autosaveNow;
  autosaveNow = function (...a) { return inMode() ? undefined : _autosaveNow.apply(this, a); }; // eslint-disable-line no-global-assign

  function mode(on, title) {
    $('#editor').classList.toggle('wpb-mode', on); $('#editor').classList.toggle('wpw-mode', on);
    let note = $('#wpb-note');
    if (on && !note) { note = document.createElement('div'); note.id = 'wpb-note'; note.className = 'wpb-note'; $('.ed-side').prepend(note); }
    if (note) note.innerHTML = on ? `<span class="ms">widgets</span><div><b>${escHtml(t('Estás editando un widget de bloque'))}</b><p>${escHtml(t('Al guardar vuelves a Menús y widgets; el cambio se publica cuando pulses «Guardar cambios» allí.'))}</p></div>` : '';
    $('#ed-bar-title').textContent = on ? (title || t('Widget de bloque')) : (draft?.type === 'page' ? t('Página') : t('Entrada'));
    const lab = $('#send span:not(.ms)') || $('#send');
    if (on) { lab.dataset.was = lab.dataset.was || lab.textContent; lab.textContent = t('Listo'); }
    else if (lab.dataset.was) { lab.textContent = lab.dataset.was; delete lab.dataset.was; }
  }

  async function open({ content, title, onSave }) {
    if (inMode()) return toast(t('Ya estás editando un widget: termina o ciérralo primero.'), true);
    let blocks = [];
    try { blocks = content ? await window.api.parseBlocks(content) : []; } catch { blocks = []; }
    if (!blocks.length) blocks = [window.BlockEditor.create('paragraph')];
    cb = onSave;
    parent = null;
    if (typeof editorOpen === 'function' && editorOpen() && draft) {
      const p = draftPayload($('input[name="d-when"]:checked')?.value || 'draft');
      parent = { draft: { ...draft, title: p.title, excerpt: p.excerpt, tags: p.tags, categories: p.categories, parent: p.parent, slug: $('#d-slug')?.value || '', seoDesc: $('#d-seodesc')?.value || '', focusKw: $('#d-kw')?.value || '' }, keys: draftKeys, st: wpSt, url: wpUrl, dirty: draftDirty };
    }
    draft = { title: title || t('Widget de bloque'), excerpt: '', slug: '', tags: [], categories: [], blocks: JSON.parse(JSON.stringify(blocks)), featuredImageId: null, keepFeaturedInBody: true, date: null, postId: null, previewOnly: false, wpStatus: null, sections: [], sourceText: '', extraMedia: [], type: 'wp_widget', isNew: true };
    draftKeys = [];
    renderWpState(null);
    openEditor();
    mode(true, title);
    draftDirty = false;
  }
  function back() {
    const p = parent; parent = null; cb = null;
    mode(false);
    if (!p) { draft = null; $('#editor').classList.add('hidden'); document.body.classList.remove('editing'); return; }
    draft = p.draft; draftKeys = p.keys;
    openEditor(); renderWpState(p.st, p.url); mode(false); draftDirty = p.dirty; window.BlockEditor.render();
  }
  async function save() {
    const content = await window.api.composeDraft(draft.blocks);
    const done = cb; back();
    if (done) done(content);
    toast(t('Widget actualizado. Pulsa «Guardar cambios» en Menús y widgets para publicarlo.'));
  }
  async function leave() {
    if (draftDirty && !await ask(t('¿Salir sin guardar los cambios del widget?'), { danger: true, ok: t('Salir') })) return;
    back();
  }
  const send = $('#send'), prevSend = send.onclick;
  send.onclick = (e) => (inMode() ? busy(e.currentTarget || send, save) : prevSend.call(send, e));
  const close = $('#ed-close'), prevClose = close.onclick;
  close.onclick = (e) => (inMode() ? leave() : prevClose.call(close, e));
  return { open, inMode };
})();
window.WidgetEdit = WidgetEdit;
