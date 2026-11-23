// Ecos · Ajustes → Copia de seguridad → «Copia de emergencia» y aviso en Inicio si la última copia es antigua.
// La copia la hace main.js (src/emergency.js): contenido + copia visual navegable + configuración + guía en un ZIP.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

const EMG = { st: null, last: null };
const EMG_PHASES = [['contenido', 'Contenido', 'article'], ['configuracion', 'Configuración', 'tune'], ['visual', 'Copia visual', 'web'], ['guia', 'Guía', 'menu_book']];
const emSize = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

function emPaint() {
  const st = EMG.st;
  if (!st) return;
  const self = CFG.wpMode === 'selfhosted';
  $('#em-note').textContent = !self ? t('La copia de emergencia solo está disponible con «Mi web (wp-admin)» en Conexiones → WordPress.') : (st.lastError ? t('Último fallo: {e}', { e: st.lastError }) : '');
  $('#em-dir').textContent = st.dir;
  $('#em-reset').classList.toggle('hidden', !st.custom);
  $('#em-auto').value = st.auto;
  if (document.activeElement !== $('#em-keep')) $('#em-keep').value = st.keep;
  $('#em-run').disabled = !self || !CFG.wpConnected || !!st.running;
  $('#em-open-folder').onclick = () => window.api.emergencyOpen('folder').catch(toastError);
  const box = $('#em-list');
  box.innerHTML = st.copies.length ? st.copies.map((c, i) => `<div class="em-row"><span class="ms">folder_zip</span><b>${escHtml(fmtDate(c.at))}</b><span class="sz">${emSize(c.bytes)}</span><span class="sp"></span>
    <button class="btn text small" data-k="visual" data-i="${i}"><span class="ms">web</span>${t('Copia visual')}</button><button class="btn text small" data-k="file" data-i="${i}">${t('Mostrar')}</button></div>`).join('')
    : `<p class="hint">${t('Todavía no hay ninguna copia de emergencia en esta carpeta.')}</p>`;
  box.querySelectorAll('button[data-k]').forEach((b) => { b.onclick = () => window.api.emergencyOpen(b.dataset.k, st.copies[+b.dataset.i].name).catch(toastError); });
  if (st.running) emShowRunning(st.running.last, st.running.auto); else if (!EMG.busy) $('#em-prog').classList.add('hidden');
}

async function emRefresh() {
  try { EMG.st = await window.api.emergencyState(); emPaint(); } catch { /* sin datos */ }
}

// ---------------------------------------------------------------- progreso por fases
function emShowRunning(p, auto) {
  $('#em-prog').classList.remove('hidden');
  const cur = p?.phase === 'guardar' ? 'guia' : p?.phase || 'contenido';
  const idx = EMG_PHASES.findIndex((x) => x[0] === cur);
  $('#em-phases').innerHTML = EMG_PHASES.map(([k, label, ic], i) => `<li class="${i < idx ? 'done' : i === idx ? 'on' : ''}"><span class="ms">${i < idx ? 'check_circle' : ic}</span>${t(label)}</li>`).join('');
  const bar = $('#em-prog .bw-bar'), txt = $('#em-txt');
  let pct = null, msg = auto ? t('Copia de emergencia automática en curso…') : t('Preparando la copia…');
  if (p) {
    if (p.phase === 'contenido') {
      if (p.step === 'fotos') { pct = p.total ? Math.round(p.done / p.total * 100) : 0; msg = t('Copiando fotos… {d} de {n}', { d: p.done, n: p.total }); }
      else msg = p.total ? t('Leyendo entradas y páginas… {d} de {n}', { d: p.done, n: p.total }) : t('Leyendo entradas y páginas…');
    } else if (p.phase === 'configuracion') { pct = p.total ? Math.round((p.done || 0) / p.total * 100) : null; msg = t('Leyendo la configuración… {d} de {n}', { d: p.done || 0, n: p.total || 0 }); }
    else if (p.phase === 'visual') { pct = p.total > 1 ? Math.round((p.done || 0) / p.total * 100) : null; msg = t('Copiando la web tal como se ve… {d} de {n} páginas · {a} recursos', { d: p.done || 0, n: p.total || 0, a: p.assets || 0 }); }
    else if (p.phase === 'guia') msg = t('Escribiendo la guía de recuperación…');
    else if (p.phase === 'guardar') msg = t('Cerrando el archivo…');
  }
  txt.textContent = msg;
  bar.classList.toggle('indet', pct === null);
  $('i', bar).style.width = pct === null ? '' : pct + '%';
}
window.api.onEmergencyProgress?.((p) => { EMG.last = p; if (!EMG.st) return; EMG.st.running = EMG.st.running || { auto: !!p.auto }; emShowRunning(p, p.auto); $('#em-run').disabled = true; });
window.api.onEmergencyDone?.(async (d) => {
  await emRefresh();
  if (d.auto) {
    if (d.ok) toast(t('Copia de emergencia automática guardada ({s}).', { s: emSize(d.bytes) }));
    $('#bn-emergency')?.remove();
  }
});

