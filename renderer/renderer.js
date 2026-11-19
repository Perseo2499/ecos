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
function toast(msg, isError) {
  const el = $('#toast');
  el.textContent = msg; el.className = 'show' + (isError ? ' error' : '');
  // Los errores largos se quedan más tiempo (se cierran también al pulsarlos)
  clearTimeout(el._h); el._h = setTimeout(() => (el.className = ''), isError ? Math.min(30000, 6000 + msg.length * 60) : 4500);
  el.onclick = () => (el.className = '');
}
async function busy(btn, fn) {
  const label = btn.innerHTML; btn.disabled = true; btn.textContent = t('Trabajando…');
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.innerHTML = label; }
}
const fileUrl = (p) => p && 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23');
const fmtDate = (d) => new Date(d).toLocaleString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const fmtDay = (d) => new Date(d).toLocaleDateString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const decodeEntities = (s) => { const x = document.createElement('textarea'); x.innerHTML = s || ''; return x.value; };
async function savePrefs(patch) { CFG = await window.api.setConfig({ prefs: { ...prefs(), ...patch } }); applyPrefs(); }

$$('[data-copy]').forEach((b) => b.onclick = () => { navigator.clipboard.writeText($(b.dataset.copy).value); toast(t('Copiado')); });

// ---------------------------------------------------------------- pestañas
function showTab(name) {
  $$('header nav button, .tab').forEach((x) => x.classList.remove('active'));
  $(`header nav button[data-tab="${name}"]`).classList.add('active'); $('#tab-' + name).classList.add('active');
  if (name === 'blog' && !blog.loaded) loadBlog();
  if (name === 'posts') refreshExported();
  updateCount();
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
}

function banner(id, html, actions = []) {
  $('#bn-' + id)?.remove();
  const el = document.createElement('div');
  el.className = 'banner'; el.id = 'bn-' + id;
  el.innerHTML = `<span>${html}</span>`;
  for (const [label, fn, cls] of actions) {
    const b = document.createElement('button'); b.textContent = label; b.className = 'btn ' + (cls === 'primary' ? 'filled' : 'text');
    b.onclick = () => fn(el); el.appendChild(b);
  }
  const x = document.createElement('button'); x.className = 'x'; x.innerHTML = '<span class="ms">close</span>'; x.title = t('Cerrar'); x.onclick = () => el.remove();
  el.appendChild(x);
  $('#banners').appendChild(el);
}

function checkTokenExpiry() {
  if (!prefs().checkToken || !CFG.metaConnected || !CFG.metaTokenExpires) return;
  const days = Math.floor((new Date(CFG.metaTokenExpires) - Date.now()) / 864e5);
  if (days > 10) return;
  banner('token', days < 0 ? t('La conexión con Meta ha caducado.') : t('La conexión con Meta caduca en {n} días.', { n: days }),
    [[t('Renovar ahora'), (el) => busy(el.querySelector('button'), async () => { await doMetaLogin(); el.remove(); }), 'primary']]);
}

// Publicaciones nuevas desde la última vez que se abrió Ecos y que no están en el blog
async function checkPending() {
  if (!prefs().checkNew || !CFG.metaConnected || !$('#page').value) return;
  const since = CFG.lastSeenAt ? new Date(CFG.lastSeenAt) : null;
  try {
    const r = await window.api.metaPosts($('#page').value, ['instagram', 'facebook']);
    const merged = await window.api.mergeDuplicates(r.posts);
    const fresh = merged.filter((p) => !liveExport(p) && (!since || new Date(p.date) > since));
    if (!since) { await window.api.setConfig({ lastSeenAt: new Date().toISOString() }); return; }
    if (!fresh.length) return;
    banner('pending', t('Hay {n} publicaciones nuevas en tus redes que aún no están en el blog.', { n: fresh.length }), [[t('Verlas'), async (el) => {
      el.remove();
      cursors = r.cursors; await addPosts(r.posts);
      $('#f-show').value = 'pending'; renderFeed(); showTab('posts');
      await window.api.setConfig({ lastSeenAt: new Date().toISOString() });
    }, 'primary']]);
  } catch { /* sin conexión: no se avisa */ }
}

