// Editor de bloques · «Más bloques» (1): pestañas, línea de tiempo, cifras destacadas, testimonios, tarjetas con icono y llamada a la acción.
// La lógica pura, la salida a WordPress y la lectura de vuelta están en renderer/moreblocks.js; el resto (donación, evento, audio, PDF, puntos,
// antes/después y preguntas frecuentes) en more2.js. Aquí también están las piezas comunes (campos, foto pequeña, selector de iconos).
(function () {
  const E = window.BlockEditor, K = window.BlockKit, M = window.MoreBlocks;
  const { $, $$, t, esc, bid, has } = K;

  const plain = (h) => String(h || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const words = (h, n = 7) => { const w = plain(h).split(' ').filter(Boolean); return w.slice(0, n).join(' ') + (w.length > n ? '…' : ''); };

  // --- Crear, resumen de capas y filas del panel «Estilo» (se enganchan a lo que ya hay, sin tocar core.js ni style.js) --------------
  const baseCreate = E.create;
  E.create = function (type, extra = {}) {
    if (!M.DEFAULTS[type]) return baseCreate.call(this, type, extra);
    const b = { id: bid(), type, ...M.DEFAULTS[type]() };
    if (type === 'tabs') b.cols.forEach((c, k) => { c.title = t('Pestaña {n}', { n: k + 1 }); c.children = [this.create('paragraph')]; });
    if (type === 'cta') { b.title = t('¿Te apuntas?'); b.html = t('Cuéntanos qué te interesa y te respondemos enseguida.'); b.buttons[0].html = t('Quiero participar'); }
    if (type === 'donate') b.title = t('Haz una donación');
    if (type === 'event') { const d = new Date(Date.now() + 14 * 864e5); b.start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T18:00`; }
    return Object.assign(b, extra);
  };
  const baseSummary = E.summary;
  E.summary = function (b) {
    switch (b.type) {
      case 'tabs': return (b.cols || []).map((c) => words(c.title, 2)).join(' · ');
      case 'timeline': case 'figures': case 'testimonials': case 'cards': case 'faq': { const n = (b.items || []).length; return t(n === 1 ? '{n} elemento' : '{n} elementos', { n }); }
      case 'cta': case 'donate': case 'event': case 'audio': case 'pdf': return words(b.title);
      case 'hotspots': return t('{n} puntos', { n: (b.points || []).length });
      default: return baseSummary.call(this, b);
    }
  };
  const baseRows = E.styleRows;
  E.styleRows = function (b) {
    const rows = baseRows.call(this, b);
    const fn = E.mbRows[b.type];
    if (fn) rows.push(...fn.call(this, b));
    return rows;
  };
  const chip = (txt, on, fn, o = {}) => ({ t: txt, on, fn, ...o });
  E.mbChip = chip;
  E.mbRows = {
    tabs(b) { return [{ label: t('Aspecto de las pestañas'), chips: [chip(t('Con línea'), b.variant !== 'pill', () => { delete b.variant; }), chip(t('Píldoras'), b.variant === 'pill', () => { b.variant = 'pill'; })] }]; },
    timeline(b) { return [{ label: t('Dirección'), chips: [chip(t('Vertical'), b.dir !== 'h', () => { b.dir = 'v'; }), chip(t('Horizontal'), b.dir === 'h', () => { b.dir = 'h'; })] }]; },
    figures(b) { return [{ label: t('Contador animado al aparecer (respeta «reducir movimiento»)'), chips: [chip(t('Sí'), !!b.count, () => { b.count = true; }), chip(t('No'), !b.count, () => { b.count = false; })] }]; },
    testimonials(b) { return [{ label: t('Disposición'), chips: [chip(t('En fila'), !b.slider, () => { delete b.slider; }), chip(t('Carrusel deslizable'), !!b.slider, () => { b.slider = true; })] }]; },
    cta(b) {
      return [
        { label: t('Alineación'), chips: [chip(t('Centrado'), b.align !== 'left', () => { b.align = 'center'; }), chip(t('Izquierda'), b.align === 'left', () => { b.align = 'left'; })] },
        { label: t('Color de fondo'), color: { get: () => b.bg || '', set: (v) => { if (v) { b.bg = v; delete b.gradient; } else delete b.bg; }, none: true } },
        { label: t('Degradado de fondo'), grad: { get: () => b.gradient || '', set: (v) => { if (v) { b.gradient = v; delete b.bg; } else delete b.gradient; } } },
        { label: t('Imagen de fondo'), chips: [{ t: t('Poner una imagen…'), ic: 'wallpaper', on: false, raw: () => this.pickFromTray((m) => this.changeBlock(b.id, () => this.setDesign(b, { bgi: { url: m.url, x: 0.5, y: 0.5, dim: 40 } })), 'image') },
          chip(t('Quitar imagen'), false, () => this.setDesign(b, { bgi: undefined }), { off: !window.Design.pick(b).bgi })] },
        { label: t('Color del texto'), color: { get: () => b.color || '', set: (v) => { if (v) b.color = v; else delete b.color; }, none: true } },
        { label: t('Color del botón'), color: { get: () => b.btnBg || '', set: (v) => { if (v) b.btnBg = v; else delete b.btnBg; }, none: true } },
        { label: t('Color del texto del botón'), color: { get: () => b.btnColor || '', set: (v) => { if (v) b.btnColor = v; else delete b.btnColor; }, none: true } },
        { label: t('Esquinas del botón'), chips: [['', t('Tema')], ['square', t('Recto')], ['round', t('Redondeado')], ['pill', t('Píldora')]].map(([v, n]) => chip(n, (b.btnRadius || '') === v, () => { if (v) b.btnRadius = v; else delete b.btnRadius; })) },
      ];
    },
  };

  // --- Piezas comunes -------------------------------------------------------------------------------------------------------
  Object.assign(E, {
    // Texto editable de un campo `key` de `obj` (una fila de un bloque)
    mbText(tag, b, obj, key, ph, cls) { return this.editable(tag, obj[key] || '', t(ph), (h) => { obj[key] = h; }, { block: b, cls }); },
    // Campo de texto normal (enlaces, fechas, números…) con un solo paso de «deshacer» por edición
    mbInput(b, obj, key, ph, o = {}) {
      const inp = document.createElement('input');
      inp.className = 'mb-in' + (o.cls ? ' ' + o.cls : ''); inp.type = o.type || 'text'; inp.placeholder = ph ? t(ph) : ''; inp.value = obj[key] || '';
      if (o.title) inp.title = t(o.title);
      let snap = false;
      inp.oninput = () => { if (!snap) { this.snapshot(); snap = true; } obj[key] = o.trim === false ? inp.value : inp.value.trim(); o.after?.(inp.value); this.onChange(); };
      inp.onblur = () => { snap = false; };
      inp.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
      return inp;
    },
    // Foto pequeña de un campo (elegir de la bandeja, soltar una foto o quitarla)
    mbImg(b, obj, key, { round = false, label = 'Foto', cls = '' } = {}) {
      const box = document.createElement('div');
      const img = obj[key];
      box.className = 'mb-img' + (round ? ' round' : '') + (img?.url ? ' has' : '') + (cls ? ' ' + cls : '');
      if (img?.url) {
        box.innerHTML = `<img src="${esc(img.url)}" alt="" draggable="false"><button class="mb-x" title="${t('Quitar la foto')}"><span class="ms">close</span></button>`;
        $('.mb-x', box).onclick = (e) => { e.stopPropagation(); this.change(() => { obj[key] = null; }, b.id); };
        $('img', box).onclick = () => this.pickFromTray((m) => this.change(() => { obj[key] = { ...m }; }, b.id), 'image');
      } else {
        box.innerHTML = `<button class="mb-add" title="${t(label)}"><span class="ms">add_photo_alternate</span></button>`;
        $('.mb-add', box).onclick = () => this.pickFromTray((m) => this.change(() => { obj[key] = { ...m }; }, b.id), 'image');
      }
      this.acceptPhoto(box, (m) => { obj[key] = m; });
      return box;
    },
    // Quitar un elemento de la lista (al menos queda uno)
    mbDel(b, list, k, min = 1) {
      const x = document.createElement('button');
      x.className = 'mb-del'; x.title = t('Quitar'); x.innerHTML = '<span class="ms">close</span>'; x.disabled = list.length <= min;
      x.onclick = () => this.change(() => list.splice(k, 1), b.id);
      return x;
    },
    // Selector de icono: Material Symbols de la lista o un emoji escrito
    mbIconPop(anchor, current, pick) {
      let pop = $('#mb-icon-pop');
      if (!pop) { pop = document.createElement('div'); pop.id = 'mb-icon-pop'; pop.className = 'mb-icon-pop'; document.body.appendChild(pop); }
      pop.innerHTML = `<div class="mb-icon-grid">${M.ICONS.map(([n]) => `<button type="button" data-i="${n}" title="${n.replace(/_/g, ' ')}" class="${n === current ? 'on' : ''}"><span class="ms">${n}</span></button>`).join('')}</div>
        <div class="mb-icon-emoji"><input placeholder="${t('O escribe un emoji')}" maxlength="8"><button type="button" class="btn tonal">${t('Usar')}</button></div>`;
      pop.classList.remove('hidden');
      const r = anchor.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
      pop.style.top = Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 4)) + 'px';
      const off = (e) => { if (!pop.contains(e.target)) { pop.classList.add('hidden'); document.removeEventListener('mousedown', off, true); } };
      const done = (v) => { pop.classList.add('hidden'); document.removeEventListener('mousedown', off, true); pick(v); };
      $$('.mb-icon-grid button', pop).forEach((x) => (x.onclick = () => done(x.dataset.i)));
      const inp = $('input', pop);
      $('.btn', pop).onclick = () => { const v = M.safeGlyph(inp.value); if (v) done(v); else K.toast(t('Escribe un solo emoji o símbolo.')); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('.btn', pop).click(); } };
      setTimeout(() => document.addEventListener('mousedown', off, true), 0);
    },
    // Botón «Añadir» de la barra de un bloque con elementos
    mbAddBtn(extra, label, on) {
      extra.insertAdjacentHTML('beforeend', `<button class="lv" data-mbadd="1" title="${t(label)}"><span class="ms">add</span><span class="lbl">${t(label)}</span></button>`);
      $('[data-mbadd]', extra).onclick = on;
    },
    // Cuadrícula de elementos (tarjetas, cifras, testimonios…) con su botón de quitar
    mbGrid(cls, n) { const g = document.createElement('div'); g.className = `mb-grid ${cls} n${Math.max(1, Math.min(4, n))}`; return g; },
  });

  // --- Pestañas ------------------------------------------------------------------------------------------------------------
  E.types.tabs = function (b, i, body, extra) {
    b.cols = b.cols || [];
    if (!has(b.active) || b.active >= b.cols.length) b.active = 0;
    const act = b.active;
    const bar = document.createElement('div');
    bar.className = 'mb-tabs-bar' + (b.variant === 'pill' ? ' pill' : '');
    bar.setAttribute('role', 'tablist');
    b.cols.forEach((c, k) => {
      const tab = document.createElement('div');
      tab.className = 'mb-tab' + (k === act ? ' on' : '');
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', k === act ? 'true' : 'false');
      const title = this.mbText('span', b, c, 'title', 'Título', 'mb-tab-t');
      title.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
      tab.appendChild(title);
      tab.onmousedown = (e) => { if (k !== b.active && !e.target.closest('.mb-del')) { b.active = k; this.repaintBlock(b.id); } };
      if (b.cols.length > 2) tab.appendChild(this.mbDel(b, b.cols, k, 2));
      bar.appendChild(tab);
    });
    const panel = document.createElement('div');
    panel.className = 'mb-tab-panel';
    panel.setAttribute('role', 'tabpanel');
    const c = b.cols[act];
    if (c) panel.appendChild(this.list(c.children = c.children || [], b.id));
    body.append(bar, panel);
    this.mbAddBtn(extra, 'Añadir pestaña', () => this.change(() => { b.cols.push({ title: t('Pestaña {n}', { n: b.cols.length + 1 }), width: '', children: [this.create('paragraph')] }); b.active = b.cols.length - 1; }, b.id));
    this.styleBtn(extra, b);
  };

  // --- Línea de tiempo -----------------------------------------------------------------------------------------------------
  E.types.timeline = function (b, i, body, extra) {
    const wrap = document.createElement('div');
    wrap.className = 'mb-tl' + (b.dir === 'h' ? ' h' : '');
    b.items.forEach((it, k) => {
      const row = document.createElement('div');
      row.className = 'mb-tl-item';
      const txt = document.createElement('div');
      txt.className = 'mb-tl-txt';
      txt.append(this.mbText('div', b, it, 'date', 'Fecha (1999, Mayo…)', 'mb-date'), this.mbText('div', b, it, 'title', 'Título del hito', 'mb-title'), this.mbText('div', b, it, 'html', 'Texto del hito', 'mb-text'));
      row.append(txt, this.mbImg(b, it, 'img', { label: 'Foto del hito' }), this.mbDel(b, b.items, k));
      wrap.appendChild(row);
    });
    body.appendChild(wrap);
    extra.innerHTML = ['v', 'h'].map((d) => `<button class="lv ${(b.dir || 'v') === d ? 'on' : ''}" data-d="${d}" title="${d === 'v' ? t('Vertical') : t('Horizontal')}"><span class="ms">${d === 'v' ? 'timeline' : 'arrow_range'}</span></button>`).join('');
    $$('[data-d]', extra).forEach((x) => (x.onclick = () => this.change(() => { b.dir = x.dataset.d; }, b.id)));
    this.mbAddBtn(extra, 'Añadir hito', () => this.change(() => b.items.push({ date: '', title: '', html: '', img: null }), b.id));
    this.styleBtn(extra, b);
  };

  // --- Cifras destacadas ---------------------------------------------------------------------------------------------------
  E.types.figures = function (b, i, body, extra) {
    const g = this.mbGrid('mb-figs', b.items.length);
    b.items.forEach((it, k) => {
      const c = document.createElement('div');
      c.className = 'mb-fig';
      c.append(this.mbText('div', b, it, 'value', '20', 'mb-fig-n'), this.mbText('div', b, it, 'label', 'años de historia', 'mb-fig-l'), this.mbDel(b, b.items, k));
      g.appendChild(c);
    });
    body.appendChild(g);
    if (b.count) body.insertAdjacentHTML('beforeend', `<div class="hint mb-note"><span class="ms">123</span>${t('Los números cuentan desde 0 al aparecer en la web.')}</div>`);
    extra.innerHTML = '';
    this.mbAddBtn(extra, 'Añadir cifra', () => this.change(() => b.items.push({ value: '', label: '' }), b.id));
    $('[data-mbadd]', extra).disabled = b.items.length >= 4;
    this.styleBtn(extra, b);
  };

  // --- Testimonios ---------------------------------------------------------------------------------------------------------
  E.types.testimonials = function (b, i, body, extra) {
    const g = this.mbGrid('mb-testis' + (b.slider ? ' slider' : ''), b.slider ? 3 : b.items.length);
    b.items.forEach((it, k) => {
      const c = document.createElement('div');
      c.className = 'mb-testi';
      c.append(this.mbImg(b, it, 'img', { round: true, label: 'Foto de la persona' }), this.mbText('div', b, it, 'html', 'Lo que dice esta persona…', 'mb-quote'), this.mbText('div', b, it, 'name', 'Nombre', 'mb-name'), this.mbText('div', b, it, 'role', 'Cargo o relación', 'mb-role'), this.mbDel(b, b.items, k));
      g.appendChild(c);
    });
    body.appendChild(g);
    extra.innerHTML = '';
    this.mbAddBtn(extra, 'Añadir testimonio', () => this.change(() => b.items.push({ html: '', name: '', role: '', img: null }), b.id));
    this.styleBtn(extra, b);
  };

  // --- Tarjetas con icono --------------------------------------------------------------------------------------------------
  E.types.cards = function (b, i, body, extra) {
    const g = this.mbGrid('mb-cards', b.items.length);
    b.items.forEach((it, k) => {
      const c = document.createElement('div');
      c.className = 'mb-card';
      const ic = document.createElement('button');
      ic.type = 'button'; ic.className = 'mb-ico'; ic.title = t('Cambiar el icono');
      const cur = M.iconValue(it.icon);
      ic.innerHTML = M.isIconName(cur) ? `<span class="ms">${cur}</span>` : `<span class="mb-emoji">${esc(cur || '＋')}</span>`;
      ic.onclick = () => this.mbIconPop(ic, cur, (v) => this.change(() => { it.icon = v; }, b.id));
      const link = document.createElement('div');
      link.className = 'mb-link';
      link.append(this.mbInput(b, it, 'url', 'Enlace (opcional)', { type: 'url' }), this.mbInput(b, it, 'label', 'Texto del enlace', { trim: false }));
      c.append(ic, this.mbText('div', b, it, 'title', 'Título', 'mb-title'), this.mbText('div', b, it, 'html', 'Texto de la tarjeta', 'mb-text'), link, this.mbDel(b, b.items, k));
      g.appendChild(c);
    });
    body.appendChild(g);
    extra.innerHTML = '';
    this.mbAddBtn(extra, 'Añadir tarjeta', () => this.change(() => b.items.push({ icon: 'star', title: '', html: '', url: '', label: '' }), b.id));
    $('[data-mbadd]', extra).disabled = b.items.length >= 4;
    this.styleBtn(extra, b);
  };

  // --- Llamada a la acción -------------------------------------------------------------------------------------------------
  E.types.cta = function (b, i, body, extra) {
    const box = document.createElement('div');
    box.className = 'mb-cta' + (b.align === 'left' ? ' left' : '');
    const bgi = window.Design.pick(b).bgi;
    if (b.gradient) box.style.backgroundImage = b.gradient; else if (b.bg) box.style.backgroundColor = b.bg;
    if (bgi?.url) { box.style.backgroundImage = `linear-gradient(rgba(0,0,0,${(bgi.dim || 0) / 100}),rgba(0,0,0,${(bgi.dim || 0) / 100})),url("${String(bgi.url).replace(/"/g, '%22')}")`; box.style.backgroundSize = 'cover'; }
    if (b.color) box.style.color = b.color;
    const btns = document.createElement('div');
    btns.className = 'mb-cta-btns';
    b.buttons.forEach((bt, k) => {
      const w = document.createElement('div');
      w.className = 'mb-cta-btn' + (k ? ' outline' : '');
      const label = this.mbText('span', b, bt, 'html', k ? 'Botón secundario' : 'Texto del botón', 'ed-btn' + (k ? ' outline' : ''));
      if (!k) { if (b.btnBg) label.style.setProperty('--eb-bg', b.btnBg); if (b.btnColor) label.style.setProperty('--eb-fg', b.btnColor); if (b.btnRadius) label.style.setProperty('--eb-r', { square: '0', round: '8px', pill: '9999px' }[b.btnRadius]); }
      label.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
      w.append(label, this.mbInput(b, bt, 'url', 'Enlace (https://…)', { type: 'url' }));
      if (k) { const x = this.mbDel(b, b.buttons, k, 1); w.appendChild(x); }
      btns.appendChild(w);
    });
    box.append(this.mbText('div', b, b, 'title', 'Título', 'mb-cta-t'), this.mbText('div', b, b, 'html', 'Texto de apoyo', 'mb-cta-p'), btns);
    body.appendChild(box);
    extra.innerHTML = '';
    this.mbAddBtn(extra, 'Añadir segundo botón', () => this.change(() => b.buttons.push({ html: '', url: '' }), b.id));
    $('[data-mbadd]', extra).disabled = b.buttons.length >= 2;
    this.styleBtn(extra, b);
  };
})();
