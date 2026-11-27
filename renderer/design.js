// Panel de diseño universal (lógica pura, sin DOM): espaciado, bordes, esquinas, sombra, fondo, ancho, alineación, por dispositivo,
// animaciones y tipografía de CUALQUIER bloque. La usan el editor de bloques (renderer/blocks/style.js), la salida a WordPress
// (src/transform.js: decorate) y la lectura de vuelta (src/parseblocks.js: read).
//
// Dónde va cada cosa en la salida:
//  · bloques que lo soportan (párrafo, título, lista, cita, imagen y texto, sección, columnas, portada, botones, desplegable):
//    atributos estándar de WordPress (style.spacing, style.border, style.shadow, style.color, align) → editables en WordPress;
//  · el resto (imagen, vídeo, tabla, galería, mapa, carrusel…) y lo que WordPress no tiene (por dispositivo, animación,
//    fuentes, degradado en el texto…): clases ecos-* con su CSS en el bloque ecos-fx (o en ecos.css del complemento).
(function (root) {
  const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i;
  const has = (v) => v !== undefined && v !== null && v !== '';
  const int = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
  const SK = () => root.Sections || (typeof require !== 'undefined' ? require('./sections') : null);

  // --- Valores permitidos ------------------------------------------------------------------------------------------
  const SC = [0, 8, 16, 32, 64, 96]; // escala de espacios en px: 0, XS, S, M, L, XL
  const SC_N = ['0', 'XS', 'S', 'M', 'L', 'XL'];
  const snap = (v) => { const n = Number(v); return SC.reduce((a, x) => (Math.abs(x - n) < Math.abs(a - n) ? x : a), 0); };
  const SHADOWS = { s: '0 2px 6px rgba(0, 0, 0, 0.14)', m: '6px 6px 9px rgba(0, 0, 0, 0.2)', l: '0 18px 40px rgba(0, 0, 0, 0.3)' };
  const SHADOW_N = { s: 'Suave', m: 'Media', l: 'Fuerte' };
  const RADII = [0, 8, 16, 28, 999];
  const BW = [1, 2, 4, 8];
  const BS = ['solid', 'dashed', 'dotted'];
  const LH = ['1.2', '1.4', '1.6', '1.8', '2'];
  const TT = ['uppercase', 'lowercase', 'capitalize'];
  const FSM = [14, 16, 18, 20, 24, 28, 32, 40];
  const ANIMS = ['fade', 'up', 'left', 'right', 'zoom'];
  const DUR = [300, 600, 900, 1200];
  const DELAY = [0, 150, 300, 600, 900, 1200];
  const SPACINGS = ['0.5px', '1px', '2px', '4px']; // espaciado de letras (igual que el de la barra de formato)
  const FONTS = [
    ['inter', 'Inter', 'Inter:wght@400;700', 'sans-serif'], ['roboto', 'Roboto', 'Roboto:wght@400;700', 'sans-serif'],
    ['open-sans', 'Open Sans', 'Open+Sans:wght@400;700', 'sans-serif'], ['lato', 'Lato', 'Lato:wght@400;700', 'sans-serif'],
    ['montserrat', 'Montserrat', 'Montserrat:wght@400;700', 'sans-serif'], ['poppins', 'Poppins', 'Poppins:wght@400;700', 'sans-serif'],
    ['nunito', 'Nunito', 'Nunito:wght@400;700', 'sans-serif'], ['raleway', 'Raleway', 'Raleway:wght@400;700', 'sans-serif'],
    ['merriweather', 'Merriweather', 'Merriweather:wght@400;700', 'serif'], ['playfair-display', 'Playfair Display', 'Playfair+Display:wght@400;700', 'serif'],
    ['lora', 'Lora', 'Lora:wght@400;700', 'serif'], ['source-serif', 'Source Serif', 'Source+Serif+4:wght@400;700', 'serif'],
    ['work-sans', 'Work Sans', 'Work+Sans:wght@400;700', 'sans-serif'], ['rubik', 'Rubik', 'Rubik:wght@400;700', 'sans-serif'],
    ['karla', 'Karla', 'Karla:wght@400;700', 'sans-serif'], ['dm-sans', 'DM Sans', 'DM+Sans:wght@400;700', 'sans-serif'],
    ['quicksand', 'Quicksand', 'Quicksand:wght@400;700', 'sans-serif'], ['oswald', 'Oswald', 'Oswald:wght@400;700', 'sans-serif'],
    ['bebas-neue', 'Bebas Neue', 'Bebas+Neue', 'sans-serif'], ['caveat', 'Caveat', 'Caveat:wght@400;700', 'cursive'],
  ].map(([slug, name, q, generic]) => ({ slug, name, q, family: `"${name === 'Source Serif' ? 'Source Serif 4' : name}",${generic === 'cursive' ? 'cursive' : 'system-ui,' + generic}` }));
  const fontBySlug = (s) => FONTS.find((f) => f.slug === s);
  // Enlace de Google Fonts con las familias pedidas (solo las que se usan)
  const fontsUrl = (slugs) => {
    const fam = [...new Set(slugs)].map(fontBySlug).filter(Boolean).map((f) => 'family=' + f.q);
    return fam.length ? `https://fonts.googleapis.com/css2?${fam.join('&')}&display=swap` : '';
  };
  const TG = () => (SK()?.GRADIENTS || []).map((g) => g.css); // degradados para el texto (los mismos que el fondo)

  // Claves de diseño de un bloque (lo que se copia con «Copiar estilo»; el contenido no cuenta)
  const DESIGN_KEYS = ['mt', 'mb', 'p', 'bw', 'bs', 'bc', 'rd', 'sh', 'bg', 'gradient', 'fbg', 'fgr', 'bgi', 'wd', 'da', 'hm', 'ht', 'hd', 'fsm', 'pm', 'an', 'ad', 'ay', 'lh', 'tt', 'tg', 'hl', 'gf'];
  const STYLE_KEYS = ['size', 'font', 'color', 'spacing', 'shadow', 'dropCap']; // formato de texto (solo entre bloques de texto)
  const TEXT_TYPES = ['paragraph', 'heading', 'quote', 'list'];
  // bloques cuyo color/degradado de fondo es b.bg / b.gradient (el resto usa fbg / fgr, para no mezclarlo con el color del texto o del botón)
  const bgKeys = (type) => (['paragraph', 'heading', 'list', 'quote', 'group', 'columns'].includes(type) ? ['bg', 'gradient'] : ['fbg', 'fgr']);

  // --- Qué bloque de WordPress admite qué ----------------------------------------------------------------------------
  const STD = new Set(['paragraph', 'heading', 'list', 'quote', 'pullquote', 'media-text', 'group', 'columns', 'buttons', 'details', 'cover']);
  const NATIVE_W = new Set(['group', 'columns', 'cover', 'media-text', 'image', 'video', 'embed', 'table', 'gallery', 'pullquote', 'separator', 'details']);
  const TEXT_STD = new Set(['paragraph', 'heading', 'list', 'quote', 'pullquote', 'media-text']); // interlineado y mayúsculas: los escribe blockStyle
  const OWN_ALIGN = ['paragraph', 'heading', 'buttons', 'image', 'video']; // tipos de Ecos con su propia alineación (b.align)

  // --- FNV-1a: huella corta para las clases de imagen de fondo ---------------------------------------------------------
  const hash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const hex6 = (c) => {
    const m = String(c || '').match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return '';
    return (m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1]).toLowerCase();
  };
  const ANCHOR = /^[a-z0-9]{4,12}$/; // ancla de bloque para las notas de revisión
  const SAFE_URL = /^https?:\/\/[^\s"'()<>\\]+$/i;
  const cleanBgi = (g) => {
    if (!g || !SAFE_URL.test(g.url || '')) return null;
    const f = (v) => Math.round(Math.max(0, Math.min(1, Number.isFinite(Number(v)) ? Number(v) : 0.5)) * 100);
    return { url: g.url, x: f(g.x ?? 0.5) / 100, y: f(g.y ?? 0.5) / 100, dim: Math.max(0, Math.min(80, Math.round((Number(g.dim) || 0) / 10) * 10)) };
  };
  const bgiRule = (g) => {
    const x = Math.round(g.x * 100), y = Math.round(g.y * 100);
    const h = hash(`${g.url}|${x}|${y}|${g.dim}`);
    const veil = g.dim ? `linear-gradient(rgba(0,0,0,${g.dim / 100}),rgba(0,0,0,${g.dim / 100})),` : '';
    return { cls: 'ecos-d-bgi-' + h, rule: `.ecos-d-bgi-${h}{background-image:${veil}url("${g.url}");background-size:cover;background-position:${x}% ${y}%}` };
  };
  // Lee las reglas de fondo con imagen de un bloque de estilos ecos-fx: huella → { url, x, y, dim }
  function parseBgiRules(css) {
    const out = {};
    const re = /\.ecos-d-bgi-([0-9a-f]{8})\{background-image:(?:linear-gradient\(rgba\(0,0,0,([\d.]+)\),rgba\(0,0,0,[\d.]+\)\),)?url\("([^"]+)"\);background-size:cover;background-position:(\d+)% (\d+)%\}/g;
    for (let m; (m = re.exec(String(css || '')));) out[m[1]] = { url: m[3], x: Number(m[4]) / 100, y: Number(m[5]) / 100, dim: m[2] ? Math.round(Number(m[2]) * 100) : 0 };
    return out;
  }

  // --- CSS de las clases (todas estáticas salvo color, resaltado e imagen de fondo, que van por reglas dinámicas) ---------------
  const BP_M = '(max-width:599px)', BP_T = '(min-width:600px) and (max-width:1024px)', BP_D = '(min-width:1025px)';
  const TXT = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,summary,td,th,cite,a,span';
  const CSS = {};
  const sel = (c, deep) => (deep ? `.${c},.${c} :where(${TXT})` : `.${c}`);
  SC.forEach((v) => {
    CSS[`ecos-d-mt-${v}`] = `.ecos-d-mt-${v}{margin-top:${v}px!important}`;
    CSS[`ecos-d-mb-${v}`] = `.ecos-d-mb-${v}{margin-bottom:${v}px!important}`;
    for (const [k, side] of [['pt', 'top'], ['pr', 'right'], ['pb', 'bottom'], ['pl', 'left']]) CSS[`ecos-d-${k}-${v}`] = `.ecos-d-${k}-${v}{padding-${side}:${v}px!important}`;
    CSS[`ecos-m-p-${v}`] = `@media ${BP_M}{.ecos-m-p-${v}{padding:${v}px!important}}`;
  });
  BW.forEach((v) => { CSS[`ecos-d-bw-${v}`] = `.ecos-d-bw-${v}{border-width:${v}px;border-style:solid}`; });
  BS.slice(1).forEach((v) => { CSS[`ecos-d-bs-${v}`] = `.ecos-d-bs-${v}{border-style:${v}!important}`; });
  RADII.forEach((v) => { CSS[`ecos-d-rd-${v}`] = `.ecos-d-rd-${v}{border-radius:${v}px;overflow:hidden}`; });
  Object.entries(SHADOWS).forEach(([k, v]) => { CSS[`ecos-d-sh-${k}`] = `.ecos-d-sh-${k}{box-shadow:${v}}`; });
  CSS['ecos-d-w-wide'] = '.ecos-d-w-wide{width:min(1100px,calc(100vw - 2rem));max-width:none;position:relative;left:50%;transform:translateX(-50%)}';
  CSS['ecos-d-w-full'] = '.ecos-d-w-full{width:100vw;max-width:100vw;position:relative;left:50%;transform:translateX(-50%)}';
  ['left', 'center', 'right'].forEach((v) => { CSS[`ecos-d-al-${v}`] = `.ecos-d-al-${v}{text-align:${v}}.ecos-d-al-${v} .wp-block-buttons{justify-content:${v === 'left' ? 'flex-start' : v === 'right' ? 'flex-end' : 'center'}}`; });
  CSS['ecos-hide-m'] = `@media ${BP_M}{.ecos-hide-m{display:none!important}}`;
  CSS['ecos-hide-t'] = `@media ${BP_T}{.ecos-hide-t{display:none!important}}`;
  CSS['ecos-hide-d'] = `@media ${BP_D}{.ecos-hide-d{display:none!important}}`;
  FSM.forEach((v) => { CSS[`ecos-m-fs-${v}`] = `@media ${BP_M}{${sel(`ecos-m-fs-${v}`, true)}{font-size:${v}px!important}}`; });
  LH.forEach((v) => { CSS[`ecos-d-lh-${v.replace('.', '')}`] = `${sel(`ecos-d-lh-${v.replace('.', '')}`, true)}{line-height:${v}}`; });
  TT.forEach((v, k) => { CSS[`ecos-d-tt-${k}`] = `${sel(`ecos-d-tt-${k}`, true)}{text-transform:${v}}`; });
  FONTS.forEach((f) => { CSS[`ecos-font-${f.slug}`] = `${sel(`ecos-font-${f.slug}`, true)}{font-family:${f.family}}`; });
  // Animaciones al aparecer: el contenido solo se oculta cuando el guion ya está funcionando (clase ecos-js en <html>)
  const ANIM_FROM = { fade: 'opacity:0', up: 'opacity:0;transform:translateY(32px)', left: 'opacity:0;transform:translateX(-40px)', right: 'opacity:0;transform:translateX(40px)', zoom: 'opacity:0;transform:scale(.88)' };
  ANIMS.forEach((a) => { CSS[`ecos-anim-${a}`] = `.ecos-js .ecos-anim-${a}:not(.ecos-in){${ANIM_FROM[a]}}`; });
  DUR.forEach((v) => { CSS[`ecos-ad-${v}`] = `.ecos-ad-${v}{--ecos-ad:${v}ms}`; });
  DELAY.slice(1).forEach((v) => { CSS[`ecos-ay-${v}`] = `.ecos-ay-${v}{--ecos-ay:${v}ms}`; });
  CSS.anim = '[class*="ecos-anim-"]{transition:opacity var(--ecos-ad,600ms) ease var(--ecos-ay,0ms),transform var(--ecos-ad,600ms) cubic-bezier(.2,0,0,1) var(--ecos-ay,0ms)}@media (prefers-reduced-motion:reduce){[class*="ecos-anim-"]{opacity:1!important;transform:none!important;transition:none!important}}';
  // Texto con degradado (los degradados predefinidos) y resaltado decorativo (subrayado grueso de color)
  const tgRule = (i, g) => `${sel(`ecos-d-tg-${i}`, true)}{background:${g}!important;-webkit-background-clip:text;background-clip:text;color:transparent!important;-webkit-text-fill-color:transparent}`;
  const hlRule = (hex) => `${sel(`ecos-d-hl-${hex}`, true)}{text-decoration:underline;text-decoration-color:#${hex};text-decoration-thickness:.32em;text-underline-offset:.08em;text-decoration-skip-ink:none}`;
  TG().forEach((g, i) => { CSS[`ecos-d-tg-${i}`] = tgRule(i, g); });
  const dynRule = (cls) => {
    let m;
    if ((m = cls.match(/^ecos-d-bc-([0-9a-f]{6})$/))) return `.${cls}{border-color:#${m[1]}}`;
    if ((m = cls.match(/^ecos-d-bgc-([0-9a-f]{6})$/))) return `.${cls}{background-color:#${m[1]}}`;
    if ((m = cls.match(/^ecos-d-hl-([0-9a-f]{6})$/))) return hlRule(m[1]);
    return '';
  };
  // Color de resaltado de la paleta (para que el CSS común del complemento ya lo traiga)
  ['fd9800', 'b3202a', '0f172a', 'fff9e0', 'ffffff', 'f3f4f6', 'd1d5db', '6b7280', '374151', '000000'].forEach((h) => {
    CSS[`ecos-d-hl-${h}`] = hlRule(h); CSS[`ecos-d-bc-${h}`] = dynRule(`ecos-d-bc-${h}`); CSS[`ecos-d-bgc-${h}`] = dynRule(`ecos-d-bgc-${h}`);
  });

  // --- Salida: de las propiedades de diseño de un bloque a atributos, clases y estilos --------------------------------------
  // name: bloque de WordPress sin «core/» (paragraph, group, image, html…). force: todo con clases (vista previa del editor).
  function plan(b, name, force = false) {
    const std = !force && STD.has(name);
    const P = { attrs: {}, cls: [], custom: [], css: {}, fx: [], dyn: [] };
    const st = {};
    const addCls = (c) => { P.cls.push(c); P.custom.push(c); P.fx.push(c); };
    const stdCls = (c) => P.cls.push(c);
    const dyn = (c) => { const r = dynRule(c); if (r) { P.dyn.push(r); P.fx.push('dyn:' + r); } addCls(c); };
    const space = (v) => (std ? int(v, 0, 200) : snap(v));
    // espaciado exterior e interior
    for (const [k, side] of [['mt', 'top'], ['mb', 'bottom']]) {
      if (!has(b[k]) || !Number.isFinite(Number(b[k]))) continue;
      const v = space(b[k]);
      if (v === null) continue;
      if (std) { (st.spacing = st.spacing || {}).margin = { ...(st.spacing.margin || {}), [side]: v + 'px' }; P.css['margin-' + side] = v + 'px'; } else addCls(`ecos-d-${k}-${v}`);
    }
    const p = b.p && typeof b.p === 'object' ? b.p : null;
    if (p) {
      for (const [k, side] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) {
        if (!has(p[k]) || !Number.isFinite(Number(p[k]))) continue;
        const v = space(p[k]);
        if (v === null) continue;
        if (std) { (st.spacing = st.spacing || {}).padding = { ...(st.spacing.padding || {}), [side]: v + 'px' }; P.css['padding-' + side] = v + 'px'; } else addCls(`ecos-d-p${k}-${v}`);
      }
    }
    // borde, esquinas y sombra
    const bc = SAFE_COLOR.test(b.bc || '') ? b.bc : '', bs = BS.includes(b.bs) ? b.bs : '';
    const bw = BW.includes(Number(b.bw)) ? Number(b.bw) : (bc || bs) && !has(b.bw) ? 1 : 0;
    if (bw) {
      if (std) {
        st.border = { ...(st.border || {}), width: bw + 'px', style: bs || 'solid' };
        P.css['border-width'] = bw + 'px'; P.css['border-style'] = bs || 'solid';
        if (bc) { st.border.color = bc; P.css['border-color'] = bc; stdCls('has-border-color'); }
      } else {
        addCls(`ecos-d-bw-${bw}`);
        if (bs && bs !== 'solid') addCls(`ecos-d-bs-${bs}`);
        if (hex6(bc)) dyn(`ecos-d-bc-${hex6(bc)}`);
      }
    }
    if (has(b.rd) && Number.isFinite(Number(b.rd))) {
      const v = std ? int(b.rd, 0, 999) : RADII.reduce((a, x) => (Math.abs(x - Number(b.rd)) < Math.abs(a - Number(b.rd)) ? x : a), 0);
      if (v !== null) { if (std) { st.border = { ...(st.border || {}), radius: v + 'px' }; P.css['border-radius'] = v + 'px'; } else addCls(`ecos-d-rd-${v}`); }
    }
    if (SHADOWS[b.sh]) { if (std) { st.shadow = SHADOWS[b.sh]; P.css['box-shadow'] = SHADOWS[b.sh]; } else addCls('ecos-d-sh-' + b.sh); }
    // fondo: color, degradado e imagen (con punto focal y oscurecido)
    const [kc, kg] = bgKeys(b.type);
    if (kc === 'fbg' && name !== 'cover') {
      const grad = SK()?.safeGradient(b[kg]) || '';
      if (grad || SAFE_COLOR.test(b[kc] || '')) {
        if (std) {
          st.color = grad ? { gradient: grad } : { background: b[kc] };
          P.css[grad ? 'background' : 'background-color'] = grad || b[kc];
          stdCls('has-background');
        } else if (grad) { const i = (SK()?.GRADIENTS || []).findIndex((g) => g.css === grad); if (i >= 0) addCls('ecos-d-bgg-' + i); } else if (hex6(b[kc])) dyn('ecos-d-bgc-' + hex6(b[kc]));
      }
    }
    const bgi = name === 'cover' ? null : cleanBgi(b.bgi);
    if (bgi) { const r = bgiRule(bgi); P.dyn.push(r.rule); P.fx.push('dyn:' + r.rule); addCls(r.cls); }
    // ancho y alineación
    const wd = ['wide', 'full'].includes(b.wd) ? b.wd : '';
    if (wd) { if (!force && NATIVE_W.has(name)) { P.attrs.align = wd; stdCls('align' + wd); } else addCls('ecos-d-w-' + wd); }
    if (['left', 'center', 'right'].includes(b.da) && !OWN_ALIGN.includes(b.type)) addCls('ecos-d-al-' + b.da);
    // por dispositivo
    if (b.hm) addCls('ecos-hide-m');
    if (b.ht) addCls('ecos-hide-t');
    if (b.hd) addCls('ecos-hide-d');
    if (FSM.includes(Number(b.fsm))) addCls('ecos-m-fs-' + Number(b.fsm));
    if (has(b.pm) && SC.includes(Number(b.pm))) addCls('ecos-m-p-' + Number(b.pm));
    // animación al aparecer
    if (ANIMS.includes(b.an)) {
      addCls('ecos-anim-' + b.an);
      if (DUR.includes(Number(b.ad)) && Number(b.ad) !== 600) addCls('ecos-ad-' + Number(b.ad));
      if (DELAY.includes(Number(b.ay)) && Number(b.ay) > 0) addCls('ecos-ay-' + Number(b.ay));
      P.fx.push('anim');
    }
    // tipografía (interlineado y mayúsculas de los bloques de texto los escribe blockStyle)
    if (!TEXT_STD.has(name) || force) {
      if (LH.includes(String(b.lh))) addCls('ecos-d-lh-' + String(b.lh).replace('.', ''));
      const ti = TT.indexOf(b.tt); if (ti >= 0) addCls('ecos-d-tt-' + ti);
    }
    if (b.tg) { const i = TG().indexOf(b.tg); if (i >= 0) addCls('ecos-d-tg-' + i); }
    if (hex6(b.hl)) dyn('ecos-d-hl-' + hex6(b.hl));
    if (fontBySlug(b.gf)) addCls('ecos-font-' + b.gf);
    // ancla estable para las notas de revisión (renderer/editorial.js): clase ecos-a-<id corto>, sin CSS ni efectos
    if (ANCHOR.test(b.anc || '')) { P.cls.push('ecos-a-' + b.anc); P.custom.push('ecos-a-' + b.anc); }
    if (st.spacing || st.border || st.shadow || st.color) P.attrs.style = st;
    return P;
  }
  const isEmpty = (P) => !P.cls.length && !Object.keys(P.attrs).length;
  const hasDesign = (b) => ANCHOR.test(b.anc || '') || DESIGN_KEYS.some((k) => has(b[k]) && !(typeof b[k] === 'object' && !Object.keys(b[k]).length));

  // --- Aplicar el plan al HTML de un bloque ya escrito (solo la etiqueta exterior y el comentario de WordPress) ----------------
  const splitDecls = (s) => { const out = []; let cur = '', depth = 0; for (const ch of String(s)) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ';' && !depth) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const merge = (dst, src) => { for (const [k, v] of Object.entries(src)) { if (isObj(v) && isObj(dst[k])) merge(dst[k], v); else dst[k] = isObj(v) ? JSON.parse(JSON.stringify(v)) : v; } return dst; };
  function decorate(markup, b, onFx) {
    const m = String(markup).match(/^<!-- wp:([a-z0-9/-]+)(?: (\{[\s\S]*?\}))? (\/)?-->(\n)?/);
    if (!m) return markup;
    const name = m[1].replace(/^core\//, ''), selfClose = !!m[3];
    const P = plan(b, name);
    if (isEmpty(P)) return markup;
    let attrs = {};
    try { attrs = m[2] ? JSON.parse(m[2]) : {}; } catch { return markup; }
    // bloque sin HTML propio (Spectra): solo clases propias en el atributo className
    const rest = markup.slice(m[0].length);
    const tag = selfClose ? null : rest.match(/^<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>/);
    if (!selfClose && !tag) return markup;
    // lo que ya llevaba el bloque (p. ej. foto a un lado) no se pisa
    if (P.attrs.align && attrs.align) { delete P.attrs.align; P.cls = P.cls.filter((c) => !/^align(wide|full)$/.test(c)); }
    merge(attrs, P.attrs);
    if (P.custom.length) attrs.className = [...new Set([...(attrs.className ? String(attrs.className).split(/\s+/) : []), ...P.custom])].join(' ');
    // etiqueta exterior: clases y estilos
    let html = rest;
    if (tag) {
      let attrStr = tag[2];
      const cm = attrStr.match(/\sclass="([^"]*)"/), sm = attrStr.match(/\sstyle="([^"]*)"/);
      const classes = [...new Set([...(cm ? cm[1].split(/\s+/).filter(Boolean) : []), ...P.cls])];
      const decls = sm ? splitDecls(sm[1]) : [];
      const idx = (p) => decls.findIndex((x) => x.slice(0, x.indexOf(':')).trim().toLowerCase() === p);
      for (const [k, v] of Object.entries(P.css)) { const i = idx(k); const d = `${k}:${v}`; if (i >= 0) decls[i] = d; else decls.push(d); }
      // el color del degradado sustituye al color liso
      if (P.css.background && idx('background-color') >= 0) decls.splice(idx('background-color'), 1);
      if (P.css['background-color'] && idx('background') >= 0) decls.splice(idx('background'), 1);
      attrStr = attrStr.replace(/\sclass="[^"]*"/, '').replace(/\sstyle="[^"]*"/, '');
      html = `<${tag[1]}${classes.length ? ` class="${classes.join(' ')}"` : ''}${attrStr}${decls.length ? ` style="${decls.join(';')}"` : ''}${tag[3] ? ' /' : ''}>` + rest.slice(tag[0].length);
    }
    P.fx.forEach((k) => onFx?.(k));
    // orden fijo de los atributos (así lo que se vuelve a enviar sale idéntico): el resto, estilo, diseño y clases propias
    const ordered = {};
    for (const k of Object.keys(attrs)) if (!['style', 'layout', 'className'].includes(k)) ordered[k] = attrs[k];
    for (const k of ['style', 'layout', 'className']) if (k in attrs) ordered[k] = attrs[k];
    const json = Object.keys(ordered).length ? ' ' + JSON.stringify(ordered).replace(/--/g, '\\u002d\\u002d') : '';
    return `<!-- wp:${m[1]}${json} ${selfClose ? '/' : ''}-->${m[4] || ''}${html}`;
  }

  // --- Lectura: de los atributos y clases de un bloque de WordPress a las propiedades de diseño --------------------------------
  // Devuelve { d, rest, ok }: d = propiedades de diseño, rest = atributos que quedan (sin lo que ya se ha leído),
  // ok = false si algún valor no es de los que Ecos escribe (el bloque se conserva tal cual).
  function read(a, name, { bgi = {} } = {}) {
    const rest = JSON.parse(JSON.stringify(a || {}));
    const d = {};
    let ok = true;
    const toks = String(rest.className || '').split(/\s+/).filter(Boolean), keep = [];
    const tgs = TG();
    for (const c of toks) {
      let m;
      if ((m = c.match(/^ecos-d-(mt|mb)-(\d+)$/))) d[m[1]] = Number(m[2]);
      else if ((m = c.match(/^ecos-d-p([trbl])-(\d+)$/))) (d.p = d.p || {})[m[1]] = Number(m[2]);
      else if ((m = c.match(/^ecos-d-bw-(\d)$/))) d.bw = Number(m[1]);
      else if ((m = c.match(/^ecos-d-bs-(dashed|dotted)$/))) d.bs = m[1];
      else if ((m = c.match(/^ecos-d-bc-([0-9a-f]{6})$/))) d.bc = '#' + m[1];
      else if ((m = c.match(/^ecos-d-rd-(\d+)$/))) d.rd = Number(m[1]);
      else if ((m = c.match(/^ecos-d-sh-([sml])$/))) d.sh = m[1];
      else if ((m = c.match(/^ecos-d-bgc-([0-9a-f]{6})$/))) d.fbg = '#' + m[1];
      else if ((m = c.match(/^ecos-d-bgg-(\d+)$/))) { const g = SK()?.GRADIENTS[Number(m[1])]; if (g) d.fgr = g.css; }
      else if ((m = c.match(/^ecos-d-bgi-([0-9a-f]{8})$/))) { if (bgi[m[1]]) d.bgi = { ...bgi[m[1]] }; }
      else if ((m = c.match(/^ecos-d-w-(wide|full)$/))) d.wd = m[1];
      else if ((m = c.match(/^ecos-d-al-(left|center|right)$/))) d.da = m[1];
      else if ((m = c.match(/^ecos-hide-([mtd])$/))) d['h' + m[1]] = true;
      else if ((m = c.match(/^ecos-m-fs-(\d+)$/))) d.fsm = Number(m[1]);
      else if ((m = c.match(/^ecos-m-p-(\d+)$/))) d.pm = Number(m[1]);
      else if ((m = c.match(/^ecos-anim-(fade|up|left|right|zoom)$/))) d.an = m[1];
      else if ((m = c.match(/^ecos-ad-(\d+)$/))) d.ad = Number(m[1]);
      else if ((m = c.match(/^ecos-ay-(\d+)$/))) d.ay = Number(m[1]);
      else if ((m = c.match(/^ecos-d-lh-(\d+)$/))) d.lh = m[1].length === 1 ? m[1] : m[1][0] + '.' + m[1].slice(1);
      else if ((m = c.match(/^ecos-d-tt-(\d)$/))) { if (TT[Number(m[1])]) d.tt = TT[Number(m[1])]; }
      else if ((m = c.match(/^ecos-d-tg-(\d+)$/))) { if (tgs[Number(m[1])]) d.tg = tgs[Number(m[1])]; }
      else if ((m = c.match(/^ecos-d-hl-([0-9a-f]{6})$/))) d.hl = '#' + m[1];
      else if ((m = c.match(/^ecos-font-([a-z-]+)$/))) { if (fontBySlug(m[1])) d.gf = m[1]; }
      else if ((m = c.match(/^ecos-a-([a-z0-9]{4,12})$/))) d.anc = m[1];
      else keep.push(c);
    }
    if (keep.length) rest.className = keep.join(' '); else delete rest.className;
    if (STD.has(name)) {
      const st = rest.style;
      if (isObj(st)) {
        const sp = st.spacing;
        if (isObj(sp)) {
          if (isObj(sp.margin)) {
            for (const [k, v] of Object.entries(sp.margin)) { if (k === 'top' || k === 'bottom') { const n = pxOf(v); if (n === null) ok = false; else d[k === 'top' ? 'mt' : 'mb'] = n; } else ok = false; }
            delete sp.margin;
          }
          if (isObj(sp.padding)) {
            for (const [k, v] of Object.entries(sp.padding)) { const key = { top: 't', right: 'r', bottom: 'b', left: 'l' }[k]; const n = pxOf(v); if (!key || n === null) ok = false; else (d.p = d.p || {})[key] = n; }
            delete sp.padding;
          }
          if (!Object.keys(sp).length) delete st.spacing;
        }
        const bd = st.border;
        if (isObj(bd)) {
          for (const [k, v] of Object.entries(bd)) {
            if (k === 'width') { const n = pxOf(v); if (BW.includes(n)) d.bw = n; else ok = false; delete bd.width; }
            else if (k === 'style') { if (BS.includes(v)) { if (v !== 'solid') d.bs = v; } else ok = false; delete bd.style; }
            else if (k === 'color') { if (SAFE_COLOR.test(String(v))) d.bc = v; else ok = false; delete bd.color; }
            else if (k === 'radius') { const n = pxOf(v); if (n !== null) d.rd = n; else ok = false; delete bd.radius; }
          }
          if (!Object.keys(bd).length) delete st.border;
        }
        if (has(st.shadow)) { const k = Object.keys(SHADOWS).find((x) => SHADOWS[x] === st.shadow); if (k) d.sh = k; else ok = false; delete st.shadow; }
        if (isObj(st.color) && name !== 'cover' && bgKeys({ 'media-text': 'mediatext', pullquote: 'quote' }[name] || name)[0] === 'fbg') {
          if (st.color.gradient) { d.fgr = st.color.gradient; delete st.color.gradient; }
          if (st.color.background) { d.fbg = st.color.background; delete st.color.background; }
          if (!Object.keys(st.color).length) delete st.color;
        }
        if (!Object.keys(st).length) delete rest.style;
      }
    }
    if (NATIVE_W.has(name) && ['wide', 'full'].includes(rest.align)) { d.wd = rest.align; delete rest.align; }
    if (d.bc && !d.bw) d.bw = 1;
    return { d, rest, ok };
  }
  const pxOf = (v) => { const m = String(v).match(/^(\d{1,3})px$/); return m ? Number(m[1]) : null; };

  // --- Copiar y pegar estilo, estilos guardados ---------------------------------------------------------------------------
  const clone = (v) => JSON.parse(JSON.stringify(v));
  // El estilo de un bloque (solo diseño y formato de texto, nunca el contenido); el fondo va con nombres neutros
  function pick(b) {
    const o = {};
    const [kc, kg] = bgKeys(b.type);
    for (const k of DESIGN_KEYS) if (has(b[k]) && !['bg', 'gradient', 'fbg', 'fgr'].includes(k)) o[k] = clone(b[k]);
    if (has(b[kc])) o.fbg = b[kc];
    if (has(b[kg])) o.fgr = b[kg];
    if (b.width === 'wide' || b.width === 'full') o.wd = b.width;
    // las secciones guardan esquinas, sombra, borde de 1 px y margen interior con sus claves de siempre
    if (b.type === 'group') {
      if (Number(b.radius) > 0 && !has(o.rd)) o.rd = Number(b.radius);
      if (b.shadow === true && !o.sh) o.sh = 'm';
      if (b.border && !o.bw) { o.bw = 1; o.bc = b.border; }
      const gp = { s: [24, 24], m: [48, 32], l: [80, 40] }[b.pad];
      if (gp && !o.p) o.p = { t: gp[0], r: gp[1], b: gp[0], l: gp[1] };
    }
    if (TEXT_TYPES.includes(b.type)) for (const k of STYLE_KEYS) if (has(b[k]) && b[k] !== false) o[k] = b[k];
    return o;
  }
  // Limpia un estilo (de una copia, de un estilo guardado o escrito a mano): solo valores permitidos
  function clean(s) {
    const o = {};
    if (!isObj(s)) return o;
    for (const k of ['mt', 'mb']) { const v = has(s[k]) ? int(s[k], 0, 200) : null; if (v !== null) o[k] = v; }
    if (has(s.pm) && SC.includes(Number(s.pm))) o.pm = Number(s.pm);
    if (isObj(s.p)) { const p = {}; for (const k of 'trbl') { const v = has(s.p[k]) ? int(s.p[k], 0, 200) : null; if (v !== null) p[k] = v; } if (Object.keys(p).length) o.p = p; }
    if (BW.includes(Number(s.bw))) o.bw = Number(s.bw);
    if (BS.includes(s.bs) && s.bs !== 'solid') o.bs = s.bs;
    if (SAFE_COLOR.test(s.bc || '')) o.bc = s.bc;
    { const v = has(s.rd) ? int(s.rd, 0, 999) : null; if (v !== null) o.rd = v; }
    if (SHADOWS[s.sh]) o.sh = s.sh;
    if (SAFE_COLOR.test(s.fbg || '')) o.fbg = s.fbg;
    if (SK()?.safeGradient(s.fgr)) o.fgr = s.fgr;
    const g = cleanBgi(s.bgi); if (g) o.bgi = g;
    if (['wide', 'full'].includes(s.wd)) o.wd = s.wd;
    if (['left', 'center', 'right'].includes(s.da)) o.da = s.da;
    for (const k of ['hm', 'ht', 'hd']) if (s[k]) o[k] = true;
    if (FSM.includes(Number(s.fsm))) o.fsm = Number(s.fsm);
    if (ANIMS.includes(s.an)) o.an = s.an;
    if (DUR.includes(Number(s.ad)) && Number(s.ad) !== 600) o.ad = Number(s.ad);
    if (DELAY.includes(Number(s.ay)) && Number(s.ay) > 0) o.ay = Number(s.ay);
    if (LH.includes(String(s.lh))) o.lh = String(s.lh);
    if (TT.includes(s.tt)) o.tt = s.tt;
    if (TG().includes(s.tg)) o.tg = s.tg;
    if (SAFE_COLOR.test(s.hl || '')) o.hl = s.hl;
    if (fontBySlug(s.gf)) o.gf = s.gf;
    if (/^\d{1,2}px$/.test(s.size || '')) o.size = s.size;
    if (['serif', 'sans', 'round', 'mono', 'hand'].includes(s.font)) o.font = s.font;
    if (SAFE_COLOR.test(s.color || '')) o.color = s.color;
    if (/^\d{1,2}(\.\d)?px$/.test(s.spacing || '')) o.spacing = s.spacing;
    if (s.shadow === true) o.shadow = true;
    if (s.dropCap === true) o.dropCap = true;
    return o;
  }
  // Pega un estilo en un bloque (sustituye su diseño; el contenido no se toca). Devuelve el bloque.
  function apply(b, style) {
    const s = clean(style);
    for (const k of DESIGN_KEYS) delete b[k];
    if (TEXT_TYPES.includes(b.type)) for (const k of STYLE_KEYS) delete b[k];
    if (b.type === 'group' || b.type === 'columns' || b.type === 'cover') { delete b.pad; delete b.radius; delete b.border; delete b.shadow; if (['wide', 'full'].includes(s.wd)) b.width = s.wd; else delete b.width; }
    const [kc, kg] = bgKeys(b.type);
    // tipos con su propia alineación (texto, título, botón): «da» es su b.align
    if (s.da && OWN_ALIGN.includes(b.type)) { if (b.type !== 'image' && b.type !== 'video') { if (s.da === 'left') delete b.align; else b.align = s.da; } delete s.da; }
    for (const [k, v] of Object.entries(s)) {
      if (k === 'fbg') { if (b.type !== 'cover') b[kc] = v; }
      else if (k === 'fgr') { if (b.type !== 'cover') b[kg] = v; }
      else if (k === 'wd') { if (!['group', 'columns', 'cover'].includes(b.type)) b.wd = v; }
      else if (k === 'bgi') { if (b.type !== 'cover') b.bgi = v; }
      else if (STYLE_KEYS.includes(k)) { if (TEXT_TYPES.includes(b.type)) b[k] = v; }
      else b[k] = v;
    }
    return b;
  }
  const makeSaved = (name, b) => ({ name: String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40), style: clean(pick(b)) });
  const validSaved = (list) => (Array.isArray(list) ? list : []).filter((x) => x && typeof x.name === 'string' && x.name.trim() && isObj(x.style)).map((x) => ({ name: x.name.trim().slice(0, 40), style: clean(x.style) }));
  // Resumen del estilo para la ficha (qué lleva)
  const summary = (style) => {
    const s = clean(style), o = [];
    if (has(s.mt) || has(s.mb) || s.p) o.push('espaciado');
    if (s.bw || s.rd || s.sh) o.push('bordes');
    if (s.fbg || s.fgr || s.bgi) o.push('fondo');
    if (s.hm || s.ht || s.hd || s.fsm || has(s.pm)) o.push('dispositivos');
    if (s.an) o.push('animación');
    if (s.lh || s.tt || s.tg || s.hl || s.gf || s.size || s.font) o.push('tipografía');
    return o;
  };
  const isHidden = (b, dev) => !!b[{ mobile: 'hm', tablet: 'ht', desktop: 'hd' }[dev]];

  // --- Vista previa en el editor: las mismas clases (menos las de ancho, dispositivo y animación) y sus reglas ---------------------
  function preview(b) {
    const P = plan(b, 'html', true);
    const skip = /^ecos-(hide|anim|ad|ay|m-fs|m-p|d-w)-/;
    const cls = P.custom.filter((c) => !skip.test(c));
    return { cls, fx: P.fx.filter((k) => !/^(anim|ecos-(hide|anim|ad|ay|m-fs|m-p|d-w)-)/.test(k)) };
  }
  // Todo el CSS estático de las clases ecos-d-*, ecos-font-* y demás (para el editor y para el complemento: ecos.css)
  const STATIC_CSS = () => Object.keys(CSS).map((k) => CSS[k]).join('\n');

  const api = {
    SC, SC_N, SHADOWS, SHADOW_N, RADII, BW, BS, LH, TT, FSM, ANIMS, DUR, DELAY, SPACINGS, FONTS, fontBySlug, fontsUrl, TG, DESIGN_KEYS, STYLE_KEYS, TEXT_TYPES, OWN_ALIGN,
    bgKeys, STD, NATIVE_W, CSS, dynRule, plan, decorate, read, hasDesign, parseBgiRules, bgiRule, cleanBgi, hex6, snap,
    pick, clean, apply, makeSaved, validSaved, summary, isHidden, preview, STATIC_CSS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Design = api;
})(typeof window !== 'undefined' ? window : globalThis);