// ---------------------------------------------------------------- Conexiones: Meta y WordPress
function fillConnections() {
  $('#meta-redirect').value = CFG.metaRedirectUri; $('#wp-redirect').value = CFG.wpRedirectUri;
  for (const f of ['#f-meta', '#f-wp']) for (const el of $(f).elements) if (el.name) el.value = CFG[el.name] || '';
  setWpMode(CFG.wpMode || 'selfhosted');
}
// Modo de WordPress: web propia (wp-admin) o WordPress.com
function setWpMode(m) {
  $('#f-wp').wpMode.value = m;
  $$('#wp-mode button').forEach((b) => b.classList.toggle('active', b.dataset.v === m));
  $$('.wp-mode-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.mode !== m));
}
$$('#wp-mode button').forEach((b) => b.onclick = () => setWpMode(b.dataset.v));
for (const f of ['#f-meta', '#f-wp']) $(f).onsubmit = async (e) => {
  e.preventDefault();
  CFG = await window.api.setConfig(Object.fromEntries(new FormData(e.target))); renderStatus(); toast(t('Guardado'));
};
function renderPages(accs) {
  $('#page').innerHTML = accs.map((a) => `<option value="${escHtml(a.pageId)}">${escHtml(a.pageName)}${a.igUser ? ' · @' + escHtml(a.igUser) : ' (' + t('sin Instagram') + ')'}</option>`).join('');
}
async function doMetaLogin() {
  CFG = await window.api.setConfig(Object.fromEntries(new FormData($('#f-meta'))));
  toast(t('Termina el inicio de sesión en tu navegador…'));
  renderPages(await window.api.metaLogin());
  CFG = await window.api.getConfig(); renderStatus(); $('#bn-token')?.remove();
  toast(t('Conectado con Meta'));
}
async function doWpLogin() {
  CFG = await window.api.setConfig(Object.fromEntries(new FormData($('#f-wp'))));
  toast(t('Termina el inicio de sesión en tu navegador…'));
  const name = await window.api.wpLogin();
  CFG = await window.api.getConfig(); renderStatus(); toast(t('Conectado a {s}', { s: name })); loadCategories();
}
$('#meta-login').onclick = (e) => busy(e.target, doMetaLogin);
$('#wp-login').onclick = (e) => busy(e.target, doWpLogin);
async function loadCategories() {
  try { categories = await window.api.wpCategories(); } catch { categories = []; }
}

// ---------------------------------------------------------------- Conexiones: selector de IA
let aiSel = null; // proveedor activo (el que se ve y se usa)
const logoOf = (id) => `assets/ai/${id}-${document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'}.png`;
function renderAi() {
  const A = CFG.ai; if (!A) return;
  aiSel = A.active;
  const act = A.providers[A.active];
  $('#ai-current').textContent = act ? `${act.name} · ${act.model || act.defaultModel || t('sin modelo')}${act.needsKey && !act.hasKey ? ' · ' + t('sin clave') : ''}` : '';
  $('#ai-providers').innerHTML = '';
  for (const [id, p] of Object.entries(A.providers)) {
    const row = document.createElement('label');
    row.className = 'ai-prov' + (id === aiSel ? ' sel active' : '');
    row.innerHTML = `<input type="radio" name="ai-prov" ${id === aiSel ? 'checked' : ''}>
      <img class="ai-logo" src="${logoOf(id)}" alt="">
      <span class="ai-name">${escHtml(p.name)}</span>
      ${p.hasKey || !p.needsKey ? `<span class="ai-ok" title="${t('Clave guardada')}"></span>` : ''}`;
    row.querySelector('input').onchange = async () => { CFG.ai = await window.api.aiSetActive(id); renderAi(); };
    $('#ai-providers').appendChild(row);
  }
  const p = A.providers[aiSel];
  $('#ai-url').value = p.url; $('#ai-url').placeholder = t('URL personalizada (opcional)');
  $('#ai-url').title = p.defaultBase || '';
  $('#ai-key').value = '';
  $('#ai-key').placeholder = !p.needsKey ? t('No hace falta clave') : p.hasKey ? '•••••• ' + t('(guardada) — pega otra para cambiarla') : t('Pega aquí la clave de {p}', { p: p.name });
  $('#ai-key').disabled = !p.needsKey;
  $('#ai-remove').classList.toggle('hidden', !p.hasKey);
  $('#ai-model').value = p.model || p.defaultModel || '';
  $('#ai-instructions').value = CFG.aiInstructions || '';
}
$('#ai-save').onclick = (e) => busy(e.target, async () => {
  CFG.ai = await window.api.aiSave(aiSel, { key: $('#ai-key').value, url: $('#ai-url').value, model: $('#ai-model').value });
  if (CFG.ai.active !== aiSel) CFG.ai = await window.api.aiSetActive(aiSel);
  renderAi(); toast(t('Guardado'));
});
$('#ai-remove').onclick = async () => {
  if (!confirm(t('¿Quitar la clave guardada de {p}?', { p: CFG.ai.providers[aiSel].name }))) return;
  CFG.ai = await window.api.aiRemove(aiSel); renderAi();
};
$('#ai-getkey').onclick = (e) => { e.preventDefault(); window.api.open(CFG.ai.providers[aiSel].keyUrl); };
$('#ai-list-models').onclick = (e) => busy(e.target, async () => {
  const list = await window.api.aiModels(aiSel, $('#ai-key').value, $('#ai-url').value);
  $('#ai-model-list').innerHTML = list.map((m) => `<option value="${escHtml(m)}">`).join('');
  toast(t('{n} modelos disponibles. Haz clic en el campo «Modelo» para elegir.', { n: list.length }));
  $('#ai-model').focus();
});
$('#ai-test').onclick = (e) => busy(e.target, async () => {
  CFG.ai = await window.api.aiSave(aiSel, { key: $('#ai-key').value, url: $('#ai-url').value, model: $('#ai-model').value });
  if (CFG.ai.active !== aiSel) CFG.ai = await window.api.aiSetActive(aiSel);
  renderAi();
  $('#ai-test-status').textContent = t('Probando…');
  try { const who = await window.api.aiTest(); $('#ai-test-status').textContent = t('Listo para usar.') + ' ' + who; $('#ai-test-status').className = 'ok-text'; }
  catch (err) { $('#ai-test-status').textContent = err.message; $('#ai-test-status').className = 'err-text'; }
});
$('#ai-instr-save').onclick = async () => { CFG = await window.api.setConfig({ aiInstructions: $('#ai-instructions').value }); toast(t('Guardado')); };

// ---------------------------------------------------------------- Publicaciones: lista
function visiblePosts() {
  const q = $('#f-search').value.trim().toLowerCase();
  const show = $('#f-show').value;
  return posts.filter((p) => {
    if (q && !p.text.toLowerCase().includes(q)) return false;
    const done = !!liveExport(p);
    return show === 'all' || (show === 'done' ? done : !done);
  });
}
function renderFeed() {
  const list = visiblePosts();
  const feed = $('#feed');
  feed.classList.toggle('selecting', selected.size > 0);
  if (!rawPosts.length) { feed.innerHTML = `<div class="empty"><span class="ms fill">photo_library</span><b>${t('Aún no hay publicaciones')}</b><span>${t('Elige un origen arriba o arrastra archivos aquí.')}</span></div>`; return; }
  if (!list.length) { feed.innerHTML = `<div class="empty"><span class="ms">filter_alt_off</span><span>${t('Ninguna publicación coincide con el filtro.')}</span></div>`; return; }
  feed.innerHTML = '';
  for (const p of list) {
    const key = keyOf(p);
    const ex = exportOf(p);
    const card = document.createElement('div');
    card.className = 'post' + (selected.has(key) ? ' sel' : '') + (ex && !GONE.includes(ex.status) ? ' done' : '');
    card.tabIndex = 0;
    const first = p.media.find((m) => m.type === 'image') || p.media[0];
    const thumb = first && (first.url || (first.type === 'image' ? fileUrl(first.path) : null));
    const badges = [p, ...(p.alsoOn || [])].map((x) => `<span class="badge ${x.source}">${x.source === 'instagram' ? 'IG' : 'FB'}</span>`).join(' ');
    card.innerHTML = `
      ${thumb ? `<img src="${escHtml(thumb)}" loading="lazy" alt="">` : `<div class="noimg">${t('Sin imagen')}</div>`}
      ${ex ? (() => { const st = EX_STATUS()[ex.status] || { icon: 'check_circle', label: t('En el blog') };
        return `<span class="done-badge st-${escHtml(ex.status || 'publish')}" title="${t('Abrir la entrada en WordPress')}"><span class="ms fill">${st.icon}</span>${st.label}</span>`; })() : ''}
      <span class="check"><span class="ms">check</span></span>
      <div class="media-tools">
        ${p.media.some((m) => m.type === 'video') ? `<span class="vid-badge"><span class="ms fill">play_circle</span>${t('Vídeo')}</span>` : ''}
        ${p.media.length ? `<button class="zoom" title="${t('Ver en grande')}"><span class="ms">open_in_full</span></button>` : ''}
      </div>
      <div class="meta">${badges} ${fmtDate(p.date)}${p.media.length > 1 ? ' · ' + t('{n} archivos', { n: p.media.length }) : ''}${p.media.some((m) => m.type === 'video') ? ' · ' + t('vídeo') : ''}</div>
      <p></p>`;
    card.querySelector('p').textContent = p.text.slice(0, 220) + (p.text.length > 220 ? '…' : '');
    if (ex) card.querySelector('.done-badge').onclick = (e) => { e.stopPropagation(); window.api.open(ex.editUrl); };
    card.querySelector('.zoom')?.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(mediaItemsOf(p), 0); });
    card.ondblclick = (e) => { e.preventDefault(); if (p.media.length) openLightbox(mediaItemsOf(p), 0); };
    const toggle = () => { selected.has(key) ? selected.delete(key) : selected.add(key); card.classList.toggle('sel'); updateCount(); feed.classList.toggle('selecting', selected.size > 0); };
    card.onclick = toggle;
    card.onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } };
    feed.appendChild(card);
  }
}
function updateCount() {
  $('#sel-count').textContent = t(selected.size === 1 ? '{n} seleccionada' : '{n} seleccionadas', { n: selected.size });
  $('#make').disabled = selected.size === 0;
  // La barra flotante aparece al seleccionar algo (y se oculta mientras el editor está abierto)
  $('#selbar').classList.toggle('show', selected.size > 0 && $('#editor').classList.contains('hidden') && $('#tab-posts').classList.contains('active'));
}
$('#sel-clear').onclick = () => { selected.clear(); updateCount(); renderFeed(); };
async function addPosts(list, select = false) {
  const have = new Set(rawPosts.map(keyOf));
  for (const p of list) {
    if (!have.has(keyOf(p))) rawPosts.push(p);
    if (select) selected.add(keyOf(p));
  }
  rawPosts.sort((a, b) => new Date(b.date) - new Date(a.date));
  await rebuildView();
}
async function rebuildView() {
  posts = $('#f-merge').checked ? await window.api.mergeDuplicates(rawPosts) : rawPosts;
  const valid = new Set(posts.map(keyOf));
  for (const k of [...selected]) if (!valid.has(k)) selected.delete(k);
  $('#more').classList.toggle('hidden', !(cursors && (cursors.facebook || cursors.instagram)));
  updateCount(); renderFeed();
}
const metaSources = () => [$('#src-ig').checked && 'instagram', $('#src-fb').checked && 'facebook'].filter(Boolean);
async function loadFirst() { const r = await window.api.metaPosts($('#page').value, metaSources()); cursors = r.cursors; await addPosts(r.posts); return r.posts.length; }
async function loadMore() { const r = await window.api.metaPosts($('#page').value, metaSources(), cursors); cursors = r.cursors; await addPosts(r.posts); return r.posts.length; }
$('#load').onclick = (e) => busy(e.target, async () => toast(t('{n} publicaciones cargadas', { n: await loadFirst() })));
$('#more').onclick = (e) => busy(e.target, loadMore);
$('#f-merge').onchange = async () => { CFG = await window.api.setConfig({ format: { ...CFG.format, mergeDuplicates: $('#f-merge').checked } }); rebuildView(); };
$('#f-search').oninput = renderFeed;
$('#f-show').onchange = renderFeed;
$('#clear').onclick = () => { rawPosts = []; posts = []; cursors = null; selected.clear(); $('#more').classList.add('hidden'); updateCount(); renderFeed(); };

