// Ecos · Pantalla «Conexiones»: desplegables, Meta, WordPress y selector de IA.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

// ---------------------------------------------------------------- Conexiones en desplegables
// Lista de conexiones, una encima de otra y a todo el ancho. Empiezan cerradas; cada una se abre o se cierra
// pulsando su nombre o su flecha. Se recuerda lo que dejó abierto cada persona.
const CONN = { 'f-meta': () => CFG.metaConnected, 'f-wp': () => CFG.wpConnected, 'f-gp': () => CFG.gpConnected, 'ai-card': () => CFG.aiConfigured, 'dev-card': null };
let connOpen = null;
try { connOpen = JSON.parse(localStorage.getItem('ecos-conn-open') || 'null'); } catch { /* sin almacenamiento */ }
function renderConnStates() {
  for (const [id, ok] of Object.entries(CONN)) {
    const card = document.getElementById(id);
    if (!card) continue;
    const head = $('.card-head', card);
    if (!head.querySelector('.conn-arrow')) {
      head.insertAdjacentHTML('beforeend', '<span class="conn-state"></span><button type="button" class="conn-arrow" title=""><svg viewBox="0 0 1 1" width="18" height="18"><circle cx=".14" cy=".34" r=".08"/><circle cx=".32" cy=".5" r=".08"/><circle cx=".5" cy=".66" r=".08"/><circle cx=".68" cy=".5" r=".08"/><circle cx=".86" cy=".34" r=".08"/></svg></button>');
      const name = $('h2', head);
      name.classList.add('conn-name'); name.tabIndex = 0; name.setAttribute('role', 'button');
      const toggle = () => {
        // despliegue suave: se anima la altura de la tarjeta (y el contenido aparece deslizándose)
        const opening = card.classList.contains('collapsed');
        const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const from = card.offsetHeight;
        card.classList.toggle('collapsed');
        const to = card.offsetHeight;
        if (!still && card.animate) {
          card.getAnimations().forEach((x) => x.cancel());
          if (!opening) card.classList.remove('collapsed'); // al cerrar, el contenido se ve hasta que termina
          card.style.overflow = 'hidden';
          const ease = 'cubic-bezier(.2, 0, 0, 1)';
          const anim = card.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: opening ? 380 : 280, easing: ease });
          const body = [...card.children].filter((c) => !c.classList.contains('card-head'));
          body.forEach((c, i) => c.animate(opening
            ? [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }]
            : [{ opacity: 1 }, { opacity: 0 }], { duration: opening ? 320 : 180, delay: opening ? Math.min(i, 6) * 25 : 0, easing: ease, fill: 'backwards' }));
          anim.onfinish = anim.oncancel = () => { card.style.overflow = ''; if (!opening) card.classList.add('collapsed'); };
        }
        connOpen = connOpen || {};
        connOpen[id] = opening;
        try { localStorage.setItem('ecos-conn-open', JSON.stringify(connOpen)); } catch { /* nada */ }
      };
      $('.conn-arrow', head).onclick = toggle;
      name.onclick = toggle;
      name.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
      card.classList.toggle('collapsed', !(connOpen && connOpen[id]));
    }
    $('.conn-arrow', head).title = card.classList.contains('collapsed') ? t('Abrir') : t('Cerrar');
    const st = $('.conn-state', head);
    if (!ok) { st.textContent = ''; continue; }
    const done = !!ok();
    st.className = 'conn-state ' + (done ? 'ok' : 'off');
    st.textContent = done ? (id === 'ai-card' ? t('Lista') : t('Conectado')) : (id === 'ai-card' ? t('Sin configurar') : t('No conectado'));
  }
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
  if (typeof fillGPhotos === 'function') fillGPhotos();
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
  // los botones de IA del editor se activan en cuanto hay una IA lista (sin reiniciar la app)
  if (A.configured !== undefined) {
    CFG.aiConfigured = A.configured;
    renderConnStates();
    $$('#ai-article, #ai-alts').forEach((b) => { b.disabled = !CFG.aiConfigured; b.parentElement.title = CFG.aiConfigured ? '' : t('Configura una IA en «Conexiones» para usar estos botones.'); });
  }
  aiSel = A.active;
  const act = A.providers[A.active];
  const CLI_NAMES = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' };
  $('#ai-current').textContent = !act ? '' : act.cli
    ? `${act.name} · ${CLI_NAMES[act.tool] || t('elige una CLI')}${act.model ? ' · ' + act.model : ''}`
    : `${act.name} · ${act.model || act.defaultModel || t('sin modelo')}${act.needsKey && !act.hasKey ? ' · ' + t('sin clave') : ''}`;
  $('#ai-providers').innerHTML = '';
  for (const [id, p] of Object.entries(A.providers)) {
    if (p.cli && !prefs().devMode && id !== aiSel) continue; // la CLI local solo con el modo desarrollador
    const row = document.createElement('label');
    row.className = 'ai-prov' + (id === aiSel ? ' sel active' : '');
    row.innerHTML = `<input type="radio" name="ai-prov" ${id === aiSel ? 'checked' : ''}>
      ${p.cli ? '<span class="ai-logo cli-logo"><span class="ms">terminal</span></span>' : `<img class="ai-logo" src="${logoOf(id)}" alt="">`}
      <span class="ai-name">${escHtml(p.name)}</span>
      ${p.hasKey || !p.needsKey ? `<span class="ai-ok" title="${t('Clave guardada')}"></span>` : ''}`;
    row.querySelector('input').onchange = async () => { CFG.ai = await window.api.aiSetActive(id); renderAi(); };
    $('#ai-providers').appendChild(row);
  }
  const p = A.providers[aiSel];
  // CLI local: se elige la herramienta en lugar de URL y clave
  $('#ai-cli').classList.toggle('hidden', !p.cli);
  $$('#ai-url, #ai-key, .ai-key-actions').forEach((x) => x.classList.toggle('hidden', !!p.cli));
  $$('#ai-cli-tools button').forEach((b) => b.classList.toggle('active', b.dataset.tool === p.tool));
  $('#ai-model').placeholder = p.cli ? t('Modelo (opcional: si lo dejas vacío, usa el de la CLI)') : t('Nombre del modelo');
  $('#ai-url').value = p.url; $('#ai-url').placeholder = t('URL personalizada (opcional)');
  $('#ai-url').title = p.defaultBase || '';
  $('#ai-key').value = '';
  $('#ai-key').placeholder = !p.needsKey ? t('No hace falta clave') : p.hasKey ? '•••••• ' + t('(guardada) — pega otra para cambiarla') : t('Pega aquí la clave de {p}', { p: p.name });
  $('#ai-key').disabled = !p.needsKey;
  $('#ai-remove').classList.toggle('hidden', !p.hasKey);
  $('#ai-model').value = p.model || p.defaultModel || '';
  $('#ai-instructions').value = CFG.aiInstructions || '';
}
$$('#ai-cli-tools button').forEach((b) => (b.onclick = async () => {
  if (b.disabled) return;
  CFG.ai = await window.api.aiSave('cli', { tool: b.dataset.tool });
  if (CFG.ai.active !== 'cli') CFG.ai = await window.api.aiSetActive('cli');
  $('#ai-model-list').innerHTML = (await window.api.aiModels('cli').catch(() => [])).map((m) => `<option value="${escHtml(m)}">`).join('');
  renderAi(); toast(t('Los botones de IA usarán {c}. Pulsa «Probar» para comprobarlo.', { c: b.textContent.trim() }));
}));
$('#ai-save').onclick = (e) => busy(e.target, async () => {
  CFG.ai = await window.api.aiSave(aiSel, { key: $('#ai-key').value, url: $('#ai-url').value, model: $('#ai-model').value });
  if (CFG.ai.active !== aiSel) CFG.ai = await window.api.aiSetActive(aiSel);
  renderAi(); toast(t('Guardado'));
});
$('#ai-remove').onclick = async () => {
  if (!await ask(t('¿Quitar la clave guardada de {p}?', { p: CFG.ai.providers[aiSel].name }), { danger: true })) return;
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
  catch (err) { $('#ai-test-status').textContent = friendlyError(err).text; $('#ai-test-status').className = 'err-text'; }
});
$('#ai-instr-save').onclick = async () => { CFG = await window.api.setConfig({ aiInstructions: $('#ai-instructions').value }); toast(t('Guardado')); };
