// Ecos · Copia de emergencia de la web: un ZIP con
//   contenido/      el WXR y las fotos (src/backupcreate.js),
//   visual/         copia estática navegable de cómo se ve la web ahora (se abre con visual/index.html, sin internet),
//   configuracion/  ajustes, menús, estructura, personalizador de Astra, CSS adicional… en JSON legible,
//   LEEME.html      guía de recuperación paso a paso.
// Las funciones puras (rutas locales, reescritura de enlaces, extracción de recursos, rotación, filtro de opciones
// sensibles, guía) están aparte de la parte que habla con la web, para poder probarlas.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BC = require('./backupcreate');

// ---------------------------------------------------------------- opciones sensibles
// La misma lista que wp-plugin/ecos/includes/export.php (ECOS_WP_SENSITIVE_RE). Si cambia una, cambia la otra.
const SENSITIVE_RE = /key|secret|token|password|pass|license/i;
const isSensitiveName = (name) => SENSITIVE_RE.test(String(name ?? ''));
// Quita, a cualquier profundidad, las claves con nombre sensible
function scrub(value, depth = 0) {
  if (depth > 12) return null;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!isSensitiveName(k)) out[k] = scrub(v, depth + 1);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------- direcciones y rutas locales
const siteHost = (u) => u.host.toLowerCase().replace(/^www\./, '');
const parseUrl = (s, base) => { try { return new URL(s, base); } catch { return null; } };
// ¿Esta dirección es de la misma web (http/https y mismo dominio, con o sin «www»)?
function sameSite(url, origin) {
  const u = typeof url === 'string' ? parseUrl(url) : url, o = typeof origin === 'string' ? parseUrl(origin) : origin;
  return !!u && !!o && /^https?:$/.test(u.protocol) && siteHost(u) === siteHost(o);
}
const noHash = (u) => { const x = new URL(u); x.hash = ''; return x.href; };
// Clave de una página: ruta sin barra final + parámetros (así «/a» y «/a/» son la misma)
function pageKey(url) {
  const u = new URL(url);
  const p = u.pathname.replace(/\/+$/, '') || '/';
  return p + u.search;
}
const hashOf = (s) => crypto.createHash('md5').update(String(s)).digest('hex').slice(0, 6);
const cleanSeg = (s) => (s.replace(/[<>:"|?*\\\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 120)) || '_';
function segs(pathname) {
  return pathname.split('/').filter(Boolean).map((s) => { let d = s; try { d = decodeURIComponent(s); } catch { /* tal cual */ } return cleanSeg(d); });
}
// Ruta local (dentro de visual/) de una página: una carpeta por dirección con su index.html
function localPage(url) {
  const u = new URL(url);
  const parts = segs(u.pathname);
  const last = parts[parts.length - 1] || '';
  let p = /\.html?$/i.test(last) ? parts.join('/') : [...parts, 'index.html'].join('/');
  if (u.search) p = p.replace(/(\.html?)$/i, `~${hashOf(u.search)}$1`);
  return p;
}
const KNOWN_EXT = /\.(css|js|mjs|json|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|ogg|wav|pdf|xml|txt|map)$/i;
// Identidad de un recurso: ruta (y parámetros solo si no es un tipo de archivo conocido); «style.css?ver=1» y «style.css» son el mismo
const assetKey = (url) => { const u = new URL(url); return u.pathname + (KNOWN_EXT.test(u.pathname) ? '' : u.search); };
// Ruta local de un recurso (CSS, JS, imagen, fuente…): la misma ruta que en la web; si depende de parámetros (p. ej. un .php) se le añade una marca
function localAsset(url) {
  const u = new URL(url);
  const parts = segs(u.pathname);
  if (!parts.length || u.pathname.endsWith('/')) parts.push('index.html');
  let p = parts.join('/');
  if (u.search && !KNOWN_EXT.test(p)) p = p.replace(/(\.[a-z0-9]+)?$/i, (m) => `~${hashOf(u.search)}${m || '.bin'}`);
  return p;
}
const encodeRel = (rel) => rel.split('/').map((s) => (s === '..' || s === '.' ? s : encodeURIComponent(s))).join('/');
// Enlace relativo de un archivo local a otro (ambos relativos a visual/)
function relLink(fromLocal, toLocal) {
  const r = path.posix.relative(path.posix.dirname(fromLocal), toLocal);
  return encodeRel(r || path.posix.basename(toLocal));
}

// ---------------------------------------------------------------- extracción y reescritura de HTML y CSS
const ENT = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const decodeAttr = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]));
const encodeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const SKIP_VALUE = /^\s*(#|data:|javascript:|mailto:|tel:|blob:|about:|sms:)/i;
// Atributos que llevan una dirección (kind: 'asset' = recurso, 'link' = otra página)
const ASSET_ATTRS = new Set(['src', 'poster', 'data-src', 'data-lazy-src', 'data-original', 'data-bg', 'data-background', 'data-background-image', 'data-large_image', 'data-thumb', 'data-full-url', 'data-lazy-srcset-src']);
const SRCSET_ATTRS = new Set(['srcset', 'data-srcset', 'data-lazy-srcset', 'imagesrcset']);
const LINK_ASSET_REL = /(^|\s)(stylesheet|icon|shortcut|apple-touch-icon|apple-touch-icon-precomposed|preload|modulepreload|mask-icon|manifest)(\s|$)/i;

// Una lista «srcset»: [{ url, desc }]
function parseSrcset(v) {
  const out = [], re = /(\S+?)(\s+[\d.]+[wx])?(?:\s*,\s*|\s*$)/g;
  let m;
  while ((m = re.exec(v)) && m[0] !== '') out.push({ url: m[1], desc: m[2] || '' });
  return out;
}

// CSS: url(…) y @import «…». mapper(absUrl, kind) → texto nuevo o null (se deja como está)
function rewriteCss(css, baseUrl, mapper) {
  const sub = (raw, kind) => {
    const v = raw.trim();
    if (!v || SKIP_VALUE.test(v)) return null;
    const u = parseUrl(v, baseUrl);
    return u ? mapper(u.href, kind) : null;
  };
  return css
    .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)]*?))\s*\)/gi, (all, a, b, c) => {
      const raw = a ?? b ?? c ?? '';
      const r = sub(raw, 'asset');
      return r == null ? all : `url("${r.replace(/"/g, '%22')}")`;
    })
    .replace(/@import\s+(?:"([^"]*)"|'([^']*)')/gi, (all, a, b) => {
      const r = sub(a ?? b ?? '', 'css');
      return r == null ? all : `@import "${r.replace(/"/g, '%22')}"`;
    });
}