// Selector de origen
$$('.sources button').forEach((b) => b.onclick = () => {
  $$('.sources button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.src-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'src-' + b.dataset.src));
});
const showSource = (src) => $(`.sources button[data-src="${src}"]`).click();

// ZIP de Meta
const importZip = (kind) => (e) => busy(e.target, async () => {
  const list = await window.api.importMetaExport(kind);
  if (list) { await addPosts(list); toast(t('{n} publicaciones importadas', { n: list.length })); }
});
$('#zip-file').onclick = importZip('file');
$('#zip-folder').onclick = importZip('folder');

// Capturas con IA
async function importShots(files) {
  toast(t('La IA está leyendo las capturas…'));
  const post = await window.api.importScreenshots(files);
  await addPosts([post], true);
  toast(post.warning || t('Publicación leída: {n} foto(s). Ya está seleccionada.', { n: post.media.length }), !!post.warning);
}
$('#shots-pick').onclick = (e) => busy(e.target, async () => { const f = await window.api.pickImages(false); if (f) await importShots(f); });

// Manual
let manualFiles = [];
const renderManualCount = () => ($('#m-count').textContent = t('{n} archivo(s)', { n: manualFiles.length }));
$('#m-files').onclick = async () => { const f = await window.api.pickImages(true); if (f) { manualFiles = manualFiles.concat(f); renderManualCount(); } };
$('#m-add').onclick = async () => {
  if (!$('#m-text').value.trim() && !manualFiles.length) return toast(t('Escribe un texto o añade fotos'), true);
  const post = await window.api.manualPost({
    text: $('#m-text').value, date: $('#m-date').value || null, source: $('#m-source').value,
    permalink: $('#m-link').value.trim() || null, files: manualFiles,
  });
  await addPosts([post], true);
  $('#m-text').value = ''; $('#m-link').value = ''; manualFiles = []; renderManualCount();
  toast(t('Añadida a la lista y seleccionada'));
};

// Arrastrar y soltar en la ventana
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#drop').classList.remove('hidden'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').classList.add('hidden'); } });
window.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault(); dragDepth = 0; $('#drop').classList.add('hidden');
  const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
  if (!paths.length) return;
  showTab('posts');
  try {
    const zip = paths.find((p) => /\.zip$/i.test(p));
    if (zip) { const list = await window.api.importMetaPath(zip); await addPosts(list); toast(t('{n} publicaciones importadas', { n: list.length })); return; }
    const media = paths.filter((p) => /\.(jpe?g|png|webp|gif|mp4|mov)$/i.test(p));
    if (!media.length) return toast(t('Ese tipo de archivo no se puede usar aquí'), true);
    if ($('.sources button.active').dataset.src === 'shots') return importShots(media.filter((p) => !/\.(mp4|mov)$/i.test(p)));
    manualFiles = manualFiles.concat(media); renderManualCount(); showSource('manual');
    toast(t('{n} archivo(s) añadidos. Escribe el texto y pulsa «Añadir a la lista».', { n: media.length }));
  } catch (err) { toast(err.message, true); }
});

// ---------------------------------------------------------------- Resumen de un periodo
$('#summary').onclick = () => {
  const now = new Date(), first = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  $('#sum-from').value = iso(first); $('#sum-to').value = iso(now);
  $('#summary-modal').classList.remove('hidden');
};
$('#sum-cancel').onclick = () => $('#summary-modal').classList.add('hidden');
$('#sum-go').onclick = (e) => busy(e.target, async () => {
  const from = new Date($('#sum-from').value + 'T00:00:00'), to = new Date($('#sum-to').value + 'T23:59:59');
  if (!(from <= to)) throw new Error(t('Revisa las fechas'));
  // Trae publicaciones hasta llegar a la fecha de inicio (si se usa la conexión con Meta)
  if (CFG.metaConnected && $('#page').value) {
    if (!cursors) await loadFirst();
    for (let i = 0; i < 15 && cursors && (cursors.facebook || cursors.instagram); i++) {
      const oldest = rawPosts.length ? new Date(rawPosts[rawPosts.length - 1].date) : new Date();
      if (oldest < from) break;
      await loadMore();
    }
  }
  const inRange = posts.filter((p) => new Date(p.date) >= from && new Date(p.date) <= to && (!$('#sum-pending').checked || !liveExport(p)));
  if (!inRange.length) throw new Error(t('No hay publicaciones en ese periodo'));
  selected.clear(); inRange.forEach((p) => selected.add(keyOf(p)));
  $('#f-show').value = 'all'; renderFeed(); updateCount();
  $('#summary-modal').classList.add('hidden');
  await makeDraft();
});

// ---------------------------------------------------------------- Editor visual
async function makeDraft() {
  const chosen = posts.filter((p) => selected.has(keyOf(p)));
  const already = chosen.filter(liveExport);
  if (already.length && !confirm(t('{n} de las publicaciones elegidas ya están en el blog. ¿Crear otra entrada de todos modos?', { n: already.length }))) return;
  toast(t('Subiendo fotos a WordPress…'));
  draft = await window.api.buildDraft(chosen);
  draft.excerpt = ''; draft.postId = null; // postId: borrador ya guardado en WordPress (vista previa)
  draftKeys = chosen.flatMap(keysOf);
  openEditor();
  if (draft.failed?.length) toast(t('No se pudieron subir {n} archivo(s): {e}', { n: draft.failed.length, e: draft.failed[0] }), true);
  else if (draft.notes?.includes('video')) toast(t('Tu plan de WordPress no admite subir vídeos: se insertará el vídeo original de la red social.'));
}
$('#make').onclick = (e) => busy(e.target, makeDraft);

