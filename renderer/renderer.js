const $ = (s) => document.querySelector(s);
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let rawPosts = [];     // todo lo cargado/importado
let posts = [];        // lo que se muestra (con duplicados juntados si la opción está activa)
let draft = null;
let draftKeys = [];    // claves de las publicaciones de origen del borrador
let cursors = null;    // «Cargar más» de Meta
let exported = {};     // publicaciones ya pasadas al blog
let format = {};       // opciones de Configuración → Formato
const selected = new Set();
const keyOf = (p) => p.source + ':' + p.id;
const keysOf = (p) => [keyOf(p), ...(p.alsoOn || []).map((a) => a.source + ':' + a.id)];
const exportOf = (p) => keysOf(p).map((k) => exported[k]).find(Boolean);

function toast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = ''), 5000);
}
async function busy(btn, fn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Trabajando…';
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.textContent = label; }
}

document.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => {
  navigator.clipboard.writeText($(b.dataset.copy).value); toast('Copiado');
});

// Pestañas
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button, .tab').forEach((x) => x.classList.remove('active'));
  b.classList.add('active'); $('#tab-' + b.dataset.tab).classList.add('active');
  if (b.dataset.tab === 'blog' && !blog.loaded) loadBlog();
});

function renderStatus(cfg) {
  $('#st-meta').textContent = 'Meta: ' + (cfg.metaConnected ? 'conectado' : 'no conectado');
  $('#st-meta').classList.toggle('ok', cfg.metaConnected);
  $('#st-wp').textContent = 'WordPress: ' + (cfg.wpConnected ? cfg.wpSite : 'no conectado');
  $('#st-wp').classList.toggle('ok', cfg.wpConnected);
}

function fillForms(cfg) {
  $('#meta-redirect').value = cfg.metaRedirectUri; $('#wp-redirect').value = cfg.wpRedirectUri;
  for (const f of ['#f-meta', '#f-wp', '#f-ai']) for (const el of $(f).elements) if (el.name) el.value = cfg[el.name] || '';
}

for (const f of ['#f-meta', '#f-wp', '#f-ai']) $(f).onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const cfg = await window.api.setConfig(data); renderStatus(cfg); toast('Guardado');
};

function fillFormat(f) {
  const form = $('#f-format');
  form.cleanTitle.checked = f.cleanTitle !== false;
  form.footer.value = f.footer ?? '';
  form.extraTags.value = f.extraTags || '';
  form.categories.value = f.categories || '';
  form.status.value = f.status || 'draft';
}
$('#f-format').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const next = {
    ...format, cleanTitle: form.cleanTitle.checked, footer: form.footer.value, extraTags: form.extraTags.value,
    categories: form.categories.value, status: form.status.value,
  };
  const cfg = await window.api.setConfig({ format: next });
  format = cfg.format; toast('Guardado');
};

// Modo de arranque
function renderMode(m) {
  $('#mode-name').textContent = m.name;
  const compat = m.level > 0;
  $('#mode-hint').textContent = compat
    ? 'Ecos detectó que en este equipo no arrancaba con el aislamiento de seguridad de Chromium y usa el modo compatible. Si has reinstalado Ecos o actualizado Windows, puedes volver a probar el modo normal: si falla, Ecos vuelve sola al compatible.'
    : 'Modo recomendado.';
  $('#mode-normal').classList.toggle('hidden', !compat);
}
$('#mode-normal').onclick = () => { toast('Reiniciando Ecos…'); window.api.tryNormalMode(); };

function renderPages(accs) {
  $('#page').innerHTML = accs.map((a) => `<option value="${a.pageId}">${a.pageName}${a.igUser ? ' · @' + a.igUser : ' (sin Instagram)'}</option>`).join('');
}

