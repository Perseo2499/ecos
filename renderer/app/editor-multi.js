// Ecos · Varias personas en la misma web: rol (enviar a revisión), aviso de edición simultánea (bloqueo estándar de WordPress,
// con el Complemento de Ecos ≥ 1.2.0) y aviso de «alguien ha cambiado esta entrada desde que la abriste».
// Sigue a app/editor-history.js y comparte su ámbito global (se cargan en orden desde index.html). La lógica pura está en multiuser.js.
const MU = window.MultiUser;
const selfMode = () => (CFG.wpMode || 'selfhosted') === 'selfhosted';
const currentMe = () => (selfMode() ? CFG.wpMe || null : null);

// Persona (autor) con avatar pequeño o iniciales: sirve en el Blog, en Inicio y en los avisos
function authorHtml(a, cls = '') {
  if (!a || !a.name) return '';
  const av = a.avatar ? `<img class="au-av" src="${escHtml(a.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
  return `<span class="au ${cls}" title="${escHtml(t('Autor: {n}', { n: a.name }))}">${av || `<span class="au-av au-ini">${escHtml(MU.initials(a.name))}</span>`}<span class="au-n">${escHtml(a.name)}</span></span>`;
}

// ---------------------------------------------------------------- Rol: quien no puede publicar envía a revisión
function multiApplyRole() {
  const ok = MU.canPublish(currentMe());
  const radio = $('input[name="d-when"][value="publish"], input[name="d-when"][value="pending"]');
  const fut = $('input[name="d-when"][value="future"]');
  if (!radio) return;
  radio.value = ok ? 'publish' : 'pending';
  const label = radio.closest('label');
  $$('.ms', label)[0].textContent = ok ? 'public' : 'rate_review';
  label.lastElementChild.textContent = ok ? t('Publicar') : t('Enviar a revisión');
  label.title = ok ? '' : t('Tu rol no puede publicar: la entrada queda pendiente de revisión para que alguien con permiso la publique.');
  fut.closest('label').classList.toggle('hidden', !ok);
  const cur = $('input[name="d-when"]:checked')?.value;
  if (!ok && (!cur || cur === 'future' || cur === 'publish')) radio.checked = true;
  if (!ok && draft?.wpStatus === 'pending') radio.checked = true;
  toggleSchedule();
}

// ---------------------------------------------------------------- Aviso de edición simultánea
let lockKeeper = null, lockId = 0, lockReadonly = false;
function setReadonly(on) {
  lockReadonly = on;
  $('#editor').classList.toggle('readonly', on);
  for (const el of ['#d-title', '#d-blocks', '.ed-media', '.ed-side'].map((s) => $(s))) if (el) el.inert = on;
  $('#send').disabled = on;
}
function renderLock(state, user) {
  const box = $('#ed-lock');
  if (state !== 'other') {
    const was = lockReadonly;
    box.classList.add('hidden'); box.innerHTML = '';
    if (was) { setReadonly(false); toast(t('Ya puedes editar: nadie más la tiene abierta.')); }
    return;
  }
  const page = isPageDraft();
  box.classList.remove('hidden');
  box.innerHTML = `<span class="ms fill">lock_person</span><span class="ed-lock-t"></span><span class="ed-lock-a"></span>`;
  $('.ed-lock-t', box).textContent = (page ? t('{n} está editando esta página ahora mismo. Si envías, podrías sobrescribir sus cambios.', { n: user?.name || t('Alguien') })
    : t('{n} está editando esta entrada ahora mismo. Si envías, podrías sobrescribir sus cambios.', { n: user?.name || t('Alguien') })) + (lockReadonly ? ' ' + t('(Solo lectura)') : '');
  const acts = $('.ed-lock-a', box);
  const add = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.onclick = () => busy(b, fn); acts.appendChild(b); };
  if (!lockReadonly) add(t('Abrir en solo lectura'), 'text small', async () => { setReadonly(true); renderLock('other', user); });
  add(t('Editar de todos modos'), 'tonal small', async () => { setReadonly(false); await lockKeeper?.takeOver(); renderLock(lockKeeper?.state === 'other' ? 'other' : 'mine'); });
}
function multiStop() {
  const k = lockKeeper, id = lockId; lockKeeper = null; lockId = 0;
  if (k) k.stop();
  setReadonly(false);
  renderLock('idle');
  return id;
}
function multiOnOpen() {
  multiStop();
  if (!draft?.postId || draft.previewOnly || !selfMode() || !CFG.ecosHelper?.installed) return;
  lockId = draft.postId;
  lockKeeper = MU.createLockKeeper({
    id: lockId,
    api: { acquire: (id, force) => window.api.postLockAcquire(id, force), release: (id) => window.api.postLockRelease(id) },
    onChange: (st, u) => renderLock(st, u),
  });
  lockKeeper.start();
}
// Al cerrar el editor (con cualquier botón) se suelta el bloqueo
new MutationObserver(() => { if ($('#editor').classList.contains('hidden') && lockKeeper) multiStop(); }).observe($('#editor'), { attributes: true, attributeFilter: ['class'] });
window.addEventListener('beforeunload', () => { if (lockKeeper && lockId) window.api.postLockRelease(lockId).catch(() => {}); });

// ---------------------------------------------------------------- Diálogo con varias salidas
// options: [[texto, valor, clase]]; Esc o fuera = el último valor marcado como «cancelar» (o null)
function askChoice(message, options, { detail = '', cancelValue = null } = {}) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const d = document.createElement('div');
    d.className = 'dlg-scrim';
    d.innerHTML = `<div class="dlg multi-dlg" role="alertdialog" aria-modal="true"><span class="ms fill dlg-ic">warning</span><p class="dlg-msg"></p><p class="dlg-sub hint"></p><div class="dlg-actions"></div></div>`;
    $('.dlg-msg', d).textContent = message;
    const sub = $('.dlg-sub', d); sub.textContent = detail; sub.hidden = !detail;
    const close = (v) => { d.classList.add('out'); setTimeout(() => d.remove(), 160); document.removeEventListener('keydown', key, true); prev?.focus?.(); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cancelValue); } };
    for (const [label, value, cls] of options) {
      const b = document.createElement('button'); b.className = 'btn ' + (cls || 'text'); b.textContent = label; b.onclick = () => close(value);
      $('.dlg-actions', d).appendChild(b);
    }
    d.addEventListener('mousedown', (e) => { if (e.target === d) close(cancelValue); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(d);
    $('.dlg-actions .filled, .dlg-actions .tonal', d)?.focus();
  });
}

// ---------------------------------------------------------------- Antes de enviar
// Devuelve false si se cancela el envío
async function multiPreSend() {
  if (!draft?.postId || draft.previewOnly || draft.isNew || !selfMode()) return true;
  // 1) ¿Otra persona la tiene abierta ahora mismo? (comprobación fresca, no la de hace un minuto)
  if (lockKeeper) {
    const r = await lockKeeper.check();
    if (r.state === 'other' && !await ask(t('{n} está editando esta entrada ahora mismo (en Ecos o en WordPress). Si envías, podrías sobrescribir sus cambios. ¿Enviar de todos modos?', { n: r.user?.name || t('Alguien') }), { ok: t('Enviar de todos modos') })) return false;
  }
  // 2) ¿Se ha modificado en WordPress después de abrirla?
  let cur = null;
  try { cur = (await window.api.postModified(draft.postId, draft.type))?.modified || null; } catch { return true; } // sin conexión: lo decide el envío (cola)
  if (MU.changedSince(draft.wpModified, cur)) {
    const pick = await askChoice(t('Alguien ha cambiado esta entrada desde que la abriste'), [
      [t('Cancelar'), 'cancel', 'text'], [t('Comparar'), 'compare', 'outlined'], [t('Sobrescribir'), 'overwrite', 'filled danger-fill'],
    ], { detail: t('Si la sobrescribes, esos cambios se perderán, aunque Ecos guarda en el Historial una copia de lo que había.'), cancelValue: 'cancel' });
    if (pick === 'compare') { openHistory(); return false; }
    if (pick !== 'overwrite') return false;
    draft.wpModified = cur;
  }
  return true;
}