function openEditor() {
  $('#sent').classList.add('hidden'); $('#send').classList.remove('hidden');
  $('#d-title').value = draft.title;
  $('#d-excerpt').value = draft.excerpt || '';
  $('#d-tags').value = draft.tags.join(', ');
  const f = CFG.format || {};
  const defCats = (f.categories || '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
  renderCats(defCats);
  $$('input[name="d-when"]').forEach((r) => (r.checked = r.value === (f.status || 'draft')));
  $('#d-schedule').value = '';
  $('#d-template').innerHTML = `<option value="">${t('Sin plantilla')}</option>` + (CFG.templates || []).map((tp, i) => `<option value="${i}">${escHtml(tp.name)}</option>`).join('');
  // Sin IA configurada, los botones se muestran desactivados y explican por qué al pasar el ratón
  $$('#ai-article, #ai-alts').forEach((b) => { b.disabled = !CFG.aiConfigured; b.parentElement.title = CFG.aiConfigured ? '' : t('Configura una IA en «Conexiones» para usar estos botones.'); });
  toggleSchedule();
  renderSections();
  $('#editor').classList.remove('hidden');
  $('#editor').scrollTop = 0;
  updateCount();
}
const closeEditor = () => { $('#editor').classList.add('hidden'); updateCount(); };
$('#ed-close').onclick = closeEditor;
const toggleSchedule = () => $('#d-schedule').classList.toggle('hidden', $('input[name="d-when"]:checked')?.value !== 'future');
$$('input[name="d-when"]').forEach((r) => (r.onchange = () => { toggleSchedule(); if (r.value === 'future') $('#d-schedule').focus(); }));

function renderCats(checkedNames) {
  const box = $('#d-cats');
  if (!categories.length) { box.innerHTML = `<span class="hint">${t('No se han podido cargar las categorías del blog.')}</span>`; return; }
  box.innerHTML = categories.map((c) => `<label class="chip"><input type="checkbox" value="${escHtml(c.name)}" ${checkedNames.includes(c.name.toLowerCase()) ? 'checked' : ''}>${escHtml(c.name)}</label>`).join('');
}

function renderSections() {
  const wrap = $('#d-sections');
  wrap.innerHTML = '';
  draft.sections.forEach((sec, si) => {
    const box = document.createElement('div');
    box.className = 'section';
    box.innerHTML = `
      ${draft.sections.length > 1 ? `<div class="sec-title">${t('Publicación {n}', { n: si + 1 })}</div>` : ''}
      <div class="rt-bar">
        <button data-cmd="bold" title="${t('Negrita')}"><span class="ms">format_bold</span></button>
        <button data-cmd="italic" title="${t('Cursiva')}"><span class="ms">format_italic</span></button>
        <button data-cmd="link" title="${t('Enlace')}"><span class="ms">link</span></button>
        <button data-cmd="unlink" title="${t('Quitar enlace')}"><span class="ms">link_off</span></button>
      </div>
      <div class="rt" contenteditable="true" spellcheck="true"></div>
      <div class="imgs"></div>
      ${sec.footer ? `<div class="foot hint"></div>` : ''}`;
    const rt = box.querySelector('.rt');
    rt.innerHTML = sec.html;
    rt.oninput = () => (sec.html = rt.innerHTML);
    rt.onpaste = (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); };
    box.querySelectorAll('.rt-bar button').forEach((b) => b.onmousedown = (e) => {
      e.preventDefault();
      if (b.dataset.cmd === 'link') { const url = prompt(t('Dirección del enlace (https://…)')); if (url) document.execCommand('createLink', false, url); }
      else document.execCommand(b.dataset.cmd);
      sec.html = rt.innerHTML;
    });
    if (sec.footer) box.querySelector('.foot').innerHTML = sec.footer;
    renderImages(box.querySelector('.imgs'), sec);
    wrap.appendChild(box);
  });
}

// Fotos: arrastrar para ordenar, ★ imagen destacada, × quitar, texto alternativo
let dragImg = null;
function renderImages(el, sec) {
  el.innerHTML = '';
  if (!sec.images.length && !sec.videos.length && !sec.embed) { el.innerHTML = `<span class="hint">${t('Sin fotos')}</span>`; return; }
  sec.images.forEach((img, i) => {
    const fig = document.createElement('div');
    fig.className = 'img' + (draft.featuredImageId === img.id ? ' featured' : '');
    fig.draggable = true;
    fig.innerHTML = `<img src="${escHtml(img.url)}" alt="">
      <button class="star" title="${t('Usar como imagen destacada')}"><span class="ms fill">star</span></button>
      <button class="del" title="${t('Quitar de la entrada')}"><span class="ms">close</span></button>
      <input class="alt" placeholder="${t('Descripción (alt)')}">`;
    fig.querySelector('img').onclick = () => openLightbox(sectionItems(sec), i);
    fig.querySelector('.alt').value = img.alt || '';
    fig.querySelector('.alt').oninput = (e) => (img.alt = e.target.value);
    fig.querySelector('.star').onclick = () => { draft.featuredImageId = img.id; renderSections(); };
    fig.querySelector('.del').onclick = () => {
      sec.images.splice(i, 1);
      if (draft.featuredImageId === img.id) draft.featuredImageId = draft.sections.flatMap((s) => s.images)[0]?.id;
      renderSections();
    };
    fig.ondragstart = (e) => { dragImg = { sec, i }; e.dataTransfer.effectAllowed = 'move'; fig.classList.add('dragging'); };
    fig.ondragend = () => fig.classList.remove('dragging');
    fig.ondragover = (e) => { if (dragImg?.sec === sec) { e.preventDefault(); e.stopPropagation(); } };
    fig.ondrop = (e) => {
      if (dragImg?.sec !== sec) return;
      e.preventDefault(); e.stopPropagation();
      const [moved] = sec.images.splice(dragImg.i, 1);
      sec.images.splice(i, 0, moved); dragImg = null; renderSections();
    };
    el.appendChild(fig);
  });
  const vid = (txt) => { const d = document.createElement('div'); d.className = 'img vid'; d.innerHTML = '<span class="ms">movie</span>'; d.append(txt); el.appendChild(d); };
  sec.videos.forEach((v, k) => {
    const d = document.createElement('div');
    d.className = 'img';
    d.innerHTML = `${v.poster ? `<img src="${escHtml(v.poster)}" alt="">` : `<video src="${escHtml(v.url)}" preload="metadata" muted style="width:116px;height:116px;object-fit:cover;border-radius:var(--r-l)"></video>`}<span class="play"><span class="ms fill">play_arrow</span></span>`;
    d.onclick = () => openLightbox(sectionItems(sec), sec.images.length + k);
    el.appendChild(d);
  });
  if (sec.embed) vid(t('Vídeo de {r} (se inserta el original)', { r: sec.embed.provider === 'instagram' ? 'Instagram' : 'Facebook' }));
}

