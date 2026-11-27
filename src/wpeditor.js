// Editor de WordPress dentro de Ecos: la parte de datos (sin ventanas, así se prueba con `node --test`).
// Para editar con el editor oficial (Gutenberg) un bloque de otro plugin (Spectra, Kadence…) Ecos crea un borrador TEMPORAL con el
// contenido de ese bloque, lo abre en una ventana propia (src/wpeditorwin.js), lee el resultado y borra el borrador.
// Para la entrada completa no hace falta borrador: se abre su propio post.php.
const crypto = require('crypto');

const TEMP_TITLE = 'Ecos · edición temporal';
const SLUG_PREFIX = 'ecos-temp-';
const ORPHAN_AGE_MS = 10 * 60 * 1000; // un temporal más viejo que esto, sin ventana que lo use, es un resto de un cierre brusco

const versionLess = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0; }
  return false;
};
// ¿Esta versión del complemento trae la dirección de un solo uso? (≥ 1.6.0)
const helperHasEditor = (version) => !!version && !versionLess(version, '1.6.0');

const origin = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).origin; } catch { return ''; } };
const hostKey = (h) => String(h || '').toLowerCase().replace(/^www\./, '');

// Dirección del editor de una entrada o página (relativa a wp-admin) y la completa
const targetFor = (postId) => `post.php?post=${Math.floor(Number(postId))}&action=edit`;
function adminUrl(siteOrigin, target) {
  if (!/^(post\.php\?post=\d+&action=edit|post-new\.php(\?post_type=page)?)$/.test(target)) throw new Error('Destino no permitido');
  return `${siteOrigin}/wp-admin/${target}`;
}

// ¿Se puede navegar a esta dirección dentro de la ventana del editor? Solo http(s) y el dominio de la web
function inScope(url, siteOrigin) {
  try {
    const u = new URL(url), s = new URL(siteOrigin);
    return /^https?:$/.test(u.protocol) && hostKey(u.hostname) === hostKey(s.hostname);
  } catch { return false; }
}

// La dirección de un solo uso que da el complemento: admin-post.php?action=ecos_editor&t=… de la propia web
function validOneTime(url, siteOrigin) {
  try {
    const u = new URL(url);
    return u.origin === new URL(siteOrigin).origin && /\/wp-admin\/admin-post\.php$/.test(u.pathname) && u.searchParams.get('action') === 'ecos_editor' && /^[a-f0-9]{64}$/.test(u.searchParams.get('t') || '');
  } catch { return false; }
}
// Dirección para abrir el editor: con el complemento ≥ 1.6, la de un solo uso (entra sin pedir contraseña); si no (o si falla),
// la normal de wp-admin y la persona inicia sesión una vez (queda recordada en la partición de la ventana).
async function sessionUrl(W, cfg, target, helperVersion) {
  const site = W.publicBase(cfg);
  const plain = adminUrl(site, target);
  if (!helperHasEditor(helperVersion)) return { url: plain, oneTime: false };
  try {
    const r = await W.request(cfg, '/ecos/v1/editor-session', { method: 'POST', json: { target } });
    if (r && validOneTime(r.url, site)) return { url: r.url, oneTime: true };
  } catch { /* se abre wp-admin normal */ }
  return { url: plain, oneTime: false };
}

// --- Borrador temporal -----------------------------------------------------------------------------------------------------
const isTemp = (p) => !!p && String(p.slug || '').startsWith(SLUG_PREFIX);
async function createTemp(W, cfg, content = '') {
  const slug = SLUG_PREFIX + crypto.randomBytes(5).toString('hex');
  const p = await W.request(cfg, '/wp/v2/posts?context=edit', { method: 'POST', json: { title: TEMP_TITLE, slug, status: 'draft', content: String(content || '') } });
  if (!p || !Number.isInteger(p.id)) throw new Error('WordPress no creó el borrador temporal');
  return { id: p.id, slug };
}
async function readContent(W, cfg, id) {
  const p = await W.request(cfg, `/wp/v2/posts/${Number(id)}?context=edit&_fields=id,content,modified_gmt`);
  const c = p?.content;
  return { content: typeof c === 'string' ? c : String(c?.raw ?? ''), modified: p?.modified_gmt || '' };
}
// Borrado definitivo. Nunca lanza: devuelve true si el borrador ya no existe
async function deleteTemp(W, cfg, id) {
  try { await W.request(cfg, `/wp/v2/posts/${Number(id)}?force=true`, { method: 'DELETE' }); return true; }
  catch (e) { return /no existe|invalid post id|ID de entrada|rest_post_invalid_id|no encontrad/i.test(e.message || ''); }
}
// Al arrancar: borra los borradores temporales que quedaron (cierre brusco). Solo los marcados y con más de `minAgeMs`
async function cleanupOrphans(W, cfg, { now = Date.now(), minAgeMs = ORPHAN_AGE_MS } = {}) {
  let list;
  try { list = await W.request(cfg, '/wp/v2/posts?status=draft&context=edit&per_page=100&search=ecos&_fields=id,slug,title,modified_gmt'); } catch { return 0; }
  let n = 0;
  for (const p of Array.isArray(list) ? list : []) {
    if (!isTemp(p)) continue;
    const t = Date.parse((p.modified_gmt || '') + (/[zZ]|[+-]\d\d:?\d\d$/.test(p.modified_gmt || '') ? '' : 'Z'));
    if (Number.isFinite(t) && now - t < minAgeMs) continue;
    if (await deleteTemp(W, cfg, p.id)) n++;
  }
  return n;
}

// --- Guardar desde dentro de la ventana ------------------------------------------------------------------------------------
// Se ejecuta con webContents.executeJavaScript en la página del editor. Espera a que Gutenberg esté listo, guarda con savePost() y
// espera a que termine de guardar. Devuelve { ok, error? }.
const SAVE_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now();
  const ready = () => window.wp && window.wp.data && window.wp.data.select('core/editor') && window.wp.data.dispatch('core/editor');
  while (!ready()) { if (Date.now() - t0 > 15000) return { ok: false, error: 'editor-not-ready' }; await sleep(150); }
  const sel = () => window.wp.data.select('core/editor');
  while (sel().isSavingPost() && Date.now() - t0 < 30000) await sleep(100);
  await window.wp.data.dispatch('core/editor').savePost();
  await sleep(100);
  while ((sel().isSavingPost() || (sel().isAutosavingPost && sel().isAutosavingPost())) && Date.now() - t0 < 45000) await sleep(100);
  if (sel().isSavingPost()) return { ok: false, error: 'timeout' };
  if (sel().didPostSaveRequestFail && sel().didPostSaveRequestFail()) return { ok: false, error: 'save-failed' };
  return { ok: true };
})()`;

module.exports = { TEMP_TITLE, SLUG_PREFIX, ORPHAN_AGE_MS, SAVE_SCRIPT, helperHasEditor, targetFor, adminUrl, inScope, validOneTime, sessionUrl, isTemp, createTemp, readContent, deleteTemp, cleanupOrphans, origin };
