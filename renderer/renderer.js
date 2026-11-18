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
  for (const f of ['#f-meta', '#f-wp']) for (const el of $(f).elements) if (el.name) el.value = cfg[el.name] || '';
}

for (const f of ['#f-meta', '#f-wp']) $(f).onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const cfg = await window.api.setConfig(data); renderStatus(cfg); toast('Guardado');
};

function renderPages(accs) {
  $('#page').innerHTML = accs.map((a) => `<option value="${a.pageId}">${a.pageName}${a.igUser ? ' · @' + a.igUser : ' (sin Instagram)'}</option>`).join('');
}

$('#meta-login').onclick = (e) => busy(e.target, async () => {
  await window.api.setConfig(Object.fromEntries(new FormData($('#f-meta'))));
  renderPages(await window.api.metaLogin());
  renderStatus(await window.api.getConfig()); toast('Conectado con Meta');
});
$('#wp-login').onclick = (e) => busy(e.target, async () => {
  await window.api.setConfig(Object.fromEntries(new FormData($('#f-wp'))));
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
const fmtDate = (d) => new Date(d).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
function renderFeed() {
  if (!posts.length) { $('#feed').innerHTML = '<p class="hint">No hay publicaciones.</p>'; return; }
  $('#feed').innerHTML = '';
  for (const p of posts) {
    const key = p.source + ':' + p.id;
    const card = document.createElement('div');
    card.className = 'post' + (selected.has(key) ? ' sel' : '');
    const thumb = p.media[0]?.url;
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
  posts = await window.api.metaPosts($('#page').value, sources);
  selected.clear(); updateCount(); renderFeed();
});

// Borrador
$('#make').onclick = (e) => busy(e.target, async () => {
  const chosen = posts.filter((p) => selected.has(p.source + ':' + p.id));
  draft = await window.api.buildDraft(chosen);
  $('#d-title').value = draft.title;
  $('#d-tags').value = draft.tags.join(', ');
  $('#d-content').value = draft.content;
  $('#d-preview').innerHTML = draft.content;
  $('#editor').classList.remove('hidden');
  toast('Imágenes subidas a la biblioteca de medios. Revisa la entrada.');
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

(async () => {
  const cfg = await window.api.getConfig();
  fillForms(cfg); renderStatus(cfg);
  if (cfg.metaConnected) window.api.metaAccounts().then(renderPages).catch((e) => toast(e.message, true));
  if (cfg.wpConnected) loadCategories();
})();
