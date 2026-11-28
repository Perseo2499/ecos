// Adaptación al tamaño de la ventana: conecta las barras adaptables (overflowbar.js), los cajones del editor
// (fotos a la izquierda, ajustes a la derecha) y los rótulos de las píldoras de estado cuando solo queda el punto.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const OB = window.OverflowBar;
  if (OB) {
    ['#editor .ed-bar', '#src-bar', '#f-bar', '#b-type', '#b-bar'].forEach((s) => OB.attach($(s)));
    OB.initShorts($('#ed-media'));
  }

  // ---- Cajones del editor (ventana estrecha): el lienzo se queda con todo el ancho
  const ed = $('#editor');
  const btns = { media: $('#ed-media-btn'), side: $('#ed-side-btn') };
  const narrow = () => window.matchMedia('(max-width: 1000px)').matches;
  function drawer(which) {
    ed.classList.toggle('media-open', which === 'media');
    ed.classList.toggle('side-open', which === 'side');
    Object.entries(btns).forEach(([k, b]) => b.setAttribute('aria-pressed', String(k === which)));
  }
  Object.entries(btns).forEach(([k, b]) => b.addEventListener('click', () => drawer(ed.classList.contains(k + '-open') ? '' : k)));
  $('#ed-canvas').addEventListener('pointerdown', () => { if (ed.classList.contains('media-open') || ed.classList.contains('side-open')) drawer(''); });
  ed.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (ed.classList.contains('media-open') || ed.classList.contains('side-open')) && !e.defaultPrevented) { drawer(''); btns.side.focus(); } });
  window.matchMedia('(max-width: 1000px)').addEventListener('change', () => drawer(''));
  // lo que aparece en el panel derecho tras enviar («Enviado»), se muestra aunque esté plegado
  const sent = $('#sent');
  if (sent) new MutationObserver(() => { if (narrow() && !sent.classList.contains('hidden')) drawer('side'); }).observe(sent, { attributes: true, attributeFilter: ['class'] });
  window.EdDrawer = drawer;

  // ---- Pestañas de arriba: con solo el icono, el nombre va en el tooltip y en aria-label
  const tabs = $('.tabs');
  const nameTabs = () => tabs.querySelectorAll('button').forEach((b) => { const l = b.querySelector('span:not(.ms)')?.textContent.trim(); if (l) { b.title = l; b.setAttribute('aria-label', l); } });
  nameTabs(); new MutationObserver(nameTabs).observe(tabs, { childList: true, characterData: true, subtree: true });

  // ---- Píldoras de estado: con la ventana estrecha solo queda el punto; el texto pasa al tooltip
  const tip = (p) => { if (p.textContent.trim()) p.title = p.textContent.trim(); };
  ['#st-meta', '#st-wp', '#off-ind'].forEach((s) => { const p = $(s); if (!p) return; tip(p); new MutationObserver(() => tip(p)).observe(p, { childList: true, characterData: true, subtree: true }); });
})();
