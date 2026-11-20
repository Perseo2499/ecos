// Carrusel de Ecos: este mismo archivo va dentro de cada entrada con carrusel (src/transform.js lo
// incrusta) y lo usa la vista previa de la app. Sin JavaScript el carrusel se sigue pudiendo deslizar;
// con él añade flechas, puntos, contador, teclado y paso automático (en pausa al pasar el ratón).
(function () {
  function ecosCarousel(root) {
    if (!root || root.getAttribute('data-ec-ready')) return;
    root.setAttribute('data-ec-ready', '1');
    var doc = root.ownerDocument;
    var track = root.querySelector('.ec-track');
    var slides = Array.prototype.slice.call(root.querySelectorAll('.ec-slide'));
    if (!track || slides.length < 2) return;
    root.classList.add('ec-js');
    Array.prototype.forEach.call(root.querySelectorAll('.ec-nav'), function (x) { x.style.display = 'none'; });
    function mk(tag, cls, text) { var e = doc.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; }
    var prev = mk('button', 'ec-btn ec-prev', '‹'), next = mk('button', 'ec-btn ec-next', '›');
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', 'Anterior'); next.setAttribute('aria-label', 'Siguiente');
    var count = mk('span', 'ec-count'), dots = mk('div', 'ec-dots'), bar = mk('span', 'ec-bar');
    slides.forEach(function (s, i) {
      var d = mk('button', 'ec-dot'); d.type = 'button'; d.setAttribute('aria-label', 'Foto ' + (i + 1));
      d.onclick = function () { go(i); hold(); };
      dots.appendChild(d);
    });
    root.appendChild(prev); root.appendChild(next); root.appendChild(count); root.appendChild(bar); root.appendChild(dots);
    var cur = -1;
    function go(i) {
      i = (i + slides.length) % slides.length;
      var s = slides[i];
      track.scrollTo({ left: s.offsetLeft - (track.clientWidth - s.clientWidth) / 2, behavior: 'smooth' });
    }
    function update() {
      var mid = track.scrollLeft + track.clientWidth / 2, best = 0, bd = Infinity;
      slides.forEach(function (s, i) { var d = Math.abs(s.offsetLeft + s.clientWidth / 2 - mid); if (d < bd) { bd = d; best = i; } });
      if (best === cur) return;
      cur = best;
      slides.forEach(function (s, i) { s.classList.toggle('ec-on', i === cur); });
      Array.prototype.forEach.call(dots.children, function (d, i) { d.classList.toggle('ec-on', i === cur); });
      count.textContent = (cur + 1) + ' / ' + slides.length;
      restartBar();
    }
    var raf = 0;
    track.addEventListener('scroll', function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }, { passive: true });
    prev.onclick = function () { go(cur - 1); hold(); };
    next.onclick = function () { go(cur + 1); hold(); };
    // Arrastrar con el ratón (con el dedo ya se desliza solo): se sigue al puntero y al soltar se va a la
    // foto siguiente o anterior según el sentido, o a la más cercana si el gesto fue corto
    var win = doc.defaultView || window, grab = null;
    track.addEventListener('dragstart', function (e) { e.preventDefault(); });
    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      grab = { x: e.clientX, left: track.scrollLeft, from: cur, moved: false };
      paused = true;
    });
    win.addEventListener('pointermove', function (e) {
      if (!grab) return;
      var dx = e.clientX - grab.x;
      if (!grab.moved && Math.abs(dx) < 5) return;
      if (!grab.moved) { grab.moved = true; track.classList.add('ec-dragging'); }
      e.preventDefault();
      track.scrollLeft = grab.left - dx;
    });
    win.addEventListener('pointerup', function (e) {
      if (!grab) return;
      var g = grab; grab = null; paused = false;
      if (!g.moved) return;
      var dx = e.clientX - g.x;
      track.classList.remove('ec-dragging');
      update();
      var to = dx < -40 ? Math.max(g.from + 1, cur) : dx > 40 ? Math.min(g.from - 1, cur) : cur;
      go(Math.max(0, Math.min(slides.length - 1, to)));
      hold();
      // que soltar no cuente como clic sobre la foto
      track.addEventListener('click', function stop(ev) { ev.preventDefault(); ev.stopPropagation(); track.removeEventListener('click', stop, true); }, true);
      setTimeout(function () { track.classList.remove('ec-dragging'); }, 0);
    });
    root.tabIndex = 0;
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); hold(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); hold(); }
    });
    // Paso automático (con barra de progreso); en pausa con el ratón encima, al tocar o con la pestaña oculta
    var ms = Number(root.getAttribute('data-autoplay')) || 0;
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var paused = false, timer = 0;
    function restartBar() {
      if (!ms || still) return;
      bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)';
      void bar.offsetWidth;
      if (!paused) { bar.style.transition = 'transform ' + ms + 'ms linear'; bar.style.transform = 'scaleX(1)'; }
    }
    function tick() { if (!paused && !doc.hidden) go(cur + 1); }
    function start() { clearInterval(timer); if (ms && !still) timer = setInterval(tick, ms); }
    function hold() { start(); restartBar(); }
    root.addEventListener('mouseenter', function () { paused = true; restartBar(); });
    root.addEventListener('mouseleave', function () { paused = false; hold(); });
    track.addEventListener('touchstart', function () { paused = true; }, { passive: true });
    track.addEventListener('touchend', function () { paused = false; hold(); }, { passive: true });
    if (!ms || still) root.classList.add('ec-static');
    update(); start();
  }
  window.ecosCarousel = ecosCarousel;
  Array.prototype.forEach.call(document.querySelectorAll('[data-ecos-carousel]'), ecosCarousel);
})();