// Plantillas
$('#d-template').onchange = () => {
  const tp = (CFG.templates || [])[$('#d-template').value];
  if (!tp) return;
  if (tp.categories) renderCats(tp.categories.split(',').map((c) => c.trim().toLowerCase()));
  if (tp.tags) {
    const cur = $('#d-tags').value.split(',').map((x) => x.trim()).filter(Boolean);
    $('#d-tags').value = [...new Set([...cur, ...tp.tags.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean)])].join(', ');
  }
  if (tp.status) { $$('input[name="d-when"]').forEach((r) => (r.checked = r.value === tp.status)); toggleSchedule(); }
  if (tp.footer !== undefined && tp.footer !== '') {
    for (const sec of draft.sections) if (sec.footer !== null) sec.footer = escHtml(tp.footer).replace('{redes}', (sec.footer.match(/<a [\s\S]*<\/a>|Instagram|Facebook/) || [''])[0]);
    renderSections();
  }
  toast(t('Plantilla «{p}» aplicada', { p: tp.name }));
};

// IA en el editor
$('#ai-article').onclick = (e) => busy(e.target, async () => {
  if (draft.sections.length > 1 && !confirm(t('La IA reescribirá el texto como un único artículo. ¿Continuar?'))) return;
  const text = draft.sourceText || draft.sections.map((s) => s.html.replace(/<[^>]+>/g, ' ')).join('\n\n');
  const r = await window.api.aiArticle({ title: $('#d-title').value, text });
  $('#d-title').value = r.title;
  $('#d-excerpt').value = r.excerpt;
  draft.sections[0].html = r.paragraphs.map((p) => `<p>${escHtml(p)}</p>`).join('');
  for (const s of draft.sections.slice(1)) s.html = '';
  const cur = $('#d-tags').value.split(',').map((x) => x.trim()).filter(Boolean);
  $('#d-tags').value = [...new Set([...cur, ...r.tags])].join(', ');
  renderSections();
  toast(t('Listo. Revisa el texto antes de enviarlo.'));
});
$('#ai-alts').onclick = (e) => busy(e.target, async () => {
  const imgs = draft.sections.flatMap((s) => s.images);
  if (!imgs.length) throw new Error(t('Esta entrada no tiene fotos'));
  const alts = await window.api.aiAlts(imgs.map((i) => i.url), $('#d-title').value);
  imgs.forEach((img, i) => { if (alts[i]) img.alt = alts[i]; });
  renderSections();
  toast(t('Descripciones añadidas. Puedes corregirlas debajo de cada foto.'));
});

// Enviar
$('#send').onclick = (e) => busy(e.target, async () => {
  const when = $('input[name="d-when"]:checked').value;
  if (when === 'publish' && !confirm(t('Se publicará ahora y será visible en la web. ¿Continuar?'))) return;
  const res = await window.api.publish({
    postId: draft.postId,
    title: $('#d-title').value.trim(),
    excerpt: $('#d-excerpt').value.trim(),
    sections: draft.sections,
    tags: $('#d-tags').value.split(',').map((x) => x.trim()).filter(Boolean),
    categories: $$('#d-cats input:checked').map((i) => i.value),
    status: when,
    scheduleAt: when === 'future' ? $('#d-schedule').value : null,
    featuredImageId: draft.featuredImageId,
    keepDate: $('#d-keepdate').checked, date: draft.date,
    keys: draftKeys,
  });
  exported = res.exported; lastSent = res;
  $('#sent-text').textContent = res.status === 'publish' ? t('¡Entrada publicada!')
    : res.status === 'future' ? t('Entrada programada para el {d}.', { d: fmtDate(res.date) }) : t('Borrador creado en WordPress.');
  $('#send').classList.add('hidden'); $('#sent').classList.remove('hidden');
  selected.clear(); updateCount(); renderFeed(); blog.loaded = false;
});

$('#sent-edit').onclick = () => lastSent && window.api.open(lastSent.editUrl);
$('#sent-view').onclick = () => lastSent && window.api.open(lastSent.url);
$('#sent-close').onclick = closeEditor;

// ---------------------------------------------------------------- Visor de fotos y vídeos
const mediaItemsOf = (p) => p.media.map((m) => (m.type === 'video'
  ? { type: 'video', src: m.videoUrl || fileUrl(m.path), poster: m.url && !m.path ? m.url : '' , fallback: m.url }
  : { type: 'image', src: m.url || fileUrl(m.path) }));
const sectionItems = (sec) => [...sec.images.map((i) => ({ type: 'image', src: i.url })), ...sec.videos.map((v) => ({ type: 'video', src: v.url, poster: v.poster }))];
let lb = { items: [], i: 0 };
function openLightbox(items, i) {
  if (!items.length) return;
  lb = { items, i: Math.max(0, Math.min(i, items.length - 1)) };
  $('#lightbox').classList.remove('hidden'); renderLightbox();
}
function renderLightbox() {
  const it = lb.items[lb.i], stage = $('#lightbox .lb-stage');
  stage.innerHTML = '';
  if (it.type === 'video' && it.src) {
    const v = document.createElement('video');
    v.src = it.src; v.controls = true; v.autoplay = true; if (it.poster) v.poster = it.poster;
    v.onerror = () => { stage.innerHTML = ''; const img = document.createElement('img'); img.src = it.poster || it.fallback || ''; stage.appendChild(img); toast(t('No se puede reproducir este vídeo aquí; se muestra su miniatura.')); };
    stage.appendChild(v);
  } else {
    const img = document.createElement('img'); img.src = it.src || it.fallback || ''; img.alt = ''; stage.appendChild(img);
  }
  $('#lightbox .lb-count').textContent = lb.items.length > 1 ? `${lb.i + 1} / ${lb.items.length}` : '';
  $$('#lightbox .lb-prev, #lightbox .lb-next').forEach((b) => (b.style.visibility = lb.items.length > 1 ? 'visible' : 'hidden'));
}
const closeLightbox = () => { $('#lightbox').classList.add('hidden'); $('#lightbox .lb-stage').innerHTML = ''; };
const stepLightbox = (d) => { lb.i = (lb.i + d + lb.items.length) % lb.items.length; renderLightbox(); };
$('#lightbox .lb-close').onclick = closeLightbox;
$('#lightbox .lb-prev').onclick = () => stepLightbox(-1);
$('#lightbox .lb-next').onclick = () => stepLightbox(1);
$('#lightbox').onclick = (e) => { if (e.target.id === 'lightbox' || e.target.classList.contains('lb-stage')) closeLightbox(); };
document.addEventListener('keydown', (e) => {
  if ($('#lightbox').classList.contains('hidden')) {
    if (e.key === 'Escape') { if (!$('#pv-modal').classList.contains('hidden')) $('#pv-modal').classList.add('hidden'); else if (!$('#summary-modal').classList.contains('hidden')) $('#summary-modal').classList.add('hidden'); }
    return;
  }
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') stepLightbox(-1);
  if (e.key === 'ArrowRight') stepLightbox(1);
});

