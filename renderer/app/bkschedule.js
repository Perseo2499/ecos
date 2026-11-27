// Ecos · Ajustes → Copia de seguridad → «Copias programadas», historial, indicador de progreso y aviso de fallo en Inicio.
// La programación y las copias las hace main.js (src/backupsched.js, backupinc.js, backupverify.js, gdrive.js).
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

const BKS = { st: null, busy: false, verifying: {}, waiting: '' };
const bkSize = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const bkKindLabel = (k) => (k === 'emergency' ? t('Copia de emergencia') : t('Copia de la web'));

function bksFillWeekdays() {
  const sel = $('#bks-weekday');
  if (sel.options.length) return;
  const lang = prefs().lang === 'en' ? 'en-GB' : 'es-ES';
  for (let i = 0; i < 7; i++) { // 7 de enero de 2024 fue domingo
    const o = document.createElement('option'); o.value = i; o.textContent = new Date(2024, 0, 7 + i).toLocaleDateString(lang, { weekday: 'long' }); sel.appendChild(o);
  }
}

function bksPaint() {
  const st = BKS.st;
  if (!st || !st.cfg) return;
  bksFillWeekdays();
  const c = st.cfg, self = typeof CFG !== 'undefined' && CFG?.wpMode === 'selfhosted';
  $('#bks-note').textContent = !self ? t('Las copias programadas solo están disponibles con «Mi web (wp-admin)» en Conexiones → WordPress.') : BKS.waiting === 'battery' ? t('En espera: el ordenador va con batería.') : BKS.waiting === 'offline' ? t('En espera: no hay conexión a internet.') : '';
  $('#bks-on').checked = c.enabled;
  $('#bks-form').classList.toggle('dim', !c.enabled);
  $('#bks-kind').value = c.kind; $('#bks-freq').value = c.freq; $('#bks-weekday').value = c.weekday;
  if (document.activeElement !== $('#bks-monthday')) $('#bks-monthday').value = c.monthday;
  if (document.activeElement !== $('#bks-time')) $('#bks-time').value = c.time;
  if (document.activeElement !== $('#bks-keep')) $('#bks-keep').value = c.keep;
  $('#bks-wd-w').classList.toggle('hidden', c.freq !== 'weekly');
  $('#bks-md-w').classList.toggle('hidden', c.freq !== 'monthly');
  $('#bks-plugged').checked = c.onlyPlugged; $('#bks-net').checked = c.needNetwork; $('#bks-photos').checked = c.photos;
  $('#bks-photos-w').classList.toggle('hidden', c.kind !== 'web');
  $('#bks-dir').textContent = st.dir; $('#bks-reset').classList.toggle('hidden', !st.custom);
  $('#bks-cloud').value = c.cloud;
  const d = st.drive;
  $('#bks-drive-t').textContent = d.connected ? t('Desconectar Google Drive') : t('Conectar Google Drive');
  $('#bks-cloud-note').textContent = d.connected ? t('Google Drive conectado. Ecos solo ve los archivos que él mismo crea en «Ecos · Copias», no el resto de tu Drive. La subida se reanuda sola si se corta.')
    : d.hasClient ? t('Conecta tu cuenta de Google. Usa el mismo ID de cliente que Google Fotos y necesita tener activada la «Google Drive API» en ese proyecto de Google Cloud.')
      : t('Para subir a Drive hace falta antes el ID de cliente de Google (Conexiones → Google Fotos). Si prefieres no crear credenciales, usa una carpeta sincronizada.');
  $('#bks-next').innerHTML = c.enabled && st.nextRun ? `<span class="ms">schedule</span>${escHtml(t('Próxima copia: {d}', { d: fmtDate(st.nextRun) }))}` : '';
  $('#bks-next').classList.toggle('hidden', !(c.enabled && st.nextRun));
  $('#bks-run').disabled = !self || !(typeof CFG !== 'undefined' && CFG?.wpConnected) || !!st.running;
  const cache = st.cache || { count: 0, bytes: 0 };
  $('#bks-cache').textContent = cache.count ? t('Caché de copias incrementales: {n} archivos, {s}. Las fotos que no cambian se leen de aquí en vez de volver a bajarlas.', { n: cache.count, s: bkSize(cache.bytes) }) : '';
  $('#bks-clear').classList.toggle('hidden', !cache.count);
  bkPaintHistory();
  bkChipPaint(st.running ? st.running.last : null, st.running);
}

