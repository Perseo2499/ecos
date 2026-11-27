// Ecos · guion de «Más bloques» en la web: pestañas, cifras con contador, copiar (Bizum / IBAN), calendario, puntos interactivos,
// comparador antes/después y preguntas frecuentes (solo una abierta). Todo es opcional: sin este guion, cada bloque se ve completo y en orden.
// Va dentro del bloque de estilos de Ecos (codificado, para que WordPress no lo altere) o, con el complemento, en ecos-more.js.
// IMPORTANTE: se codifica quitando las líneas que empiezan por «//» y juntando el resto en una línea: nada de comentarios al final de línea.
(function () {
  var reduced = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var uid = 0;

  function parseCount(text) {
    var m = String(text).match(/^(\D*?)(\d[\d.,]*)(\D*)$/);
    if (!m) return null;
    var raw = m[2], sep = '', dec = 0, n;
    if (/^\d{1,3}(\.\d{3})+$/.test(raw)) { sep = '.'; n = Number(raw.replace(/\./g, '')); }
    else if (/^\d{1,3}(,\d{3})+$/.test(raw)) { sep = ','; n = Number(raw.replace(/,/g, '')); }
    else if (/^\d+[.,]\d{1,2}$/.test(raw)) { dec = raw.length - raw.search(/[.,]/) - 1; n = Number(raw.replace(',', '.')); }
    else if (/^\d+$/.test(raw)) { n = Number(raw); }
    else return null;
    return { pre: m[1], suf: m[3], n: n, sep: sep, dec: dec, dsep: dec ? raw.charAt(raw.search(/[.,]/)) : '' };
  }
  function countText(p, f) {
    var v = p.n * f;
    var s = p.dec ? v.toFixed(p.dec).replace('.', p.dsep) : String(Math.round(v));
    if (p.sep) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, p.sep);
    return p.pre + s + p.suf;
  }
  var ease = function (x) { return 1 - Math.pow(1 - x, 3); };

  function counters() {
    var els = $$('.ecos-count .ecos-cifra-num');
    if (!els.length || reduced() || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (list) {
      list.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var el = e.target, final = el.textContent, p = parseCount(final);
        if (!p || !p.n) return;
        var t0 = null;
        var step = function (t) {
          if (t0 === null) t0 = t;
          var x = Math.min(1, (t - t0) / 1400);
          el.textContent = x >= 1 ? final : countText(p, ease(x));
          if (x < 1) requestAnimationFrame(step);
        };
        el.textContent = countText(p, 0);
        requestAnimationFrame(step);
      });
    }, { threshold: 0.3 });
    els.forEach(function (el) { io.observe(el); });
  }

  function tabs() {
    $$('.ecos-tabs').forEach(function (root) {
      var panels = $$(':scope > .ecos-tab', root);
      if (panels.length < 2) return;
      var id = 'ecos-tabs-' + (++uid);
      var list = document.createElement('div');
      list.className = 'ecos-tab-list';
      list.setAttribute('role', 'tablist');
      var btns = panels.map(function (p, i) {
        var h = p.querySelector(':scope > .wp-block-heading');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ecos-tab-btn';
        b.id = id + '-t' + i;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-controls', id + '-p' + i);
        b.textContent = h ? h.textContent : 'Pestaña ' + (i + 1);
        p.id = id + '-p' + i;
        p.setAttribute('role', 'tabpanel');
        p.setAttribute('aria-labelledby', b.id);
        list.appendChild(b);
        return b;
      });
      var show = function (i, focus) {
        btns.forEach(function (b, k) {
          b.setAttribute('aria-selected', k === i ? 'true' : 'false');
          b.tabIndex = k === i ? 0 : -1;
          panels[k].hidden = k !== i;
        });
        if (focus) btns[i].focus();
      };
      btns.forEach(function (b, i) {
        b.addEventListener('click', function () { show(i, false); });
        b.addEventListener('keydown', function (e) {
          var k = e.key, n = btns.length, to = -1;
          if (k === 'ArrowRight' || k === 'ArrowDown') to = (i + 1) % n;
          else if (k === 'ArrowLeft' || k === 'ArrowUp') to = (i - 1 + n) % n;
          else if (k === 'Home') to = 0;
          else if (k === 'End') to = n - 1;
          if (to < 0) return;
          e.preventDefault();
          show(to, true);
        });
      });
      root.insertBefore(list, root.firstChild);
      root.classList.add('ecos-tabs-js');
      show(0, false);
    });
  }

  function copyText(text, done) {
    var ok = function () { done(true); };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var r = false;
      try { r = document.execCommand('copy'); } catch (e) { r = false; }
      document.body.removeChild(ta);
      done(r);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  }
  function copyLinks() {
    $$('a[href^="#ecos-copy-"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var text = decodeURIComponent(a.getAttribute('href').slice(11));
        var old = a.textContent;
        copyText(text, function (ok) {
          a.textContent = ok ? '¡Copiado!' : text;
          setTimeout(function () { a.textContent = old; }, 2200);
        });
      });
    });
    $$('a[href^="data:text/calendar"]').forEach(function (a) { a.setAttribute('download', 'evento.ics'); });
  }

  function hotspots() {
    $$('.ecos-puntos').forEach(function (root) {
      var fig = root.querySelector(':scope > .wp-block-image');
      var pts = $$(':scope > .ecos-punto', root);
      if (!fig || !pts.length) return;
      var id = 'ecos-pts-' + (++uid);
      var stage = document.createElement('div');
      stage.className = 'ecos-pts-stage';
      root.insertBefore(stage, fig);
      stage.appendChild(fig);
      var pops = [];
      var closeAll = function (except) {
        pops.forEach(function (o) { if (o.pop !== except) { o.pop.hidden = true; o.btn.setAttribute('aria-expanded', 'false'); } });
      };
      pts.forEach(function (p, i) {
        var m = /ecos-px-(\d+)/.exec(p.className), n = /ecos-py-(\d+)/.exec(p.className);
        var x = m ? +m[1] : 50, y = n ? +n[1] : 50;
        var h = p.querySelector('.wp-block-heading');
        var title = h ? h.textContent : 'Punto ' + (i + 1);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ecos-pt-btn';
        btn.textContent = String(i + 1);
        btn.style.left = x + '%';
        btn.style.top = y + '%';
        btn.setAttribute('aria-label', title);
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', id + '-' + i);
        var pop = document.createElement('div');
        pop.className = 'ecos-pt-pop' + (x < 25 ? ' ecos-l' : x > 75 ? ' ecos-r' : '');
        pop.id = id + '-' + i;
        pop.setAttribute('role', 'region');
        pop.setAttribute('aria-label', title);
        pop.hidden = true;
        pop.style.left = x + '%';
        pop.style.top = y + '%';
        var b = document.createElement('b');
        b.textContent = title;
        pop.appendChild(b);
        $$('p', p).forEach(function (q) { var c = document.createElement('div'); c.innerHTML = q.innerHTML; pop.appendChild(c); });
        var x2 = document.createElement('button');
        x2.type = 'button';
        x2.className = 'ecos-pt-x';
        x2.setAttribute('aria-label', 'Cerrar');
        x2.textContent = '×';
        pop.appendChild(x2);
        x2.addEventListener('click', function () { closeAll(null); btn.focus(); });
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var open = pop.hidden;
          closeAll(pop);
          pop.hidden = !open;
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        stage.appendChild(btn);
        stage.appendChild(pop);
        pops.push({ btn: btn, pop: pop });
      });
      root.classList.add('ecos-pts-js');
      document.addEventListener('click', function (e) { if (!stage.contains(e.target)) closeAll(null); });
      stage.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var o = pops.filter(function (q) { return !q.pop.hidden; })[0];
        closeAll(null);
        if (o) o.btn.focus();
      });
    });
  }

  function compare() {
    $$('.ecos-compare').forEach(function (root) {
      var figs = $$(':scope > .wp-block-image', root);
      if (figs.length !== 2) return;
      var m = /ecos-cmp-(\d+)/.exec(root.className);
      var pos = m ? Math.min(100, +m[1]) : 50;
      var stage = document.createElement('div');
      stage.className = 'ecos-cmp-stage';
      root.insertBefore(stage, figs[0]);
      figs[1].classList.add('ecos-cmp-under');
      figs[0].classList.add('ecos-cmp-top');
      stage.appendChild(figs[1]);
      stage.appendChild(figs[0]);
      var bar = document.createElement('div');
      bar.className = 'ecos-cmp-bar';
      var range = document.createElement('input');
      range.type = 'range';
      range.className = 'ecos-cmp-range';
      range.min = '0';
      range.max = '100';
      range.step = '1';
      range.value = String(pos);
      range.setAttribute('aria-label', 'Comparador antes y después: desliza para ver cada foto');
      var tagA = document.createElement('span');
      tagA.className = 'ecos-cmp-tag ecos-a';
      tagA.textContent = 'Antes';
      var tagB = document.createElement('span');
      tagB.className = 'ecos-cmp-tag ecos-b';
      tagB.textContent = 'Después';
      stage.appendChild(bar);
      stage.appendChild(tagA);
      stage.appendChild(tagB);
      stage.appendChild(range);
      var set = function (v) {
        figs[0].style.clipPath = 'inset(0 ' + (100 - v) + '% 0 0)';
        bar.style.left = v + '%';
        range.setAttribute('aria-valuetext', v + ' % de la foto de antes');
      };
      range.addEventListener('input', function () { set(+range.value); });
      set(pos);
      root.classList.add('ecos-cmp-js');
    });
  }

  function faq() {
    $$('.ecos-faq-uno').forEach(function (root) {
      var all = $$('details', root);
      all.forEach(function (d) {
        d.addEventListener('toggle', function () {
          if (!d.open) return;
          all.forEach(function (o) { if (o !== d) o.open = false; });
        });
      });
    });
  }

  function run() { tabs(); counters(); copyLinks(); hotspots(); compare(); faq(); }
  if (typeof module !== 'undefined' && module.exports) { module.exports = { parseCount: parseCount, countText: countText }; return; }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
