// Barra inferior Vinilo (portada de Brisa): una pista gris con UNA píldora negra que se traslada, iconos
// de puntos y la etiqueta de la pantalla activa en letra de puntos. Un único valor «pos» (0…n−1) mueve a
// la vez la píldora, los iconos y las páginas, así siempre van sincronizados, también al arrastrar.
// Las páginas se deslizan en horizontal: la saliente y la entrante, siempre separadas un ancho de ventana.
// Solo con el tema Vinilo; si no, se usan las pestañas de arriba de siempre.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const TABS = ['posts', 'blog', 'connections', 'settings'];
  const n = TABS.length;
  const STEP = 56, PILL = 200, PAD = 6; // hueco de cada icono, ancho de la píldora, relleno de la pista
  const INNER = (n - 1) * STEP + PILL;
  const DUR = 400;
  // Iconos de puntos (pares x,y de 0 a 1): rombo, triángulo, cruz y aspa
  const STARS = {
    posts: [[0.5, 0.1], [0.9, 0.5], [0.5, 0.9], [0.1, 0.5]],
    blog: [[0.5, 0.12], [0.9, 0.85], [0.1, 0.85]],
    connections: [[0.5, 0.1], [0.5, 0.5], [0.5, 0.9], [0.1, 0.5], [0.9, 0.5]],
    settings: [[0.15, 0.15], [0.85, 0.15], [0.5, 0.5], [0.15, 0.85], [0.85, 0.85]],
  };
  const dotIcon = (k) => `<svg viewBox="0 0 1 1" width="22" height="22">${STARS[k].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".08"/>`).join('')}</svg>`;

  // Curva (0.2, 0, 0, 1) de Material, como en Brisa
  function bezier(x1, y1, x2, y2) {
    const c = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
    return (x) => { let lo = 0, hi = 1, t = x; for (let i = 0; i < 24; i++) { t = (lo + hi) / 2; if (c(x1, x2, t) < x) lo = t; else hi = t; } return c(y1, y2, t); };
  }
  const ease = bezier(0.2, 0, 0, 1);
  const motionOk = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

  let bar, pill, items = [];
  let pos = 0;            // posición continua de la píldora
  let pg = null;          // transición de páginas en curso: { from, to, p }
  let anim = null;

  function build() {
    bar = document.createElement('nav');
    bar.className = 'vnav';
    bar.style.width = INNER + PAD * 2 + 'px';
    bar.innerHTML = `<div class="vnav-pill"></div>` + TABS.map((k) => `<div class="vnav-item" data-tab="${k}"><span class="vnav-ic">${dotIcon(k)}</span><span class="vnav-lbl"><span></span></span></div>`).join('');
    document.body.appendChild(bar);
    pill = $('.vnav-pill', bar);
    pill.style.width = PILL + 'px';
    items = $$('.vnav-item', bar);
    labels();
    gestures();
  }
  // Etiquetas: el texto de las pestañas de arriba (ya traducido)
  function labels() {
    items.forEach((it) => { $('.vnav-lbl span', it).textContent = $(`header nav button[data-tab="${it.dataset.tab}"] span:last-child`)?.textContent || ''; it.dataset.w = 0; });
  }

  const navA = (i) => Math.max(0, 1 - Math.abs(pos - i)); // 1 = dentro de la píldora
  function paint() {
    const px = pos * STEP;
    pill.style.transform = `translateX(${px}px)`;
    const center = px + PILL / 2;
    items.forEach((it, i) => {
      const a = navA(i);
      const rest = i <= pos ? i * STEP + STEP / 2 : (i - 1) * STEP + PILL + STEP / 2;
      const cx = rest + (center - rest) * a;
      const lbl = $('.vnav-lbl', it);
      if (!Number(it.dataset.w)) it.dataset.w = $('span', lbl).scrollWidth;
      lbl.style.width = Number(it.dataset.w) * a + 'px';
      lbl.style.opacity = a;
      const ic = $('.vnav-ic', it);
      ic.style.transform = `scale(${0.7 + 0.3 * a})`;
      ic.style.opacity = 0.3 + 0.7 * a;
      it.style.transform = `translateX(${cx}px) translateX(-50%)`;
    });
    pages();
  }

  // --- Páginas: solo la de partida y la de llegada, desplazadas según «p» (0 → 1)
  function pages() {
    const W = $('main').clientWidth;
    TABS.forEach((k, i) => {
      const sec = $('#tab-' + k);
      const inMove = pg && pg.p > 0 && pg.p < 1 && (i === pg.from || i === pg.to);
      const peek = inMove && !sec.classList.contains('active');
      sec.classList.toggle('vpeek', peek);
      sec.classList.toggle('vhide', !!pg && !inMove && sec.classList.contains('active'));
      sec.style.top = peek ? Math.max(0, scrollY) + 'px' : '';
      if (!inMove) { sec.style.transform = ''; return; }
      const dir = pg.to > pg.from ? 1 : -1;
      sec.style.transform = `translateX(${i === pg.from ? -dir * pg.p * W : dir * (1 - pg.p) * W}px)`;
    });
  }

  function settle(j) {
    pg = null;
    const tab = TABS[j];
    if (!$('#tab-' + tab).classList.contains('active')) window.showTab?.(tab);
    $$('.tab').forEach((x) => { x.classList.remove('vpeek', 'vhide'); x.style.top = ''; x.style.transform = ''; });
  }

  // Animación: la píldora recorre los huecos intermedios, pero solo se mueven las dos páginas
  function go(j, from = pos) {
    cancelAnimationFrame(anim);
    const cur = Math.round(from);
    if (!motionOk()) { pos = j; settle(j); paint(); scrollTo(0, 0); return; }
    // si venimos de un arrastre, la transición sigue entre las dos páginas vecinas desde donde quedó
    const a = Math.floor(from), frac = from - a;
    pg = frac > 1e-3 ? (j > a ? { from: a, to: j, p: frac / Math.max(1, j - a) } : { from: a + 1, to: j, p: (1 - frac) / Math.max(1, a + 1 - j) })
      : { from: cur, to: j, p: 0 };
    if (pg.from === pg.to) { pos = j; settle(j); paint(); return; }
    const p0 = pg.p, t0 = performance.now() + 48; // ~3 fotogramas: las dos páginas se pintan antes de moverse
    const step = (now) => {
      const t = Math.min(1, Math.max(0, (now - t0) / DUR));
      pg.p = p0 + (1 - p0) * ease(t);
      pos = pg.from + (pg.to - pg.from) * pg.p;
      paint();
      if (t < 1) anim = requestAnimationFrame(step);
      else { pos = j; settle(j); paint(); scrollTo(0, 0); anim = null; }
    };
    paint();
    anim = requestAnimationFrame(step);
  }

  // --- Toque (gana el icono más cercano) y arrastre horizontal sobre la barra
  function gestures() {
    let down = null;
    bar.addEventListener('pointerdown', (e) => {
      cancelAnimationFrame(anim);
      down = { x: e.clientX, start: pos, drag: false, last: Math.round(pos) };
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (!down.drag && Math.abs(dx) < 6) return;
      down.drag = true;
      pos = Math.min(n - 1, Math.max(0, down.start + dx / STEP));
      const a = Math.floor(pos);
      pg = a < n - 1 ? { from: a, to: a + 1, p: pos - a } : null;
      if (Math.round(pos) !== down.last) { down.last = Math.round(pos); bar.classList.add('tick'); setTimeout(() => bar.classList.remove('tick'), 90); }
      paint();
    });
    const up = (e) => {
      if (!down) return;
      const d = down; down = null;
      if (d.drag) { go(Math.round(pos), pos); return; }
      // toque: el icono más cercano al dedo
      const x = e.clientX;
      let best = 0, dist = Infinity;
      items.forEach((it, i) => { const r = it.getBoundingClientRect(); const dd = Math.abs(r.left + r.width / 2 - x); if (dd < dist) { dist = dd; best = i; } });
      if (best !== Math.round(pos)) go(best);
    };
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  }

  // Sincroniza con el cambio de pantalla desde otros sitios (avisos, botones…)
  function sync() {
    if (!bar || anim || pg) return;
    const i = TABS.findIndex((k) => $('#tab-' + k)?.classList.contains('active'));
    if (i >= 0 && Math.abs(pos - i) > 1e-3 && !$('.vpeek')) { pos = i; paint(); }
  }

  function apply(on) {
    if (on && !bar) build();
    if (bar) { labels(); sync(); paint(); }
  }
  const mo = new MutationObserver(sync);
  TABS.forEach((k) => { const el = document.getElementById('tab-' + k); if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] }); });
  window.VinylNav = { apply, go: (k) => go(TABS.indexOf(k)) };
})();
