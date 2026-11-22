// Ecos · «Fondo de la página»: lógica pura (sirve en la app, en main.js y en las pruebas).
// Genera el CSS que pone una imagen (o un fondo sugerido) a los lados y el contenido en una tarjeta blanca,
// lo escribe al final del contenido de WordPress como un bloque HTML y lo vuelve a leer al abrir la entrada.
// Pensado para Astra; los selectores son conservadores y llevan !important porque el tema pinta sus propios fondos.
(function (root) {
  const MARK = 'ecos-pagebg';       // clase del <style>
  const FLAG = 'ecos-page-bg';      // clase del marcador que activa las reglas (body:has(.ecos-page-bg))
  const ORANGE = '#fd9800';
  const WIDTHS = [760, 960, 1200];
  const SHADOWS = ['none', 'soft', 'strong'];
  const OVERLAYS = { white: '255,255,255', black: '0,0,0', orange: '253,152,0' };

  // Fondos sin foto: degradados y tramas suaves hechos con CSS (el naranja de la web y tonos neutros)
  const PRESETS = {
    amanecer: { name: 'Amanecer', color: '#ffe9c7', image: `linear-gradient(135deg,#fff6e8 0%,#ffdca3 55%,${ORANGE} 150%)`, size: 'auto' },
    arena: { name: 'Arena', color: '#efe8da', image: 'linear-gradient(160deg,#f8f4ec 0%,#e6dccb 100%)', size: 'auto' },
    niebla: { name: 'Niebla', color: '#e3e8ee', image: 'linear-gradient(180deg,#f1f4f7 0%,#d2d9e2 100%)', size: 'auto' },
    puntos: { name: 'Puntos', color: '#fff8ee', image: 'radial-gradient(rgba(253,152,0,.35) 1.6px,transparent 1.8px)', size: '22px 22px' },
    rayas: { name: 'Rayas', color: '#fffaf2', image: 'repeating-linear-gradient(45deg,rgba(253,152,0,.14) 0 10px,transparent 10px 20px)', size: 'auto' },
    carbon: { name: 'Carbón', color: '#2a2622', image: 'linear-gradient(160deg,#3a342e 0%,#1f1c19 100%)', size: 'auto' },
  };

  const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def; };

  // Solo direcciones http(s) sin espacios ni caracteres de control; comillas, paréntesis, barras y ángulos se
  // codifican, así que la URL no puede cerrar el url("…") ni el <style> ni el atributo. Devuelve '' si no vale.
  function safeUrl(u) {
    const s = String(u == null ? '' : u).trim();
    if (!/^https?:\/\/[^\s\u0000-\u001f\u007f]+$/i.test(s) || s.length > 2000) return '';
    try { new URL(s); } catch { return ''; }
    return s.replace(/[\\"'()<>`{}|^\u0080-￿]/gu, (c) => [...new TextEncoder().encode(c)].map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join(''));
  }

  const DEFAULTS = { img: null, preset: null, fixed: true, mode: 'cover', overlay: { color: 'white', opacity: 0 }, blur: 0, width: 960, radius: 16, shadow: 'soft', margin: 40, header: false };

  // Datos en bruto (de la interfaz o leídos de WordPress) → datos limpios, o null si no hay fondo que poner
  function normalize(pb) {
    if (!pb || typeof pb !== 'object') return null;
    const url = pb.img && typeof pb.img === 'object' ? safeUrl(pb.img.url) : '';
    const preset = typeof pb.preset === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, pb.preset) ? pb.preset : null;
    if (!url && !preset) return null;
    const ov = pb.overlay && typeof pb.overlay === 'object' ? pb.overlay : {};
    const idn = Number(pb.img?.id);
    return {
      img: url ? { id: Number.isFinite(idn) && idn > 0 ? idn : 0, url: String(pb.img.url).trim() } : null,
      preset: url ? null : preset,
      fixed: pb.fixed !== false,
      mode: pb.mode === 'repeat' ? 'repeat' : 'cover',
      overlay: { color: Object.prototype.hasOwnProperty.call(OVERLAYS, ov.color) ? ov.color : 'white', opacity: num(ov.opacity, 0, 80, 0) },
      blur: num(pb.blur, 0, 12, 0),
      width: WIDTHS.includes(Number(pb.width)) ? Number(pb.width) : 960,
      radius: num(pb.radius, 0, 48, 16),
      shadow: SHADOWS.includes(pb.shadow) ? pb.shadow : 'soft',
      margin: num(pb.margin, 0, 120, 40),
      header: pb.header === true,
    };
  }

  const SHADOW_CSS = { none: 'none', soft: '0 6px 30px rgba(0,0,0,.12)', strong: '0 12px 48px rgba(0,0,0,.30)' };

  // Capas del fondo: velo + imagen/trama. Devuelve { image, size, repeat, color }
  function layers(c) {
    const rgba = c.overlay.opacity > 0 ? `rgba(${OVERLAYS[c.overlay.color]},${(c.overlay.opacity / 100).toFixed(2)})` : '';
    const L = [], S = [], R = [];
    if (rgba) { L.push(`linear-gradient(${rgba},${rgba})`); S.push('100% 100%'); R.push('no-repeat'); }
    let color = '#fff';
    if (c.img) {
      L.push(`url("${safeUrl(c.img.url)}")`);
      S.push(c.mode === 'repeat' ? 'auto' : 'cover'); R.push(c.mode === 'repeat' ? 'repeat' : 'no-repeat');
    } else {
      const p = PRESETS[c.preset]; color = p.color;
      L.push(p.image); S.push(p.size); R.push(p.size === 'auto' ? 'no-repeat' : 'repeat');
    }
    return { image: L.join(','), size: S.join(','), repeat: R.join(','), color };
  }

  // CSS completo. '' si no hay fondo (sin pageBg no cambia nada).
  function css(pb) {
    const c = normalize(pb);
    if (!c) return '';
    const B = `html body:has(.${FLAG})`;
    const l = layers(c);
    const pos = c.img && c.mode === 'cover' ? 'center center' : '0 0';
    const att = c.fixed ? 'fixed' : 'scroll';
    const blurred = c.blur > 0;
    const bleed = c.blur * 3;
    const out = [];
    // 1) Fondo: en el propio body, o (con desenfoque) en un pseudo-elemento que lleva el filtro
    if (!blurred) {
      out.push(`${B}{background-color:${l.color}!important;background-image:${l.image}!important;background-size:${l.size}!important;background-repeat:${l.repeat}!important;background-position:${pos}!important;background-attachment:${att}!important}`);
    } else {
      // fija: sobra por los cuatro lados (los bordes difuminados quedan fuera de la pantalla); si se desplaza, solo
      // por arriba y abajo para no crear scroll horizontal
      out.push(`${B}{background-color:${l.color}!important;background-image:none!important;position:relative}`);
      out.push(`${B}::before{content:"";position:${c.fixed ? 'fixed' : 'absolute'};${c.fixed ? `inset:-${bleed}px` : `top:-${bleed}px;bottom:-${bleed}px;left:0;right:0`};z-index:-1;pointer-events:none;background-image:${l.image};background-size:${l.size};background-repeat:${l.repeat};background-position:${pos};filter:blur(${c.blur}px);clip-path:inset(${bleed}px ${c.fixed ? bleed : 0}px)}`);
    }
    // 2) Contenedores de Astra (layouts «plain» y «separate») sin fondo para que se vea el de la página
    const clear = ['#page', '.hfeed.site', '.site-content', '.ast-container', '.ast-plain-container .site-content', '.ast-plain-container #primary',
      '.ast-separate-container .site-main', '.site-main', '.ast-separate-container .ast-article-single', '.ast-separate-container .ast-article-post',
      '.ast-separate-container .ast-archive-description', '.ast-separate-container #primary', '.ast-plain-container .ast-article-single'];
    out.push(`${clear.map((s) => `${B} ${s}`).join(',')}{background:transparent!important;background-image:none!important}`);
    // 3) Cabecera: blanca (por defecto) o transparente sobre el fondo
    const head = ['#masthead', '.site-header', '.main-header-bar', '.ast-primary-header-bar', '.ast-above-header', '.ast-below-header', '.main-header-bar-wrap'];
    out.push(c.header ? `${head.map((s) => `${B} ${s}`).join(',')}{background:transparent!important;border-bottom-color:transparent!important}`
      : `${B} #masthead,${B} .site-header{background-color:#fff!important}`);
    // 4) La tarjeta blanca centrada
    out.push(`${B} #primary{box-sizing:border-box!important;float:none!important;width:calc(100% - 32px)!important;max-width:${c.width}px!important;margin:${c.margin}px auto!important;padding:clamp(20px,4vw,48px)!important;background:#fff!important;border-radius:${c.radius}px!important;box-shadow:${SHADOW_CSS[c.shadow]}!important}`);
    out.push(`${B} #primary .ast-article-single,${B} #primary article{padding:0!important;margin:0!important;border:0!important;box-shadow:none!important;background:transparent!important}`);
    out.push(`${B} #primary img{max-width:100%;height:auto}`);
    out.push(`${B} .ast-container{max-width:100%!important;padding-left:0!important;padding-right:0!important}`);
    // 5) Móvil: tarjeta casi a todo el ancho y el fondo se desplaza (los móviles no soportan bien «fixed»)
    out.push(`@media (max-width:767px){${B}{background-attachment:scroll!important}${blurred && c.fixed ? `${B}::before{position:absolute;inset:auto;top:-${bleed}px;bottom:-${bleed}px;left:0;right:0;clip-path:inset(${bleed}px 0)}` : ''}${B} #primary{width:calc(100% - 20px)!important;margin:12px auto!important;padding:20px 16px!important;border-radius:${Math.min(c.radius, 16)}px!important}}`);
    return out.join('\n');
  }

  // JSON apto para ir dentro de un atributo con comillas simples y dentro de <style>: < > & ' pasan a \uXXXX
  const escJson = (o) => JSON.stringify(o).replace(/[<>&'\u2028\u2029]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));

  // Bloque HTML de WordPress que se añade al final del contenido ('' si no hay fondo)
  function block(pb) {
    const c = normalize(pb);
    if (!c) return '';
    return `<!-- wp:html -->\n<style class="${MARK}" data-ecos='${escJson(c)}'>${css(c)}</style>\n<div class="${FLAG}" hidden></div>\n<!-- /wp:html -->`;
  }

  // ¿Este bloque HTML es el del fondo de la página? (el parser lo descarta como bloque visible)
  const isBlock = (html) => new RegExp(`<style class="${MARK}"`).test(String(html || ''));

  // Lee el pageBg de un contenido de WordPress (null si no hay o está dañado). Se vuelve a limpiar con normalize.
  function parse(content) {
    const m = new RegExp(`<style class="${MARK}"[^>]*?\\sdata-ecos='([^']*)'`).exec(String(content || ''));
    if (!m) return null;
    try { return normalize(JSON.parse(m[1])); } catch { return null; }
  }

  const api = { MARK, FLAG, PRESETS, WIDTHS, SHADOWS, OVERLAYS, DEFAULTS, safeUrl, normalize, css, block, isBlock, parse, escJson };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PageBg = api;
})(typeof window !== 'undefined' ? window : globalThis);
