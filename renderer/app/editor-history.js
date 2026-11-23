// Ecos · Editor de entradas (historial de versiones). Sigue a app/editor.js y comparte su ámbito global (se cargan en orden desde index.html).
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