// ---------------------------------------------------------------- Vista previa de la entrada
// Rápida: la entrada se dibuja dentro de Ecos con un estilo de blog sencillo.
// Real («Ver en mi web»): se guarda como borrador y se abre la vista previa de WordPress con tu tema.
const draftPayload = (status) => ({
  postId: draft.postId,
  title: $('#d-title').value.trim(), excerpt: $('#d-excerpt').value.trim(), sections: draft.sections,
  tags: $('#d-tags').value.split(',').map((x) => x.trim()).filter(Boolean),
  categories: $$('#d-cats input:checked').map((i) => i.value),
  status, scheduleAt: status === 'future' ? $('#d-schedule').value : null,
  featuredImageId: draft.featuredImageId, keepDate: $('#d-keepdate').checked, date: draft.date, keys: draftKeys,
});
$('#preview').onclick = (e) => busy(e.target, async () => {
  const html = (await window.api.composeDraft(draft.sections)).replace(/<!--[\s\S]*?-->/g, '');
  const featured = draft.sections.flatMap((s) => s.images).find((i) => i.id === draft.featuredImageId);
  const cats = $$('#d-cats input:checked').map((i) => i.value);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const date = new Date().toLocaleDateString(prefs().lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  $('#pv-frame').srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font:18px/1.7 Georgia,'Times New Roman',serif;color:#1d1d1f;background:#fff}
    header.site{padding:22px 32px;border-bottom:1px solid #eee;font:600 18px system-ui,sans-serif;color:${accent}}
    article{max-width:720px;margin:0 auto;padding:40px 24px 80px}
    .cats{font:600 12px system-ui,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:${accent}}
    h1{font:700 40px/1.15 system-ui,sans-serif;margin:10px 0 12px;letter-spacing:-.5px}
    .date{font:14px system-ui,sans-serif;color:#777;margin-bottom:28px}
    .featured{width:100%;border-radius:14px;margin-bottom:28px}
    .excerpt{font-size:21px;color:#444;margin:0 0 24px}
    figure{margin:28px 0}figure img,figure video{max-width:100%;border-radius:10px;display:block}
    .wp-block-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
    .wp-block-gallery figure{margin:0}.wp-block-gallery img{width:100%;aspect-ratio:1;object-fit:cover}
    .wp-block-embed{padding:18px;border:1px dashed #ccc;border-radius:10px;font:14px system-ui;color:#666;word-break:break-all}
    hr{border:0;border-top:1px solid #eee;margin:40px 0}a{color:${accent}}
    .tags{margin-top:40px;font:13px system-ui;color:#777}.tags span{display:inline-block;background:#f2f2f2;border-radius:99px;padding:4px 12px;margin:0 6px 6px 0}
    @media(max-width:500px){h1{font-size:30px}article{padding:24px 18px}}
  </style></head><body><header class="site">${escHtml(CFG.wpSite || '')}</header><article>
    ${cats.length ? `<div class="cats">${escHtml(cats.join(' · '))}</div>` : ''}
    <h1>${escHtml($('#d-title').value)}</h1><div class="date">${date}</div>
    ${featured ? `<img class="featured" src="${escHtml(featured.url)}" alt="">` : ''}
    ${$('#d-excerpt').value.trim() ? `<p class="excerpt">${escHtml($('#d-excerpt').value.trim())}</p>` : ''}
    ${html}
    <div class="tags">${$('#d-tags').value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => `<span>#${escHtml(x)}</span>`).join('')}</div>
  </article></body></html>`;
  $('#pv-modal').classList.remove('hidden');
});
$$('#pv-size button').forEach((b) => b.onclick = () => {
  $$('#pv-size button').forEach((x) => x.classList.toggle('active', x === b));
  $('#pv-frame').style.maxWidth = b.dataset.w + 'px';
});
$('#pv-close').onclick = () => $('#pv-modal').classList.add('hidden');
$('#pv-web').onclick = (e) => busy(e.target, async () => {
  const r = await window.api.previewDraft(draftPayload('draft'));
  draft.postId = r.postId;
  window.api.open(r.previewUrl);
  toast(t('Guardado como borrador. La vista previa se abre en tu navegador.'));
});

// ---------------------------------------------------------------- Pestaña Blog
const blog = { loaded: false, type: 'post', page: 1, per: 20, found: 0 };
const STATUS = () => ({ publish: t('Publicada'), draft: t('Borrador'), future: t('Programada'), pending: t('Pendiente'), private: t('Privada'), trash: t('Papelera') });
async function loadBlog() {
  const list = $('#b-list');
  list.innerHTML = `<p class="hint pad">${t('Cargando…')}</p>`;
  try {
    const r = await window.api.blogList({ type: blog.type, status: $('#b-status').value, search: $('#b-search').value.trim(), page: blog.page, number: blog.per });
    blog.loaded = true; blog.found = r.found;
    renderBlog(r.items);
  } catch (e) { list.innerHTML = `<div class="empty"><span class="ms">cloud_off</span><span>${escHtml(e.message)}</span></div>`; }
}
function renderBlog(items) {
  const list = $('#b-list');
  const pages = Math.max(1, Math.ceil(blog.found / blog.per));
  $('#b-info').textContent = t(blog.type === 'page' ? '{n} páginas · página {p} de {t}' : '{n} entradas · página {p} de {t}', { n: blog.found, p: blog.page, t: pages });
  $('#b-prev').disabled = blog.page <= 1; $('#b-next').disabled = blog.page >= pages;
  if (!items.length) { list.innerHTML = `<div class="empty"><span class="ms">inbox</span><span>${t('No hay nada con estos filtros.')}</span></div>`; return; }
  list.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'b-row';
    const when = fmtDay(it.status === 'publish' || it.status === 'future' ? it.date : it.modified);
    row.innerHTML = `
      ${it.image ? `<img src="${escHtml(it.image)}" loading="lazy" alt="">` : `<div class="noimg"><span class="ms">image</span></div>`}
      <div><div class="b-title"></div>
        <div class="b-meta"><span class="st ${escHtml(it.status)}">${STATUS()[it.status] || escHtml(it.status)}</span>${when}${it.categories.length ? ' · ' + escHtml(it.categories.join(', ')) : ''}</div>
        <div class="b-ex"></div></div>
      <div class="b-actions"></div>`;
    const title = decodeEntities(it.title);
    row.querySelector('.b-title').textContent = title;
    row.querySelector('.b-ex').textContent = decodeEntities(it.excerpt);
    const actions = row.querySelector('.b-actions');
    const btn = (label, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = 'btn ' + (cls === 'primary' ? 'tonal' : cls === 'danger' ? 'text danger' : 'text');
      b.textContent = label; b.onclick = () => busy(b, fn); actions.appendChild(b);
    };
    if (it.status !== 'trash') btn(t('Editar'), async () => window.api.open(await window.api.blogEditUrl(it.id, it.type)));
    if (it.status === 'publish') btn(t('Ver'), async () => window.api.open(it.url));
    if (['draft', 'pending', 'private'].includes(it.status)) btn(t('Publicar'), async () => {
      if (!confirm(t('¿Publicar «{x}»? Será visible en la web.', { x: title }))) return;
      exported = await window.api.blogSetStatus(it.id, 'publish', it.type); toast(t('Publicada')); loadBlog(); renderFeed();
    }, 'primary');
    if (it.status === 'publish') btn(t('Pasar a borrador'), async () => {
      if (!confirm(t('¿Retirar «{x}» de la web y dejarla como borrador?', { x: title }))) return;
      exported = await window.api.blogSetStatus(it.id, 'draft', it.type); toast(t('Ahora es un borrador')); loadBlog(); renderFeed();
    });
    if (it.status === 'trash') btn(t('Restaurar como borrador'), async () => { exported = await window.api.blogSetStatus(it.id, 'draft', it.type); toast(t('Restaurada como borrador')); loadBlog(); renderFeed(); });
    else btn(t('Papelera'), async () => {
      if (!confirm(t('¿Mover «{x}» a la papelera? Podrás recuperarla durante 30 días.', { x: title }))) return;
      exported = await window.api.blogTrash(it.id, it.type); toast(t('Movida a la papelera')); loadBlog(); renderFeed();
    }, 'danger');
    list.appendChild(row);
  }
}
$$('#b-type button').forEach((b) => b.onclick = () => { $$('#b-type button').forEach((x) => x.classList.toggle('active', x === b)); blog.type = b.dataset.type; blog.page = 1; loadBlog(); });
$('#b-status').onchange = () => { blog.page = 1; loadBlog(); };
let bTimer; $('#b-search').oninput = () => { clearTimeout(bTimer); bTimer = setTimeout(() => { blog.page = 1; loadBlog(); }, 400); };
$('#b-refresh').onclick = loadBlog;
$('#b-prev').onclick = () => { blog.page--; loadBlog(); };
$('#b-next').onclick = () => { blog.page++; loadBlog(); };
$('#b-new').onclick = () => {
  if (CFG.wpMode === 'selfhosted') {
    const base = (CFG.wpUrl || '').replace(/\/$/, '');
    return window.api.open(`${/^https?:/.test(base) ? base : 'https://' + base}/wp-admin/post-new.php${blog.type === 'page' ? '?post_type=page' : ''}`);
  }
  window.api.open(`https://wordpress.com/${blog.type === 'page' ? 'page' : 'post'}/${CFG.wpSite}`);
};

// ---------------------------------------------------------------- Ajustes
function applyPrefs() {
  const p = prefs();
  const dark = p.theme === 'dark' || (p.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--accent', p.accent);
  document.documentElement.style.setProperty('--card-min', p.cards + 'px');
  window.api.setZoom(Number(p.zoom) || 1);
  for (const [id, v] of [['#s-theme', p.theme], ['#s-zoom', String(p.zoom)], ['#s-cards', String(p.cards)], ['#s-accent', p.accent]]) $$(id + ' button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
  $('#s-lang').value = p.lang;
  $$('#s-lang-seg button').forEach((b) => b.classList.toggle('active', b.dataset.v === p.lang));
  const preset = $$('#s-accent button').some((b) => b.dataset.v === p.accent);
  $('.custom-color').classList.toggle('active', !preset);
  $('#s-accent-custom').value = p.accent;
  if ($('#ai-providers').children.length) renderAi(); // logos claros/oscuros
  $('#s-check-new').checked = p.checkNew; $('#s-check-token').checked = p.checkToken;
  if (window.I18N.lang !== p.lang) { window.I18N.setLang(p.lang); refreshTexts(); }
}
matchMedia('(prefers-color-scheme: dark)').onchange = applyPrefs;
$$('#s-theme button').forEach((b) => b.onclick = () => savePrefs({ theme: b.dataset.v }));
$$('#s-zoom button').forEach((b) => b.onclick = () => savePrefs({ zoom: Number(b.dataset.v) }));
$$('#s-cards button').forEach((b) => b.onclick = () => savePrefs({ cards: Number(b.dataset.v) }));
$$('#s-accent button').forEach((b) => b.onclick = () => savePrefs({ accent: b.dataset.v }));
$('#s-lang').onchange = () => savePrefs({ lang: $('#s-lang').value });
$$('#s-lang-seg button').forEach((b) => b.onclick = () => savePrefs({ lang: b.dataset.v }));
$('#s-accent-custom').oninput = (e) => document.documentElement.style.setProperty('--accent', e.target.value); // vista previa
$('#s-accent-custom').onchange = (e) => savePrefs({ accent: e.target.value });
// Índice de Ajustes: resalta la sección visible
const setObs = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) $$('.set-nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id));
}, { rootMargin: '-90px 0px -60% 0px' });
$$('.set-body .card').forEach((c) => setObs.observe(c));
$('#s-check-new').onchange = () => savePrefs({ checkNew: $('#s-check-new').checked });
$('#s-check-token').onchange = () => savePrefs({ checkToken: $('#s-check-token').checked });
$$('.set-nav a').forEach((a) => a.onclick = (e) => { e.preventDefault(); $(a.getAttribute('href')).scrollIntoView({ behavior: 'smooth', block: 'start' }); });

// Formato
function fillFormat() {
  const f = CFG.format || {}, form = $('#f-format');
  form.cleanTitle.checked = f.cleanTitle !== false; form.footer.value = f.footer ?? '';
  form.extraTags.value = f.extraTags || ''; form.categories.value = f.categories || ''; form.status.value = f.status || 'draft';
}
$('#f-format').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  CFG = await window.api.setConfig({ format: { ...CFG.format, cleanTitle: form.cleanTitle.checked, footer: form.footer.value, extraTags: form.extraTags.value, categories: form.categories.value, status: form.status.value } });
  toast(t('Guardado'));
};

// Plantillas
function renderTemplates() {
  const list = $('#tpl-list');
  const tpls = CFG.templates || [];
  list.innerHTML = tpls.length ? '' : `<p class="hint">${t('Todavía no hay plantillas.')}</p>`;
  tpls.forEach((tp, i) => {
    const row = document.createElement('div');
    row.className = 'tpl';
    row.innerHTML = `
      <input data-k="name" placeholder="${t('Nombre (p. ej. Comunicado)')}">
      <input data-k="categories" placeholder="${t('Categorías')}">
      <input data-k="tags" placeholder="${t('Etiquetas')}">
      <input data-k="footer" placeholder="${t('Pie (vacío = el de por defecto)')}">
      <select data-k="status"><option value="">${t('Estado: por defecto')}</option><option value="draft">${t('Guardar como borrador')}</option><option value="publish">${t('Publicar ahora')}</option></select>
      <button class="btn text icon-only danger" title="${t('Borrar plantilla')}"><span class="ms">delete</span></button>`;
    row.querySelectorAll('[data-k]').forEach((inp) => { inp.value = tp[inp.dataset.k] || ''; inp.onchange = saveTemplates; });
    row.querySelector('button').onclick = async () => { tpls.splice(i, 1); CFG = await window.api.setConfig({ templates: tpls }); renderTemplates(); };
    list.appendChild(row);
  });
}
async function saveTemplates() {
  const tpls = $$('#tpl-list .tpl').map((row) => Object.fromEntries($$('[data-k]', row).map((i) => [i.dataset.k, i.value.trim()])));
  CFG = await window.api.setConfig({ templates: tpls }); toast(t('Plantillas guardadas'));
}
$('#tpl-add').onclick = async () => {
  CFG = await window.api.setConfig({ templates: [...(CFG.templates || []), { name: t('Nueva plantilla'), categories: '', tags: '', footer: '', status: '' }] });
  renderTemplates(); $$('#tpl-list .tpl input')?.slice(-5)[0]?.select();
};

// Copia de seguridad
$('#bk-export').onclick = (e) => busy(e.target, async () => {
  const where = await window.api.exportConfig($('#bk-secrets').checked);
  if (where) toast(t('Copia guardada en {p}', { p: where }));
});
async function doImport() {
  const c = await window.api.importConfig();
  if (!c) return false;
  CFG = c; await afterConfigLoaded(); toast(t('Configuración importada. Ahora pulsa «Conectar» en Meta y WordPress.'));
  return true;
}
$('#bk-import').onclick = (e) => busy(e.target, doImport);

// Actualizaciones
function renderUpdate(st) {
  $('#app-version').textContent = st.version || '–';
  const texts = {
    checking: t('Buscando actualizaciones…'),
    latest: t('Tienes la última versión.'),
    downloading: t('Descargando la versión {v}… {p} %', { v: st.version, p: st.percent || 0 }),
    ready: t('La versión {v} está lista. Se instalará al cerrar Ecos, o ahora mismo si reinicias.', { v: st.version }),
    error: t('No se pudo comprobar si hay actualizaciones: {e}', { e: st.message }),
    unsupported: st.reason === 'portable' ? t('La versión portable no se actualiza sola. Usa el instalador para recibir actualizaciones automáticas.') : t('Las actualizaciones solo funcionan en la versión instalada.'),
  };
  $('#update-detail').textContent = texts[st.state] || '';
  $('#update-bar').classList.toggle('hidden', !['downloading', 'ready'].includes(st.state));
  $('#update-text').textContent = texts[st.state] || '';
  $('#update-install').classList.toggle('hidden', st.state !== 'ready');
}
window.api.onUpdate(renderUpdate);
$('#update-install').onclick = () => window.api.installUpdate();
$('#update-check').onclick = async () => renderUpdate(await window.api.checkUpdate());
$('#open-releases').onclick = () => window.api.open('https://github.com/Perseo2499/ecos/releases');
$('#open-repo').onclick = () => window.api.open('https://github.com/Perseo2499/ecos');

// Avanzado
function renderMode(m) {
  $('#mode-name').textContent = m.level > 0 ? t('Compatible (sin sandbox)') : t('Normal');
  $('#mode-hint').textContent = m.level > 0
    ? t('Ecos detectó que en este equipo no arrancaba con el aislamiento de seguridad de Chromium y usa el modo compatible. Si has reinstalado Ecos o actualizado Windows, puedes volver a probar el modo normal: si falla, Ecos vuelve sola al compatible.')
    : t('Modo recomendado.');
  $('#mode-normal').classList.toggle('hidden', !(m.level > 0));
}
$('#mode-normal').onclick = () => { toast(t('Reiniciando Ecos…')); window.api.tryNormalMode(); };
$('#open-logs').onclick = () => window.api.openData();
$('#wizard-again').onclick = () => openWizard();
$('#forget-exported').onclick = async () => {
  if (!confirm(t('Ecos dejará de marcar publicaciones como «En el blog». Las entradas de tu web no se tocan. ¿Continuar?'))) return;
  exported = await window.api.clearExported(); renderFeed(); toast(t('Hecho'));
};
$('#reset-all').onclick = () => {
  if (!confirm(t('Se borrarán todas las conexiones, claves, ajustes y plantillas de Ecos en este ordenador. Tu blog y tus redes no se tocan. ¿Continuar?'))) return;
  if (!confirm(t('¿Seguro? Esta acción no se puede deshacer. Si quieres, exporta antes una copia de seguridad.'))) return;
  window.api.resetAll();
};

// ---------------------------------------------------------------- Asistente de primera configuración
let wzStep = 0;
const homeOf = new Map();
function openWizard() {
  // Las tarjetas de Meta y WordPress se muestran dentro del asistente (y vuelven a su sitio al cerrarlo)
  for (const [slot, sel] of [['meta', '#f-meta'], ['wp', '#f-wp']]) {
    const card = $(sel);
    if (!homeOf.has(card)) homeOf.set(card, { parent: card.parentNode, next: card.nextSibling });
    $(`.wz-slot[data-slot="${slot}"]`).appendChild(card);
  }
  wzStep = 0; renderWizard(); $('#wizard').classList.remove('hidden');
}
function closeWizard(done) {
  for (const [card, pos] of homeOf) pos.parent.insertBefore(card, pos.next);
  $('#wizard').classList.add('hidden');
  if (done) window.api.setConfig({ wizardDone: true });
}
function renderWizard() {
  $$('.wz-page').forEach((p) => p.classList.toggle('hidden', Number(p.dataset.page) !== wzStep));
  $$('.wz-steps span').forEach((s) => { const n = Number(s.dataset.step); s.className = n === wzStep ? 'on' : n < wzStep ? 'done' : ''; });
  $('#wz-back').classList.toggle('hidden', wzStep === 0);
  $('#wz-next').textContent = wzStep === 3 ? t('Empezar') : wzStep === 0 ? t('Comenzar') : t('Siguiente');
  if (wzStep === 3) $('#wz-summary').textContent = [
    CFG.metaConnected ? '✓ ' + t('Instagram y Facebook conectados') : '• ' + t('Instagram y Facebook sin conectar (puedes usar el ZIP de Meta o el modo manual)'),
    CFG.wpConnected ? '✓ ' + t('Blog conectado: {s}', { s: CFG.wpSiteLabel || CFG.wpSite }) : '• ' + t('Blog sin conectar'),
  ].join('  ');
}
$('#wz-next').onclick = () => {
  if (wzStep === 1 && !CFG.metaConnected && !confirm(t('Todavía no has conectado Meta. ¿Seguir de todos modos?'))) return;
  if (wzStep === 2 && !CFG.wpConnected && !confirm(t('Todavía no has conectado WordPress. Sin él no se pueden crear entradas. ¿Seguir de todos modos?'))) return;
  if (wzStep === 3) { closeWizard(true); showTab('posts'); return; }
  wzStep++; renderWizard();
};
$('#wz-back').onclick = () => { wzStep--; renderWizard(); };
$('#wz-skip').onclick = () => closeWizard(true);
$('#wz-import').onclick = (e) => busy(e.target, async () => { if (await doImport()) { wzStep = 1; renderWizard(); } });
$('#open-wizard').onclick = () => openWizard();

// ---------------------------------------------------------------- textos que dependen del idioma
function refreshTexts() {
  window.I18N.apply(document);
  renderStatus(); updateCount(); renderFeed(); renderAi(); renderManualCount();
  if ($('#bn-token')) checkTokenExpiry();
  if (CFG.startMode) renderMode(CFG.startMode);
  if (blog.loaded) loadBlog();
  window.api.updateStatus().then(renderUpdate).catch(() => {});
}

// ---------------------------------------------------------------- arranque
async function afterConfigLoaded() {
  exported = CFG.exported || {};
  $('#f-merge').checked = CFG.format?.mergeDuplicates !== false;
  fillConnections(); fillFormat(); renderTemplates(); renderAi(); renderStatus();
  if (CFG.startMode) renderMode(CFG.startMode);
  applyPrefs();
}
window.api.onToast((m) => toast(m));
window.api.onConfigChanged((c) => { CFG = { ...CFG, ...c }; renderStatus(); });

(async () => {
  CFG = await window.api.getConfig();
  window.I18N.setLang(prefs().lang);
  window.I18N.apply(document);
  await afterConfigLoaded();
  updateCount(); renderFeed(); renderManualCount();
  window.api.updateStatus().then(renderUpdate).catch(() => {});
  window.api.appInfo().then((i) => ($('#about-info').textContent = `${t('Versión')} ${i.version} · Electron ${i.electron} · ${i.platform}`)).catch(() => {});
  if (CFG.wpConnected) { loadCategories(); refreshExported(true); }
  checkTokenExpiry();
  if (CFG.metaConnected) {
    try { renderPages(await window.api.metaAccounts()); checkPending(); } catch (e) { toast(e.message, true); }
  }
  if (!CFG.wizardDone) openWizard();
})();
