// Ecos · Editor de entradas (datos de la entrada, estado en WordPress y enviar). Sigue a app/editor.js y comparte su ámbito global (se cargan en orden desde index.html).
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
  if (res.cacheNote) { const [n0, ...n1] = res.cacheNote.split(' ('); $('#sent-text').textContent += ' ' + t(n0) + (n1.length ? ' (' + n1.join(' (') : ''); }
  $('#sent').classList.remove('hidden');
  $('#sent-share').classList.toggle('hidden', !(res.status === 'publish' && CFG.metaConnected && CFG.shareFacebook === true));
  selected.clear(); updateCount(); renderFeed(); blog.loaded = false;
});
$('#sent-edit').onclick = () => lastSent && window.api.open(lastSent.editUrl);
$('#sent-share').onclick = () => openFbShare();
$('#sent-view').onclick = () => lastSent && window.api.open(lastSent.url);
$('#sent-close').onclick = () => { $('#sent').classList.add('hidden'); $('#editor').classList.add('hidden'); document.body.classList.remove('editing'); updateCount(); };

