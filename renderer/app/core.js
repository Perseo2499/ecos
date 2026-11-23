// Interfaz de Ecos. Toda la comunicación con el sistema va por window.api (preload.js).
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const t = (s, v) => window.I18N.t(s, v);
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- registro de errores de la ventana
// Los errores no capturados y las promesas rechazadas se reenvían al proceso principal, que los escribe (sin datos
// sensibles) en el registro de errores (Ajustes → Avanzado)
function reportToLog(kind, message, extra = {}) {
  try { window.api?.logRenderer?.({ kind, message: String(message || ''), ...extra }); } catch { /* sin registro */ }
}
window.addEventListener('error', (e) => reportToLog('error', e.message || (e.error && e.error.message), { source: e.filename, line: e.lineno, col: e.colno, stack: e.error && e.error.stack }));
window.addEventListener('unhandledrejection', (e) => { const r = e.reason; reportToLog('promesa rechazada', (r && r.message) || r, { stack: r && r.stack }); });

// ---------------------------------------------------------------- estado
let CFG = {};          // configuración pública (sin claves)
let rawPosts = [];     // todo lo cargado/importado
let posts = [];        // lo que se muestra (con duplicados juntados si procede)
let cursors = null;    // «Cargar más»
let exported = {};     // publicaciones ya pasadas al blog
let draft = null;      // borrador abierto en el editor
let draftKeys = [];
let categories = [];   // categorías del blog
let lastSent = null;
const selected = new Set();
const keyOf = (p) => p.source + ':' + p.id;
const keysOf = (p) => [keyOf(p), ...(p.alsoOn || []).map((a) => a.source + ':' + a.id)];
const exportOf = (p) => keysOf(p).map((k) => exported[k]).find(Boolean);
// «En el blog» solo cuenta si la entrada sigue existiendo (no en la papelera ni eliminada)
const GONE = ['trash', 'deleted'];
const liveExport = (p) => { const ex = exportOf(p); return ex && !GONE.includes(ex.status) ? ex : null; };
const EX_STATUS = () => ({
  publish: { icon: 'check_circle', label: t('Publicada') }, draft: { icon: 'edit_note', label: t('Borrador') },
  future: { icon: 'schedule', label: t('Programada') }, pending: { icon: 'hourglass_top', label: t('Pendiente') },
  private: { icon: 'lock', label: t('Privada') }, trash: { icon: 'delete', label: t('En la papelera') },
  deleted: { icon: 'block', label: t('Eliminada') },
});
let lastRefresh = 0;
async function refreshExported(force) {
  if (!CFG.wpConnected || (!force && Date.now() - lastRefresh < 60000)) return;
  lastRefresh = Date.now();
  try { exported = await window.api.refreshExported(); renderFeed(); } catch { /* sin conexión */ }
}
const prefs = () => ({ theme: 'system', zoom: 1, cards: 230, accent: '#3c6e5f', lang: 'es', checkNew: true, checkToken: true, ...(CFG.prefs || {}) });

// ---------------------------------------------------------------- utilidades
window.CFG_AI_READY = () => !!CFG.aiConfigured;
// Diálogo de confirmación con el estilo de Ecos (en lugar del cuadro de Windows). Devuelve true/false.
function ask(message, { ok = t('Continuar'), cancel = t('Cancelar'), danger = false } = {}) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const d = document.createElement('div');
    d.className = 'dlg-scrim';
    d.innerHTML = `<div class="dlg" role="alertdialog" aria-modal="true">
      <span class="dlg-silk vinyl-only"><span class="silk"><i class="led"></i><span>SYS · CONFIRM</span></span><span class="silk"><span>DLG-01</span><span class="jp">確認</span></span></span>
      <span class="ms fill dlg-ic${danger ? ' danger' : ''}">${danger ? 'warning' : 'help'}</span>
      <p class="dlg-msg"></p>
      <div class="dlg-actions"><button class="btn text" data-r="0"></button><button class="btn filled${danger ? ' danger-fill' : ''}" data-r="1"></button></div></div>`;
    $('.dlg-msg', d).textContent = message;
    $('[data-r="0"]', d).textContent = cancel; $('[data-r="1"]', d).textContent = ok;
    if (cancel === null) $('[data-r="0"]', d).hidden = true; // solo «Aceptar»
    const close = (v) => { d.classList.add('out'); setTimeout(() => d.remove(), 160); document.removeEventListener('keydown', key, true); prev?.focus?.(); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); } if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); } };
    $$('[data-r]', d).forEach((b) => (b.onclick = () => close(b.dataset.r === '1')));
    d.addEventListener('mousedown', (e) => { if (e.target === d) close(false); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(d);
    $('[data-r="1"]', d).focus();
  });
}
window.ask = ask;