// ---------------------------------------------------------------- acciones
$('#em-pick').onclick = async () => {
  try { const dir = await window.api.emergencyPickDir(); if (dir) { EMG.st = await window.api.emergencySettings({ dir }); emPaint(); } } catch (e) { toastError(e); }
};
$('#em-reset').onclick = async () => { try { EMG.st = await window.api.emergencySettings({ dir: '' }); emPaint(); } catch (e) { toastError(e); } };
$('#em-auto').onchange = async (e) => { try { EMG.st = await window.api.emergencySettings({ auto: e.target.value }); emPaint(); } catch (er) { toastError(er); } };
$('#em-keep').onchange = async (e) => { try { EMG.st = await window.api.emergencySettings({ keep: e.target.value }); emPaint(); } catch (er) { toastError(er); } };
$('#em-cancel').onclick = () => { window.api.emergencyCancel().catch(() => {}); $('#em-txt').textContent = t('Cancelando…'); };
$('#em-run').onclick = async () => {
  EMG.busy = true;
  $('#em-run').disabled = true; $('#em-done').classList.add('hidden');
  emShowRunning(null, false);
  try {
    const r = await window.api.emergencyRun();
    await emRefresh();
    const msg = t(r.notes?.length ? 'Copia de emergencia guardada ({s}) con {n} avisos: mira LEEME.html.' : 'Copia de emergencia guardada ({s}).', { s: emSize(r.bytes), n: r.notes?.length || 0 });
    $('#em-done-txt').textContent = msg;
    $('#em-done').classList.remove('hidden');
    $('#em-open-visual').onclick = () => window.api.emergencyOpen('visual', r.name).catch(toastError);
    toast(msg, !!r.notes?.length);
    $('#bn-emergency')?.remove();
  } catch (err) { if (!/Cancelado/.test(err.message)) toastError(err); else toast(t('Copia de emergencia cancelada')); }
  finally { EMG.busy = false; $('#em-prog').classList.add('hidden'); await emRefresh(); }
};

// ---------------------------------------------------------------- aviso en Inicio: la última copia tiene más de 30 días
async function checkEmergency() {
  if (CFG.wpMode !== 'selfhosted' || !CFG.wpConnected) return;
  try {
    const st = await window.api.emergencyState();
    EMG.st = st; emPaint();
    const last = st.copies[0];
    if (!last || st.running) return;
    const days = Math.floor((Date.now() - last.at) / 864e5);
    if (days <= 30) return;
    banner('emergency', t('La última copia de emergencia de tu web es de hace {n} días.', { n: days }),
      [[t('Hacerla ahora'), (el) => { el.remove(); showTab('settings'); setTimeout(() => { $('#em').scrollIntoView({ block: 'center' }); $('#em-run').click(); }, 150); }, 'primary']]);
  } catch { /* sin datos */ }
}
emRefresh();
