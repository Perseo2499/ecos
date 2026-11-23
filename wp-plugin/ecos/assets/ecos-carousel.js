// Generado por scripts/build-wp-plugin.js a partir de renderer/carousel.js. No lo edites a mano.
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
    if (!track) return;
    if (slides.length < 2) {
      var solo = root.querySelector('video');
      if (solo) { solo.muted = true; solo.removeAttribute('controls'); solo.addEventListener('click', function () { if (solo.paused) solo.play(); else solo.pause(); }); var b1 = doc.createElement('button'); b1.type = 'button'; b1.className = 'ec-snd'; b1.textContent = '\uD83D\uDD07'; b1.setAttribute('aria-label', 'Activar o quitar el sonido'); b1.setAttribute('style', 'position:absolute;right:12px;bottom:12px;z-index:3;width:40px;height:40px;border:0;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;font-size:18px'); b1.onclick = function () { solo.muted = !solo.muted; b1.textContent = solo.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'; }; (solo.closest('.ec-slide') || root).appendChild(b1); if (window.IntersectionObserver) new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { var p = solo.play(); if (p) p.catch(function () {}); } else solo.pause(); }); }, { threshold: 0.4 }).observe(root); }
      return;
    }
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
      if (typeof autoVid === 'function') autoVid();
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
    function tick() { if (!paused && !doc.hidden && !playing) go(cur + 1); }
    function start() { clearInterval(timer); if (ms && !still) timer = setInterval(tick, ms); }
    function hold() { start(); restartBar(); }
    root.addEventListener('mouseenter', function () { paused = true; restartBar(); });
    root.addEventListener('mouseleave', function () { paused = false; hold(); });
    track.addEventListener('touchstart', function () { paused = true; }, { passive: true });
    track.addEventListener('touchend', function () { paused = false; hold(); }, { passive: true });
    // Vídeos: no pasa a la siguiente diapositiva mientras uno suena, y se pausan al salir de la vista o al cambiar de diapositiva
    var playing = false;
    var vids = Array.prototype.slice.call(root.querySelectorAll('video'));
    function pauseOthers() { vids.forEach(function (v) { var s = v.closest ? v.closest('.ec-slide') : null; if (s !== slides[cur] && !v.paused) v.pause(); }); }
    vids.forEach(function (v) {
      v.addEventListener('play', function () { playing = true; pauseOthers(); });
      v.addEventListener('pause', function () { playing = vids.some(function (x) { return !x.paused && !x.ended; }); });
      v.addEventListener('ended', function () { playing = vids.some(function (x) { return !x.paused && !x.ended; }); });
    });
    track.addEventListener('scroll', function () { setTimeout(pauseOthers, 250); }, { passive: true });
    // Reproducción automática: el vídeo de la diapositiva actual empieza solo (en silencio; se puede activar el sonido)
    // cuando el carrusel está a la vista, y al terminar se pasa a la siguiente diapositiva
    var inView = false;
    function autoVid() {
      pauseOthers();
      var v = slides[cur] ? slides[cur].querySelector('video') : null;
      if (!v || !inView) return;
      if (v.paused) { v.muted = v.muted || !v.dataset.ecSound; var p = v.play(); if (p) p.catch(function () {}); }
    }
    vids.forEach(function (v) {
      v.loop = false; v.removeAttribute('controls');
      var slide = v.closest ? v.closest('.ec-slide') : null;
      if (slide) {
        var snd = doc.createElement('button');
        snd.type = 'button'; snd.className = 'ec-snd';
        snd.setAttribute('aria-label', 'Activar o quitar el sonido');
        snd.setAttribute('style', 'position:absolute;right:12px;bottom:12px;z-index:3;width:40px;height:40px;border:0;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;backdrop-filter:blur(6px)');
        var paint = function () { snd.innerHTML = v.muted ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>' : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>'; };
        paint();
        snd.onclick = function (e) { e.stopPropagation(); v.muted = !v.muted; if (!v.muted) { v.dataset.ecSound = '1'; var pp = v.play(); if (pp) pp.catch(function () {}); } paint(); };
        v.addEventListener('volumechange', paint);
        slide.appendChild(snd);
        v.style.cursor = 'pointer';
        v.addEventListener('click', function () { if (v.paused) { var pp = v.play(); if (pp) pp.catch(function () {}); } else v.pause(); });
      }
      v.addEventListener('volumechange', function () { if (!v.muted) v.dataset.ecSound = '1'; });
      v.addEventListener('ended', function () { if (slides.length > 1) { go(cur + 1); hold(); } });
    });
    if (vids.length && window.IntersectionObserver) {
      new IntersectionObserver(function (es) { es.forEach(function (e) { inView = e.isIntersecting; if (!inView) vids.forEach(function (v) { if (!v.paused) v.pause(); }); else autoVid(); }); }, { threshold: 0.4 }).observe(root);
    }
    if (!ms || still) root.classList.add('ec-static');
    update(); start();
  }
  window.ecosCarousel = ecosCarousel;
  Array.prototype.forEach.call(document.querySelectorAll('[data-ecos-carousel]'), ecosCarousel);
})();