// Errores técnicos → español claro (la lógica pura está en errors.js). Aquí además se traduce al idioma de la app.
// Devuelve { text, detail, translated }; el detalle original va al registro y a los <details> de las pantallas con error.
function friendlyError(e) {
  const f = window.FriendlyError.friendlyError(e);
  if (f.translated) { try { console.warn('[Ecos] ' + f.detail); } catch { /* sin consola */ } }
  return f.translated ? { ...f, text: t(f.text) } : f;
}
// Bloque «hubo un error» para una pantalla o lista, con el detalle plegado y un botón «Reintentar»
function errBox(host, e, retry) {
  const f = friendlyError(e);
  host.innerHTML = `<div class="empty err-box" role="alert"><span class="ms">cloud_off</span><span class="err-msg"></span>
    ${f.detail ? `<details class="err-detail"><summary>${escHtml(t('Detalle técnico'))}</summary><code></code></details>` : ''}
    ${retry ? `<button class="btn tonal err-retry"><span class="ms">refresh</span>${escHtml(t('Reintentar'))}</button>` : ''}</div>`;
  $('.err-msg', host).textContent = f.text;
  const c = $('.err-detail code', host); if (c) c.textContent = f.detail;
  const b = $('.err-retry', host); if (b) b.onclick = () => retry();
  return f;
}

// Avisos (toasts): abajo a la derecha, hasta 3 apilados, con botón de cerrar y duración según la longitud.
// toast(msg, isError, { action: { label, onClick }, duration, detail })
const TOAST_MAX = 3;
function toast(msg, isError, opts = {}) {
  const box = $('#toast');
  box.setAttribute('role', 'region'); box.setAttribute('aria-label', t('Avisos')); box.setAttribute('aria-live', 'polite');
  msg = String(msg ?? '');
  // Si llega un error técnico suelto (sin traducir), se traduce aquí
  let detail = opts.detail || '';
  if (isError && !detail && window.FriendlyError.looksTechnical(msg)) { const f = friendlyError(msg); msg = f.text; detail = f.detail; }
  const el = document.createElement('div');
  el.className = 'toast-item' + (isError ? ' error' : '');
  el.setAttribute('role', isError ? 'alert' : 'status');
  el.innerHTML = `<span class="ms toast-ic">${isError ? 'error' : 'check_circle'}</span><div class="toast-body"><span class="toast-msg"></span></div>`;
  $('.toast-msg', el).textContent = msg;
  if (detail) { const d = document.createElement('details'); d.className = 'err-detail'; d.innerHTML = `<summary>${escHtml(t('Detalle técnico'))}</summary><code></code>`; $('code', d).textContent = detail; $('.toast-body', el).appendChild(d); }
  if (opts.action) {
    const a = document.createElement('button'); a.className = 'toast-act'; a.textContent = opts.action.label;
    a.onclick = () => { close(); try { opts.action.onClick?.(); } catch (e) { toastError(e); } };
    el.appendChild(a);
  }
  const x = document.createElement('button'); x.className = 'toast-x'; x.setAttribute('aria-label', t('Cerrar')); x.title = t('Cerrar');
  x.innerHTML = '<span class="ms">close</span>'; x.onclick = () => close(); el.appendChild(x);
  let timer, left = opts.duration || toastDuration(msg, isError), t0 = 0;
  function close() { clearTimeout(timer); if (!el.isConnected || el.classList.contains('out')) return; el.classList.add('out'); setTimeout(() => el.remove(), 220); }
  const start = () => { t0 = Date.now(); clearTimeout(timer); timer = setTimeout(close, left); };
  el.onmouseenter = () => { clearTimeout(timer); left -= Date.now() - t0; if (left < 1500) left = 1500; };
  el.onmouseleave = start;
  placeToasts(); box.appendChild(el);
  const live = () => [...box.children].filter((c) => !c.classList.contains('out'));
  while (live().length > TOAST_MAX) live()[0].querySelector('.toast-x').click();
  start();
  return el;
}
// Los avisos se colocan por encima de las barras flotantes (acciones del Blog, selección de Redes) que haya a la vista
function placeToasts() {
  let b = 20;
  for (const bar of $$('.b-bulk.on, .selbar.show')) {
    if (!bar.getClientRects().length) continue;
    const r = bar.getBoundingClientRect();
    if (r.height && r.top < innerHeight) b = Math.max(b, Math.round(innerHeight - r.top) + 12);
  }
  $('#toast').style.bottom = b + 'px';
}
try {
  const watcher = new MutationObserver(placeToasts);
  for (const bar of $$('.b-bulk, .selbar')) watcher.observe(bar, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', placeToasts);
} catch { /* sin observador */ }
// 2,5–6 s según la longitud del texto (los errores se quedan algo más)
function toastDuration(msg, isError) { const base = Math.min(6000, Math.max(2500, 1800 + String(msg).length * 45)); return isError ? Math.min(9000, base + 2000) : base; }
function toastError(e, opts) { const f = friendlyError(e); return toast(f.text, true, { detail: f.detail, ...opts }); }
async function busy(btn, fn) {
  const label = btn.innerHTML; btn.disabled = true; btn.textContent = t('Trabajando…');
  // en tareas largas (IA), los segundos que lleva: así se ve que sigue trabajando
  const t0 = Date.now();
  const tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); if (s >= 3) btn.textContent = t('Trabajando… {s} s', { s }); }, 1000);
  try { return await fn(); } catch (e) { toastError(e); } finally { clearInterval(tick); btn.disabled = false; btn.innerHTML = label; }
}
const fileUrl = (p) => p && 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23');
const fmtDate = (d) => new Date(d).toLocaleString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const fmtDay = (d) => new Date(d).toLocaleDateString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const decodeEntities = (s) => { const x = document.createElement('textarea'); x.innerHTML = s || ''; return x.value; };
async function savePrefs(patch) { CFG = await window.api.setConfig({ prefs: { ...prefs(), ...patch } }); applyPrefs(); }