const STRIP_CORS = /\s+(integrity|crossorigin)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/gi;
const TAG_RE = /<!--[\s\S]*?-->|<(script|style)\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/\1\s*>|<([a-z][a-z0-9:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
const ATTR_RE = /([a-z_:][-a-z0-9_:.]*)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

// HTML: recorre las direcciones de la página. mapper(absUrl, kind) → texto nuevo (ya relativo) o null.
// kind: 'asset' | 'css' (hoja de estilo) | 'link' (otra página) | 'next' (página siguiente) | 'meta' (no se toca)
function rewriteHtml(html, pageUrl, mapper) {
  const attrs = (tag, str) => {
    const t = tag.toLowerCase();
    const relMatch = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(str);
    const rel = (relMatch ? relMatch[1] ?? relMatch[2] ?? relMatch[3] : '') || '';
    let rewrote = false;
    const out = str.replace(ATTR_RE, (all, name, eq, dq, sq, bare) => {
      const n = name.toLowerCase(), raw = dq ?? sq ?? bare ?? '';
      const done = (val) => (val == null ? all : `${name}${eq}"${encodeAttr(val)}"`);
      const one = (value, kind) => {
        const v = decodeAttr(value).trim();
        if (!v || SKIP_VALUE.test(v)) return null;
        const u = parseUrl(v, pageUrl);
        const r = u ? mapper(u.href, kind) : null;
        if (r != null) rewrote = true;
        return r;
      };
      if (n === 'style') {
        const css = decodeAttr(raw);
        const next = rewriteCss(css, pageUrl, mapper);
        return next === css ? all : done(next);
      }
      if (SRCSET_ATTRS.has(n)) {
        const list = parseSrcset(decodeAttr(raw)); let any = false;
        const parts = list.map((x) => { const r = one(x.url, 'asset'); if (r != null) any = true; return (r ?? x.url) + x.desc; });
        return any ? done(parts.join(', ')) : all;
      }
      if (n === 'href') {
        if (t === 'a' || t === 'area') return done(one(raw, 'link'));
        if (t === 'link') {
          if (/(^|\s)next(\s|$)/i.test(rel)) return done(one(raw, 'next'));
          if (LINK_ASSET_REL.test(rel)) return done(one(raw, /stylesheet/i.test(rel) ? 'css' : 'asset'));
          return all; // canonical, alternate, shortlink, prev, api.w.org, EditURI…
        }
        return all;
      }
      if (n === 'action' && t === 'form') return all;
      if (ASSET_ATTRS.has(n)) { if (t === 'iframe' && n === 'src') return all; return done(one(raw, 'asset')); }
      return all;
    });
    return { out, rewrote };
  };
  let result = html.replace(TAG_RE, (all, sTag, sAttrs, sBody, tag, tAttrs) => {
    if (sTag) {
      const a = attrs(sTag, sAttrs || '');
      let body = sBody;
      if (sTag.toLowerCase() === 'style') body = rewriteCss(sBody, pageUrl, mapper);
      const head = `<${sTag}${a.rewrote ? a.out.replace(STRIP_CORS, '') : a.out}>`;
      return `${head}${body}</${sTag}>`;
    }
    if (tag) {
      const a = attrs(tag, tAttrs || '');
      if (!a.rewrote && a.out === tAttrs) return all;
      // el navegador no carga con file:// los recursos con integrity/crossorigin: se quitan de lo que se ha reescrito
      const clean = a.rewrote ? a.out.replace(STRIP_CORS, '') : a.out;
      return `<${tag}${clean}>`;
    }
    return all; // comentario
  });
  result = result.replace(/<base\b[^>]*>/gi, '');
  return result;
}

// Qué usa un HTML: { assets, links, next } (direcciones absolutas sin «#»)
function extractHtml(html, pageUrl) {
  const assets = new Set(), links = new Set(), next = new Set();
  rewriteHtml(html, pageUrl, (abs, kind) => {
    const k = noHash(abs);
    if (kind === 'asset' || kind === 'css') assets.add(k); else if (kind === 'link') links.add(k); else if (kind === 'next') { next.add(k); links.add(k); }
    return null;
  });
  return { assets: [...assets], links: [...links], next: [...next] };
}
function extractCss(css, cssUrl) {
  const out = new Set();
  rewriteCss(css, cssUrl, (abs) => { out.add(noHash(abs)); return null; });
  return [...out];
}
// Enlaces de los menús: lo que hay dentro de <nav> y <header> de la portada
function menuLinks(html, pageUrl) {
  const out = new Set();
  const blocks = html.match(/<(nav|header)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    for (const m of b.matchAll(/<a\b(?:"[^"]*"|'[^']*'|[^'">])*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      const v = decodeAttr(m[1] ?? m[2] ?? '').trim();
      if (!v || SKIP_VALUE.test(v)) continue;
      const u = parseUrl(v, pageUrl);
      if (u) out.add(noHash(u.href));
    }
  }
  return [...out];
}

// ¿Merece la pena copiar esta dirección como página?
const NOT_PAGE_PATH = /^\/(wp-admin|wp-login\.php|wp-json|xmlrpc\.php|wp-cron\.php|wp-content|wp-includes)(\/|$)|\/feed\/?$|\/(embed|trackback)\/?$/i;
const NOT_PAGE_EXT = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|jpe?g|png|gif|webp|avif|svg|mp3|mp4|webm|mov|css|js|json|xml|txt|ico)$/i;
function crawlablePage(url, origin) {
  const u = parseUrl(url);
  return !!u && sameSite(u, origin) && !NOT_PAGE_PATH.test(u.pathname) && !NOT_PAGE_EXT.test(u.pathname);
}

// ---------------------------------------------------------------- rastreo de la copia visual
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEXTUAL = /\.(css|js|mjs|json|svg|xml|txt|html?|map|ttf|otf|eot|ico|bmp)$/i;

function makeLimiter(n) {
  let active = 0; const q = [];
  const pump = () => { while (active < n && q.length) { active++; const { fn, res, rej } = q.shift(); fn().then(res, rej).finally(() => { active--; pump(); }); } };
  return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); pump(); });
}

