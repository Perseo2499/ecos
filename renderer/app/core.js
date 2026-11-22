// Interfaz de Ecos. Toda la comunicación con el sistema va por window.api (preload.js).
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const t = (s, v) => window.I18N.t(s, v);
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

function toast(msg, isError) {
  const el = $('#toast');
  el.textContent = msg; el.className = 'show' + (isError ? ' error' : '');
  // Los errores largos se quedan más tiempo (se cierran también al pulsarlos)
  clearTimeout(el._h); el._h = setTimeout(() => (el.className = ''), isError ? Math.min(30000, 6000 + msg.length * 60) : 4500);
  el.onclick = () => (el.className = '');
}
async function busy(btn, fn) {
  const label = btn.innerHTML; btn.disabled = true; btn.textContent = t('Trabajando…');
  // en tareas largas (IA), los segundos que lleva: así se ve que sigue trabajando
  const t0 = Date.now();
  const tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); if (s >= 3) btn.textContent = t('Trabajando… {s} s', { s }); }, 1000);
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { clearInterval(tick); btn.disabled = false; btn.innerHTML = label; }
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
  $('#st-wp').textContent = 'WordPress: ' + (CFG.wpConnected ? CFG.wpSiteLabel || CFG.wpSite : t('no conectado'));
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
