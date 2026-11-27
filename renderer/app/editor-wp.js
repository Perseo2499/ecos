// Ecos · «Abrir en el editor de WordPress»: la entrada o página completa se edita con el editor oficial de la web (en una ventana de Ecos)
// y, al volver, se recarga desde WordPress. Sigue a app/editor-send.js y comparte su ámbito global. Solo con «Mi web (wp-admin)».
const WpEditorFull = (() => {
  const L = window.WpEditorLogic;
  const avail = () => L.availability(CFG);
  const msg = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const btn = () => $('#ed-wped');

  // El botón solo aparece con «Mi web (wp-admin)» conectada y en entradas y páginas (no en el original de un bloque sincronizado)
  function update() {
    const b = btn();
    if (!b) return;
    b.classList.toggle('hidden', !(avail().ok && draft && draft.type !== 'wp_block'));
  }
  const _open = openEditor;
  openEditor = function (...a) { const r = _open.apply(this, a); update(); return r; }; // eslint-disable-line no-global-assign

  // Estado con el que se guarda antes de abrir: el que ya tiene en WordPress (no se publica ni se despublica nada)
  function keepStatus() {
    const s = wpSt;
    return s === 'publish' || s === 'future' || s === 'pending' || s === 'private' ? s : 'draft';
  }

  async function open() {
    const a = avail();
    if (!a.ok) return toast(window.WpEditorUI.explain(a), true);
    if (!$('#d-title').value.trim()) throw new Error(t('Escribe un título'));
    const exists = !!draft.postId && !draft.previewOnly && !draft.isNew;
    const q = exists
      ? t('Antes de abrir el editor de WordPress, Ecos guardará esta entrada en WordPress con lo que tienes aquí (sin cambiar si está publicada o en borrador). Al terminar, se recargará desde WordPress. ¿Continuar?')
      : t('Esta entrada todavía no está en WordPress: Ecos creará primero un borrador y lo abrirá en el editor de WordPress. Al terminar, se recargará desde WordPress. ¿Continuar?');
    if (!await ask(q, { ok: exists ? t('Guardar y abrir') : t('Crear borrador y abrir') })) return;
    if (exists && !await multiPreSend()) return;
    const status = exists ? keepStatus() : 'draft';
    const p = draftPayload(MU.sendStatus(status, currentMe()));
    if (status === 'future') p.scheduleAt = draft.date || p.scheduleAt;
    const res = await window.api.publish(p);
    if (res.queued) return toast(t('Sin conexión: no se puede abrir el editor de WordPress ahora. El envío queda en cola.'), true);
    exported = res.exported; lastSent = res; draft.postId = res.postId || draft.postId; draft.wpModified = res.modified || draft.wpModified; draft.previewOnly = false; draft.isNew = false;
    window.api.autosaveClear().catch(() => {}); draftDirty = false; renderWpState(res.status, res.url);
    let r;
    try { r = await window.api.wpEditorPost({ postId: draft.postId, type: draft.type, labels: window.WpEditorUI.labels('post'), colors: window.WpEditorUI.colors() }); }
    catch (e) { return toast(msg(e), true); }
    if (!r || r.cancelled) return toast(t('Has cerrado el editor de WordPress sin terminar. Si guardaste algo allí, pulsa «Actualizar» para traerlo a Ecos.'));
    await openFromWp(draft.postId, draftKeys, draft.type);
    toast(t('Entrada recargada desde WordPress tras editarla allí. Los bloques que Ecos no sabe editar se conservan tal cual.'));
    renderFeed(); blog.loaded = false;
  }

  const b = btn();
  if (b) b.onclick = (e) => busy(e.currentTarget, open);
  return { open, update, keepStatus };
})();
