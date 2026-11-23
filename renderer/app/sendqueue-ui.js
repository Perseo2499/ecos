// Ecos · Cola de envíos sin conexión (indicador en la cabecera y panel) y canal de pruebas de las actualizaciones.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

let sendQueueItems = [];
function renderQueue(items) {
  sendQueueItems = Array.isArray(items) ? items : [];
  const n = sendQueueItems.length;
  $('#q-ind').classList.toggle('hidden', !n);
  $('#q-count').textContent = String(n);
  $('#q-ind').title = n === 1 ? t('1 envío pendiente') : t('{n} envíos pendientes', { n });
  if (!n) closeQueuePanel();
  const list = $('#q-list');
  list.innerHTML = sendQueueItems.map((it) => {
    const when = it.nextAt > Date.now() ? t('Próximo intento: {d}', { d: new Date(it.nextAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : t('Reintentando…');
    return `<div class="q-item" data-id="${escHtml(it.id)}">
      <div class="q-main"><b>${escHtml(it.title || t('(sin título)'))}</b><span class="hint">${it.type === 'page' ? t('Página') : t('Entrada')} · ${escHtml(when)}${it.attempts ? ' · ' + t('{n} intentos', { n: it.attempts }) : ''}</span></div>
      <button class="btn text small" data-q="retry">${t('Reintentar ya')}</button>
      <button class="btn text small danger" data-q="discard">${t('Descartar')}</button>
    </div>`;
  }).join('');
}
function closeQueuePanel() { $('#q-panel').classList.add('hidden'); $('#q-ind').setAttribute('aria-expanded', 'false'); }
$('#q-ind').onclick = (e) => {
  e.stopPropagation();
  const open = $('#q-panel').classList.toggle('hidden') === false;
  $('#q-ind').setAttribute('aria-expanded', String(open));
};
document.addEventListener('click', (e) => { if (!e.target.closest('.q-wrap')) closeQueuePanel(); });
$('#q-retry-all').onclick = async () => { try { renderQueue(await window.api.queueRetry()); } catch (e) { toastError(e); } };
$('#q-list').onclick = async (e) => {
  const b = e.target.closest('[data-q]'); if (!b) return;
  const id = b.closest('.q-item').dataset.id;
  try {
    if (b.dataset.q === 'retry') renderQueue(await window.api.queueRetry(id));
    else if (await ask(t('Se descartará este envío y no se hará. ¿Continuar?'), { danger: true, ok: t('Descartar') })) renderQueue(await window.api.queueDiscard(id));
  } catch (err) { toastError(err); }
};
window.api.onQueue(renderQueue);
window.api.onQueueDone(() => { blog.loaded = false; refreshExported(true); });
window.addEventListener('online', () => { window.api.queueOnline().then(renderQueue).catch(() => {}); });
window.api.queueList().then(renderQueue).catch(() => {});

// Canal de pruebas (Ajustes → Avanzado)
function renderBeta() { const el = $('#s-beta'); if (el) el.checked = !!prefs().betaChannel; }
$('#s-beta').onchange = async () => {
  await savePrefs({ betaChannel: $('#s-beta').checked });
  toast($('#s-beta').checked ? t('Canal de pruebas activado: Ecos instalará las versiones nuevas en cuanto salgan.') : t('Canal estable: Ecos esperará 24 horas antes de instalar una versión nueva.'));
  setTimeout(() => window.api.updateStatus().then(renderUpdate).catch(() => {}), 800);
};