function bkDestText(e) {
  const parts = [e.file ? t('Este ordenador') : ''];
  if (e.cloud) parts.push(e.cloud.ok ? 'Google Drive' : t('Drive: falló'));
  return parts.filter(Boolean).join(' + ');
}
function bkIncText(e) {
  const s = e.stats || {};
  if (e.kind === 'web' && (s.reused || s.downloaded)) return t('{r} fotos reutilizadas, {d} nuevas', { r: s.reused || 0, d: s.downloaded || 0 });
  return '';
}
function bkPaintHistory() {
  const box = $('#bk-list'), list = BKS.st?.history || [];
  if (!list.length) { box.dataset.sig = ''; box.innerHTML = `<p class="hint">${t('Todavía no hay copias en el historial.')}</p>`; return; }
  const html = list.slice(0, 30).map((e) => {
    const gone = e.removed;
    const v = e.verified;
    const res = !e.ok ? `<span class="bk-badge bad"><span class="ms">error</span>${escHtml(e.error || t('Falló'))}</span>`
      : gone ? `<span class="bk-badge muted"><span class="ms">auto_delete</span>${t('Retirada por antigüedad')}</span>`
        : v ? (v.ok ? `<span class="bk-badge ok"><span class="ms">verified</span>${t('Verificada')}</span>` : `<span class="bk-badge bad" title="${escHtml((v.problems || []).join(' · '))}"><span class="ms">gpp_bad</span>${escHtml((v.problems || [])[0] || t('Dañada'))}</span>`)
          : `<span class="bk-badge ok"><span class="ms">check_circle</span>${t('Correcta')}</span>`;
    const cloudBad = e.ok && e.cloud && !e.cloud.ok ? `<span class="bk-badge bad"><span class="ms">cloud_off</span>${escHtml(e.cloud.error || '')}</span>` : '';
    const can = e.ok && e.file && !gone;
    const vbusy = BKS.verifying[e.id];
    return `<div class="bk-row${gone ? ' gone' : ''}" data-id="${escHtml(e.id)}">
      <div class="bk-main"><b>${escHtml(fmtDate(e.at))}</b><span>${escHtml(bkKindLabel(e.kind))}${e.auto ? ' · ' + t('Programada') : ' · ' + t('A mano')}</span>
        <span class="sz">${e.ok ? bkSize(e.bytes) : ''}</span><span class="dest">${escHtml(e.ok ? bkDestText(e) : '')}</span></div>
      <div class="bk-res">${res}${cloudBad}${e.ok && bkIncText(e) ? `<span class="bk-inc">${escHtml(bkIncText(e))}</span>` : ''}</div>
      <div class="bk-act">${can ? `<button class="btn text small" data-a="open"><span class="ms">folder_open</span>${t('Abrir carpeta')}</button><button class="btn tonal small" data-a="verify"${vbusy ? ' disabled' : ''}><span class="ms">fact_check</span>${vbusy ? t('Verificando… {p}%', { p: vbusy.pct || 0 }) : t('Verificar')}</button>` : ''}</div>
    </div>`;
  }).join('');
  if (box.dataset.sig === html) return; // sin cambios: no se repinta (así no se pierde un clic a medias)
  box.dataset.sig = html; box.innerHTML = html;
  box.querySelectorAll('.bk-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-a=open]')?.addEventListener('click', () => window.api.bkOpen(id).catch(toastError));
    row.querySelector('[data-a=verify]')?.addEventListener('click', () => bkVerify(id));
  });
}

