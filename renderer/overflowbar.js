// Barra adaptable: dado un contenedor de botones/chips, lo que no cabe se va recortando por etapas:
//   0 todo con su etiqueta · 1 etiquetas cortas (data-short) · 2 solo iconos (con aria-label/title completos)
//   3 lo que sigue sin caber pasa, por orden de prioridad (data-prio: el menor se oculta antes), a un menú «⋯».
// El menú CONTIENE los botones reales (no copias): conservan sus eventos y, como el menú vive dentro del
// propio contenedor, los selectores que buscan dentro de él siguen encontrándolos.
// Marcas en los hijos directos del contenedor:
//   data-prio="n"        puede pasar al menú (sin esto, nunca se oculta)
//   data-short="Texto"   etiqueta corta de la etapa 1 (se pone en el <span> de la etiqueta)
//   data-keep-label      en la etapa 2 conserva la etiqueta corta (p. ej. el botón principal «Enviar»)
//   data-ov="drop"       texto auxiliar que simplemente se oculta si no cabe (no va al menú)
//   data-label="Texto"   nombre del botón en el menú cuando solo tiene icono
(function () {
  const T = (s) => (window.I18N ? window.I18N.t(s) : s);
  const MENU_ITEM = 'button, a[href], select, input, [tabindex]';
  const bars = new Set();
  let uid = 0;

  const shown = (e) => getComputedStyle(e).display !== 'none';

  function prepareLabels(item) {
    const spans = [...item.querySelectorAll(':scope > span:not(.ms), :scope > button > span:not(.ms), :scope > label > span:not(.ms)')]
      .filter((s) => !s.children.length && s.textContent.trim() && !s.classList.contains('ov-short') && !/^b-badge|count/.test(s.className));
    spans.forEach((s) => {
      s.classList.add('ov-lbl');
      if (s.parentElement.querySelector(':scope > .ms')) s.parentElement.classList.add('ov-ic');
      if (s.dataset.short && !s.nextElementSibling?.classList.contains('ov-short')) {
        s.classList.add('ov-full');
        const sh = document.createElement('span');
        sh.className = 'ov-lbl ov-short';
        sh.setAttribute('data-i18n', '');
        sh.textContent = s.dataset.short;
        s.after(sh);
        if (window.I18N) window.I18N.apply(item);
      }
    });
  }
  // El atributo data-short puede ir también en el propio botón (p. ej. un chip con un solo texto): se baja al <span>.
  function hoistShort(item) {
    if (!item.dataset.short) return;
    const s = [...item.querySelectorAll(':scope > span:not(.ms), :scope > button > span:not(.ms)')].find((x) => x.textContent.trim());
    if (s && !s.dataset.short) s.dataset.short = item.dataset.short;
  }

  class Bar {
    constructor(el, o) {
      this.el = el; this.o = o; this.id = ++uid; this.stage = 0; this.busy = false; this.ph = new Map();
      el.classList.add('ov-bar');
      this.wrap = document.createElement('span');
      this.wrap.className = 'ov-more-wrap hidden';
      this.more = document.createElement('button');
      this.more.type = 'button';
      this.more.className = 'btn text icon-only ov-more';
      this.more.setAttribute('aria-haspopup', 'menu');
      this.more.setAttribute('aria-expanded', 'false');
      this.more.innerHTML = '<span class="ms">more_horiz</span>';
      this.menu = document.createElement('div');
      this.menu.className = 'ov-menu hidden';
      this.menu.id = 'ov-menu-' + this.id;
      this.menu.setAttribute('role', 'menu');
      this.more.setAttribute('aria-controls', this.menu.id);
      this.wrap.append(this.more, this.menu);
      el.append(this.wrap);
      this.setLabels();
      this.more.addEventListener('click', () => (this.isOpen() ? this.close(true) : this.open()));
      this.more.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen()) { e.preventDefault(); e.stopPropagation(); this.close(true); }
        else if (e.key === 'ArrowDown' || ((e.key === 'Enter' || e.key === ' ') && !this.isOpen())) { e.preventDefault(); this.open(true); }
      });
      this.menu.addEventListener('keydown', (e) => this.onMenuKey(e));
      this.menu.addEventListener('click', (e) => { const b = e.target.closest('button, a'); if (b && b !== this.more) setTimeout(() => this.close(false), 0); });
      this.out = (e) => { if (this.isOpen() && !this.wrap.contains(e.target)) this.close(false); };
      document.addEventListener('pointerdown', this.out, true);
      this.items().forEach((i) => { hoistShort(i); prepareLabels(i); });
      this.ro = new ResizeObserver(() => this.schedule());
      this.ro.observe(el);
      this.mo = new MutationObserver((recs) => { if (recs.some((r) => ![this.menu, this.wrap, this.more].includes(r.target) && !(r.type === 'childList' && r.target === this.menu && [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 8)))) this.schedule(); });
      this.observe();
      this.schedule();
      if (document.fonts?.ready) document.fonts.ready.then(() => this.schedule());
    }
    observe() { this.mo.observe(this.el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] }); }
    setLabels() { this.more.title = T(this.o.label || 'Más opciones'); this.more.setAttribute('aria-label', this.more.title); this.menu.setAttribute('aria-label', this.more.title); }
    items() { return [...this.el.children].filter((c) => c !== this.wrap).concat([...this.menu.children]); }
    movable() { return this.items().filter((c) => c.dataset.prio !== undefined || c.dataset.ov === 'drop'); }
    schedule() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = 0; this.layout(); });
    }
    isOpen() { return !this.menu.classList.contains('hidden'); }

    // ---- medición ----
    fits() {
      const el = this.el, cr = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const limit = cr.right - (parseFloat(cs.paddingRight) || 0) + 0.5;
      let right = 0;
      for (const c of el.children) { const r = c.getBoundingClientRect(); if (r.width > 0 && shown(c)) right = Math.max(right, r.right); }
      return right <= limit;
    }
    setStage(n) {
      this.stage = n;
      this.el.classList.toggle('ov-s1', n >= 1);
      this.el.classList.toggle('ov-s2', n >= 2);
    }
    restoreAll() {
      for (const [it, c] of this.ph) { if (c.parentNode) c.replaceWith(it); it.classList.remove('ov-gone'); it.removeAttribute('role'); it.querySelector(':scope > .ov-menu-lbl')?.remove(); }
      this.ph.clear();
      this.items().forEach((i) => i.classList.remove('ov-gone'));
    }
    sendToMenu(it) {
      if (it.dataset.ov === 'drop') { it.classList.add('ov-gone'); return; }
      const c = document.createComment('ov');
      it.before(c); this.ph.set(it, c);
      this.menu.append(it);
      const own = it.querySelector(':scope > .ov-lbl, :scope > button > .ov-lbl');
      if (!own && !it.matches('select, input, .field, .b-range, .seg, .switch, label') && it.tagName === 'BUTTON') {
        const l = document.createElement('span');
        l.className = 'ov-menu-lbl';
        l.textContent = it.dataset.label ? T(it.dataset.label) : (it.getAttribute('aria-label') || it.title || '');
        it.append(l);
      }
      if (it.tagName === 'BUTTON') it.setAttribute('role', 'menuitem');
    }
    setAria() {
      // etapa 2: el icono solo → nombre accesible y tooltip con el texto completo
      this.items().forEach((it) => {
        const own = it.matches('button, a') ? it : it.querySelector(':scope > button, :scope > a, :scope > label');
        const tgt = own || it;
        const full = [...it.querySelectorAll('.ov-lbl:not(.ov-short)')].map((s) => s.textContent.trim()).join(' ').trim();
        if (this.stage >= 2 && it.classList.contains('ov-ic') && full && !it.closest('.ov-menu')) {
          if (!tgt.hasAttribute('aria-label') || tgt.dataset.ovAria !== undefined) { tgt.setAttribute('aria-label', full); tgt.dataset.ovAria = '1'; }
          if (!tgt.title || tgt.dataset.ovTitle !== undefined) { tgt.title = full; tgt.dataset.ovTitle = '1'; }
        } else {
          if (tgt.dataset.ovAria !== undefined) { tgt.removeAttribute('aria-label'); delete tgt.dataset.ovAria; }
          if (tgt.dataset.ovTitle !== undefined) { tgt.removeAttribute('title'); delete tgt.dataset.ovTitle; }
        }
      });
    }
    layout() {
      if (!this.el.isConnected) { this.destroy(); return; }
      if (this.busy || !shown(this.el) || !this.el.getBoundingClientRect().width) return;
      this.busy = true; this.mo.disconnect();
      const focused = this.el.contains(document.activeElement) ? document.activeElement : null;
      try {
        const wasOpen = this.isOpen();
        this.items().forEach((i) => { hoistShort(i); prepareLabels(i); });
        this.restoreAll();
        this.wrap.classList.add('hidden'); this.menu.classList.add('hidden');
        this.el.append(this.wrap);
        let ok = false;
        for (const s of [0, 1, 2]) { this.setStage(s); if (this.fits()) { ok = true; break; } }
        if (!ok) {
          const cand = this.movable().filter((i) => shown(i) && !i.classList.contains('hidden')).sort((a, b) => (+a.dataset.prio || 0) - (+b.dataset.prio || 0));
          this.wrap.classList.remove('hidden');
          for (const it of cand) {
            if (this.fits()) break;
            if (this.ph.has(it) || it.classList.contains('ov-gone')) continue;
            // los de la misma prioridad se van juntos (p. ej. «Desde» y «Hasta», o Deshacer y Rehacer)
            cand.filter((o) => o.dataset.prio === it.dataset.prio).forEach((o) => this.sendToMenu(o));
          }
          const moved = [...this.ph.keys()];
          if (moved.length) {
            // el «⋯» va justo después del hueco del último que se ha ido (junto al grupo de botones de la derecha)
            const last = [...this.ph.values()].sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1)).pop();
            last.after(this.wrap);
            // los del menú en el orden original
            moved.sort((a, b) => (this.ph.get(a).compareDocumentPosition(this.ph.get(b)) & 4 ? -1 : 1)).forEach((m) => this.menu.append(m));
          } else this.wrap.classList.add('hidden');
        }
        const inMenu = [...this.menu.children].some((c) => !c.classList.contains('hidden') && shown(c));
        if (!inMenu) this.wrap.classList.add('hidden');
        this.more.classList.toggle('has-active', !!this.menu.querySelector('.active, [aria-pressed="true"]'));
        this.setAria();
        if (wasOpen && inMenu) this.menu.classList.remove('hidden'); else this.close(false);
        this.el.dataset.ov = String(this.stage) + (this.ph.size ? 'm' : '');
      } finally {
        this.busy = false; this.observe();
        if (focused && focused.isConnected && document.activeElement !== focused && focused.offsetParent !== null) focused.focus({ preventScroll: true });
      }
    }

    // ---- menú accesible ----
    open(focusFirst) {
      if (this.wrap.classList.contains('hidden')) return;
      this.menu.classList.remove('hidden');
      this.more.setAttribute('aria-expanded', 'true');
      // hacia dónde se abre: alineado a la derecha del «⋯», o a la izquierda si no cabe
      this.menu.style.left = 'auto'; this.menu.style.right = '0';
      const r = this.menu.getBoundingClientRect();
      if (r.left < 8) { this.menu.style.left = '0'; this.menu.style.right = 'auto'; }
      const w = this.menu.getBoundingClientRect();
      if (w.right > innerWidth - 8) { this.menu.style.left = 'auto'; this.menu.style.right = '0'; }
      if (focusFirst) this.focusables()[0]?.focus();
    }
    close(refocus) {
      if (!this.isOpen()) return;
      this.menu.classList.add('hidden');
      this.more.setAttribute('aria-expanded', 'false');
      if (refocus) this.more.focus();
    }
    focusables() { return [...this.menu.querySelectorAll(MENU_ITEM)].filter((e) => !e.disabled && e.offsetParent !== null && e.getAttribute('tabindex') !== '-2'); }
    onMenuKey(e) {
      const list = this.focusables(), i = list.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
      else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
      else if (e.key === 'Tab') this.close(false);
    }
    destroy() {
      this.ro.disconnect(); this.mo.disconnect();
      document.removeEventListener('pointerdown', this.out, true);
      bars.delete(this);
    }
  }

  const OverflowBar = {
    // Convierte un contenedor en barra adaptable. Idempotente.
    attach(el, o = {}) {
      if (!el) return null;
      if (el._ovBar) return el._ovBar;
      const b = new Bar(el, o);
      el._ovBar = b; bars.add(b);
      return b;
    },
    relayout(el) { (el ? [el._ovBar] : [...bars]).forEach((b) => b && b.schedule()); },
    // Etiquetas cortas fuera de barras (se eligen por CSS/contenedor): crea los <span class="ov-short">
    initShorts(root = document) {
      root.querySelectorAll('[data-short]').forEach((e) => { if (e.closest('.ov-bar')) return; const it = e.closest('button, a, label') || e.parentElement; hoistShort(it); prepareLabels(it); });
    },
    refreshLabels() { bars.forEach((b) => { b.setLabels(); b.schedule(); }); },
  };
  window.OverflowBar = OverflowBar;
})();
