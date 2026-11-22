// Ecos · Google Fotos: tarjeta de Conexiones y selector de fotos (Photos Picker API) para el editor y Medios.
// La lógica de red vive en src/gphotos.js (proceso principal); aquí solo está la interfaz.

function fillGPhotos() {
  const f = $('#f-gp'); if (!f) return;
  $('#gp-redirect').value = CFG.gpRedirectUri || 'http://localhost:53682/google';
  for (const el of f.elements) if (el.name) el.value = CFG[el.name] || '';
  $('#gp-logout').classList.toggle('hidden', !CFG.gpConnected);
  $('#gp-login span:last-child').textContent = t(CFG.gpConnected ? 'Volver a conectar' : 'Conectar con Google');
  renderConnStates();
}
$('#f-gp').onsubmit = async (e) => {
  e.preventDefault();
  CFG = await window.api.setConfig(Object.fromEntries(new FormData(e.target))); fillGPhotos(); toast(t('Guardado'));
};
$('#gp-login').onclick = (e) => busy(e.currentTarget, async () => {
  CFG = await window.api.setConfig(Object.fromEntries(new FormData($('#f-gp'))));
  toast(t('Termina el inicio de sesión en tu navegador…'));
  CFG = await window.api.gphotosLogin(); fillGPhotos(); toast(t('Conectado con Google Fotos'));
});
$('#gp-logout').onclick = async () => {
  if (!await ask(t('¿Desconectar Google Fotos? Tendrás que volver a conectar para elegir fotos.'), { danger: true, ok: t('Desconectar') })) return;
  CFG = await window.api.gphotosLogout(); fillGPhotos();
};

// Archivo JSON de credenciales (el «client_secret_….json» de Google Cloud)
$('#gp-json').onclick = (e) => busy(e.currentTarget, async () => {
  const c = await window.api.gphotosLoadCredentials();
  if (!c) return;
  CFG = c; fillGPhotos(); toast(t('Credenciales cargadas. Ahora pulsa «Conectar con Google».'));
});
// Al abrir la tarjeta, si faltan credenciales: se ofrece usar un archivo encontrado en las carpetas de Ecos
let gpOffered = false;
async function offerGPhotosFile() {
  if (gpOffered || CFG.gpClientId) return;
  gpOffered = true;
  let file = null;
  try { file = await window.api.gphotosFindCredentials(); } catch { /* sin carpeta */ }
  if (!file) return;
  if (!await ask(t('He encontrado tus credenciales de Google en {f}. ¿Usarlas?', { f: file }), { ok: t('Usar') })) return;
  CFG = await window.api.gphotosLoadCredentials(file); fillGPhotos(); toast(t('Credenciales cargadas. Ahora pulsa «Conectar con Google».'));
}
$('#f-gp .conn-name')?.addEventListener('click', () => setTimeout(() => { if (!$('#f-gp').classList.contains('collapsed')) offerGPhotosFile().catch(toastError); }, 50));

