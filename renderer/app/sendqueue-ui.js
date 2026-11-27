// Ecos · Cola de envíos sin conexión (indicador en la cabecera y panel) y canal de pruebas de las actualizaciones.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

let sendQueueItems = [];
const queueShown = new Set(); // avisos de «envío a medias» / «cambió en WordPress» ya enseñados
const queueRef = (it) => { const m = /^(post|page):(\d+)$/.exec(it.key || ''); return m ? { type: m[1], id: Number(m[2]) } : null; };
const queueProgressText = (it) => {
  const p = it.progress; if (!p) return '';
  const bits = [];
  if (p.mediaTotal) bits.push(t('{a} de {b} fotos subidas', { a: p.mediaDone, b: p.mediaTotal }));
  if (p.created) bits.push(t('entrada ya creada en WordPress'));
  return bits.join(' · ');
};
async function queueCompare(it) {
  const r = queueRef(it); if (!r) return;
  closeQueuePanel();
  await openFromWp(r.id, null, r.type);
  toast(t('Esta es la versión que hay ahora en WordPress. Tu versión sigue guardada en «Envíos pendientes».'));
}
async function queueResolve(it, how) { try { renderQueue(await window.api.queueResolve(it.id, how)); } catch (e) { toastError(e); } }
// Avisos al abrir Ecos (o cuando cambia la cola): envío a medias y conflicto
function queueNotices() {
  for (const it of sendQueueItems) {
    if (!it.hold || queueShown.has(it.id + it.hold)) continue;
    queueShown.add(it.id + it.hold);
    const title = it.title || t('(sin título)');
    if (it.hold === 'interrupted') {
      const pt = queueProgressText(it);
      banner('q-' + it.id, t('Hay un envío a medias: «{title}»', { title }) + (pt ? ` (${pt})` : ''), [
        [t('Continuar'), (el) => { el.remove(); window.api.queueRetry(it.id).then(renderQueue).catch(toastError); }, 'primary'],
        [t('Ver'), () => { $('#q-panel').classList.remove('hidden'); $('#q-ind').setAttribute('aria-expanded', 'true'); }],
        [t('Descartar'), async (el) => { if (await ask(t('Se descartará este envío y no se hará. ¿Continuar?'), { danger: true, ok: t('Descartar') })) { el.remove(); window.api.queueDiscard(it.id).then(renderQueue).catch(toastError); } }],
      ]);
    } else if (it.hold === 'conflict') {
      banner('q-' + it.id, t('«{title}» ha cambiado en WordPress mientras tanto. ¿Qué hacemos con tu versión?', { title }), [
        [t('Comparar'), () => queueCompare(it)],
        [t('Sobrescribir'), (el) => { el.remove(); queueResolve(it, 'overwrite'); }, 'primary'],
        [t('Guardar como copia'), (el) => { el.remove(); queueResolve(it, 'copy'); }],
      ]);
    }
  }
}
function renderQueue(items) {
  sendQueueItems = Array.isArray(items) ? items : [];
  queueNotices();
  const n = sendQueueItems.length;
  $('#q-ind').classList.toggle('hidden', !n);
  $('#q-count').textContent = String(n);
  $('#q-ind').title = n === 1 ? t('1 envío pendiente') : t('{n} envíos pendientes', { n });
  if (!n) closeQueuePanel();
  const list = $('#q-list');
  list.innerHTML = sendQueueItems.map((it) => {
    const prog = queueProgressText(it);
    const holdTxt = it.hold === 'interrupted' ? t('Envío a medias: pulsa Continuar') : it.hold === 'conflict' ? t('Ha cambiado en WordPress') : '';
    const when = holdTxt || it.nextAt > Date.now() ? t('Próximo intento: {d}', { d: new Date(it.nextAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : t('Reintentando…');
    return `<div class="q-item" data-id="${escHtml(it.id)}">
      <div class="q-main"><b>${escHtml(it.title || t('(sin título)'))}</b><span class="hint">${it.type === 'page' ? t('Página') : t('Entrada')} · ${escHtml(when)}${it.attempts ? ' · ' + t('{n} intentos', { n: it.attempts }) : ''}</span>${prog ? `<span class="hint">${escHtml(prog)}</span>` : ''}</div>
      ${it.hold === 'conflict' ? `<button class="btn text small" data-q="compare">${t('Comparar')}</button><button class="btn text small" data-q="overwrite">${t('Sobrescribir')}</button><button class="btn text small" data-q="copy">${t('Guardar como copia')}</button>`
        : `<button class="btn text small" data-q="retry">${it.hold === 'interrupted' ? t('Continuar') : t('Reintentar ya')}</button>`}
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
    const it = sendQueueItems.find((x) => x.id === id);
    if (b.dataset.q === 'retry') renderQueue(await window.api.queueRetry(id));
    else if (b.dataset.q === 'compare') await queueCompare(it);
    else if (b.dataset.q === 'overwrite' || b.dataset.q === 'copy') await queueResolve(it, b.dataset.q);
    else if (await ask(t('Se descartará este envío y no se hará. ¿Continuar?'), { danger: true, ok: t('Descartar') })) renderQueue(await window.api.queueDiscard(id));
  } catch (err) { toastError(err); }
};
window.api.onQueue(renderQueue);
window.api.onQueueDone(() => { blog.loaded = false; refreshExported(true); });
window.api.queueList().then(renderQueue).catch(() => {});

// Canal de pruebas (Ajustes → Avanzado)
function renderBeta() { const el = $('#s-beta'); if (el) el.checked = !!prefs().betaChannel; }
$('#s-beta').onchange = async () => {
  await savePrefs({ betaChannel: $('#s-beta').checked });
  toast($('#s-beta').checked ? t('Canal de pruebas activado: Ecos instalará las versiones nuevas en cuanto salgan.') : t('Canal estable: Ecos esperará 24 horas antes de instalar una versión nueva.'));
  setTimeout(() => window.api.updateStatus().then(renderUpdate).catch(() => {}), 800);
};
