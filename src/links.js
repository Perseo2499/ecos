// Revisar enlaces: comprueba si siguen funcionando y propone una alternativa cuando han cambiado.
// La red es inyectable (opts.fetch) para poder probarlo sin internet.
const { extractLinks, replaceLinkInHtml, unlinkInHtml } = require('../renderer/linkutil');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' };

// Forma comparable de una dirección: sin http/https, sin www, sin barra final ni #ancla
function canon(u) {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./i, '').toLowerCase() + x.pathname.replace(/\/+$/, '') + x.search;
  } catch { return String(u); }
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; } };
const is2xx = (c) => c >= 200 && c < 300;

// Una petición (HEAD, o GET leyendo solo la cabecera). Devuelve { code, finalUrl } o { error, timeout }
async function attempt(fetchFn, url, method, timeout) {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeout);
  try {
    const res = await fetchFn(url, { method, redirect: 'follow', headers: HEADERS, signal: ctl.signal });
    const out = { code: res.status, finalUrl: res.url || url };
    if (method === 'GET') { try { ctl.abort(); } catch { /* ya está */ } try { await res.body?.cancel?.(); } catch { /* sin cuerpo */ } }
    return out;
  } catch (e) {
    if (timedOut) return { error: 'timeout', timeout: true };
    return { error: e?.cause?.code || e?.message || 'error' };
  } finally { clearTimeout(timer); }
}
async function probe(fetchFn, url, timeout) {
  const h = await attempt(fetchFn, url, 'HEAD', timeout);
  if (h.timeout || !(h.error || [405, 403, 501].includes(h.code))) return h;
  const g = await attempt(fetchFn, url, 'GET', timeout);
  // si el GET también falla, nos quedamos con la respuesta del HEAD cuando la hubo
  return g.error && !h.error ? h : g;
}

// Pregunta al Archivo de Internet por una copia guardada
async function wayback(fetchFn, url, timeout) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetchFn('https://archive.org/wayback/available?url=' + encodeURIComponent(url), { headers: HEADERS, signal: ctl.signal });
    const c = (await r.json())?.archived_snapshots?.closest;
    return c?.available && c.url ? String(c.url).replace(/^http:/i, 'https:') : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

async function checkUrl(url, { fetch: fetchFn = globalThis.fetch, timeout = 12000, siteUrl, findOnSite } = {}) {
  const res = { url, status: 'unknown', code: null, finalUrl: null, suggestion: null, suggestionSource: null, note: '' };
  const r = await probe(fetchFn, url, timeout);
  if (r.error) {
    res.note = r.timeout ? 'La página no ha respondido a tiempo' : 'No se puede conectar con esa dirección';
    res.status = r.timeout ? 'unknown' : 'broken';
  } else {
    res.code = r.code; res.finalUrl = r.finalUrl;
    if (is2xx(r.code)) {
      if (canon(r.finalUrl) === canon(url)) res.status = 'ok';
      else { res.status = 'moved'; res.suggestion = r.finalUrl; res.suggestionSource = 'redirect'; res.note = 'La dirección ha cambiado'; }
    } else if (r.code === 404 || r.code === 410 || (r.code >= 500 && r.code < 600)) {
      res.status = 'broken'; res.note = r.code < 600 && r.code >= 500 ? 'La web da un error' : 'La página ya no existe';
    } else {
      res.note = r.code === 999 ? 'LinkedIn no deja comprobar sus enlaces a los robots; seguramente funciona'
        : r.code === 429 ? 'La web ha limitado las comprobaciones; inténtalo más tarde'
        : 'Esta web no deja comprobar el enlace a los robots; puede que funcione en el navegador';
    }
  }
  if (res.status !== 'broken') return res;

  // Buscar una alternativa que funcione
  const works = async (u) => { const p = await probe(fetchFn, u, timeout); return !p.error && is2xx(p.code) ? (p.finalUrl || u) : null; };
  const set = (u, src) => { res.suggestion = u; res.suggestionSource = src; return res; };
  if (/^http:\/\//i.test(url)) {
    const ok = await works(url.replace(/^http:/i, 'https:'));
    if (ok) return set(ok, 'https');
  }
  if (siteUrl && findOnSite && hostOf(url) && hostOf(url) === hostOf(siteUrl)) {
    let found = null;
    try { found = await findOnSite(url); } catch { /* sin resultado */ }
    const ok = found && canon(found) !== canon(url) ? await works(found) : null;
    if (ok) return set(ok, 'site');
  }
  const arch = await wayback(fetchFn, url, timeout);
  if (arch) return set(arch, 'archive');
  return res;
}

const cache = new Map();
// Comprueba varias direcciones (máx. 6 a la vez; cada una queda en memoria durante la sesión)
async function checkMany(urls, opts = {}, onProgress) {
  const list = [...new Set(urls)];
  const results = new Array(list.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++, u = list[i];
      if (!cache.has(u)) cache.set(u, checkUrl(u, opts).catch((e) => ({ url: u, status: 'unknown', code: null, finalUrl: null, suggestion: null, suggestionSource: null, note: e.message })));
      results[i] = await cache.get(u);
      done++;
      try { onProgress?.({ done, total: list.length, url: u }); } catch { /* el aviso no es crítico */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));
  return results;
}
const clearCache = () => cache.clear();

module.exports = { extractLinks, replaceLinkInHtml, unlinkInHtml, checkUrl, checkMany, clearCache, canon };