async function bkVerify(id) {
  BKS.verifying[id] = { pct: 0 }; bkPaintHistory();
  try {
    const r = await window.api.bkVerify(id);
    BKS.st = r.state;
    toast(r.ok ? t('La copia está íntegra ({n} archivos comprobados).', { n: r.entries }) : t('La copia tiene problemas: {p}', { p: r.problems[0] || '' }), !r.ok);
  } catch (e) { toastError(e); }
  delete BKS.verifying[id]; bksPaint();
}

async function bksRefresh() { try { BKS.st = await window.api.bkState(); bksPaint(); } catch { /* sin datos */ } }
async function bksSave(patch) { try { BKS.st = await window.api.bkSave(patch); bksPaint(); } catch (e) { toastError(e); bksPaint(); } }

// ---------------------------------------------------------------- indicador de progreso (visible en toda la app)
function bkProgress(p) {
  if (!p) return { msg: t('Preparando la copia…'), pct: null };
  if (p.step === 'subida') return { msg: t('Subiendo a Google Drive… {s} de {n}', { s: bkSize(p.done || 0), n: bkSize(p.total || 0) }), pct: p.total ? Math.round(p.done / p.total * 100) : null };
  if (p.phase) { // copia de emergencia: por fases
    if (p.phase === 'contenido' && p.step === 'fotos') return { msg: t('Copiando fotos… {d} de {n}', { d: p.done, n: p.total }), pct: p.total ? Math.round(p.done / p.total * 100) : 0 };
    if (p.phase === 'contenido') return { msg: t('Leyendo entradas y páginas…'), pct: null };
    if (p.phase === 'configuracion') return { msg: t('Leyendo la configuración… {d} de {n}', { d: p.done || 0, n: p.total || 0 }), pct: p.total ? Math.round((p.done || 0) / p.total * 100) : null };
    if (p.phase === 'visual') return { msg: t('Copiando la web tal como se ve… {d} de {n} páginas', { d: p.done || 0, n: p.total || 0 }), pct: p.total > 1 ? Math.round((p.done || 0) / p.total * 100) : null };
    return { msg: t('Cerrando el archivo…'), pct: null };
  }
  if (p.step === 'fotos') return { msg: t('Copiando fotos… {d} de {n}', { d: p.done, n: p.total }), pct: p.total ? Math.round(p.done / p.total * 100) : 0 };
  if (p.step === 'entradas') return { msg: p.total ? t('Leyendo entradas y páginas… {d} de {n}', { d: p.done, n: p.total }) : t('Leyendo entradas y páginas…'), pct: null };
  return { msg: t('Guardando el archivo…'), pct: null };
}
function bkChipPaint(p, running) {
  const chip = $('#bk-chip');
  if (!running) { chip.classList.add('hidden'); return; }
  const g = bkProgress(p);
  chip.classList.remove('hidden');
  $('#bk-chip-t').textContent = (running.auto ? t('Copia programada') : bkKindLabel(running.kind)) + ' · ' + g.msg;
  const bar = $('.bw-bar', chip);
  bar.classList.toggle('indet', g.pct === null);
  $('i', bar).style.width = g.pct === null ? '' : g.pct + '%';
}
$('#bk-chip-x').onclick = () => { window.api.bkCancel().catch(() => {}); $('#bk-chip-t').textContent = t('Cancelando…'); };

window.api.onBkEvent?.(async (ev) => {
  if (ev.type === 'start') { BKS.waiting = ''; BKS.st = BKS.st || {}; BKS.st.running = { kind: ev.kind, auto: ev.auto, last: null }; bkChipPaint(null, BKS.st.running); $('#bks-run').disabled = true; return; }
  if (ev.type === 'progress') { if (BKS.st) { BKS.st.running = BKS.st.running || { kind: ev.kind, auto: ev.auto }; BKS.st.running.last = ev; bkChipPaint(ev, BKS.st.running); } return; }
  if (ev.type === 'verify') { if (BKS.verifying[ev.id]) { BKS.verifying[ev.id].pct = ev.total ? Math.round(ev.done / ev.total * 100) : 0; bkPaintHistory(); } return; }
  if (ev.type === 'waiting') { BKS.waiting = ev.reason; bksPaint(); return; }
  if (ev.type === 'done') {
    if (BKS.st) BKS.st.running = null;
    $('#bk-chip').classList.add('hidden');
    await bksRefresh();
    if (ev.cancelled) toast(t('Copia cancelada'));
    else if (ev.ok) { $('#bn-bkfail')?.remove(); if (ev.auto) toast(t('Copia programada guardada ({s}).', { s: bkSize(ev.entry.bytes) })); }
    else if (ev.auto) checkBackupFailure();
    return;
  }
  if (ev.type === 'history') bksRefresh();
});

