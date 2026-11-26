// Ecos · Estilos de tu web en el editor: los colores, tamaños de letra y fuentes del tema de WordPress (leídos con
// window.api.themeStyles) se ofrecen primero en los selectores. Cuando se elige uno, el bloque guarda su valor y, en b.th,
// el nombre del elemento del tema (b.th.color = { slug, v }): al enviar se escribe con las clases estándar de WordPress
// (has-<slug>-color, textColor, fontSize…) y, al reabrir, se vuelve a leer igual (src/transform.js y src/parseblocks.js).
(function () {
  const t = (s, v) => (window.I18N ? window.I18N.t(s, v) : s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
  let S = null; // estilos cargados

  const colors = () => S?.colors || [];
  const sizes = () => S?.sizes || [];
  const fonts = () => S?.fonts || [];
  const headingFont = () => S?.headingFont || '';
  const isAstra = () => !!S?.theme?.isAstra;
  const colorOf = (slug) => colors().find((c) => c.slug === slug);
  const sizeOf = (slug) => sizes().find((z) => z.slug === slug);
  const fontOf = (slug) => fonts().find((f) => f.slug === slug);

  // Hoja con las clases de WordPress para lo que el editor muestra (marcas de color en línea): así se ven igual que en la web
  function paintCss() {
    let el = document.getElementById('ecos-theme-css');
    if (!el) { el = document.createElement('style'); el.id = 'ecos-theme-css'; document.head.appendChild(el); }
    el.textContent = colors().map((c) => `.has-${c.slug}-color{color:${c.color} !important}.has-${c.slug}-background-color{background-color:${c.color} !important}`).join('\n');
  }

  // Selectores de la barra de formato: tamaño y fuente
  function fillSelects() {
    const size = document.getElementById('fmt-size'), font = document.getElementById('fmt-font');
    if (size) {
      size.querySelector('#fmt-size-th')?.remove();
      if (sizes().length) {
        const g = document.createElement('optgroup'); g.id = 'fmt-size-th'; g.label = t('Tamaños de tu web');
        g.innerHTML = sizes().map((z) => `<option value="t:${esc(z.slug)}">${esc(z.name)}</option>`).join('');
        size.insertBefore(g, size.options[1] || null);
      }
    }
    if (font) {
      font.querySelector('#fmt-font-th')?.remove();
      const opts = [];
      if (headingFont()) opts.push(`<option value="heading" style="font-family:${esc(headingFont())}">${esc(t('Fuente de los títulos'))}</option>`);
      for (const f of fonts()) opts.push(`<option value="wp:${esc(f.slug)}" style="font-family:${esc(f.family)}">${esc(f.name)}</option>`);
      if (opts.length) {
        const g = document.createElement('optgroup'); g.id = 'fmt-font-th'; g.label = t('Fuentes de tu web');
        g.innerHTML = opts.join('');
        font.insertBefore(g, font.options[1] || null);
      }
    }
  }

  async function load(force) {
    try { S = (await window.api.themeStyles(!!force)) || null; } catch { /* sin conexión: se usan los colores de serie */ }
    paintCss(); fillSelects();
    return S;
  }

  // «Colores de tu web» + resto de colores: el HTML de los selectores. kind: 'swatch' (panel Estilo) o 'sw' (barra de formato)
  const chipsHtml = (cls, ri, cur) => colors().map((c) => `<button class="${cls} ${cur && cur.toLowerCase() === c.color.toLowerCase() ? 'on' : ''}" ${ri !== undefined ? `data-r="${ri}"` : ''} data-sw="${esc(c.color)}" data-th="${esc(c.slug)}" style="background:${esc(c.color)}" title="${esc(c.name)}"></button>`).join('');
  // Panel «Estilo»: dentro de la fila de muestras (sp-sws)
  function panelSwatches(ri, cur, std) {
    const own = colors();
    const rest = std.map((c) => `<button class="sp-sw ${cur.toLowerCase() === c ? 'on' : ''}" data-r="${ri}" data-sw="${c}" style="background:${c}" title="${c}"></button>`).join('');
    if (!own.length) return rest;
    return `<span class="sp-sub">${esc(t('Colores de tu web'))}</span>${chipsHtml('sp-sw', ri, cur)}<span class="sp-sub">${esc(t('Otros colores'))}</span>${rest}`;
  }
  // Barra de formato: bloque que va sobre la cuadrícula de colores
  function barSwatches() {
    const own = colors();
    if (!own.length) return '';
    return `<div class="pop-sub">${esc(t('Colores de tu web'))}</div><div class="sw-grid">${own.map((c) => `<span class="sw" data-c="${esc(c.color)}" data-th="${esc(c.slug)}" style="background:${esc(c.color)}" title="${esc(c.name)}"></span>`).join('')}</div><div class="pop-sub">${esc(t('Otros colores'))}</div>`;
  }

  // Apunta (o quita) el nombre del elemento del tema en el bloque: b.th[prop] = { slug, v: valor del bloque }
  function tag(b, prop, slug, v) {
    if (slug && SLUG.test(slug) && b[prop]) (b.th ||= {})[prop] = { slug, v: v || b[prop] };
    else if (b.th) { delete b.th[prop]; if (!Object.keys(b.th).length) delete b.th; }
  }
  // Tras cambiar un color en el panel Estilo (before = { bg, color } antes del cambio)
  function tagChanged(b, before, hex, slug) {
    for (const k of ['bg', 'color']) {
      if (b[k] !== before[k]) tag(b, k, b[k] === hex ? slug : '');
      else if (slug && b[k] === hex) tag(b, k, slug);
    }
  }

  // Valor del tamaño / fuente a mostrar en los selectores de la barra
  const sizeValue = (b) => (b.th?.size && b.th.size.v === b.size ? 't:' + b.th.size.slug : b.size || '');
  const fontValue = (b) => b.font || '';
  // Elección en los selectores de la barra → { value, slug } para guardar en el bloque
  function pickSize(v) {
    if (!String(v).startsWith('t:')) return { value: v, slug: '' };
    const z = sizeOf(v.slice(2));
    return z ? { value: z.size, slug: z.slug } : { value: '', slug: '' };
  }
  function pickFont(v) {
    if (v === 'heading') return { value: 'heading', slug: 'heading', css: headingFont() };
    return { value: v, slug: '' };
  }
  // CSS de la fuente de un bloque con fuente de la web (para mostrarla en el editor)
  function fontCss(key) {
    if (key === 'heading') return headingFont();
    if (String(key || '').startsWith('wp:')) return fontOf(key.slice(3))?.family || '';
    return '';
  }

  window.ThemeUI = { load, colors, sizes, fonts, headingFont, isAstra, colorOf, sizeOf, panelSwatches, barSwatches, tag, tagChanged, sizeValue, fontValue, pickSize, pickFont, fontCss, state: () => S, set: (s) => { S = s; paintCss(); fillSelects(); } };
})();
