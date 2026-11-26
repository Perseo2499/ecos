// Estilos de la web (tema de WordPress): paleta de colores, degradados, tamaños de letra y familias tipográficas.
// Se leen del complemento (GET /ecos/v1/theme) o, sin él, de la API estándar (/wp/v2/global-styles/themes/<tema>), se
// normalizan y se guardan en caché en la configuración (cfg.themeStyles). transform.js y parseblocks.js consultan el
// último estado cargado (set/get) para escribir y leer las clases estándar de WordPress (has-<slug>-color…).
const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d.,\s%/deg-]+\))$/i;
const SIZE = /^[\w\s.,()%+*/-]{1,80}$/;
const FAMILY = /^[\w\s,'"\-.]{1,200}$/;
const GRADIENT = /^(linear|radial)-gradient\([\w\s.,()%#-]{1,300}\)$/i;

const text = (v) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, 60);

// Lista de un ajuste con orígenes ({ theme, custom, default } o una lista directa): tema y personalizados; si no hay, los de serie
function flat(v) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== 'object') return [];
  const own = [...(v.theme || []), ...(v.custom || [])];
  return own.length ? own : [...(v.default || [])];
}
function uniq(list, key) {
  const seen = new Set();
  return list.filter((x) => (seen.has(x[key]) ? false : seen.add(x[key])));
}

// settings: { color: { palette, gradients }, typography: { fontSizes, fontFamilies } } (como en theme.json)
function fromSettings(s) {
  s = s || {};
  const colors = uniq(flat(s.color?.palette).filter((c) => c && SLUG.test(String(c.slug)) && COLOR.test(String(c.color || '')))
    .map((c) => ({ slug: String(c.slug), name: text(c.name) || String(c.slug), color: String(c.color) })), 'slug');
  const gradients = uniq(flat(s.color?.gradients).filter((g) => g && SLUG.test(String(g.slug)) && GRADIENT.test(String(g.gradient || '')))
    .map((g) => ({ slug: String(g.slug), name: text(g.name) || String(g.slug), gradient: String(g.gradient) })), 'slug');
  const sizes = uniq(flat(s.typography?.fontSizes).filter((z) => z && SLUG.test(String(z.slug)) && SIZE.test(String(z.size || '')))
    .map((z) => ({ slug: String(z.slug), name: text(z.name) || String(z.slug), size: String(z.size) })), 'slug');
  const fonts = uniq(flat(s.typography?.fontFamilies).filter((f) => f && SLUG.test(String(f.slug)) && FAMILY.test(String(f.fontFamily || '')))
    .map((f) => ({ slug: String(f.slug), name: text(f.name) || String(f.slug), family: String(f.fontFamily) })), 'slug');
  return { colors, gradients, sizes, fonts };
}

// Respuesta del complemento (ecos/v1/theme) o de la API de estilos globales → estado normalizado
function normalize(data, source) {
  data = data || {};
  const base = fromSettings(data.settings || {});
  const astra = data.astra && typeof data.astra === 'object' ? data.astra : null;
  if (astra) {
    for (const c of Array.isArray(astra.palette) ? astra.palette : []) {
      if (c && SLUG.test(String(c.slug)) && COLOR.test(String(c.color || '')) && !base.colors.some((x) => x.slug === c.slug)) {
        base.colors.push({ slug: String(c.slug), name: text(c.name) || String(c.slug), color: String(c.color) });
      }
    }
  }
  const fam = (v) => (typeof v === 'string' && FAMILY.test(v) && v.trim() && v.trim() !== 'inherit' ? v.trim() : '');
  const th = data.theme || {};
  return {
    at: Date.now(), source: source || 'plugin',
    theme: { name: text(th.name), stylesheet: String(th.stylesheet || '').replace(/[^\w.-]/g, ''), isAstra: !!th.isAstra },
    ...base,
    bodyFont: fam(astra?.bodyFont), headingFont: fam(astra?.headingFont),
  };
}

// Lee los estilos de la web. getJson(route) → datos de la API REST. helperVersion: versión del complemento (o vacío)
const lessThan = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0; } return false; };
const helperHasTheme = (v) => !!v && !lessThan(v, '1.4.0');
async function fetchTheme(getJson, helperVersion) {
  if (helperHasTheme(helperVersion)) {
    try {
      const d = await getJson('/ecos/v1/theme');
      if (d && d.plugin === 'ecos') return normalize(d, 'plugin');
    } catch { /* se prueba la API estándar */ }
  }
  const themes = await getJson('/wp/v2/themes?status=active');
  const active = Array.isArray(themes) ? themes[0] : null;
  const sheet = String(active?.stylesheet || '').replace(/[^\w.-]/g, '');
  if (!sheet) throw new Error('No se pudo saber qué tema está activo.');
  const gs = await getJson(`/wp/v2/global-styles/themes/${sheet}`);
  const name = active?.name?.raw || active?.name?.rendered || active?.name || sheet;
  return normalize({ settings: gs?.settings, theme: { name: typeof name === 'string' ? name : sheet, stylesheet: sheet, isAstra: /^astra/.test(sheet) || active?.template === 'astra' } }, 'rest');
}