$('#meta-login').onclick = (e) => busy(e.target, async () => {
  await window.api.setConfig(Object.fromEntries(new FormData($('#f-meta'))));
  toast('Termina el inicio de sesión en tu navegador…');
  renderPages(await window.api.metaLogin());
  renderStatus(await window.api.getConfig()); toast('Conectado con Meta');
});
$('#wp-login').onclick = (e) => busy(e.target, async () => {
  await window.api.setConfig(Object.fromEntries(new FormData($('#f-wp'))));
  toast('Termina el inicio de sesión en tu navegador…');
  const name = await window.api.wpLogin();
  renderStatus(await window.api.getConfig()); toast('Conectado a ' + name); loadCategories();
});

async function loadCategories() {
  try {
    const cats = await window.api.wpCategories();
    $('#d-cats').innerHTML = cats.map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
  } catch { /* sin conexión todavía */ }
}

// Listado de publicaciones
const fileUrl = (p) => p && 'file:///' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23');
const fmtDate = (d) => new Date(d).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
function visiblePosts() {
  const q = $('#f-search').value.trim().toLowerCase();
  const show = $('#f-show').value;
  return posts.filter((p) => {
    if (q && !p.text.toLowerCase().includes(q)) return false;
    const done = !!exportOf(p);
    return show === 'all' || (show === 'done' ? done : !done);
  });
}

function renderFeed() {
  const list = visiblePosts();
  if (!rawPosts.length) { $('#feed').innerHTML = '<p class="hint">No hay publicaciones todavía.</p>'; return; }
  if (!list.length) { $('#feed').innerHTML = '<p class="hint">Ninguna publicación coincide con el filtro.</p>'; return; }
  $('#feed').innerHTML = '';
  for (const p of list) {
    const key = keyOf(p);
    const ex = exportOf(p);
    const card = document.createElement('div');
    card.className = 'post' + (selected.has(key) ? ' sel' : '') + (ex ? ' done' : '');
    const first = p.media.find((m) => m.type === 'image') || p.media[0];
    const thumb = first && (first.url || (first.type === 'image' ? fileUrl(first.path) : null));
    const badges = [p, ...(p.alsoOn || [])].map((x) => `<span class="badge ${x.source}">${x.source === 'instagram' ? 'IG' : 'FB'}</span>`).join(' ');
    card.innerHTML = `
      ${thumb ? `<img src="${escHtml(thumb)}" loading="lazy">` : '<div class="noimg">Sin imagen</div>'}
      ${ex ? '<span class="done-badge" title="Abrir la entrada en WordPress">✓ En el blog</span>' : ''}
      <div class="meta">${badges}
        ${fmtDate(p.date)}${p.media.length > 1 ? ` · ${p.media.length} archivos` : ''}${p.media.some((m) => m.type === 'video') ? ' · vídeo' : ''}</div>
      <p></p>`;
    card.querySelector('p').textContent = p.text.slice(0, 220) + (p.text.length > 220 ? '…' : '');
    if (ex) card.querySelector('.done-badge').onclick = (e) => { e.stopPropagation(); window.api.open(ex.editUrl); };
    card.onclick = () => {
      selected.has(key) ? selected.delete(key) : selected.add(key);
      card.classList.toggle('sel'); updateCount();
    };
    $('#feed').appendChild(card);
  }
}
function updateCount() {
  $('#sel-count').textContent = `${selected.size} seleccionada${selected.size === 1 ? '' : 's'}`;
  $('#make').disabled = selected.size === 0;
}

const metaSources = () => [$('#src-ig').checked && 'instagram', $('#src-fb').checked && 'facebook'].filter(Boolean);
const hasMore = () => cursors && (cursors.facebook || cursors.instagram);
$('#load').onclick = (e) => busy(e.target, async () => {
  const r = await window.api.metaPosts($('#page').value, metaSources());
  cursors = r.cursors;
  await addPosts(r.posts);
  toast(`${r.posts.length} publicaciones cargadas`);
});
$('#more').onclick = (e) => busy(e.target, async () => {
  const r = await window.api.metaPosts($('#page').value, metaSources(), cursors);
  cursors = r.cursors;
  await addPosts(r.posts);
});

