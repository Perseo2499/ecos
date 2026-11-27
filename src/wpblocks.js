// Patrones de la web y bloques sincronizados (wp_block) de WordPress propio. Los datos se normalizan en renderer/patterns.js.
const P = require('../renderer/patterns');
const { request } = require('./wpself');
const { parseBlocks } = require('./parseblocks');

const first = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };

// Patrones del tema y los complementos + sus categorías (la API de patrones necesita WordPress 6.0 o posterior)
async function listPatterns(cfg) {
  const [patterns, cats] = await Promise.all([
    first(() => request(cfg, '/wp/v2/block-patterns/patterns'), []),
    first(() => request(cfg, '/wp/v2/block-patterns/categories'), []),
  ]);
  return { patterns: P.normalizePatterns(patterns), categories: P.normalizeCategories(cats) };
}
// Bloques reutilizables / patrones del usuario (wp_block). Hasta 5 páginas de 100.
async function listSynced(cfg) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const { data, res } = await request(cfg, `/wp/v2/blocks?context=edit&per_page=100&page=${page}&status=publish`, { raw: true });
    out.push(...(Array.isArray(data) ? data : []));
    if (page >= Number(res.headers.get('x-wp-totalpages') || 1)) break;
  }
  return P.normalizeSynced(out).map((s) => ({ ...s, blocks: parseBlocks(s.content) }));
}
async function getSynced(cfg, id) {
  const r = P.normalizeSynced([await request(cfg, `/wp/v2/blocks/${Number(id)}?context=edit`)])[0];
  if (!r) throw new Error('No se encuentra ese bloque sincronizado');
  return { ...r, blocks: parseBlocks(r.content) };
}
// Crea (sin id) o actualiza un wp_block. `content` ya viene compuesto (composeBlocks).
async function saveSynced(cfg, { id, title, content, sync }) {
  const body = P.syncedPayload(title, content, sync);
  if (id) { delete body.meta; delete body.status; }
  const r = await request(cfg, id ? `/wp/v2/blocks/${Number(id)}` : '/wp/v2/blocks', { method: 'POST', json: body });
  return { id: r.id, title: P.plain(typeof r.title === 'object' ? r.title.raw || r.title.rendered : r.title) || body.title };
}

module.exports = { listPatterns, listSynced, getSynced, saveSynced };