// ---------------------------------------------------------------- aviso persistente en Inicio si la copia programada falló
async function checkBackupFailure() {
  await bksRefresh();
  const f = BKS.st?.failure;
  if (!f) { $('#bn-bkfail')?.remove(); return; }
  const w = { today: t('de hoy'), yesterday: t('de ayer') }[bkWhen(f.at)] || t('del {d}', { d: new Date(f.at).toLocaleDateString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long' }) });
  banner('bkfail', `<span class="ms">error</span>${escHtml(t('La copia programada {w} falló: {e}', { w, e: f.error }))}`,
    [[t('Reintentar'), (el) => { el.remove(); bkRetry(f.kind); }, 'primary'], [t('Descartar'), (el) => { el.remove(); window.api.bkDismissFailure().then(() => { if (BKS.st) BKS.st.failure = null; }).catch(() => {}); }]]);
}
function bkWhen(at) {
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(new Date(at))) / 864e5);
  return diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : 'date';
}
async function bkRetry(kind) {
  try { await window.api.bkRun(kind); } catch (e) { if (!/Cancelado/.test(e.message)) toastError(e); }
  await bksRefresh();
}

// ---------------------------------------------------------------- controles
$('#bks-on').onchange = (e) => bksSave({ enabled: e.target.checked });
$('#bks-kind').onchange = (e) => bksSave({ kind: e.target.value });
$('#bks-freq').onchange = (e) => bksSave({ freq: e.target.value });
$('#bks-weekday').onchange = (e) => bksSave({ weekday: e.target.value });
$('#bks-monthday').onchange = (e) => bksSave({ monthday: e.target.value });
$('#bks-time').onchange = (e) => { if (e.target.value) bksSave({ time: e.target.value }); };
$('#bks-keep').onchange = (e) => bksSave({ keep: e.target.value });
$('#bks-plugged').onchange = (e) => bksSave({ onlyPlugged: e.target.checked });
$('#bks-net').onchange = (e) => bksSave({ needNetwork: e.target.checked });
$('#bks-photos').onchange = (e) => bksSave({ photos: e.target.checked });
$('#bks-cloud').onchange = (e) => {
  if (e.target.value === 'drive' && !BKS.st?.drive.connected) { toast(t('Primero conecta Google Drive.'), true); e.target.value = BKS.st.cfg.cloud; return; }
  bksSave({ cloud: e.target.value });
};
$('#bks-pick').onclick = async () => { try { const dir = await window.api.bkPickDir(); if (dir) await bksSave({ dir }); } catch (e) { toastError(e); } };
$('#bks-reset').onclick = () => bksSave({ dir: '' });
$('#bks-drive').onclick = async (e) => {
  const b = e.currentTarget; b.disabled = true;
  try {
    if (BKS.st.drive.connected) BKS.st = await window.api.bkDriveLogout();
    else { toast(t('Se abrirá el navegador para conectar Google Drive…')); BKS.st = await window.api.bkDriveLogin(); toast(t('Google Drive conectado.')); }
    bksPaint();
  } catch (er) { toastError(er); } finally { b.disabled = false; }
};
$('#bks-folder').onclick = () => window.api.bkOpen().catch(toastError);
$('#bks-clear').onclick = async () => { try { BKS.st = await window.api.bkClearCache(); bksPaint(); toast(t('Caché vaciada. La próxima copia bajará todo otra vez.')); } catch (e) { toastError(e); } };
$('#bks-run').onclick = async () => { $('#bks-run').disabled = true; await bkRetry(BKS.st?.cfg.kind || 'web'); };

bksRefresh();