// Añade publicaciones a la lista sin duplicar y recalcula la vista
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
  // La selección se queda solo con publicaciones visibles
  const valid = new Set(posts.map(keyOf));
  for (const k of [...selected]) if (!valid.has(k)) selected.delete(k);
  $('#more').classList.toggle('hidden', !hasMore());
  updateCount(); renderFeed();
}
$('#f-merge').onchange = async () => {
  format = (await window.api.setConfig({ format: { ...format, mergeDuplicates: $('#f-merge').checked } })).format;
  rebuildView();
};
$('#f-search').oninput = renderFeed;
$('#f-show').onchange = renderFeed;
$('#clear').onclick = () => { rawPosts = []; posts = []; cursors = null; selected.clear(); $('#more').classList.add('hidden'); updateCount(); renderFeed(); };

// Selector de origen
document.querySelectorAll('.sources button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.sources button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.src-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'src-' + b.dataset.src));
});

// ZIP de Meta
const importZip = (kind) => (e) => busy(e.target, async () => {
  const list = await window.api.importMetaExport(kind);
  if (list) { await addPosts(list); toast(`${list.length} publicaciones importadas`); }
});
$('#zip-file').onclick = importZip('file');
$('#zip-folder').onclick = importZip('folder');

// Capturas con IA
$('#shots-pick').onclick = (e) => busy(e.target, async () => {
  const files = await window.api.pickImages(false);
  if (!files) return;
  const post = await window.api.importScreenshots(files);
  await addPosts([post], true);
  toast(post.warning || `Publicación leída: ${post.media.length} foto(s). Ya está seleccionada.`, !!post.warning);
});

// Manual
let manualFiles = [];
$('#m-files').onclick = async () => {
  const files = await window.api.pickImages(true);
  if (files) { manualFiles = manualFiles.concat(files); $('#m-count').textContent = `${manualFiles.length} archivo(s)`; }
};
$('#m-add').onclick = async () => {
  if (!$('#m-text').value.trim() && !manualFiles.length) return toast('Escribe un texto o añade fotos', true);
  const post = await window.api.manualPost({
    text: $('#m-text').value, date: $('#m-date').value || null, source: $('#m-source').value,
    permalink: $('#m-link').value.trim() || null, files: manualFiles,
  });
  await addPosts([post], true);
  $('#m-text').value = ''; $('#m-link').value = ''; manualFiles = []; $('#m-count').textContent = '0 archivos';
  toast('Añadida a la lista y seleccionada');
};