$$('[data-copy]').forEach((b) => b.onclick = () => { navigator.clipboard.writeText($(b.dataset.copy).value); toast(t('Copiado')); });

// ---------------------------------------------------------------- pestañas
new ResizeObserver(([e]) => document.documentElement.style.setProperty('--appbar-h', Math.round(e.target.getBoundingClientRect().height) + 'px')).observe($('.appbar'));
function showTab(name) {
  $$('header nav button, .tab').forEach((x) => x.classList.remove('active'));
  $(`header nav button[data-tab="${name}"]`).classList.add('active'); $('#tab-' + name).classList.add('active');
  if (name === 'blog' && !blog.loaded && !['structure', 'calendar'].includes(blog.type)) loadBlog();
  if (name === 'posts') refreshExported();
  updateCount();
  window.onTabShown?.(name); // Inicio y el aviso de publicaciones nuevas (app/home.js)
}
$$('header nav button').forEach((b) => b.onclick = () => showTab(b.dataset.tab));

// ---------------------------------------------------------------- estado de conexiones y avisos
function renderStatus() {
  $('#st-meta').textContent = 'Meta: ' + (CFG.metaConnected ? t('conectado') : t('no conectado'));
  $('#st-meta').classList.toggle('ok', !!CFG.metaConnected);
  $('#st-wp').textContent = 'WordPress: ' + (CFG.wpConnected ? CFG.wpSiteLabel || CFG.wpSite || t('conectado') : t('no conectado'));
  $('#st-wp').classList.toggle('ok', !!CFG.wpConnected);
  const exp = CFG.metaTokenExpires && new Date(CFG.metaTokenExpires);
  $('#meta-expiry').textContent = CFG.metaConnected && exp ? t('La conexión con Meta caduca el {d}.', { d: fmtDay(exp) }) : '';
  renderConnStates();
}

// Red de seguridad: si queda el modo «pantalla completa» sin ninguna pantalla completa visible (la barra de
// arriba se esconde y no se podría salir), se quita solo.
setInterval(() => {
  if (!document.body.classList.contains('editing')) return;
  const open = ['#editor', '#restore', '#term'].some((s) => { const el = document.querySelector(s); return el && !el.classList.contains('hidden') && el.checkVisibility(); });
  if (!open) document.body.classList.remove('editing');
}, 1500);
