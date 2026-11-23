// Editor de bloques · contenedores: sección, columnas y portada (llevan otros bloques dentro), con márgenes, guardar como sección y
// número de columnas.
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { $, $$, t, COLS, pct, has } = K;

  Object.assign(E, {
    // --- Diseño avanzado (fase 2) ---------------------------------------------------------------------------------------
    // Margen exterior arriba y abajo de un contenedor
    margins(el, b) {
      if (has(b.mt)) el.style.marginTop = Number(b.mt) + 'px';
      if (has(b.mb)) el.style.marginBottom = Number(b.mb) + 'px';
    },
    // Imagen de fondo de una portada: si estaba tapada del todo por la capa de color, se deja ver
    setCoverImg(b, m) {
      if (!b.img && Number(b.dim ?? 50) >= 100) b.dim = 50;
      b.img = { ...m };
    },
    // «Guardar como sección»: botón pequeño de la barra de secciones, columnas y portadas
    saveBtn(extra, b) {
      extra.insertAdjacentHTML('beforeend', `<span class="lv-sep"></span><button class="lv" data-sv="1" title="${t('Guardar como sección')}"><span class="ms">bookmark_add</span></button>`);
      $('[data-sv]', extra).onclick = () => window.SectionsUI?.save(b);
    },

    // Columnas: cambia el número conservando lo que hay dentro (las que sobran se juntan en la última)
    setColumns(b, n) {
      if (b.cols.length === n) return;
      this.change(() => {
        while (b.cols.length > n) { const last = b.cols.pop(); b.cols[b.cols.length - 1].children.push(...last.children.filter((x) => !(x.type === 'paragraph' && !(x.html || '').trim()))); }
        while (b.cols.length < n) b.cols.push({ width: '', children: [this.create('paragraph')] });
        COLS[n][0].forEach((w, k) => (b.cols[k].width = pct(w)));
      }, b.id);
    },
  });

  E.types.group = function (b, i, body, extra) {
    const g = document.createElement('div');
    g.className = `ed-group pad-${b.pad || 'none'} w-${b.width || 'normal'}`;
    Object.assign(g.style, { backgroundColor: b.gradient ? '' : b.bg || '', backgroundImage: b.gradient || '', color: b.color || '', borderRadius: b.radius ? b.radius + 'px' : '', boxShadow: b.shadow ? '6px 6px 9px rgba(0, 0, 0, 0.2)' : '' });
    if (b.border) { g.style.border = `1px solid ${b.border}`; g.style.outline = 'none'; }
    this.margins(g, b);
    g.appendChild(this.list(b.children, b.id));
    body.appendChild(g);
    this.saveBtn(extra, b);
    this.styleBtn(extra, b, false);
  };

  E.types.columns = function (b, i, body, extra) {
    const row = document.createElement('div');
    row.className = 'ed-cols' + (b.valign ? ' va-' + b.valign : '') + (b.stack !== false ? ' stack' : '');
    if (has(b.gap)) row.style.setProperty('--g', Number(b.gap) + 'px');
    if (b.gradient) row.style.backgroundImage = b.gradient; else if (b.bg) row.style.backgroundColor = b.bg;
    this.margins(row, b);
    b.cols.forEach((c) => {
      const col = document.createElement('div');
      col.className = 'ed-col';
      col.style.flexGrow = String(parseFloat(c.width) || 100 / b.cols.length);
      col.style.setProperty('--w', String(parseFloat(c.width) || 100 / b.cols.length) + '%');
      col.appendChild(this.list(c.children, b.id));
      row.appendChild(col);
    });
    body.appendChild(row);
    const n = b.cols.length, cur = b.cols.map((c) => parseFloat(c.width));
    const same = (p) => p.length === cur.length && p.every((w, k) => Math.abs(w - cur[k]) < 0.6);
    extra.innerHTML = [2, 3, 4].map((c) => `<button class="lv ${n === c ? 'on' : ''}" data-n="${c}" title="${t('{n} columnas', { n: c })}">${c}<span class="ms">view_column</span></button>`).join('')
      + '<span class="lv-sep"></span>' + (COLS[n] || []).map((p, k) => `<button class="lv ${same(p) ? 'on' : ''}" data-p="${k}" title="${t('Proporción de las columnas')}">${p.map((w) => Math.floor(w)).join('/')}</button>`).join('');
    $$('[data-n]', extra).forEach((x) => (x.onclick = () => this.setColumns(b, Number(x.dataset.n))));
    $$('[data-p]', extra).forEach((x) => (x.onclick = () => this.change(() => COLS[n][Number(x.dataset.p)].forEach((w, k) => (b.cols[k].width = pct(w))), b.id)));
    this.saveBtn(extra, b);
    this.styleBtn(extra, b);
  };

  E.types.cover = function (b, i, body, extra) {
    const cv = document.createElement('div');
    cv.className = `ed-cover w-${b.width || 'normal'}` + (b.parallax && b.img ? ' parallax' : '');
    cv.style.minHeight = (Number(b.height) || 0) + 'px';
    if (b.img) cv.style.backgroundImage = `url("${String(b.img.url).replace(/"/g, '%22')}")`;
    if (b.img && b.focalPoint) cv.style.backgroundPosition = `${Math.round(b.focalPoint.x * 100)}% ${Math.round(b.focalPoint.y * 100)}%`;
    this.margins(cv, b);
    const dim = document.createElement('div');
    dim.className = 'ed-cover-dim'; dim.style.background = b.gradient || b.overlay || '#000000'; dim.style.opacity = String((Number(b.dim ?? 50)) / 100);
    const inn = document.createElement('div');
    inn.className = 'ed-cover-in';
    const drop = document.createElement('div');
    drop.className = 'cover-bgdrop' + (b.img ? ' has' : '');
    drop.innerHTML = `<span class="ms">add_photo_alternate</span>${b.img ? t('Cambiar la imagen de fondo') : t('Arrastra aquí la imagen de fondo')}`;
    drop.onclick = () => this.pickFromTray((m) => this.change(() => this.setCoverImg(b, m)), 'image');
    this.acceptPhoto(drop, (img) => this.setCoverImg(b, img), { sameOk: (d) => !(d.kind === 'photo' && d.block === b.id) });
    inn.append(drop, this.list(b.children, b.id));
    cv.append(dim, inn);
    body.appendChild(cv);
    this.saveBtn(extra, b);
    this.styleBtn(extra, b);
  };
})();
