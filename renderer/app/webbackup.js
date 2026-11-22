// Ecos · Ajustes → Copia de seguridad → «Copia de seguridad de la web».
// Descarga todas las entradas y páginas (y, si se quiere, las fotos) en un WXR o un ZIP. Lo hace main.js (src/backupcreate.js).
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

function bwNote() {
  const self = CFG.wpMode === 'selfhosted';
  $('#bw-note').textContent = !self ? t('Esta copia solo está disponible con «Mi web (wp-admin)» en Conexiones → WordPress.')
    : $('#bw-photos').checked ? t('Se guardará un ZIP con el archivo XML y la carpeta uploads/ con las fotos de la biblioteca. Puede ocupar bastante.')
      : t('Se guardará solo el archivo XML. Las entradas seguirán enlazadas a las fotos que están en la web.');
  $('#bw-create').disabled = !self || !CFG.wpConnected;
}
$('#bw-photos').onchange = bwNote;
bwNote();

function bwProgress(p) {
  const box = $('#bw-prog'), bar = $('.bw-bar', box), txt = $('#bw-txt');
  box.classList.remove('hidden');
  let pct = null;
  if (p.step === 'entradas') txt.textContent = p.total ? t('Leyendo entradas y páginas… {d} de {n}', { d: p.done, n: p.total }) : t('Leyendo entradas y páginas…');
  else if (p.step === 'fotos') { pct = p.total ? Math.round(p.done / p.total * 100) : 0; txt.textContent = t('Copiando fotos… {d} de {n}', { d: p.done, n: p.total }); }
  else txt.textContent = t('Guardando el archivo…');
  bar.classList.toggle('indet', pct === null);
  $('i', bar).style.width = pct === null ? '' : pct + '%';
}
window.api.onBackupCreateProgress?.(bwProgress);

$('#bw-cancel').onclick = () => { window.api.backupCancelCreate().catch(() => {}); $('#bw-txt').textContent = t('Cancelando…'); };
$('#bw-create').onclick = async (e) => {
  const b = e.currentTarget, label = b.innerHTML;
  b.disabled = true;
  try {
    // aparece al elegir dónde guardar; si se cierra el cuadro, no pasa nada
    const r = await window.api.backupCreate({ photos: $('#bw-photos').checked });
    if (!r) return;
    const msg = t('Copia guardada: {a} entradas y páginas', { a: r.posts + r.pages }) + ($('#bw-photos').checked ? ' · ' + t('{n} fotos', { n: r.files }) : '');
    toast(r.missing ? msg + ' · ' + t('{n} fotos no se pudieron bajar', { n: r.missing }) : msg, !!r.missing);
    $('#bw-note').textContent = r.file;
  } catch (err) { if (!/Cancelado/.test(err.message)) toastError(err); else toast(t('Copia cancelada')); }
  finally { $('#bw-prog').classList.add('hidden'); b.innerHTML = label; bwNote(); }
};
