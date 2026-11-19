const $ = (s) => document.querySelector(s);
let posts = [];
let draft = null;
const selected = new Set();

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
function renderFeed() {
  if (!posts.length) { $('#feed').innerHTML = '<p class="hint">No hay publicaciones.</p>'; return; }
  $('#feed').innerHTML = '';
  for (const p of posts) {
    const key = p.source + ':' + p.id;
    const card = document.createElement('div');
    card.className = 'post' + (selected.has(key) ? ' sel' : '');
    const first = p.media.find((m) => m.type === 'image') || p.media[0];
    const thumb = first && (first.url || (first.type === 'image' ? fileUrl(first.path) : null));
    card.innerHTML = `
      ${thumb ? `<img src="${thumb}">` : '<div class="noimg">Sin imagen</div>'}
      <div class="meta"><span class="badge ${p.source}">${p.source === 'instagram' ? 'IG' : 'FB'}</span>
        ${fmtDate(p.date)}${p.media.length > 1 ? ` · ${p.media.length} archivos` : ''}${p.media.some((m) => m.type === 'video') ? ' · vídeo' : ''}</div>
      <p></p>`;
    card.querySelector('p').textContent = p.text.slice(0, 220) + (p.text.length > 220 ? '…' : '');
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

$('#load').onclick = (e) => busy(e.target, async () => {
  const sources = [$('#src-ig').checked && 'instagram', $('#src-fb').checked && 'facebook'].filter(Boolean);
  addPosts(await window.api.metaPosts($('#page').value, sources));
});

// Añade publicaciones a la lista sin duplicar
function addPosts(list, select = false) {
  const have = new Set(posts.map((p) => p.source + ':' + p.id));
  for (const p of list) {
    const key = p.source + ':' + p.id;
    if (!have.has(key)) posts.push(p);
    if (select) selected.add(key);
  }
  posts.sort((a, b) => new Date(b.date) - new Date(a.date));
  updateCount(); renderFeed();
}
$('#clear').onclick = () => { posts = []; selected.clear(); updateCount(); $('#feed').innerHTML = '<p class="hint">Lista vacía.</p>'; };

// Selector de origen
document.querySelectorAll('.sources button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.sources button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.src-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'src-' + b.dataset.src));
});

// ZIP de Meta
const importZip = (kind) => (e) => busy(e.target, async () => {
  const list = await window.api.importMetaExport(kind);
  if (list) { addPosts(list); toast(`${list.length} publicaciones importadas`); }
});
$('#zip-file').onclick = importZip('file');
$('#zip-folder').onclick = importZip('folder');

// Capturas con IA
$('#shots-pick').onclick = (e) => busy(e.target, async () => {
  const files = await window.api.pickImages(false);
  if (!files) return;
  const post = await window.api.importScreenshots(files);
  addPosts([post], true);
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
  addPosts([post], true);
  $('#m-text').value = ''; $('#m-link').value = ''; manualFiles = []; $('#m-count').textContent = '0 archivos';
  toast('Añadida a la lista y seleccionada');
};

// Borrador
$('#make').onclick = (e) => busy(e.target, async () => {
  const chosen = posts.filter((p) => selected.has(p.source + ':' + p.id));
  draft = await window.api.buildDraft(chosen);
  $('#d-title').value = draft.title;
  $('#d-tags').value = draft.tags.join(', ');
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
  });
  toast('¡Entrada creada! Abriendo el editor de WordPress…');
  window.api.open(res.editUrl);
});

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
  if (cfg.metaConnected) window.api.metaAccounts().then(renderPages).catch((e) => toast(e.message, true));
  if (cfg.wpConnected) loadCategories();
})();