// Estado cargado (lo usan transform y parseblocks)
let state = null;
const set = (s) => { state = s && typeof s === 'object' ? s : null; };
const get = () => state;
const KINDS = { color: ['colors', 'color'], bg: ['colors', 'color'], size: ['sizes', 'size'], gradient: ['gradients', 'gradient'] };
// Valor CSS de un elemento del tema; si no se conoce (otro tema, sin caché), la variable estándar de WordPress
function value(kind, slug) {
  const [list, prop] = KINDS[kind] || [];
  const hit = list && state?.[list]?.find((x) => x.slug === slug);
  if (hit) return hit[prop];
  const preset = { color: 'color', bg: 'color', size: 'font-size', gradient: 'gradient' }[kind];
  return `var(--wp--preset--${preset}--${slug})`;
}

// --- Diseño de la página de Astra (metas de la entrada) ----------------------------------------------------------
// Modelo de Ecos: { layout: ''|'normal'|'narrow'|'wide', sidebar: ''|'none'|'left'|'right', hideTitle, hideImage, hideHeader, hideFooter, transparent: ''|'on'|'off' }
// («» = el predeterminado del tema). Nombres de las metas según Astra 4.x (ver wp-plugin/ecos/includes/theme.php).
const LAYOUT = { normal: 'normal-width-container', narrow: 'narrow-width-container', wide: 'full-width-container' };
const SIDEBAR = { none: 'no-sidebar', left: 'left-sidebar', right: 'right-sidebar' };
const TRANSP = { on: 'enabled', off: 'disabled' };
const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const ASTRA_KEYS = ['ast-site-content-layout', 'site-sidebar-layout', 'site-post-title', 'ast-featured-img', 'ast-main-header-display', 'ast-global-header-display', 'footer-sml-layout', 'footer-adv-display', 'theme-transparent-header-meta'];
const dis = (v) => (v ? 'disabled' : '');
function astraToMeta(a) {
  a = a || {};
  return {
    'ast-site-content-layout': LAYOUT[a.layout] || 'default',
    'site-sidebar-layout': SIDEBAR[a.sidebar] || 'default',
    'site-post-title': dis(a.hideTitle),
    'ast-featured-img': dis(a.hideImage),
    'ast-main-header-display': dis(a.hideHeader),
    'ast-global-header-display': dis(a.hideHeader),
    'footer-sml-layout': dis(a.hideFooter),
    'footer-adv-display': dis(a.hideFooter),
    'theme-transparent-header-meta': TRANSP[a.transparent] || 'default',
  };
}
function astraFromMeta(m) {
  if (!m || typeof m !== 'object' || !ASTRA_KEYS.some((k) => k in m)) return null; // sin complemento 1.4: no hay metas
  const d = (k) => m[k] === 'disabled';
  return {
    layout: invert(LAYOUT)[m['ast-site-content-layout']] || '',
    sidebar: invert(SIDEBAR)[m['site-sidebar-layout']] || '',
    hideTitle: d('site-post-title'), hideImage: d('ast-featured-img'),
    hideHeader: d('ast-main-header-display') || d('ast-global-header-display'), hideFooter: d('footer-sml-layout') || d('footer-adv-display'),
    transparent: invert(TRANSP)[m['theme-transparent-header-meta']] || '',
  };
}

// --- Vista previa exacta: HTML de la página con el tema → HTML aislado para el iframe de Ecos -------------------------
// Las hojas de estilo enlazadas se incrustan (la política de seguridad de la app no deja cargar CSS de otras webs), se quitan
// todos los scripts y los enlaces no navegan. fetchText(url) → texto de la hoja (o lanza si no está disponible).
const absUrl = (u, from) => { try { return new URL(u, from).href; } catch { return u; } };
const fixCssUrls = (css, from) => css.replace(/url\(\s*(['"]?)(?!data:|#)([^'")]+)\1\s*\)/g, (_m, _q, u) => `url("${absUrl(u, from)}")`)
  .replace(/@import\s+(?:url\()?\s*['"]?[^'")\s;]+['"]?\s*\)?[^;]*;/g, '');
async function prepareExact(html, fetchText, { base = '', limit = 3e6 } = {}) {
  html = String(html || '');
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].filter((m) => /rel\s*=\s*["']?stylesheet/i.test(m[0]) && !/media\s*=\s*["']print["']/i.test(m[0]));
  let total = 0;
  const texts = await Promise.all(links.map(async (m) => {
    const href = (m[0].match(/href\s*=\s*"([^"]+)"/i) || m[0].match(/href\s*=\s*'([^']+)'/i) || [])[1];
    if (!href) return '';
    const url = absUrl(href.replace(/&#038;|&amp;/g, '&'), base || undefined);
    try { return fixCssUrls(String(await fetchText(url)), url); } catch { return ''; }
  }));
  const byTag = new Map(links.map((m, i) => [m[0], texts[i]]));
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!byTag.has(tag)) return /rel\s*=\s*["']?(preload|prefetch|modulepreload|dns-prefetch|preconnect)/i.test(tag) ? '' : tag;
    const css = byTag.get(tag);
    if (!css || (total += css.length) > limit) return '';
    return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
  });
  html = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*>/gi, '');
  html = html.replace(/(<a\b[^>]*?)\shref\s*=\s*(?:"[^"]*"|'[^']*')/gi, '$1 href="javascript:void(0)"');
  return html.replace(/<form\b/gi, '<form onsubmit="return false"');
}

module.exports = { prepareExact, fixCssUrls, astraToMeta, astraFromMeta, ASTRA_KEYS, SLUG, fromSettings, normalize, fetchTheme, helperHasTheme, set, get, value };
