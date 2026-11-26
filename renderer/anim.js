// Ecos · animaciones al aparecer en la web: los bloques con clase ecos-anim-* entran (aparecer, deslizar, ampliar) al verse en pantalla.
// Respeta «reducir movimiento» del sistema: en ese caso no se hace nada y el contenido se ve desde el principio.
// Va dentro del bloque de estilos de Ecos (codificado, para que WordPress no lo altere al guardar) o, con el complemento, en ecos-anim.js.
(function () {
  var els = document.querySelectorAll('[class*="ecos-anim-"]');
  if (!els.length || !('IntersectionObserver' in window)) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.documentElement.classList.add('ecos-js');
  var io = new IntersectionObserver(function (list) {
    list.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('ecos-in');
      io.unobserve(e.target);
    });
  }, { threshold: 0.12 });
  Array.prototype.forEach.call(els, function (el) { io.observe(el); });
})();
