// Lógica pura del SEO completo (Yoast SEO y Rank Math): lista blanca y mapeo de metas, palabras clave,
// análisis sencillo de la entrada y datos de las vistas previas. Sin pantalla ni red: se usa en el editor
// (renderer/app/seo-panel.js) y se prueba con node --test. La lista de claves debe coincidir con
// wp-plugin/ecos/includes/seo2.php (lo comprueba test/seometa.test.js).
(function (root) {
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const norm = (s) => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const slugOf = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  // Campos lógicos de Ecos → clave de meta de cada plugin
  const TEXT = ['canonical', 'ogTitle', 'ogDesc', 'ogImage', 'twTitle', 'twDesc', 'twImage'];
  const FIELDS = ['focusKw', 'extraKw', 'canonical', 'noindex', 'nofollow', 'ogTitle', 'ogDesc', 'ogImage', 'ogImageId', 'twTitle', 'twDesc', 'twImage', 'twImageId'];
  const META = {
    yoast: {
      focusKw: '_yoast_wpseo_focuskw', extraKw: '_yoast_wpseo_focuskeywords', canonical: '_yoast_wpseo_canonical',
      noindex: '_yoast_wpseo_meta-robots-noindex', nofollow: '_yoast_wpseo_meta-robots-nofollow',
      ogTitle: '_yoast_wpseo_opengraph-title', ogDesc: '_yoast_wpseo_opengraph-description', ogImage: '_yoast_wpseo_opengraph-image', ogImageId: '_yoast_wpseo_opengraph-image-id',
      twTitle: '_yoast_wpseo_twitter-title', twDesc: '_yoast_wpseo_twitter-description', twImage: '_yoast_wpseo_twitter-image', twImageId: '_yoast_wpseo_twitter-image-id',
    },
    rankmath: {
      focusKw: 'rank_math_focus_keyword', extraKw: 'rank_math_focus_keyword', canonical: 'rank_math_canonical_url',
      noindex: 'rank_math_robots', nofollow: 'rank_math_robots',
      ogTitle: 'rank_math_facebook_title', ogDesc: 'rank_math_facebook_description', ogImage: 'rank_math_facebook_image', ogImageId: 'rank_math_facebook_image_id',
      twTitle: 'rank_math_twitter_title', twDesc: 'rank_math_twitter_description', twImage: 'rank_math_twitter_image', twImageId: 'rank_math_twitter_image_id',
    },
  };
  // Metas extra de Rank Math que se escriben junto a los de Twitter (que no use los datos de Facebook)
  const RM_TW_SWITCH = 'rank_math_twitter_use_facebook';
  const PLUGINS = Object.keys(META);

  // Todas las claves que Ecos puede tocar para un plugin: ninguna otra
  const allowedKeys = (plugin) => (META[plugin] ? [...new Set([...Object.values(META[plugin]), ...(plugin === 'rankmath' ? [RM_TW_SWITCH] : [])])] : []);
  // Campos que se pueden guardar con ese plugin (sin Premium, Yoast no admite palabras clave secundarias)
  const writableFields = (plugin, premium) => (META[plugin] ? FIELDS.filter((f) => f !== 'extraKw' || plugin === 'rankmath' || !!premium) : []);

  const isUrl = (s) => { try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };
  const splitKw = (s) => String(s ?? '').split(',').map(clean).filter(Boolean);
  // «principal, otra, otra» ↔ { focusKw, extraKw }
  const joinKw = (main, extra) => [clean(main), ...(Array.isArray(extra) ? extra : splitKw(extra)).map(clean)].filter(Boolean).filter((k, i, a) => a.findIndex((x) => norm(x) === norm(k)) === i).join(', ');

  // Limpia los campos que vienen de la pantalla (o del complemento): textos recortados, direcciones válidas, números y booleanos
  function sanitize(f) {
    const o = {};
    for (const k of FIELDS) {
      if (!f || f[k] === undefined || f[k] === null) continue;
      if (k === 'noindex' || k === 'nofollow') o[k] = f[k] === true || f[k] === '1' || f[k] === 1 || f[k] === 'true';
      else if (k === 'ogImageId' || k === 'twImageId') o[k] = Math.max(0, parseInt(f[k], 10) || 0);
      else if (k === 'extraKw') o[k] = (Array.isArray(f[k]) ? f[k] : splitKw(f[k])).map(clean).filter(Boolean).slice(0, 10);
      else if (k === 'canonical' || k === 'ogImage' || k === 'twImage') { const u = clean(f[k]); o[k] = !u || isUrl(u) ? u : ''; }
      else o[k] = clean(f[k]).slice(0, k === 'ogDesc' || k === 'twDesc' ? 400 : 200);
    }
    return o;
  }

  // Campos de Ecos (parciales) → metas que hay que escribir. `current` = { robots: [...] } con lo que ya hay en Rank Math
  // para no perder «noarchive», «nosnippet»…; `premium` activa las palabras clave secundarias de Yoast.
  function toMeta(plugin, fields, { premium = false, current = {} } = {}) {
    if (!META[plugin]) return {};
    const f = sanitize(fields), m = META[plugin], out = {};
    const ok = new Set(writableFields(plugin, premium));
    for (const k of Object.keys(f)) {
      if (!ok.has(k)) continue;
      if (plugin === 'rankmath' && (k === 'focusKw' || k === 'extraKw')) continue; // se juntan abajo
      if (plugin === 'rankmath' && (k === 'noindex' || k === 'nofollow')) continue;
      if (k === 'extraKw') out[m.extraKw] = JSON.stringify(f.extraKw.map((keyword) => ({ keyword, score: 'na' })));
      else if (k === 'noindex') out[m.noindex] = f.noindex ? '1' : '0';
      else if (k === 'nofollow') out[m.nofollow] = f.nofollow ? '1' : '0';
      else out[m[k]] = typeof f[k] === 'number' ? String(f[k]) : f[k];
    }
    if (plugin === 'rankmath') {
      if ('focusKw' in f || 'extraKw' in f) out[m.focusKw] = joinKw(f.focusKw ?? current.focusKw, 'extraKw' in f ? f.extraKw : current.extraKw);
      if ('noindex' in f || 'nofollow' in f) {
        const keep = (Array.isArray(current.robots) ? current.robots : []).filter((x) => !/^(no)?(index|follow)$/.test(x));
        const ni = 'noindex' in f ? f.noindex : !!current.noindex, nf = 'nofollow' in f ? f.nofollow : !!current.nofollow;
        out[m.noindex] = [ni ? 'noindex' : 'index', ...(nf ? ['nofollow'] : []), ...keep];
      }
      if (['twTitle', 'twDesc', 'twImage', 'twImageId'].some((k) => k in f)) out[RM_TW_SWITCH] = 'off';
    }
    return out;
  }

  // Metas del plugin → campos de Ecos
  function fromMeta(plugin, meta) {
    const m = META[plugin], g = (k) => (meta && meta[k] !== undefined && meta[k] !== null ? meta[k] : '');
    if (!m) return {};
    const o = { focusKw: '', extraKw: [], canonical: clean(g(m.canonical)), noindex: false, nofollow: false };
    if (plugin === 'rankmath') {
      const [main, ...rest] = splitKw(g(m.focusKw)); o.focusKw = main || ''; o.extraKw = rest;
      const r = Array.isArray(g(m.noindex)) ? g(m.noindex) : [];
      o.noindex = r.includes('noindex'); o.nofollow = r.includes('nofollow');
    } else {
      o.focusKw = clean(g(m.focusKw));
      let ex = g(m.extraKw);
      if (typeof ex === 'string' && ex) { try { ex = JSON.parse(ex); } catch { ex = []; } }
      o.extraKw = Array.isArray(ex) ? ex.map((x) => clean(x && x.keyword)).filter(Boolean) : [];
      o.noindex = String(g(m.noindex)) === '1'; o.nofollow = String(g(m.nofollow)) === '1';
    }
    for (const k of ['ogTitle', 'ogDesc', 'ogImage', 'twTitle', 'twDesc', 'twImage']) o[k] = clean(g(m[k]));
    for (const k of ['ogImageId', 'twImageId']) o[k] = parseInt(g(m[k]), 10) || 0;
    return o;
  }

  // Solo lo que ha cambiado (para guardar el mínimo)
  function diff(orig, cur) {
    const a = sanitize(orig || {}), b = sanitize(cur || {}), out = {};
    for (const k of FIELDS) {
      if (!(k in b)) continue;
      const x = k === 'extraKw' ? (a[k] || []).join('\u0001') : a[k] ?? (typeof b[k] === 'boolean' ? false : typeof b[k] === 'number' ? 0 : '');
      const y = k === 'extraKw' ? b[k].join('\u0001') : b[k];
      if (x !== y) out[k] = b[k];
    }
    return out;
  }

  // ------------------------------------------------------------------ análisis de la entrada
  const words = (s) => norm(s).split(/[^a-z0-9ñ]+/).filter(Boolean);
  const has = (text, kw) => { const k = norm(kw); return !!k && norm(text).includes(k); };
  const lv = (ok, warn) => (ok ? 'ok' : warn ? 'warn' : 'bad');
  const TITLE = { min: 30, max: 60 }, DESC = { min: 70, max: 155 };

  // in: { title, desc, keyword, slug, paragraphs[], headings[], alts[], imgCount, text, canonical }
  // out: { score 0-100, level, checks:[{ code, level, n?, w }] }  (los textos los pone la pantalla)
  function analyze(inp) {
    const kw = clean(inp.keyword), text = clean(inp.text ?? (inp.paragraphs || []).join(' ')), title = clean(inp.title), desc = clean(inp.desc);
    const checks = [];
    const add = (code, level, w, extra) => checks.push({ code, level, w, ...(extra || {}) });
    const n = words(text).length;
    const tl = title.length, dl = desc.length;
    add('titleLen', tl >= TITLE.min && tl <= TITLE.max ? 'ok' : tl && tl <= 70 ? 'warn' : 'bad', 1, { n: tl });
    add('descLen', dl >= DESC.min && dl <= DESC.max ? 'ok' : dl && dl <= 175 ? 'warn' : 'bad', 1, { n: dl });
    add('textLen', n >= 300 ? 'ok' : n >= 150 ? 'warn' : 'bad', 1, { n });
    if (!kw) {
      add('kwSet', 'bad', 2);
    } else {
      const wk = words(kw);
      add('kwSet', 'ok', 0);
      add('kwTitle', has(title, kw) ? (norm(title).indexOf(norm(kw)) <= 10 ? 'ok' : 'warn') : 'bad', 2, { start: has(title, kw) && norm(title).indexOf(norm(kw)) > 10 });
      const sg = String(inp.slug || '').toLowerCase();
      add('kwSlug', sg.includes(slugOf(kw)) ? 'ok' : wk.length > 1 && wk.every((x) => sg.includes(slugOf(x))) ? 'warn' : 'bad', 1);
      const first = (inp.paragraphs || []).map(clean).find(Boolean) || '';
      add('kwIntro', has(first, kw) ? 'ok' : has(words(text).slice(0, 120).join(' '), kw) ? 'warn' : 'bad', 2);
      add('kwHeading', (inp.headings || []).some((h) => has(h, kw)) ? 'ok' : (inp.headings || []).length ? 'bad' : 'warn', 1, { none: !(inp.headings || []).length });
      const alts = (inp.alts || []).map(clean).filter(Boolean);
      add('kwAlt', alts.some((a) => has(a, kw)) ? 'ok' : (inp.imgCount || 0) ? 'bad' : 'warn', 1, { noImg: !(inp.imgCount || 0) });
      if (desc) add('kwDesc', has(desc, kw) ? 'ok' : 'warn', 1);
      // densidad aproximada: veces que aparece la frase / palabras del texto
      const re = new RegExp(norm(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const times = n ? (norm(text).match(re) || []).length : 0;
      const dens = n ? Math.round((times * Math.max(1, wk.length) / n) * 1000) / 10 : 0;
      add('density', dens >= 0.5 && dens <= 2.5 ? 'ok' : dens > 0 && dens <= 3.5 ? 'warn' : 'bad', 1, { n: dens, times });
    }
    const alt = Number(inp.imgCount || 0) - (inp.alts || []).map(clean).filter(Boolean).length;
    if ((inp.imgCount || 0) > 0) add('altMissing', alt <= 0 ? 'ok' : alt <= 1 ? 'warn' : 'bad', 1, { n: Math.max(0, alt) });
    if (inp.canonical && !isUrl(inp.canonical)) add('canonicalBad', 'bad', 1);
    const tot = checks.reduce((s, c) => s + c.w, 0), got = checks.reduce((s, c) => s + c.w * (c.level === 'ok' ? 1 : c.level === 'warn' ? 0.5 : 0), 0);
    const score = tot ? Math.round((got / tot) * 100) : 0;
    return { score, level: score >= 75 ? 'ok' : score >= 45 ? 'warn' : 'bad', checks: checks.filter((c) => c.w > 0) };
  }

  // ------------------------------------------------------------------ vistas previas
  function cut(s, n) {
    s = clean(s);
    if (s.length <= n) return s;
    const head = s.slice(0, n - 1), sp = head.lastIndexOf(' ');
    return (sp > n * 0.6 ? head.slice(0, sp) : head).replace(/[\s,.;:–-]+$/, '') + '…';
  }
  // Ruta tipo Google: «web.com › carpeta › entrada» (con la canónica, su dirección; si no, la de esta web y la dirección de la entrada)
  function googleUrl(host, slug, canonical) {
    if (canonical && isUrl(canonical)) {
      const u = new URL(canonical);
      return [u.host.replace(/^www\./, ''), ...u.pathname.split('/').filter(Boolean)].join(' › ');
    }
    return [String(host || '').replace(/^https?:\/\//, '').replace(/\/$/, ''), clean(slug)].filter(Boolean).join(' › ');
  }
  // Tarjetas al compartir: lo escrito para redes y, si falta, el título, la descripción y la imagen de la entrada.
  // X (Twitter) cae en lo de Facebook y este en lo general (como hacen Yoast y Rank Math).
  function social(inp) {
    const host = clean(inp.host).replace(/^https?:\/\//, '').replace(/\/$/, '');
    const title = clean(inp.ogTitle) || clean(inp.seoTitle) || clean(inp.title) || '';
    const desc = clean(inp.ogDesc) || clean(inp.desc) || '';
    const image = clean(inp.ogImage) || clean(inp.featured) || '';
    const xt = clean(inp.twTitle) || title, xd = clean(inp.twDesc) || desc, xi = clean(inp.twImage) || image;
    return {
      fb: { host: host.toUpperCase(), title: cut(title, 88), desc: cut(desc, 160), image, own: { title: !!clean(inp.ogTitle), desc: !!clean(inp.ogDesc), image: !!clean(inp.ogImage) } },
      x: { host, title: cut(xt, 70), desc: cut(xd, 125), image: xi, card: xi ? 'summary_large_image' : 'summary', own: { title: !!clean(inp.twTitle), desc: !!clean(inp.twDesc), image: !!clean(inp.twImage) } },
    };
  }

  // Qué se podrá guardar con el estado del plugin: devuelve los campos y un texto de aviso (código) si algo no se puede
  function capability(info) {
    if (!info || !info.plugin) return { can: false, why: 'noPlugin', fields: [] };
    if (!info.helper) return { can: false, why: 'noHelper', fields: [] };
    return { can: true, why: info.plugin === 'yoast' && !info.premium ? 'noPremium' : '', fields: writableFields(info.plugin, info.premium) };
  }

  const api = { FIELDS, TEXT, META, PLUGINS, RM_TW_SWITCH, allowedKeys, writableFields, sanitize, toMeta, fromMeta, diff, splitKw, joinKw, analyze, cut, googleUrl, social, capability, norm, slugOf, isUrl, TITLE, DESC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SeoMeta = api;
})(typeof window !== 'undefined' ? window : globalThis);
