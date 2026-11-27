// Ecos · Novedades de la versión, historial de versiones (Ajustes → Actualizaciones) y tarjeta «Novedades» tras actualizar.
// Los datos y el cálculo están en renderer/changelog.js (global Changelog).
const CL_ICONS = { new: 'add_circle', improved: 'trending_up', fixed: 'build', web: 'language' };
const clLabel = (s) => ({ new: t('Nuevo'), improved: t('Mejorado'), fixed: t('Corregido'), web: t('Para tu web') }[s]);
const clLang = () => (window.I18N.lang === 'en' ? 'en' : 'es');
let clInstalledVer = null;
const clFilter = new Set(); // secciones activas (vacío = todas)
let clOpenAll = false;

// «hace 3 días» / «3 days ago» y fecha completa
function clDates(iso) {
  const d = new Date(iso + 'T12:00:00');
  const abs = d.toLocaleDateString(clLang() === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  const rtf = new Intl.RelativeTimeFormat(clLang(), { numeric: 'auto' });
  let rel;
  if (Math.abs(days) < 30) rel = rtf.format(days, 'day');
  else if (Math.abs(days) < 365) rel = rtf.format(Math.round(days / 30), 'month');
  else rel = rtf.format(Math.round(days / 365), 'year');
  return { abs, rel };
}

// Lista de cambios agrupada por sección (acepta una entrada o la unión de varias)
function clSectionsHtml(src, { only, q, versions } = {}) {
  const lang = clLang(); let html = ''; let webShown = false;
  for (const s of Changelog.SECTIONS) {
    if (only && only.size && !only.has(s)) continue;
    let items = src[s] || [];
    if (q) items = items.filter((it) => Changelog.pick(it, lang).toLowerCase().includes(q));
    if (!items.length) continue;
    if (s === 'web') webShown = true;
    html += `<div class="cl-sec cl-${s}"><h4><span class="ms fill" aria-hidden="true">${CL_ICONS[s]}</span>${escHtml(clLabel(s))}</h4><ul>` +
      items.map((it) => `<li>${escHtml(Changelog.pick(it, lang))}${versions && it.version ? ` <span class="cl-v">${escHtml(it.version)}</span>` : ''}</li>`).join('') + '</ul></div>';
  }
  if (src.plugin && webShown) html += `<p class="cl-plugin"><span class="ms" aria-hidden="true">extension</span>${escHtml(t('Complemento de WordPress: versión {v}', { v: src.plugin }))}</p>`;
  return html;
}

async function clInstalled() {
  if (clInstalledVer) return clInstalledVer;
  try { clInstalledVer = (await window.api.appInfo()).version || null; } catch { /* sin versión */ }
  return clInstalledVer;
}
// La entrada de la versión instalada (o, si no tiene, la más reciente que no la supere)
const clCurrentEntry = (v) => Changelog.entryFor(v) || Changelog.ENTRIES.find((e) => Changelog.compareVersions(e.version, v) <= 0) || Changelog.ENTRIES[0];

function clRenderList() {
  const q = $('#cl-q').value.trim().toLowerCase(); const lang = clLang();
  const box = $('#cl-list'); const openNow = new Set($$('details[open]', box).map((d) => d.dataset.v));
  const first = !box.children.length;
  box.innerHTML = '';
  let shown = 0;
  for (const e of Changelog.ENTRIES) {
    const body = clSectionsHtml(e, { only: clFilter, q });
    const titleHit = q && !clFilter.size && (Changelog.pick(e.title, lang).toLowerCase().includes(q) || Changelog.label(e).includes(q));
    if (!body && !titleHit) continue;
    shown++;
    const full = body || clSectionsHtml(e);
    const { abs, rel } = clDates(e.date);
    const cur = clInstalledVer && Changelog.compareVersions(e.version, clInstalledVer) === 0;
    const d = document.createElement('details');
    d.className = 'cl-item' + (cur ? ' cur' : ''); d.dataset.v = e.version;
    d.open = clOpenAll || !!q || clFilter.size > 0 || (!first && openNow.has(e.version));
    d.innerHTML = `<summary><span class="cl-ver">${escHtml(Changelog.label(e))}</span>${cur ? `<span class="cl-badge">${escHtml(t('Instalada'))}</span>` : ''}<span class="cl-title">${escHtml(Changelog.pick(e.title, lang))}</span><span class="cl-date" title="${escHtml(abs)}">${escHtml(rel)} · ${escHtml(abs)}</span><span class="ms cl-chev" aria-hidden="true">expand_more</span></summary><div class="cl-body">${full}</div>`;
    box.appendChild(d);
  }
  $('#cl-empty').classList.toggle('hidden', shown > 0);
  $('#cl-toggle').textContent = clOpenAll ? t('Plegar todo') : t('Desplegar todo');
}

function clRenderNow() {
  if (!clInstalledVer) return;
  const e = clCurrentEntry(clInstalledVer); const { abs, rel } = clDates(e.date);
  $('#cl-now').innerHTML = `<div class="cl-now-top"><span class="cl-ver big">${escHtml(Changelog.label(e))}</span><span class="cl-badge">${escHtml(t('Instalada'))}</span><span class="cl-title">${escHtml(Changelog.pick(e.title, clLang()))}</span><span class="cl-date">${escHtml(rel)} · ${escHtml(abs)}</span></div>${clSectionsHtml(e)}`;
}

function clRenderFilters() {
  const box = $('#cl-filters'); box.innerHTML = '';
  for (const s of Changelog.SECTIONS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip' + (clFilter.has(s) ? ' active' : ''); b.dataset.s = s; b.setAttribute('aria-pressed', clFilter.has(s));
    b.innerHTML = `<span class="ms" aria-hidden="true">${CL_ICONS[s]}</span>${escHtml(clLabel(s))}`;
    b.onclick = () => { clFilter.has(s) ? clFilter.delete(s) : clFilter.add(s); clRenderFilters(); clRenderList(); };
    box.appendChild(b);
  }
}

// Actualización descargada o disponible: qué trae (changelog propio si ya lo conocemos; si no, notas de la release o enlace)
function clNotesText(html) {
  return String(html || '').replace(/<\s*br\s*\/?>|<\/(p|li|h\d|div)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40);
}
function clRenderIncoming(st) {
  const box = $('#cl-incoming'); if (!box) return;
  const v = st && ['waiting', 'downloading', 'ready'].includes(st.state) ? st.version : null;
  if (!v || !clInstalledVer || Changelog.compareVersions(v, clInstalledVer) <= 0) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const known = Changelog.entryFor(v);
  let body;
  if (known) { const list = Changelog.changesSince(clInstalledVer, v); body = clSectionsHtml(Changelog.merge(list), { versions: list.length > 1 }); }
  else {
    const lines = clNotesText(st.notes);
    body = lines.length ? `<ul class="cl-notes">${lines.map((l) => `<li>${escHtml(l)}</li>`).join('')}</ul>` : `<p class="hint">${escHtml(t('Todavía no tenemos el detalle de esta versión dentro de Ecos.'))}</p>`;
    body += `<button type="button" class="btn text" id="cl-rel">${escHtml(t('Ver la versión en GitHub'))}</button>`;
  }
  box.innerHTML = `<h3 class="cl-h"><span class="ms fill" aria-hidden="true">rocket_launch</span>${escHtml(t('Qué trae la {v}', { v }))}</h3>${body}`;
  const rel = $('#cl-rel', box); if (rel) rel.onclick = () => window.api.open('https://github.com/Perseo2499/ecos/releases/tag/v' + v);
  box.classList.remove('hidden');
}

async function clUpdate(st) { await clInstalled(); clRenderIncoming(st); }

async function initChangelogUi() {
  await clInstalled();
  clRenderFilters(); clRenderNow(); clRenderList();
  $('#cl-q').oninput = clRenderList;
  $('#cl-toggle').onclick = () => { clOpenAll = !clOpenAll; $$('#cl-list details').forEach((d) => (d.open = clOpenAll)); $('#cl-toggle').textContent = clOpenAll ? t('Plegar todo') : t('Desplegar todo'); };
}
function clRefreshTexts() { if (!clInstalledVer) return; clRenderFilters(); clRenderNow(); clRenderList(); }

// ---------------------------------------------------------------- tarjeta tras actualizar
const CL_LEGACY_BASE = '3.4.1'; // última versión antes de existir esta función: quien ya usaba Ecos parte de ella
async function maybeShowWhatsNew() {
  const cur = await clInstalled(); if (!cur) return;
  const seen = CFG.lastSeenVersion;
  if (seen === cur) return;
  const base = seen || (CFG.wizardDone ? CL_LEGACY_BASE : null);
  await window.api.setConfig({ lastSeenVersion: cur }).catch(() => {});
  if (!base || Changelog.compareVersions(cur, base) <= 0) return; // primera instalación: solo se guarda
  const list = Changelog.changesSince(base, cur);
  if (list.length) showWhatsNew(list, cur);
}
function showWhatsNew(list, cur) {
  const prev = document.activeElement; const many = list.length > 1;
  const d = document.createElement('div'); d.className = 'modal cl-modal';
  d.innerHTML = `<div class="modal-box wide" role="dialog" aria-modal="true" aria-labelledby="cl-dlg-h"><span class="ms fill modal-icon" aria-hidden="true">auto_awesome</span>
    <h2 id="cl-dlg-h" style="margin-bottom:4px">${escHtml(t('Novedades de Ecos {v}', { v: cur }))}</h2>
    <p class="hint">${escHtml(many ? t('Esto ha cambiado desde la última versión que usaste ({n} versiones).', { n: list.length }) : t('Esto ha cambiado desde la última versión que usaste.'))}</p>
    <div class="cl-dlg-body">${clSectionsHtml(Changelog.merge(list), { versions: many })}</div>
    <div class="modal-actions"><button class="btn text" id="cl-all">${escHtml(t('Ver todo el historial'))}</button><button class="btn filled" id="cl-close">${escHtml(t('Cerrar'))}</button></div></div>`;
  const close = () => { d.remove(); document.removeEventListener('keydown', key, true); prev?.focus?.(); };
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') { const f = $$('button', d); const i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
  };
  document.addEventListener('keydown', key, true);
  $('#cl-close', d).onclick = close;
  $('#cl-all', d).onclick = () => { close(); document.querySelector('[data-tab="settings"]')?.click(); setTimeout(() => $('#cl-hist-h')?.scrollIntoView({ block: 'start' }), 80); };
  d.addEventListener('mousedown', (e) => { if (e.target === d) close(); });
  document.body.appendChild(d); $('#cl-close', d).focus();
}