// Baja una dirección con reintentos y límite de tamaño → { ok, status, buf, type, url } | { ok:false, big?, status?, error? }
async function fetchBuf(url, { fetchFn = globalThis.fetch, signal, maxBytes = 50 * 1024 * 1024, retries = 3, timeoutMs = 30000, delayMs = 0 } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new Error('Cancelado');
    if (delayMs) await sleep(delayMs);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Ecos-copia-de-emergencia', Accept: '*/*' } });
      if (res.status === 429 || res.status >= 500) { last = { ok: false, status: res.status }; try { await res.body?.cancel(); } catch { /* nada */ } }
      else if (!res.ok) { try { await res.body?.cancel(); } catch { /* nada */ } return { ok: false, status: res.status }; }
      else {
        const len = Number(res.headers.get('content-length') || 0);
        if (len > maxBytes) { try { await res.body?.cancel(); } catch { /* nada */ } return { ok: false, big: true }; }
        const chunks = []; let n = 0;
        for await (const c of res.body) { n += c.length; if (n > maxBytes) { ctrl.abort(); return { ok: false, big: true }; } chunks.push(c); }
        return { ok: true, status: res.status, buf: Buffer.concat(chunks), type: res.headers.get('content-type') || '', url: res.url || url };
      }
    } catch (e) {
      if (signal?.aborted) throw new Error('Cancelado');
      last = { ok: false, error: e.message };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
    if (attempt < retries) await sleep(Math.min(4000, 400 * 3 ** attempt) * (delayMs ? 1 : 0.01));
  }
  return last || { ok: false };
}

// o = { origin, seeds: [url], zip, prefix, maxPages, maxAsset, conc, retries, delayMs, fetchFn, onProgress, cancelled, signal }
// Escribe en el ZIP: <prefix>index.html, <prefix>…/index.html y los recursos. Devuelve { pages, assets, failed, tooBig, truncated, bytes }
async function crawlVisual(o) {
  const { origin, zip, prefix = 'visual/', maxPages = 2000, maxAsset = 50 * 1024 * 1024, conc = 4, retries = 3, delayMs = 250, fetchFn, signal, onProgress = () => {}, cancelled = () => false } = o;
  const stop = () => { if (cancelled()) throw new Error('Cancelado'); };
  const out = { pages: 0, assets: 0, failed: [], tooBig: 0, truncated: 0, bytes: 0 };
  const limit = makeLimiter(conc);
  const get = (url, max) => limit(() => fetchBuf(url, { fetchFn, signal, maxBytes: max, retries, delayMs }));
  let chain = Promise.resolve();
  const zipAdd = (name, buf, deflate) => { chain = chain.then(() => zip.add(prefix + name, buf, new Date(), { deflate })); out.bytes += buf.length; return chain; };
  const fail = (u) => { if (out.failed.length < 200) out.failed.push(u); };

  // páginas
  const pages = new Map(); // clave → url
  const queue = [];
  const addPage = (url) => {
    if (!crawlablePage(url, origin)) return false;
    const k = pageKey(url);
    if (pages.has(k)) return false;
    if (pages.size >= maxPages) { out.truncated++; return false; }
    pages.set(k, noHash(url)); queue.push(noHash(url));
    return true;
  };
  for (const s of o.seeds || []) addPage(s);
  const knownPage = (url) => pages.has(pageKey(url));

  // recursos (con caché: cada uno se baja una sola vez)
  const assetDone = new Map(); // dirección → ruta local | null
  const assetJobs = new Map();
  const taken = new Map(); // ruta local → dirección
  const claim = (key, url) => {
    let local = localAsset(url);
    if (taken.has(local) && taken.get(local) !== key) local = local.replace(/(\.[a-z0-9]+)?$/i, (m) => `~${hashOf(key)}${m}`);
    taken.set(local, key);
    return local;
  };
  const mapperFor = (fromLocal) => (abs, kind) => {
    if (!sameSite(abs, origin)) return null;
    const k = noHash(abs);
    let local = null;
    if (kind === 'asset' || kind === 'css') local = assetDone.get(assetKey(k)) || null;
    else if (kind === 'link' || kind === 'next') local = knownPage(k) ? localPage(k) : null;
    if (!local) return null;
    return relLink(fromLocal, local) + (new URL(abs).hash || '');
  };
  const ensureAsset = (url, ancestors) => {
    if (!sameSite(url, origin)) return Promise.resolve(null);
    const fetchUrl = noHash(url), key = assetKey(url);
    if (assetDone.has(key)) return Promise.resolve(assetDone.get(key));
    if (ancestors.includes(key)) return Promise.resolve(null);
    if (assetJobs.has(key)) return assetJobs.get(key);
    const job = (async () => {
      stop();
      const r = await get(fetchUrl, maxAsset);
      if (!r.ok) { if (r.big) out.tooBig++; else fail(fetchUrl); assetDone.set(key, null); return null; }
      if (!sameSite(r.url, origin)) { assetDone.set(key, null); return null; }
      const local = claim(key, fetchUrl);
      let buf = r.buf;
      if (/\.css$/i.test(local) || /text\/css/i.test(r.type)) {
        const text = buf.toString('utf8');
        const deps = extractCss(text, fetchUrl);
        await Promise.all(deps.map((d) => ensureAsset(d, [...ancestors, key])));
        buf = Buffer.from(rewriteCss(text, fetchUrl, mapperFor(local)), 'utf8');
      }
      assetDone.set(key, local);
      await zipAdd(local, buf, TEXTUAL.test(local));
      out.assets++;
      return local;
    })().catch((e) => { if (/Cancelado/.test(e.message)) throw e; fail(fetchUrl); assetDone.set(key, null); return null; });
    assetJobs.set(key, job);
    return job;
  };

  let done = 0, active = 0;
  const report = () => onProgress({ step: 'visual', done, total: pages.size, assets: out.assets });
  const processPage = async (url) => {
    const r = await get(url, maxAsset);
    if (!r.ok || !sameSite(r.url, origin) || (r.type && !/html/i.test(r.type))) { if (!r.ok || sameSite(r.url || url, origin)) fail(url); return; }
    const html = r.buf.toString('utf8');
    const final = r.url || url;
    const refs = extractHtml(html, final);
    // páginas siguientes y numeración de los archivos (…/page/2/) de páginas que ya se copian
    for (const l of refs.links) {
      const u = parseUrl(l); if (!u || !sameSite(u, origin)) continue;
      const m = /^(.*)\/page\/\d+\/?$/.exec(u.pathname);
      if (m && !u.search) { const b = new URL(u.href); b.pathname = m[1] || '/'; if (knownPage(b.href) || refs.next.includes(l)) addPage(l); }
    }
    await Promise.all(refs.assets.map((a) => ensureAsset(a, [])));
    stop();
    const local = localPage(url);
    await zipAdd(local, Buffer.from(rewriteHtml(html, final, mapperFor(local)), 'utf8'), true);
    out.pages++;
  };
  const worker = async () => {
    for (;;) {
      stop();
      const url = queue.shift();
      if (!url) { if (!active) return; await sleep(15); continue; }
      active++;
      try { await processPage(url); } catch (e) { if (/Cancelado/.test(e.message)) throw e; fail(url); } finally { active--; done++; report(); }
    }
  };
  report();
  await Promise.all(Array.from({ length: Math.max(1, conc) }, worker));
  await chain;
  return out;
}

