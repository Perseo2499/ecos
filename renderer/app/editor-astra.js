// Ecos · Editor de entradas: «Diseño de la página (Astra)» y vista previa exacta con el tema. Sigue a app/editor-viewer.js y comparte su ámbito global.
// Los ajustes viajan en draft.astra = { layout, sidebar, transparent, hideTitle, hideImage, hideHeader, hideFooter } y se envían como metas
// de la entrada (complemento 1.4.0, ver wp-plugin/ecos/includes/theme.php); al abrir una entrada se leen de ahí.

// ¿El complemento instalado trae estas funciones (1.4.0 o posterior)?
const pluginAtLeast = (v) => {
  const have = String(CFG.ecosHelper?.installed ? CFG.ecosHelper.version || '' : '').split('.').map(Number);
  if (!have.length || have.some(Number.isNaN) || !CFG.ecosHelper?.installed) return false;
  const need = String(v).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (have[i] || 0) - (need[i] || 0); if (d) return d > 0; }
  return true;
};
const exactAvailable = () => CFG.wpMode === 'selfhosted' && pluginAtLeast('1.4.0');
const astraAvailable = () => exactAvailable() && !!window.ThemeUI?.isAstra();

const ASTRA_DEFAULT = () => ({ layout: '', sidebar: '', transparent: '', hideTitle: false, hideImage: false, hideHeader: false, hideFooter: false });

// Pinta la sección con lo que tiene el borrador (solo con Astra y el complemento 1.4.0)
function renderAstra() {
  const box = $('#d-astra');
  if (!box) return;
  const on = astraAvailable();
  box.classList.toggle('hidden', !on);
  if (!on) return;
  const a = { ...ASTRA_DEFAULT(), ...(draft?.astra || {}) };
  $$('[data-astra]', box).forEach((seg) => $$('button', seg).forEach((b) => b.classList.toggle('active', b.dataset.v === (a[seg.dataset.astra] || ''))));
  $$('[data-astra-flag]', box).forEach((c) => (c.checked = !!a[c.dataset.astraFlag]));
  const n = Object.entries(a).filter(([, v]) => v).length;
  $('#astra-sum').textContent = n ? t('{n} cambios', { n }) : '';
}
function setAstra(key, val) {
  draft.astra = { ...ASTRA_DEFAULT(), ...(draft.astra || {}), [key]: val };
  renderAstra();
  if (typeof autosaveSoon === 'function') autosaveSoon();
}
$$('#d-astra [data-astra] button').forEach((b) => (b.onclick = () => setAstra(b.parentElement.dataset.astra, b.dataset.v)));
$$('#d-astra [data-astra-flag]').forEach((c) => (c.onchange = () => setAstra(c.dataset.astraFlag, c.checked)));

// Al abrir el editor: carga los estilos de la web (colores, tamaños y fuentes) y enseña el panel de Astra si procede
async function loadWebStyles() {
  if (CFG.wpMode !== 'selfhosted' || !CFG.wpConnected) { renderAstra(); return; }
  try { await window.ThemeUI.load(false); } catch { /* sin conexión: colores de serie */ }
  renderAstra();
}

// ---------------------------------------------------------------- Vista previa exacta (con tu tema)
// La página completa (cabecera, menú, pie y estilos) la pinta WordPress con el contenido sin guardarlo; va en un iframe aislado
// (sin scripts y sin entrar en tu web). Si no hay complemento 1.4.0, se queda la vista rápida de siempre.
let pvQuick = null; // () => abre la vista rápida
async function openExactPreview() {
  const { html } = await window.api.renderExact(draftPayload('draft'));
  const fr = $('#pv-frame');
  fr.setAttribute('sandbox', ''); // sin scripts, sin acceso a Ecos, sin salir de la página
  fr.srcdoc = html;
  fr.onload = null;
  $('#pv-web').classList.remove('hidden');
  $('#pv-modal').classList.remove('hidden');
}
function setPvMode(mode) {
  $$('#pv-mode button').forEach((b) => b.classList.toggle('active', b.dataset.m === mode));
}
$$('#pv-mode button').forEach((b) => (b.onclick = () => busy(b, async () => {
  if (b.dataset.m === 'exact') { await openExactPreview(); setPvMode('exact'); } else { await pvQuick(); setPvMode('quick'); }
})));
