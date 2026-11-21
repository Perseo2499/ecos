// Ecos · Pantalla «Ajustes» y asistente de primera configuración.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

// ---------------------------------------------------------------- Ajustes
function applyPrefs() {
  const p = prefs();
  const dark = p.theme === 'dark' || (p.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark || p.vinyl ? 'dark' : 'light';
  window.Vinyl?.apply({ vinyl: !!p.vinyl, silk: p.silk !== false });
  $('#s-optphotos').checked = p.optimizePhotos !== false;
  $('#s-vinyl').checked = !!p.vinyl; $('#s-silk').checked = p.silk !== false;
  $('#s-silk-row').classList.toggle('hidden', !p.vinyl);
  $$('#s-theme button, #s-accent button, #s-accent-custom').forEach((b) => (b.disabled = !!p.vinyl));
  document.documentElement.style.setProperty('--accent', p.accent);
  document.documentElement.style.setProperty('--card-min', p.cards + 'px');
  window.api.setZoom(Number(p.zoom) || 1);
  for (const [id, v] of [['#s-theme', p.theme], ['#s-zoom', String(p.zoom)], ['#s-cards', String(p.cards)], ['#s-accent', p.accent]]) $$(id + ' button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
  $('#s-lang').value = p.lang;
  renderAiOpts();
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
$('#s-vinyl').onchange = () => savePrefs({ vinyl: $('#s-vinyl').checked });
$('#s-optphotos').onchange = () => savePrefs({ optimizePhotos: $('#s-optphotos').checked });
$('#s-silk').onchange = () => savePrefs({ silk: $('#s-silk').checked });
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
  if (typeof renderBlockTemplates === 'function') renderBlockTemplates();
}
// Plantillas de contenido propias (bloques): renombrar y borrar. Se crean desde el editor («Guardar como plantilla»)
function renderBlockTemplates() {
  const list = $('#btpl-list');
  if (!list) return;
  const tpls = CFG.blockTemplates || [];
  list.innerHTML = tpls.length ? '' : `<p class="hint">${t('Todavía no has guardado ninguna.')}</p>`;
  tpls.forEach((tp, i) => {
    const row = document.createElement('div');
    row.className = 'btpl';
    row.innerHTML = `<span class="ms">${tp.type === 'page' ? 'description' : 'article'}</span>
      <input maxlength="60" aria-label="${t('Nombre')}"><small>${t('{n} bloques', { n: (tp.blocks || []).length })} · ${tp.type === 'page' ? t('Página') : t('Entrada')}</small>
      <button class="btn text icon-only danger" title="${t('Borrar plantilla')}"><span class="ms">delete</span></button>`;
    const inp = row.querySelector('input'); inp.value = tp.name || '';
    inp.onchange = async () => {
      const name = inp.value.trim().slice(0, 60);
      if (!name) { inp.value = tp.name; return; }
      const next = (CFG.blockTemplates || []).map((x, k) => (k === i ? { ...x, name } : x));
      CFG = await window.api.setConfig({ blockTemplates: next }); toast(t('Plantillas guardadas'));
    };
    row.querySelector('button').onclick = async () => {
      CFG = await window.api.setConfig({ blockTemplates: (CFG.blockTemplates || []).filter((_, k) => k !== i) });
      renderBlockTemplates();
    };
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
  if (!await ask(t('Ecos dejará de marcar publicaciones como «En el blog». Las entradas de tu web no se tocan. ¿Continuar?'))) return;
  exported = await window.api.clearExported(); renderFeed(); toast(t('Hecho'));
};
$('#reset-all').onclick = async () => {
  if (!await ask(t('Se borrarán todas las conexiones, claves, ajustes y plantillas de Ecos en este ordenador. Tu blog y tus redes no se tocan. ¿Continuar?'), { danger: true })) return;
  if (!await ask(t('¿Seguro? Esta acción no se puede deshacer. Si quieres, exporta antes una copia de seguridad.'), { danger: true })) return;
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
$('#wz-next').onclick = async () => {
  if (wzStep === 1 && !CFG.metaConnected && !await ask(t('Todavía no has conectado Meta. ¿Seguir de todos modos?'))) return;
  if (wzStep === 2 && !CFG.wpConnected && !await ask(t('Todavía no has conectado WordPress. Sin él no se pueden crear entradas. ¿Seguir de todos modos?'))) return;
  if (wzStep === 3) { closeWizard(true); showTab('posts'); return; }
  wzStep++; renderWizard();
};
$('#wz-back').onclick = () => { wzStep--; renderWizard(); };
$('#wz-skip').onclick = () => closeWizard(true);
$('#wz-import').onclick = (e) => busy(e.target, async () => { if (await doImport()) { wzStep = 1; renderWizard(); } });
$('#open-wizard').onclick = () => openWizard();
