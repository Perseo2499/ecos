// Generado por scripts/build-wp-plugin.js a partir de renderer/videos.js. No lo edites a mano.
// Ecos · vídeos sueltos en la web: sin controles, solo y en silencio al verse, botón de sonido y tocar para pausar.
// Va dentro del bloque de estilos de Ecos (codificado, para que WordPress no lo altere al guardar).
(function () {
  var SVG_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>';
  var SVG_ON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';
  function setup(v) {
    if (v.getAttribute('data-ecv')) return;
    v.setAttribute('data-ecv', '1');
    var fig = v.closest ? v.closest('figure') : null;
    if (!fig) return;
    v.removeAttribute('controls'); v.controls = false; v.muted = true; v.loop = true; v.playsInline = true;
    v.style.cursor = 'pointer';
    if (getComputedStyle(fig).position === 'static') fig.style.position = 'relative';
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'ec-snd';
    b.setAttribute('aria-label', 'Activar o quitar el sonido');
    b.setAttribute('style', 'position:absolute;right:12px;bottom:12px;z-index:3;width:40px;height:40px;border:0;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0');
    function paint() { b.innerHTML = v.muted ? SVG_OFF : SVG_ON; }
    paint();
    b.onclick = function (e) { e.stopPropagation(); v.muted = !v.muted; if (!v.muted) { var p = v.play(); if (p) p.catch(function () {}); } paint(); };
    v.addEventListener('volumechange', paint);
    v.addEventListener('click', function () { if (v.paused) { var p = v.play(); if (p) p.catch(function () {}); } else v.pause(); });
    var cap = fig.querySelector('figcaption');
    if (cap) b.style.bottom = (cap.offsetHeight + 12) + 'px';
    fig.appendChild(b);
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { var p = v.play(); if (p) p.catch(function () {}); } else v.pause(); }); }, { threshold: 0.4 }).observe(v);
    }
  }
  function run() { Array.prototype.forEach.call(document.querySelectorAll('figure.wp-block-video.ecos-vp video'), setup); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