// Borrador
$('#make').onclick = (e) => busy(e.target, async () => {
  const chosen = posts.filter((p) => selected.has(keyOf(p)));
  const already = chosen.filter(exportOf);
  if (already.length && !confirm(`${already.length === 1 ? 'Una de las publicaciones ya está' : already.length + ' publicaciones ya están'} en el blog. ¿Crear otra entrada de todos modos?`)) return;
  toast('Subiendo fotos a WordPress…');
  draft = await window.api.buildDraft(chosen);
  draftKeys = chosen.flatMap(keysOf);
  $('#sent').classList.add('hidden'); $('#send').classList.remove('hidden');
  $('#d-title').value = draft.title;
  $('#d-tags').value = draft.tags.join(', ');
  $('#d-status').value = format.status || 'draft';
  const defCats = (format.categories || '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean);
  for (const o of $('#d-cats').options) o.selected = defCats.includes(o.value.toLowerCase());
  $('#d-content').value = draft.content;
  $('#d-preview').innerHTML = draft.content;
  $('#editor').classList.remove('hidden');
  toast(draft.failed?.length ? `No se pudieron subir ${draft.failed.length} archivo(s): ${draft.failed[0]}` : 'Medios subidos a la biblioteca. Revisa la entrada.', !!draft.failed?.length);
});

$('#d-content').oninput = () => ($('#d-preview').innerHTML = $('#d-content').value);
$('#v-preview').onclick = () => { $('#d-preview').classList.remove('hidden'); $('#d-content').classList.add('hidden'); $('#v-preview').classList.add('active'); $('#v-code').classList.remove('active'); };
$('#v-code').onclick = () => { $('#d-content').classList.remove('hidden'); $('#d-preview').classList.add('hidden'); $('#v-code').classList.add('active'); $('#v-preview').classList.remove('active'); };

$('#send').onclick = (e) => busy(e.target, async () => {
  const res = await window.api.publish({
    ...draft,
    title: $('#d-title').value,
    content: $('#d-content').value,
    tags: $('#d-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    categories: [...$('#d-cats').selectedOptions].map((o) => o.value),
    status: $('#d-status').value,
    keepDate: $('#d-keepdate').checked,
    keys: draftKeys,
  });
  exported = res.exported;
  lastSent = res;
  $('#sent-text').textContent = $('#d-status').value === 'publish' ? '¡Entrada publicada!' : 'Borrador creado en WordPress.';
  $('#send').classList.add('hidden'); $('#sent').classList.remove('hidden');
  selected.clear(); updateCount(); renderFeed();
});
let lastSent = null;
$('#sent-edit').onclick = () => lastSent && window.api.open(lastSent.editUrl);
$('#sent-view').onclick = () => lastSent && window.api.open(lastSent.url);
$('#sent-close').onclick = () => $('#editor').classList.add('hidden');

// Actualizaciones
function renderUpdate(st) {
  $('#app-version').textContent = st.version || '–';
  const texts = {
    checking: 'Buscando actualizaciones…',
    latest: 'Tienes la última versión.',
    downloading: `Descargando la versión ${st.version}… ${st.percent || 0} %`,
    ready: `La versión ${st.version} está lista. Se instalará al cerrar Ecos, o ahora mismo si reinicias.`,
    error: `No se pudo comprobar si hay actualizaciones: ${st.message}`,
    unsupported: st.reason === 'portable'
      ? 'La versión portable no se actualiza sola. Instala Ecos con el instalador (Ecos-Setup) para recibir actualizaciones automáticas.'
      : 'Las actualizaciones solo funcionan en la versión instalada.',
  };
  $('#update-detail').textContent = texts[st.state] || '';
  const bar = ['downloading', 'ready'].includes(st.state);
  $('#update-bar').classList.toggle('hidden', !bar);
  $('#update-text').textContent = texts[st.state] || '';
  $('#update-install').classList.toggle('hidden', st.state !== 'ready');
}
window.api.onUpdate(renderUpdate);
window.api.onToast((m) => toast(m));
window.api.onConfigChanged((c) => renderStatus(c));
$('#update-install').onclick = () => window.api.installUpdate();
$('#update-check').onclick = async () => renderUpdate(await window.api.checkUpdate());

(async () => {
  window.api.updateStatus().then(renderUpdate).catch(() => {});
  const cfg = await window.api.getConfig();
  fillForms(cfg); renderStatus(cfg);
  format = cfg.format; exported = cfg.exported || {};
  fillFormat(format); renderMode(cfg.startMode);
  $('#f-merge').checked = format.mergeDuplicates !== false;
  if (cfg.metaConnected) window.api.metaAccounts().then(renderPages).catch((e) => toast(e.message, true));
  if (cfg.wpConnected) loadCategories();
})();

// --- Pestaña «Blog»: entradas y páginas de WordPress ----------------------------
const blog = { loaded: false, type: 'post', page: 1, per: 20, found: 0 };
const STATUS = { publish: 'Publicada', draft: 'Borrador', future: 'Programada', pending: 'Pendiente', private: 'Privada', trash: 'Papelera' };

async function loadBlog() {
  const list = $('#b-list');
  list.innerHTML = '<p class="hint pad">Cargando…</p>';
  try {
    const r = await window.api.blogList({ type: blog.type, status: $('#b-status').value, search: $('#b-search').value.trim(), page: blog.page, number: blog.per });
    blog.loaded = true; blog.found = r.found;
    renderBlog(r.items);
  } catch (e) {
    list.innerHTML = `<p class="hint pad">${escHtml(e.message)}</p>`;
  }
}

function renderBlog(items) {
  const list = $('#b-list');
  const pages = Math.max(1, Math.ceil(blog.found / blog.per));
  $('#b-info').textContent = `${blog.found} ${blog.type === 'page' ? 'páginas' : 'entradas'} · página ${blog.page} de ${pages}`;
  $('#b-prev').disabled = blog.page <= 1;
  $('#b-next').disabled = blog.page >= pages;
  if (!items.length) { list.innerHTML = '<p class="hint pad">No hay nada con estos filtros.</p>'; return; }
  list.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'b-row';
    const when = new Date(it.status === 'publish' || it.status === 'future' ? it.date : it.modified)
      .toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    row.innerHTML = `
      ${it.image ? `<img src="${escHtml(it.image)}" loading="lazy">` : '<div class="noimg">Sin imagen</div>'}
      <div>
        <div class="b-title"></div>
        <div class="b-meta"><span class="st ${it.status}">${STATUS[it.status] || it.status}</span>${when}${it.categories.length ? ' · ' + escHtml(it.categories.join(', ')) : ''}</div>
        <div class="b-ex"></div>
      </div>
      <div class="b-actions"></div>`;
    row.querySelector('.b-title').textContent = decodeEntities(it.title);
    row.querySelector('.b-ex').textContent = decodeEntities(it.excerpt);
    const actions = row.querySelector('.b-actions');
    const btn = (label, fn, cls = '') => {
      const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls;
      b.onclick = () => busy(b, fn); actions.appendChild(b);
    };
    if (it.status !== 'trash') btn('Editar', async () => window.api.open(await window.api.blogEditUrl(it.id, it.type)));
    if (it.status === 'publish') btn('Ver', async () => window.api.open(it.url));
    if (['draft', 'pending', 'private'].includes(it.status)) btn('Publicar', async () => {
      if (!confirm(`¿Publicar «${decodeEntities(it.title)}»? Será visible en la web.`)) return;
      await window.api.blogSetStatus(it.id, 'publish'); toast('Publicada'); loadBlog();
    }, 'primary');
    if (it.status === 'publish') btn('Pasar a borrador', async () => {
      if (!confirm(`¿Retirar «${decodeEntities(it.title)}» de la web y dejarla como borrador?`)) return;
      await window.api.blogSetStatus(it.id, 'draft'); toast('Ahora es un borrador'); loadBlog();
    });
    if (it.status === 'trash') btn('Restaurar como borrador', async () => {
      await window.api.blogSetStatus(it.id, 'draft'); toast('Restaurada como borrador'); loadBlog();
    });
    else btn('Papelera', async () => {
      if (!confirm(`¿Mover «${decodeEntities(it.title)}» a la papelera? Podrás recuperarla durante 30 días.`)) return;
      await window.api.blogTrash(it.id); toast('Movida a la papelera'); loadBlog();
    }, 'danger');
    list.appendChild(row);
  }
}
function decodeEntities(s) { const t = document.createElement('textarea'); t.innerHTML = s || ''; return t.value; }

document.querySelectorAll('#b-type button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('#b-type button').forEach((x) => x.classList.toggle('active', x === b));
  blog.type = b.dataset.type; blog.page = 1; loadBlog();
});
$('#b-status').onchange = () => { blog.page = 1; loadBlog(); };
let bSearchTimer;
$('#b-search').oninput = () => { clearTimeout(bSearchTimer); bSearchTimer = setTimeout(() => { blog.page = 1; loadBlog(); }, 400); };
$('#b-refresh').onclick = () => loadBlog();
$('#b-prev').onclick = () => { blog.page--; loadBlog(); };
$('#b-next').onclick = () => { blog.page++; loadBlog(); };
$('#b-new').onclick = async () => {
  const cfg = await window.api.getConfig();
  window.api.open(`https://wordpress.com/${blog.type === 'page' ? 'page' : 'post'}/${cfg.wpSite}`);
};