// Ventana de Google Fotos en Ecos: espera → revisión de lo elegido (cuadrícula, al estilo del selector de
// Android: tocar una foto la quita o la vuelve a poner) → subida con el estado de cada foto
let gpProgressOn = null; // el canal de progreso se escucha una sola vez
function gpDialog() {
  const d = document.createElement('div');
  d.className = 'dlg-scrim gp-dlg';
  d.innerHTML = `<div class="dlg gp-box" role="dialog" aria-modal="true" aria-labelledby="gp-ttl">
    <div class="gp-head"><span class="ms fill dlg-ic">add_photo_alternate</span><h3 id="gp-ttl">${escHtml(t('Google Fotos'))}</h3></div>
    <p class="dlg-msg">${escHtml(t('Elige las fotos en la ventana de Google Fotos que se ha abierto y pulsa «Listo». Después las verás aquí antes de subirlas.'))}</p>
    <div class="gp-grid hidden" role="listbox" aria-multiselectable="true" aria-label="${escHtml(t('Fotos elegidas'))}"></div>
    <div class="gp-prog hidden"><div class="gp-bar"><i></i></div></div>
    <p class="hint gp-status"><span class="spin"></span>${escHtml(t('Esperando a que elijas las fotos…'))}</p>
    <div class="dlg-actions"><button class="btn text" data-r="0">${escHtml(t('Cancelar'))}</button><span class="spacer"></span>
      <button class="btn text hidden" data-r="all">${escHtml(t('Seleccionar todas'))}</button>
      <button class="btn filled hidden" data-r="ok"><span class="ms">cloud_upload</span><span class="gp-ok-t"></span></button></div></div>`;
  document.body.appendChild(d);
  const grid = $('.gp-grid', d), okB = $('[data-r="ok"]', d), allB = $('[data-r="all"]', d);
  let items = [], uploading = false;
  const chosen = () => $$('.gp-tile.on', grid).map((x) => x.dataset.id);
  const sync = () => {
    const n = chosen().length;
    $('.gp-ok-t', okB).textContent = n === 1 ? t('Subir 1 foto') : t('Subir {n} fotos', { n });
    okB.disabled = !n;
    $('.gp-status', d).textContent = t('{a} de {b} seleccionadas · toca una foto para quitarla o volver a ponerla', { a: n, b: items.length });
    allB.classList.toggle('hidden', n === items.length);
  };
  const tile = (it) => `<button class="gp-tile on" role="option" aria-selected="true" data-id="${escHtml(it.id)}" title="${escHtml(it.name)}">
      <span class="gp-th"><span class="gp-sk"></span></span>${it.type === 'video' ? '<span class="gp-vid ms fill">play_circle</span>' : ''}
      <span class="gp-check ms fill">check_circle</span><span class="gp-state"></span></button>`;
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.gp-tile'); if (!b || uploading) return;
    b.classList.toggle('on'); b.setAttribute('aria-selected', String(b.classList.contains('on'))); sync();
  });
  allB.onclick = () => { $$('.gp-tile', grid).forEach((b) => { b.classList.add('on'); b.setAttribute('aria-selected', 'true'); }); sync(); };
  okB.onclick = () => {
    const ids = chosen(); if (!ids.length) return;
    uploading = true; d.classList.add('uploading');
    $$('.gp-tile:not(.on)', grid).forEach((b) => b.remove());
    okB.classList.add('hidden'); allB.classList.add('hidden');
    $('.dlg-msg', d).textContent = t('Subiendo a tu biblioteca de WordPress con su calidad y fecha originales…');
    $('.gp-prog', d).classList.remove('hidden');
    window.api.gphotosConfirm(ids);
  };
  gpProgressOn = (p) => {
    if (p.phase === 'review') {
      items = p.items || [];
      $('.dlg-msg', d).textContent = items.length === 1 ? t('Has elegido 1 foto. Revísala antes de subirla.') : t('Has elegido {n} fotos. Revísalas antes de subirlas.', { n: items.length });
      grid.innerHTML = items.map(tile).join(''); grid.classList.remove('hidden');
      okB.classList.remove('hidden'); d.classList.add('review'); sync(); okB.focus();
    } else if (p.phase === 'thumb') {
      const th = $(`.gp-tile[data-id="${CSS.escape(p.id)}"] .gp-th`, grid);
      if (th) th.innerHTML = `<img src="${escHtml(p.thumb)}" alt="" draggable="false">`;
    } else if (p.phase === 'uploading') {
      $(`.gp-tile[data-id="${CSS.escape(p.id)}"]`, grid)?.classList.add('busy');
      $('.gp-status', d).textContent = t('Subiendo {a} de {b}…', { a: p.done + 1, b: p.total });
      $('.gp-bar i', d).style.width = Math.round(100 * p.done / Math.max(1, p.total)) + '%';
    } else if (p.phase === 'item') {
      const b = $(`.gp-tile[data-id="${CSS.escape(p.id)}"]`, grid);
      if (b) { b.classList.remove('busy'); b.classList.add(p.ok ? 'done' : 'fail'); $('.gp-state', b).innerHTML = `<span class="ms fill">${p.ok ? 'cloud_done' : 'error'}</span>`; }
      $('.gp-bar i', d).style.width = Math.round(100 * p.done / Math.max(1, p.total)) + '%';
    }
  };
  return { el: d, close() { gpProgressOn = null; d.remove(); } };
}
window.api.onGphotosProgress?.((p) => gpProgressOn?.(p));

// Elige fotos y las devuelve ya subidas a la biblioteca: [{ id, url, type, alt }]
async function pickFromGPhotos() {
  if (!CFG.gpConnected) {
    toast(t('Google Fotos no está conectado. Te llevo a Conexiones para conectarlo.'), true);
    showTab('connections');
    const card = $('#f-gp'); card?.classList.remove('collapsed'); card?.scrollIntoView?.({ block: 'center' });
    return [];
  }
  const dlg = gpDialog();
  let cancelled = false;
  $('[data-r="0"]', dlg.el).onclick = () => { cancelled = true; window.api.gphotosCancel(); dlg.close(); };
  try {
    const list = await window.api.gphotosPick();
    return cancelled ? [] : list;
  } catch (e) {
    if (cancelled) return [];
    CFG = await window.api.getConfig().catch(() => CFG); fillGPhotos();
    throw e;
  } finally { dlg.close(); }
}

// Editor: a la bandeja y, si hay un bloque activo, como bloques de imagen debajo
$('#d-media-gp')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
  const got = await pickFromGPhotos();
  if (!got?.length || !draft) return;
  const E = window.BlockEditor;
  const fresh = got.filter((p) => !(draft.extraMedia || []).some((x) => x.id === p.id));
  draft.extraMedia = [...(draft.extraMedia || []), ...fresh];
  E.media = mediaPool();
  const imgs = got.filter((g) => g.type !== 'video');
  if (E.active?.b && imgs.length) {
    const at = draft.blocks.indexOf(E.active.b) + 1;
    const blocks = imgs.map((img) => E.create('image', { img: { id: img.id, url: img.url, alt: '' } }));
    E.change(() => draft.blocks.splice(at < 1 ? draft.blocks.length : at, 0, ...blocks));
  }
  E.renderMedia();
  toast(t('{n} archivo(s) añadidos a la bandeja', { n: got.length }));
}));

// Blog → Medios: se importan a la biblioteca y se recarga la rejilla
document.addEventListener('click', (e) => {
  const b = e.target.closest('#gp-import'); if (!b) return;
  busy(b, async () => {
    const got = await pickFromGPhotos();
    if (!got?.length) return;
    toast(t('{n} archivo(s) importados de Google Fotos', { n: got.length }));
    if (typeof mediaLib !== 'undefined' && mediaLib) mediaLib.reload(true);
  });
});