// Descomprime la carpeta visual/ de una copia en destDir (para abrirla en el navegador). Devuelve la ruta de index.html
function extractVisual(zipFile, destDir) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true }, (err, zf) => {
      if (err) return reject(err);
      zf.readEntry();
      zf.on('entry', (e) => {
        const name = e.fileName.replace(/\\/g, '/');
        if (!name.startsWith('visual/') || /\/$/.test(name) || !BC.safeRel(name.slice(7))) return zf.readEntry();
        const target = path.join(destDir, name.slice(7));
        if (!path.resolve(target).startsWith(path.resolve(destDir) + path.sep)) return zf.readEntry();
        fs.mkdirSync(path.dirname(target), { recursive: true });
        zf.openReadStream(e, (er, st) => {
          if (er) return reject(er);
          const w = fs.createWriteStream(target);
          st.pipe(w); w.on('finish', () => zf.readEntry()); w.on('error', reject); st.on('error', reject);
        });
      });
      zf.on('end', () => { const idx = path.join(destDir, 'index.html'); fs.existsSync(idx) ? resolve(idx) : reject(new Error('Esta copia no incluye la copia visual')); });
      zf.on('error', reject);
    });
  });
}

// ---------------------------------------------------------------- copias: nombres, lista, rotación, calendario
const FILE_RE = /^ecos-emergencia-.+-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/;
const pad = (n) => String(n).padStart(2, '0');
function copyName(host, d = new Date()) {
  const h = String(host || 'web').toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '');
  return `ecos-emergencia-${h || 'web'}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
}
// Copias que hay en la carpeta, de la más nueva a la más antigua: [{ file, name, at, bytes }]
function listCopies(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!FILE_RE.test(n)) continue;
    try { const st = fs.statSync(path.join(dir, n)); if (st.isFile()) out.push({ file: path.join(dir, n), name: n, at: st.mtimeMs, bytes: st.size }); } catch { /* desapareció */ }
  }
  return out.sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1));
}
// Cuáles sobran para conservar solo las últimas «keep» (lista ya ordenada de más nueva a más antigua)
const pickRotation = (copies, keep) => copies.slice(Math.max(1, Math.floor(Number(keep)) || 1)).map((c) => c.name);
function rotate(dir, keep) {
  const gone = [];
  for (const n of pickRotation(listCopies(dir), keep)) { try { fs.unlinkSync(path.join(dir, n)); gone.push(n); } catch { /* en uso */ } }
  return gone;
}
// Restos de una copia que se quedó a medias (la app se cerró): se borran para volver a empezar
function cleanPartials(dir) {
  let n = 0;
  try { for (const f of fs.readdirSync(dir)) if (/^ecos-emergencia-.+\.zip\.partial$/.test(f)) { try { fs.unlinkSync(path.join(dir, f)); n++; } catch { /* en uso */ } } } catch { /* sin carpeta */ }
  return n;
}
const DAY = 864e5;
const AUTO_DAYS = { weekly: 7, monthly: 30 };
// ¿Toca hacer una copia automática ahora? Tras un fallo se reintenta como pronto a las 6 horas.
function shouldAutoRun({ auto = 'weekly', lastCopyAt = 0, lastAttempt = 0, lastFailed = false, now = Date.now() } = {}) {
  const days = AUTO_DAYS[auto];
  if (!days) return false;
  if (lastFailed && lastAttempt && now - lastAttempt < 6 * 3600e3) return false;
  return !lastCopyAt || now - lastCopyAt >= days * DAY;
}
const staleDays = (lastCopyAt, now = Date.now()) => (lastCopyAt ? Math.floor((now - lastCopyAt) / DAY) : null);

// ---------------------------------------------------------------- PHP serializado (para el .dat de «Customizer Export/Import»)
function phpSerialize(v) {
  if (v === null || v === undefined) return 'N;';
  if (typeof v === 'boolean') return `b:${v ? 1 : 0};`;
  if (typeof v === 'number') return Number.isInteger(v) ? `i:${v};` : `d:${v};`;
  if (typeof v === 'string') return `s:${Buffer.byteLength(v)}:"${v}";`;
  const key = (k) => (/^(0|-?[1-9]\d*)$/.test(String(k)) ? `i:${k};` : `s:${Buffer.byteLength(String(k))}:"${k}";`);
  const entries = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
  return `a:${entries.length}:{${entries.map(([k, x]) => key(k) + phpSerialize(x)).join('')}}`;
}
// Archivo .dat del plugin «Customizer Export/Import»: { template, mods, options, wp_css }
function customizerDat(exp) {
  const options = {};
  const astra = exp.options?.['astra-settings'];
  if (astra && typeof astra === 'object') for (const [k, v] of Object.entries(astra)) options[`astra-settings[${k}]`] = v;
  return phpSerialize({ template: exp.theme?.stylesheet || exp.theme?.template || 'astra', mods: exp.theme_mods || {}, options, wp_css: exp.custom_css || '' });
}

// ---------------------------------------------------------------- guía de recuperación (LEEME.html)
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtBytes = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const fmtDateEs = (d) => new Date(d).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
const plain = (x) => String(x?.rendered ?? x ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#8217;/g, '’');

function menuTree(menus) {
  const items = menus?.items || [];
  const list = (menus?.menus || []).map((m) => {
    const mine = items.filter((i) => (Array.isArray(i.menus) ? i.menus.includes(m.id) : i.menus === m.id)).sort((a, b) => (a.menu_order || 0) - (b.menu_order || 0));
    const ul = (parent) => {
      const kids = mine.filter((i) => (i.parent || 0) === parent);
      return kids.length ? `<ul>${kids.map((i) => `<li>${esc(plain(i.title))}${i.url ? ` <small>${esc(i.url)}</small>` : ''}${ul(i.id)}</li>`).join('')}</ul>` : '';
    };
    return `<h4>${esc(m.name)}</h4>${ul(0) || '<p><em>(vacío)</em></p>'}`;
  });
  return list.join('');
}

// info = { site, siteUrl, date, bytes, summary: { posts, pages, photos, visualPages, visualAssets, visualFailed }, config: { files:[…], notes:[…], exp, system, plugins, themes, menus }, hasExport, ecosVersion }
function buildGuide(info) {
  const s = info.summary || {}, c = info.config || {}, sys = c.system || {}, exp = c.exp || null;
  const plugins = (c.plugins || []), themes = (c.themes || []);
  const act = plugins.filter((p) => p.active), activeTheme = themes.find((t) => t.active) || (exp?.theme ? { name: exp.theme.name, version: exp.theme.version, stylesheet: exp.theme.stylesheet, parent: exp.theme.template !== exp.theme.stylesheet ? exp.theme.template : '' } : null);
  const row = (a, b, d) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td>${d !== undefined ? `<td>${esc(d)}</td>` : ''}</tr>`;
  const plTable = plugins.length ? `<table><thead><tr><th>Plugin</th><th>Versión</th><th>Estado</th></tr></thead><tbody>${plugins.map((p) => row(p.name, p.version, p.active ? 'activo' : 'desactivado')).join('')}</tbody></table>` : '<p><em>No se pudo leer la lista de plugins (hace falta el Complemento de Ecos 1.3.0 o superior en la web). Míralos en wp-admin → Plugins de tu web, si aún funciona, o pregunta a tu hosting.</em></p>';
  const thTable = themes.length ? `<table><thead><tr><th>Tema</th><th>Versión</th><th>Estado</th></tr></thead><tbody>${themes.map((t) => row(t.name + (t.parent ? ` (hijo de ${t.parent})` : ''), t.version, t.active ? 'activo' : 'instalado')).join('')}</tbody></table>` : '';
  const files = new Set(c.files || []);
  const has = (f) => files.has(f);
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Copia de emergencia de ${esc(info.site)} · Guía de recuperación</title>
<style>
body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:50rem;margin:0 auto;padding:24px 18px 60px;color:#1d1b16;background:#fffdf8}
h1{font-size:1.8rem;margin:.2em 0}h2{margin-top:2em;border-bottom:2px solid #e8dfcf;padding-bottom:.2em}h3{margin-top:1.4em}
code,.k{background:#f2ecdf;padding:1px 6px;border-radius:5px;font-family:ui-monospace,Consolas,monospace;font-size:.92em}
table{border-collapse:collapse;width:100%;margin:.6em 0}td,th{border:1px solid #e0d6c4;padding:6px 10px;text-align:left;vertical-align:top}th{background:#f6f0e3}
.box{background:#f6f0e3;border-radius:10px;padding:12px 16px;margin:1em 0}.warn{background:#fff1d6}
li{margin:.35em 0}small{color:#6b6458}a{color:#7a4a00}
@media print{body{max-width:none}}
</style></head><body>
<h1>Copia de emergencia de ${esc(info.site)}</h1>
<p>Creada con Ecos el <b>${esc(fmtDateEs(info.date))}</b> · tamaño aproximado <b>${esc(fmtBytes(info.bytes || 0))}</b> · dirección de la web: <b>${esc(info.siteUrl)}</b></p>
<div class="box">Guarda este archivo ZIP en un sitio seguro (por ejemplo, otra carpeta de tu ordenador o Google Drive). Esta guía explica cómo volver a levantar la web si se pierde el hosting, el tema o los plugins. No hace falta saber programar, pero conviene ir con calma y en orden.</div>

<h2>1. Qué hay en esta copia</h2>
<table>
<tr><td><code>contenido/</code></td><td>Todas tus entradas y páginas (${esc(s.posts ?? 0)} entradas y ${esc(s.pages ?? 0)} páginas) en un archivo de WordPress (<code>ecos-copia-de-seguridad.xml</code>) y la carpeta <code>uploads/</code> con ${esc(s.photos ?? 0)} fotos y archivos de la biblioteca.</td></tr>
<tr><td><code>visual/</code></td><td>Cómo se ve la web ahora, como una web estática: ${esc(s.visualPages ?? 0)} páginas y ${esc(s.visualAssets ?? 0)} recursos (estilos, scripts, fuentes e imágenes). Se abre sin internet.${s.visualFailed ? ` (${esc(s.visualFailed)} recursos no se pudieron bajar.)` : ''}</td></tr>
<tr><td><code>configuracion/</code></td><td>Ajustes de WordPress, menús, estructura de páginas, categorías, etiquetas, usuarios (solo nombre y rol), plantillas de bloques, y —con el Complemento de Ecos 1.3 o superior en la web— los ajustes del personalizador de Astra, el CSS adicional, los widgets, las opciones de Astra y Spectra y la lista de plugins y temas con su versión. Todo en archivos legibles.</td></tr>
<tr><td><code>LEEME.html</code></td><td>Esta guía.</td></tr>
</table>
${info.hasExport ? '' : '<div class="box warn"><b>Atención:</b> en esta copia no se pudo leer el ajuste del tema ni la lista de plugins porque el Complemento de Ecos de la web no está instalado o es anterior a la 1.3.0. Instálalo o actualízalo en Ecos (Conexiones → Complemento de Ecos) y haz otra copia cuando puedas.</div>'}
${(c.notes || []).length ? `<div class="box warn"><b>Avisos al crear la copia:</b><ul>${c.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}

<h2>2. Cómo ver la copia visual (sin internet)</h2>
<ol>
<li>Descomprime este ZIP en una carpeta (clic derecho → «Extraer todo» en Windows).</li>
<li>Abre la carpeta <code>visual</code> y haz doble clic en <code>index.html</code>: se abre la portada en tu navegador.</li>
<li>Los enlaces entre páginas funcionan sin conexión. Lo que venía de fuera de tu web (Google Fonts, Instagram, mapas, vídeos incrustados) solo se ve si hay internet.</li>
</ol>
<p>Sirve como <b>referencia</b> de cómo estaba cada página (textos, orden, colores), por si hay que rehacer algo a mano. No es una web WordPress: no se edita.</p>

<h2>3. Recuperar la web paso a paso</h2>
<h3>Paso 1 · Instala WordPress</h3>
<ol>
<li>Contrata o reactiva el hosting y crea una instalación nueva de WordPress (casi todos los hostings tienen un botón «Instalar WordPress»).</li>
<li>${sys.wordpress ? `Tu web usaba WordPress <b>${esc(sys.wordpress)}</b>${sys.php ? ` con PHP <b>${esc(sys.php)}</b>` : ''}. Instala la versión actual de WordPress; si algo falla, prueba con PHP ${esc(String(sys.php || '8.1').split('.').slice(0, 2).join('.'))}.` : 'Instala la versión actual de WordPress.'}${sys.language ? ` Idioma: <code>${esc(sys.language)}</code>.` : ''}</li>
<li>En <b>Ajustes → Enlaces permanentes</b> elige ${sys.permalinks ? `la misma estructura que tenías: <code>${esc(sys.permalinks)}</code>` : 'la misma estructura que tenías (la de la copia visual te lo indica: las direcciones de las carpetas)'} y guarda. Así las direcciones de las páginas serán las mismas que antes.</li>
</ol>
<h3>Paso 2 · Instala el tema</h3>
${activeTheme ? `<p>Tu web usaba el tema <b>${esc(activeTheme.name)}</b> versión <b>${esc(activeTheme.version)}</b>${activeTheme.parent ? ` (tema hijo de <b>${esc(activeTheme.parent)}</b>: instala también el principal)` : ''}. En <b>Apariencia → Temas → Añadir nuevo</b> búscalo, instálalo y actívalo.</p>` : '<p>En <b>Apariencia → Temas → Añadir nuevo</b> instala el tema que usaba tu web (Astra) y actívalo.</p>'}
${thTable}
<h3>Paso 3 · Instala los plugins</h3>
<p>En <b>Plugins → Añadir nuevo</b> instala y activa los que estaban activos${act.length ? ` (${act.length})` : ''}. Para Spectra busca «Spectra» (el plugin se llama <code>ultimate-addons-for-gutenberg</code>). Si necesitas una versión concreta, usa «Ver detalles» → «Versiones anteriores» en la ficha del plugin en wordpress.org.</p>
${plTable}
<p><small>Los plugins de pago (con licencia) hay que volver a descargarlos de la cuenta de su fabricante: las licencias y claves no se guardan en la copia, a propósito.</small></p>
<h3>Paso 4 · Importa las entradas y las páginas</h3>
<ol>
<li>Copia la carpeta <code>contenido/uploads/</code> de este ZIP dentro de <code>wp-content/uploads/</code> de tu hosting (con el administrador de archivos o por FTP). Así las fotos recuperan su sitio.</li>
<li>En WordPress, ve a <b>Herramientas → Importar → WordPress</b> (te pedirá instalar el importador; hazlo y pulsa «Ejecutar importador»).</li>
<li>Sube <code>contenido/ecos-copia-de-seguridad.xml</code>. Marca «Descargar e importar archivos adjuntos» solo si la web antigua sigue en línea; si no, déjalo sin marcar y, al terminar, registra las fotos con un plugin como «Add From Server» (que añade a la biblioteca los archivos que ya están en <code>uploads</code>).</li>
<li>Asigna las entradas a tu usuario cuando te lo pregunte y termina. Comprueba en <b>Entradas</b> y <b>Páginas</b> que están todas.</li>
<li>Con Ecos también puedes restaurar entradas sueltas: Ajustes → Restaurar entradas, eligiendo este ZIP o el XML.</li>
</ol>
<h3>Paso 5 · Recupera la apariencia</h3>
<ol>
<li><b>Ajustes del personalizador (colores, tipografías, cabecera, pie…).</b> ${has('personalizador-astra.dat') ? 'Instala el plugin <b>Customizer Export/Import</b>, ve a <b>Apariencia → Personalizar → Exportar/Importar</b>, elige el archivo <code>configuracion/personalizador-astra.dat</code> de esta copia y pulsa «Importar». ' : ''}${has('personalizador-theme_mods.json') ? 'Si ese método no funciona, abre <code>configuracion/personalizador-theme_mods.json</code> y <code>configuracion/opciones-astra-spectra.json</code> (los valores están en el apartado <code>astra-settings</code>) y copia a mano los valores en Apariencia → Personalizar. ' : 'Esta copia no los incluye (hace falta el Complemento de Ecos 1.3 o superior): usa la copia visual como referencia para rehacerlos. '}</li>
<li><b>CSS adicional.</b> ${has('css-adicional.css') ? 'Abre <code>configuracion/css-adicional.css</code>, copia todo su contenido y pégalo en <b>Apariencia → Personalizar → CSS adicional</b>; luego pulsa «Publicar».' : 'No se pudo leer el CSS adicional (hace falta el Complemento de Ecos 1.3 o superior).'}</li>
<li><b>Menús.</b> En <b>Apariencia → Menús</b> crea de nuevo cada menú con las mismas entradas y orden, y asígnalo a su ubicación. ${has('menus.json') ? 'El orden y las direcciones están en <code>configuracion/menus.json</code> y, resumidos, más abajo.' : ''}</li>
<li><b>Widgets.</b> ${has('widgets.json') ? 'Los widgets de las barras laterales y del pie están en <code>configuracion/widgets.json</code>: en Apariencia → Widgets añade los mismos bloques.' : 'No se pudieron leer los widgets.'}</li>
<li><b>Portada y ajustes.</b> En <b>Ajustes → Lectura</b> elige la misma página de inicio y de entradas (mira <code>configuracion/ajustes-wordpress.json</code> y <code>paginas.json</code>: «page_on_front» y «page_for_posts»). El título y el lema van en <b>Ajustes → Generales</b>.</li>
<li><b>Spectra y Astra.</b> Las opciones de estos plugins están en <code>configuracion/opciones-astra-spectra.json</code>. La mayoría se restauran solas al reimportar el personalizador; el resto se revisan en <b>Ajustes → Spectra</b>.</li>
</ol>
${c.menus ? `<h3>Menús de la web (resumen)</h3>${menuTree(c.menus)}` : ''}
<h3>Paso 6 · Comprueba</h3>
<ol>
<li>Compara cada página importante con la copia visual (<code>visual/index.html</code>).</li>
<li>Revisa el formulario de contacto, los enlaces a redes sociales y el pie de página.</li>
<li>Instala el Complemento de Ecos (Conexiones → Complemento de Ecos → Descargar) y vuelve a conectar Ecos con la web.</li>
</ol>

<h2>4. Lo que NO incluye esta copia</h2>
<ul>
<li>Comentarios, pedidos de tienda, formularios enviados, suscriptores y cualquier dato guardado por plugins en la base de datos (esto no es una copia completa de la base de datos).</li>
<li>Contraseñas de usuarios, claves de API y licencias de plugins.</li>
<li>Ajustes de plugins que no sean Astra o Spectra: usa la copia visual y la lista de plugins como guía.</li>
</ul>
<p>Para una copia completa de la base de datos y los archivos, usa también la copia de seguridad de tu hosting (o un plugin como UpdraftPlus) y guarda esta copia de emergencia como segundo seguro.</p>
<p><small>Generado por Ecos${info.ecosVersion ? ` ${esc(info.ecosVersion)}` : ''}${exp?.version ? ` · Complemento de Ecos ${esc(exp.version)}` : ''}.</small></p>
</body></html>
`;
}

// ---------------------------------------------------------------- configuración por la API
const PAGE_FIELDS = 'id,parent,menu_order,slug,title,status,link,template,date,modified,type';
const lite = (x) => ({ ...x, title: x.title ? plain(x.title) : x.title });
// deps.listAll(ruta) → [] · deps.getJson(ruta) → objeto · deps.exportData() → objeto | null · deps.me = { roles }
// Devuelve { files: { nombre: texto }, notes, exp, system, plugins, themes, menus, menuUrls }
async function collectConfig(deps, onProgress = () => {}, stop = () => {}) {
  const files = {}, notes = [];
  const json = (v) => JSON.stringify(v, null, 2) + '\n';
  const attempt = async (what, fn) => { stop(); try { return await fn(); } catch (e) { notes.push(`${what}: ${String(e.message || e).replace(/\s+/g, ' ').slice(0, 160)}`); return null; } };
  const steps = ['ajustes', 'menús', 'páginas', 'categorías', 'usuarios', 'plantillas', 'complemento'];
  let n = 0; const tick = (label) => onProgress({ step: 'configuracion', done: ++n, total: steps.length, label });

  const settings = await attempt('Ajustes de WordPress', () => deps.getJson('/wp/v2/settings'));
  if (settings) files['ajustes-wordpress.json'] = json(scrub(settings));
  tick('ajustes');

  const menus = await attempt('Menús', () => deps.listAll('/wp/v2/menus?context=edit'));
  let menuBundle = null;
  if (menus) {
    const items = (await attempt('Elementos de menú', () => deps.listAll('/wp/v2/menu-items?context=edit'))) || [];
    const locations = await attempt('Ubicaciones de menú', () => deps.getJson('/wp/v2/menu-locations'));
    menuBundle = { menus: menus.map((m) => ({ id: m.id, name: m.name, slug: m.slug, locations: m.locations || [] })), items: items.map((i) => ({ id: i.id, title: plain(i.title), url: i.url, parent: i.parent, menu_order: i.menu_order, menus: i.menus, type: i.type, object: i.object, object_id: i.object_id, target: i.target, classes: i.classes })), locations: locations || {} };
    files['menus.json'] = json(menuBundle);
  }
  tick('menús');

  const pages = await attempt('Estructura de páginas', () => deps.listAll(`/wp/v2/pages?context=edit&status=publish,draft,private,pending,future&_fields=${PAGE_FIELDS}`));
  if (pages) files['paginas.json'] = json(pages.map(lite));
  tick('páginas');

  const cats = await attempt('Categorías', () => deps.listAll('/wp/v2/categories?_fields=id,name,slug,parent,count,description,link'));
  if (cats) files['categorias.json'] = json(cats);
  const tags = await attempt('Etiquetas', () => deps.listAll('/wp/v2/tags?_fields=id,name,slug,count,description,link'));
  if (tags) files['etiquetas.json'] = json(tags);
  tick('categorías');

  const admin = (deps.me?.roles || []).includes('administrator');
  const users = await attempt('Usuarios', () => deps.listAll(admin ? '/wp/v2/users?context=edit&_fields=id,name,slug,roles,email' : '/wp/v2/users?_fields=id,name,slug,roles'));
  if (users) files['usuarios.json'] = json(users.map((u) => ({ id: u.id, name: u.name, slug: u.slug, roles: u.roles || undefined, ...(admin && u.email ? { email: u.email } : {}) })));
  tick('usuarios');

  const tpl = {};
  for (const [key, route, label] of [['plantillas', '/wp/v2/templates?context=edit', 'Plantillas de bloques'], ['partes_de_plantilla', '/wp/v2/template-parts?context=edit', 'Partes de plantilla'], ['bloques_reutilizables', '/wp/v2/blocks?context=edit&status=publish,draft', 'Bloques reutilizables']]) {
    const r = await deps.listAll(route).catch(() => null);
    if (r && r.length) tpl[key] = r; else if (!r) notes.push(`${label}: no disponible en esta web (normal con temas clásicos como Astra)`);
  }
  tick('plantillas');

  let exp = await attempt('Complemento de Ecos (configuración del tema)', async () => (deps.exportData ? await deps.exportData() : null));
  if (!exp && deps.exportData) notes.push('Ajustes del personalizador, CSS adicional, widgets y opciones: necesitan el Complemento de Ecos 1.3.0 o superior en la web.');
  let plugins = [], themes = [], system = {};
  if (exp) {
    const T = exp.theme?.stylesheet;
    if (T) { const gs = await deps.getJson(`/wp/v2/global-styles/themes/${encodeURIComponent(T)}`).catch(() => null); if (gs) tpl.estilos_globales_del_tema = gs; }
    files['personalizador-theme_mods.json'] = json({ tema: exp.theme, theme_mods: scrub(exp.theme_mods), theme_mods_del_tema_principal: exp.parent_theme_mods ? scrub(exp.parent_theme_mods) : null });
    files['personalizador-astra.dat'] = customizerDat({ ...exp, theme_mods: scrub(exp.theme_mods), options: scrub(exp.options) });
    if (exp.custom_css != null) files['css-adicional.css'] = String(exp.custom_css) || '/* (sin CSS adicional) */\n';
    files['widgets.json'] = json(scrub(exp.widgets));
    files['opciones-astra-spectra.json'] = json(scrub(exp.options));
    plugins = (exp.plugins || []).map((p) => ({ name: p.name, version: p.version, active: !!p.active, file: p.file, uri: p.uri }));
    themes = (exp.themes || []).map((t) => ({ name: t.name, version: t.version, stylesheet: t.stylesheet, parent: t.parent, active: !!t.active }));
    system = { ...exp.site, ecos_plugin: exp.version };
  } else {
    // sin el complemento: lo que da la API estándar (necesita permiso de administrador)
    const pl = await deps.listAll('/wp/v2/plugins').catch(() => null);
    if (pl) plugins = pl.map((p) => ({ name: plain(p.name), version: p.version, active: /^active/.test(p.status), file: p.plugin }));
    const th = await deps.getJson('/wp/v2/themes?status=active').catch(() => null);
    if (Array.isArray(th)) themes = th.map((t) => ({ name: plain(t.name), version: t.version, stylesheet: t.stylesheet, parent: t.template && t.template !== t.stylesheet ? t.template : '', active: true }));
    const root = await deps.getJson('/').catch(() => null);
    system = { name: root?.name, description: root?.description, url: root?.home || root?.url, language: settings?.language, timezone: settings?.timezone_string || settings?.timezone };
  }
  if (Object.keys(tpl).length) files['plantillas-y-bloques.json'] = json(tpl);
  files['plugins.json'] = json(plugins);
  files['temas.json'] = json(themes);
  files['sistema.json'] = json(system);
  tick('complemento');
  if (notes.length) files['avisos.json'] = json(notes);
  const menuUrls = (menuBundle?.items || []).map((i) => i.url).filter(Boolean);
  return { files, notes, exp, system, plugins, themes, menus: menuBundle, menuUrls, cats: cats || [] };
}

// ---------------------------------------------------------------- la copia entera
// deps = { siteName, siteUrl, media, listAll, getJson, exportData, me, download, fetchFn?, ecosVersion }
// opts = { dir, file?, keep, onProgress, cancelled, signal, delayMs, maxPages, conc }
async function runEmergency(deps, opts) {
  const { dir, keep = 4, onProgress = () => {}, cancelled = () => false, signal } = opts;
  const stop = () => { if (cancelled()) throw new Error('Cancelado'); };
  const origin = new URL(deps.siteUrl).origin;
  const host = new URL(origin).hostname;
  fs.mkdirSync(dir, { recursive: true });
  cleanPartials(dir);
  const name = opts.name || copyName(host);
  const final = path.join(dir, name), partial = final + '.partial';
  const zip = new BC.ZipWriter(partial);
  const result = { file: final, name, posts: 0, pages: 0, photos: 0, photosMissing: 0, visualPages: 0, visualAssets: 0, visualFailed: 0, visualTruncated: 0, notes: [], bytes: 0 };
  try {
    // 1 · contenido
    onProgress({ phase: 'contenido', step: 'entradas' });
    const c = await BC.createBackup({ listAll: deps.listAll, media: deps.media, download: deps.download, siteName: deps.siteName, siteUrl: origin }, {
      zip, prefix: 'contenido/', photos: true, cancelled, onProgress: (p) => onProgress({ phase: 'contenido', ...p }),
    });
    Object.assign(result, { posts: c.posts, pages: c.pages, photos: c.files, photosMissing: c.missing });
    stop();
    // 2 · configuración
    onProgress({ phase: 'configuracion', step: 'configuracion', done: 0, total: 7 });
    const cfgData = await collectConfig(deps, (p) => onProgress({ phase: 'configuracion', ...p }), stop);
    for (const [fname, text] of Object.entries(cfgData.files)) await zip.add('configuracion/' + fname, Buffer.from(text, 'utf8'), new Date(), { deflate: true });
    // 3 · copia visual
    onProgress({ phase: 'visual', step: 'visual', done: 0, total: 1 });
    const seeds = new Set([origin + '/']);
    const addSeed = (u) => { const x = parseUrl(u, origin + '/'); if (x && crawlablePage(x.href, origin)) seeds.add(noHash(x.href)); };
    try {
      for (const r of ['/wp/v2/posts', '/wp/v2/pages']) for (const p of await deps.listAll(`${r}?status=publish&_fields=id,link`)) if (p.link) addSeed(p.link);
    } catch (e) { cfgData.notes.push('Copia visual: no se pudo leer la lista de páginas por la API (' + e.message + ')'); }
    for (const cat of cfgData.cats) if (cat.link && cat.count > 0) addSeed(cat.link);
    for (const u of cfgData.menuUrls) addSeed(u);
    // enlaces del menú de la portada (también sirven si no hay API de menús)
    const home = await fetchBuf(origin + '/', { fetchFn: deps.fetchFn, signal, retries: 2, delayMs: 0, maxBytes: 20 * 1024 * 1024 });
    if (home.ok) for (const l of menuLinks(home.buf.toString('utf8'), home.url || origin + '/')) addSeed(l);
    else cfgData.notes.push('Copia visual: no se pudo abrir la portada de la web' + (home.status ? ` (HTTP ${home.status})` : '') + '.');
    const v = home.ok ? await crawlVisual({ origin, seeds: [origin + '/', ...seeds], zip, maxPages: opts.maxPages ?? 2000, conc: opts.conc ?? 4, delayMs: opts.delayMs ?? 250, retries: opts.retries ?? 3, fetchFn: deps.fetchFn, signal, cancelled, onProgress: (p) => onProgress({ phase: 'visual', ...p }) })
      : { pages: 0, assets: 0, failed: [], tooBig: 0, truncated: 0, bytes: 0 };
    Object.assign(result, { visualPages: v.pages, visualAssets: v.assets, visualFailed: v.failed.length, visualTruncated: v.truncated });
    if (v.truncated) cfgData.notes.push(`Copia visual: se alcanzó el límite de páginas y ${v.truncated} no se copiaron.`);
    if (v.tooBig) cfgData.notes.push(`Copia visual: ${v.tooBig} recursos superaban 50 MB y se dejaron como enlaces a la web.`);
    if (v.failed.length) cfgData.notes.push(`Copia visual: ${v.failed.length} direcciones no se pudieron bajar (por ejemplo ${v.failed.slice(0, 3).join(', ')}).`);
    if (c.missing) cfgData.notes.push(`Contenido: ${c.missing} archivos de la biblioteca no se pudieron bajar.`);
    stop();
    // 4 · guía
    onProgress({ phase: 'guia', step: 'guia' });
    const date = new Date();
    result.notes = cfgData.notes;
    const guide = buildGuide({
      site: deps.siteName || host, siteUrl: origin, date, bytes: zip.pos, ecosVersion: deps.ecosVersion, hasExport: !!cfgData.exp,
      summary: { posts: c.posts, pages: c.pages, photos: c.files, visualPages: v.pages, visualAssets: v.assets, visualFailed: v.failed.length },
      config: { files: Object.keys(cfgData.files), notes: cfgData.notes, exp: cfgData.exp, system: cfgData.system, plugins: cfgData.plugins, themes: cfgData.themes, menus: cfgData.menus },
    });
    await zip.add('LEEME.html', Buffer.from(guide, 'utf8'), date, { deflate: true });
    await zip.add('copia.json', Buffer.from(JSON.stringify({ ecos: deps.ecosVersion || '', creada: date.toISOString(), web: origin, entradas: c.posts, paginas: c.pages, fotos: c.files, paginasVisuales: v.pages, recursosVisuales: v.assets, avisos: cfgData.notes }, null, 2), 'utf8'), date, { deflate: true });
    onProgress({ phase: 'guardar', step: 'guardar' });
    await zip.finish();
    fs.renameSync(partial, final);
    result.bytes = fs.statSync(final).size;
    result.deleted = rotate(dir, keep);
    return result;
  } catch (e) {
    try { zip.out.destroy(); } catch { /* ya cerrado */ }
    try { fs.unlinkSync(partial); } catch { /* ya no está */ }
    throw e;
  }
}

module.exports = {
  isSensitiveName, scrub, SENSITIVE_RE, sameSite, pageKey, localPage, localAsset, relLink, parseSrcset,
  rewriteHtml, rewriteCss, extractHtml, extractCss, menuLinks, crawlablePage, fetchBuf, crawlVisual, extractVisual,
  copyName, listCopies, pickRotation, rotate, cleanPartials, shouldAutoRun, staleDays,
  phpSerialize, customizerDat, buildGuide, collectConfig, runEmergency, fmtBytes,
};
