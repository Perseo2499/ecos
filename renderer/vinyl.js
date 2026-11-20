// Tema Vinilo: negro con serigrafías (portado del tema de Brisa).
//  · Colores: fondo negro, superficies casi negras, texto blanco, contornos #3A3A3A y acento rojo FF2A1F.
//  · Serigrafías: rótulos pequeños en gris translúcido, mayúsculas y espaciados (con LED rojo y kanji
//    opcionales), rejillas de altavoz, paneles con bisel, tornillos y ventilación.
//  · Al tocar el logo, «glitch» (copias teñidas y franjas desplazadas durante 300 ms).
// El gris es para las serigrafías; el acento solo para el LED y el glitch.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const ACCENT = '#ff2a1f';


  // Rótulos de cada pantalla: [selector donde va, rótulo izquierdo (con LED), código derecho, kanji]
  const SCREENS = [
    ['#tab-posts', 'INPUT · FEED', 'EC-01', '投稿'],
    ['#tab-blog', 'OUTPUT · BLOG', 'EC-02', '記事'],
    ['#tab-connections', 'LINK · NET', 'EC-03', '接続'],
    ['#tab-settings', 'SYS · CONFIG', 'EC-04', '設定'],
  ];

  const silk = (text, { led = false, jp = null, cls = '' } = {}) =>
    `<span class="silk ${cls}">${led ? '<i class="led"></i>' : ''}<span>${text}</span>${jp ? `<span class="jp">${jp}</span>` : ''}</span>`;
  const speaker = (cols, rows, cls = '') => `<span class="speaker ${cls}" style="--cols:${cols};--rows:${rows}"></span>`;


  function decorate() {
    // Barra superior
    if (!$('.appbar .silk-brand')) $('.appbar .brand').insertAdjacentHTML('beforeend', `<span class="silk-brand vinyl-only">${silk('INPUT · HOME', { led: true })}</span>`);
    // Cabecera serigrafiada de cada pantalla
    for (const [sel, left, code, jp] of SCREENS) {
      const sec = $(sel);
      if (!sec || $('.silk-row', sec)) continue;
      sec.insertAdjacentHTML('afterbegin', `<div class="silk-row vinyl-only">${silk(left, { led: true })}${speaker(14, 1)}<span class="spacer"></span>${silk(code, { jp })}</div>`);
    }
    const ed = $('.ed-bar');
    if (ed && !$('.silk', ed)) $('.ed-bar-title', ed)?.insertAdjacentHTML('afterend', `<span class="vinyl-only">${silk('ED-01', { jp: '編集' })}</span>`);
  }



  // --- Glitch: copias teñidas desplazadas + 5 franjas horizontales que saltan (≈300 ms)
  const motionOk = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hue = (hex, deg) => { // gira el tono de un color
    const n = parseInt(hex.slice(1), 16); let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0; const l = (mx + mn) / 2, d = mx - mn;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + deg + 360) % 360;
    return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
  };
  function glitch(el, { ms = 300, k = 1.8, seed = ACCENT } = {}) {
    if (!el || !motionOk() || el.dataset.glitching) return;
    el.dataset.glitching = '1';
    const r = el.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = 'gl-layer';
    Object.assign(layer.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    const isImg = el.tagName === 'IMG';
    const copy = (tint) => {
      let c;
      if (isImg && tint) { c = document.createElement('div'); c.style.background = tint; c.style.webkitMask = c.style.mask = `url("${el.src}") center / contain no-repeat`; }
      else { c = el.cloneNode(true); c.removeAttribute('id'); if (tint) c.style.color = tint; }
      c.classList.add('gl-copy'); Object.assign(c.style, { width: r.width + 'px', height: r.height + 'px' });
      layer.appendChild(c); return c;
    };
    const tints = [copy(hue(seed, 70)), copy(hue(seed, -70))];
    tints.forEach((c) => (c.style.mixBlendMode = 'screen'));
    const bands = Array.from({ length: 5 }, (_, i) => { const c = copy(null); c.style.clipPath = `inset(${i * 20}% 0 ${100 - (i + 1) * 20}% 0)`; return c; });
    document.body.appendChild(layer);
    el.style.visibility = 'hidden';
    const t0 = performance.now(); let lastSeed = -1;
    const step = (now) => {
      const p = (now - t0) / ms;
      if (p >= 1) { layer.remove(); el.style.visibility = ''; delete el.dataset.glitching; return; }
      const env = Math.sin(Math.PI * p);
      const s = Math.floor(p * 12); // las barras saltan ~12 veces
      if (s !== lastSeed) {
        lastSeed = s;
        tints.forEach((c, i) => (c.style.transform = `translateX(${(i ? -1 : 1) * (3 + Math.random() * 5) * env * k}px)`));
        bands.forEach((c) => (c.style.transform = `translateX(${(Math.random() * 2 - 1) * 8 * env * k}px)`));
      }
      tints.forEach((c) => (c.style.opacity = (0.85 * env).toFixed(2)));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Al tocar el logo: glitch
  function tapLogo() { if (root.dataset.vinyl === 'on') glitch($('.appbar .logo img')); }

  function apply({ vinyl, silk: silkOn }) {
    root.dataset.vinyl = vinyl ? 'on' : 'off';
    root.dataset.silk = vinyl && silkOn !== false ? 'on' : 'off';
    if (vinyl) { root.dataset.theme = 'dark'; decorate(); }
  }

  document.addEventListener('click', (e) => { if (e.target.closest('.appbar .logo')) tapLogo(); });
  window.Vinyl = { apply, glitch };
})();
