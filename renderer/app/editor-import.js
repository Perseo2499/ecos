// Ecos · Editor de entradas (importar una entrada o página exportada de WordPress). Sigue a app/editor.js y comparte su ámbito global (se cargan en orden desde index.html).
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

