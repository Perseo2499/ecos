// Editor de bloques · panel «Estilo» (ventanita con las opciones de cada bloque) y menús desplegables de la barra, que se actualizan
// sin reconstruirse al pulsar una opción.
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { $, $$, t, esc, TYPES, COLS, pct, SK, SWATCH, has } = K;

  Object.assign(E, {
    // Pone el HTML en un menú flotante. Si el menú ya está abierto con la misma estructura, NO se reconstruye: solo se
    // copian las clases (opción marcada), valores y textos, así no parpadea ni se mueve al pulsar una opción.
    setPopHtml(el, html) {
      const visible = !el.classList.contains('hidden');
      const tmp = document.createElement('div'); tmp.innerHTML = html;
      const a = [...el.querySelectorAll('*')], b = [...tmp.querySelectorAll('*')];
      const same = visible && a.length === b.length && a.every((x, i) => x.tagName === b[i].tagName);
      if (!same) { el.innerHTML = html; return false; }
      a.forEach((x, i) => {
        const y = b[i];
        if (x.className !== y.className) x.className = y.className;
        if ('disabled' in x && x.disabled !== y.disabled) x.disabled = y.hasAttribute('disabled');
        if (x.tagName === 'INPUT' && x !== document.activeElement && x.getAttribute('value') !== y.getAttribute('value')) { x.setAttribute('value', y.getAttribute('value') || ''); x.value = y.getAttribute('value') || ''; }
        if (x.tagName === 'OUTPUT' && x.textContent !== y.textContent) x.textContent = y.textContent;
        const st = y.getAttribute('style'); if (st !== x.getAttribute('style') && x.tagName !== 'INPUT') { if (st == null) x.removeAttribute('style'); else x.setAttribute('style', st); }
      });
      return true;
    },

    dd: null,
    closeDrop() { $('#dd-pop')?.classList.add('hidden'); this.dd = null; $$('.lv.dd.on').forEach((x) => x.classList.remove('on')); },
    openDrop(btn, m, b) {
      let el = $('#dd-pop');
      if (!el) {
        el = document.createElement('div'); el.id = 'dd-pop'; el.className = 'sty-pop dd-pop hidden';
        document.body.appendChild(el);
        document.addEventListener('mousedown', (e) => { if (this.dd && !e.target.closest('#dd-pop, [data-dd]')) this.closeDrop(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.dd) this.closeDrop(); });
      }
      const kept = el.dataset.for === `${b.id}:${this.dd.key}` && this.setPopHtml(el, m.groups.map((g, gi) => `<div class="sp-row"><div class="sp-lbl">${esc(g.label)}</div><div class="sp-chips">${g.opts.map(([, n, on], oi) => `<button class="sp-chip ${on ? 'on' : ''}" data-g="${gi}" data-o="${oi}">${esc(n)}</button>`).join('')}</div></div>`).join(''));
      if (!kept) el.innerHTML = m.groups.map((g, gi) => `<div class="sp-row"><div class="sp-lbl">${esc(g.label)}</div><div class="sp-chips">${g.opts.map(([, n, on], oi) => `<button class="sp-chip ${on ? 'on' : ''}" data-g="${gi}" data-o="${oi}">${esc(n)}</button>`).join('')}</div></div>`).join('');
      el.dataset.for = `${b.id}:${this.dd.key}`;
      el.classList.remove('hidden');
      btn.classList.add('on');
      // la posición se fija al abrir (la barra puede ocultarse al llevar el ratón al menú); si ya estaba abierto, no se mueve
      if (!kept) {
        el.style.left = Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, this.dd.x)) + 'px';
        el.style.top = Math.max(8, Math.min(innerHeight - el.offsetHeight - 8, this.dd.y)) + 'px';
      }
      $$('.sp-chip', el).forEach((x) => (x.onclick = () => { const o = m.groups[Number(x.dataset.g)].opts[Number(x.dataset.o)]; $$(`.sp-chip[data-g="${x.dataset.g}"]`, el).forEach((y) => y.classList.toggle('on', y === x)); this.changeBlock(b.id, o[3]); }));
      void b;
    },

    pop: null, popLock: false, popSnap: false,
    styleBtn(extra, b, sep = true) {
      extra.insertAdjacentHTML('beforeend', `${sep ? '<span class="lv-sep"></span>' : ''}<button class="lv sty-btn ${this.pop?.id === b.id ? 'on' : ''}" data-sty="1" title="${t('Estilo del bloque')}"><span class="ms">tune</span><span class="lbl">${t('Estilo')}</span></button>`);
      $('[data-sty]', extra).onclick = (e) => {
        if (this.pop?.id === b.id) { this.closeStyle(); return; }
        const r = e.currentTarget.getBoundingClientRect();
        const prev = this.pop?.id; // el bloque que tenía el panel abierto (si lo había) deja de marcarse
        this.pop = { id: b.id, x: r.left, y: r.bottom + 8 };
        this.openStyle(b.id, true);
        if (!this.repaintBlock(b.id)) this.render();
        else if (prev != null && prev !== b.id) this.repaintBlock(prev);
      };
    },
    closeStyle() {
      const el = $('#sty-pop');
      if (el) el.classList.add('hidden');
      const was = this.pop; this.pop = null; this.popLock = false; this.popSnap = false;
      if (was) $$('.blk.sty-open').forEach((x) => x.classList.remove('sty-open'));
      $$('.sty-btn.on').forEach((x) => x.classList.remove('on'));
    },
    // Cambio en directo (colores, deslizadores): un solo paso de «deshacer» por gesto y sin reconstruir el panel
    live(fn) {
      if (!this.popSnap) { this.snapshot(); this.popSnap = true; }
      this.popLock = true;
      fn();
      if (!this.pop || !this.repaintBlock(this.pop.id)) this.render(); // solo se repinta el bloque que se está estilando
      this.onChange();
    },
    // Filas del panel de cada tipo de bloque: { label, chips:[{t, ic, title, on, off, fn}] | color:{get,set,none} | range:{...} | html+wire }
    styleRows(b) {
      const chip = (txt, on, fn, o = {}) => ({ t: txt, on, fn, ...o });
      const set = (k, v) => () => { if (v === undefined || v === null || v === '') delete b[k]; else b[k] = v; };
      const choose = (k, opts) => opts.map(([v, n, o]) => chip(n, (b[k] ?? '') === v, set(k, v), o));
      const widthRow = () => ({ label: t('Ancho'), chips: choose('width', [['', t('Normal')], ['wide', t('Ancho')], ['full', t('Completo')]]) });
      // Degradado de fondo (atributo estándar style.color.gradient); al elegirlo se quita el color liso
      const gradRow = (label) => ({ label: label || t('Degradado de fondo'), grad: { get: () => b.gradient || '', set: (v) => { if (v) { b.gradient = v; delete b.bg; } else delete b.gradient; } } });
      // Margen exterior arriba y abajo (style.spacing.margin)
      const marginRows = () => [['mt', t('Margen exterior arriba')], ['mb', t('Margen exterior abajo')]].map(([k, label]) => ({
        label, chips: [chip(t('Normal'), !has(b[k]), () => { delete b[k]; }), ...[0, 16, 32, 64, 96].map((v) => chip(v + ' px', has(b[k]) && Number(b[k]) === v, () => { b[k] = v; }))],
      }));
      // Punto focal de la imagen de fondo de la portada: se pulsa sobre la miniatura
      const focalRow = () => {
        const f = b.focalPoint || { x: 0.5, y: 0.5 };
        return {
          label: t('Punto focal de la imagen'),
          html: `<div class="sp-focal" title="${t('Pulsa en la parte de la foto que siempre debe verse')}"><img src="${esc(b.img.url)}" alt="" draggable="false"><i style="left:${Math.round(f.x * 100)}%;top:${Math.round(f.y * 100)}%"></i></div><button class="sp-chip" data-fc="1" ${b.focalPoint ? '' : 'disabled'}>${t('Centrar')}</button>`,
          wire: (root) => {
            const box = $('.sp-focal', root);
            box.onclick = (e) => { const r = $('img', box).getBoundingClientRect(); const x = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100) / 100, y = Math.round(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * 100) / 100; this.change(() => { b.focalPoint = { x, y }; }, b.id); };
            $('[data-fc]', root).onclick = () => this.change(() => { delete b.focalPoint; }, b.id);
          },
        };
      };
      const rows = [];
      if (b.type === 'image' || b.type === 'mediatext') {
        const px = /px$/.test(b.w || '');
        rows.push({ label: t('Recortar la foto'), chips: [{ t: t('Recortar…'), ic: 'crop', on: false, raw: () => this.cropImage(b) }] });
        rows.push({ label: t('Recorte'), chips: [['', t('Original')], ['1', '1:1'], ['4/3', '4:3'], ['3/2', '3:2'], ['16/9', '16:9'], ['9/16', '9:16']]
          .map(([v, n]) => chip(n, (b.ratio || '') === v, () => { set('ratio', v)(); if (v !== '1' && b.frame === 'circle') delete b.frame; })) });
        if (b.type === 'image') rows.push({
          label: t('Ancho'),
          html: `<input type="number" class="sp-num" min="5" max="2000" value="${parseFloat(b.w) || ''}" placeholder="${t('auto')}"><button class="sp-chip ${!px ? 'on' : ''}" data-u="%">%</button><button class="sp-chip ${px ? 'on' : ''}" data-u="px">px</button><button class="sp-chip" data-u="">${t('Auto')}</button>`,
          wire: (root) => {
            const num = $('.sp-num', root), unit = () => (/px$/.test(b.w || '') ? 'px' : '%');
            num.onchange = () => { const v = Math.max(5, Math.min(2000, parseFloat(num.value) || 0)); this.change(() => { if (!v) { delete b.w; return; } b.w = v + (unit() === 'px' ? 'px' : '%'); delete b.width; if (!b.align) b.align = 'center'; }, b.id); };
            $$('[data-u]', root).forEach((x) => (x.onclick = () => this.change(() => {
              const u = x.dataset.u;
              if (!u) { delete b.w; return; }
              const cur = parseFloat(b.w) || (u === 'px' ? 400 : 60);
              b.w = cur + u; delete b.width; if (!b.align) b.align = 'center';
            }, b.id)));
          },
        });
        rows.push({ label: t('Marco'), chips: [
          chip(t('Sin marco'), !b.frame, () => { delete b.frame; }),
          chip(t('Redondeado'), b.frame === 'rounded', () => { b.frame = 'rounded'; }),
          chip(t('Círculo'), b.frame === 'circle', () => { b.frame = 'circle'; }, { off: b.ratio !== '1', title: t('Elige primero el recorte 1:1 para usar el círculo') }),
          chip(t('Borde'), b.frame === 'border', () => { b.frame = 'border'; }),
          chip(t('Sombra'), b.frame === 'shadow', () => { b.frame = 'shadow'; }),
        ] });
        if (b.frame === 'border') rows.push({ label: t('Color del borde'), color: { get: () => b.frameColor || '#333333', set: (v) => { b.frameColor = v; } } });
        rows.push({ label: t('Efecto'), chips: [chip(t('Ninguno'), !b.fx, () => { delete b.fx; }), chip(t('Zoom al pasar el ratón'), b.fx === 'zoom', () => { b.fx = 'zoom'; }), chip(t('Blanco y negro'), b.fx === 'bw', () => { b.fx = 'bw'; })] });
        if (b.type === 'image') rows.push({ label: t('Convertir en'), chips: [['grid', 'grid_view', t('Galería')], ['mosaic', 'dashboard', t('Mosaico')], ['carousel', 'view_carousel', t('Carrusel')]].map(([k, ic, n]) => ({ t: n, ic, on: false, raw: () => this.convertImage(b, k) })) });
      } else if (b.type === 'video') {
        rows.push({ label: t('Colocación'), chips: [['', t('A todo el ancho')], ['left', t('Izquierda')], ['center', t('Centro')], ['right', t('Derecha')]]
          .map(([v, n]) => chip(n, (b.align || '') === v, () => { if (v) { b.align = v; if (!b.width) b.width = 50; } else { delete b.align; delete b.width; } })) });
        if (b.align) rows.push({ label: t('Tamaño'), chips: [[33, t('Pequeña')], [50, t('Mediana')], [75, t('Grande')]].map(([v, n]) => chip(n, (b.width || 50) === v, () => { b.width = v; })) });
        rows.push({ label: t('Recorte'), chips: [['', t('Original')], ['1', '1:1'], ['4/3', '4:3'], ['3/2', '3:2'], ['16/9', '16:9'], ['9/16', '9:16']].map(([v, n]) => chip(n, (b.ratio || '') === v, set('ratio', v))) });
        rows.push({ label: t('Marco'), chips: [
          chip(t('Sin marco'), !b.frame, () => { delete b.frame; }),
          chip(t('Redondeado'), b.frame === 'rounded', () => { b.frame = 'rounded'; }),
          chip(t('Borde'), b.frame === 'border', () => { b.frame = 'border'; }),
          chip(t('Sombra'), b.frame === 'shadow', () => { b.frame = 'shadow'; }),
        ] });
        rows.push({ label: t('Efecto'), chips: [chip(t('Ninguno'), !b.fx, () => { delete b.fx; }), chip(t('Zoom al pasar el ratón'), b.fx === 'zoom', () => { b.fx = 'zoom'; }), chip(t('Blanco y negro'), b.fx === 'bw', () => { b.fx = 'bw'; })] });
      } else if (b.type === 'group') {
        rows.push({ label: t('Color del texto'), color: { get: () => b.color || '', set: (v) => set('color', v)(), none: true } });
        // espaciado, bordes, esquinas, sombra, fondo y ancho: apartado «Diseño» (designRows)
        rows.push({ label: t('Imagen de fondo'), chips: [{ t: t('Poner una imagen de fondo…'), ic: 'wallpaper', on: false, raw: () => this.pickFromTray((m) => this.change(() => { b.type = 'cover'; b.img = { ...m }; b.overlay = '#000000'; b.dim = 40; b.height = 300; delete b.bg; delete b.gradient; delete b.border; delete b.pad; delete b.radius; delete b.shadow; }), 'image') }] });
      } else if (b.type === 'columns') {
        rows.push({ label: t('Columnas'), chips: [2, 3, 4].map((n) => chip(String(n), b.cols.length === n, () => {}, { raw: () => this.setColumns(b, n), on: b.cols.length === n })) });
        const cur = b.cols.map((c) => parseFloat(c.width));
        rows.push({ label: t('Proporción'), chips: (COLS[b.cols.length] || []).map((p) => ({ t: p.map((w) => Math.floor(w)).join(' / '), on: p.length === cur.length && p.every((w, k) => Math.abs(w - cur[k]) < 0.6), fn: () => p.forEach((w, k) => (b.cols[k].width = pct(w))) })) });
        rows.push({ label: t('Alineación vertical'), chips: [['', t('Arriba')], ['center', t('Centro')], ['bottom', t('Abajo')]].map(([v, n]) => chip(n, (b.valign || '') === v, () => { if (v) b.valign = v; else delete b.valign; })) });
        rows.push({ label: t('Apilar en móvil'), chips: [chip(t('Sí'), b.stack !== false, () => { b.stack = true; }), chip(t('No'), b.stack === false, () => { b.stack = false; })] });
        rows.push({ label: t('Separación entre columnas'), chips: [chip(t('Normal'), !has(b.gap), () => { delete b.gap; }), ...[0, 16, 32, 48, 64].map((v) => chip(v + ' px', has(b.gap) && Number(b.gap) === v, () => { b.gap = v; }))] });
      } else if (b.type === 'cover') {
        rows.push({ label: t('Imagen de fondo'), chips: [{ t: t('Cambiar imagen…'), ic: 'add_photo_alternate', on: false, raw: () => this.pickFromTray((m) => this.change(() => this.setCoverImg(b, m)), 'image') }, chip(t('Quitar imagen'), false, () => { b.img = null; delete b.focalPoint; delete b.parallax; }, { off: !b.img })] });
        if (b.img) rows.push(focalRow());
        if (b.img) rows.push({ label: t('Efecto parallax (la imagen se mueve más despacio al bajar)'), chips: [chip(t('No'), !b.parallax, () => { delete b.parallax; }), chip(t('Sí'), !!b.parallax, () => { b.parallax = true; })] });
        rows.push({ label: t('Capa de color'), color: { get: () => b.overlay || '#000000', set: (v) => { b.overlay = v; } } });
        rows.push(gradRow(t('Degradado en la capa')));
        rows.push({ label: t('Opacidad de la capa'), range: { min: 0, max: 100, step: 10, get: () => Number(b.dim ?? 50), set: (v) => { b.dim = v; }, fmt: (v) => v + '%' } });
        rows.push({ label: t('Altura'), chips: [[0, t('Auto')], [240, t('Baja')], [360, t('Media')], [480, t('Alta')], [600, t('Muy alta')]].map(([v, n]) => chip(n, (Number(b.height) || 0) === v, () => { b.height = v; })) });
      } else if (b.type === 'map') {
        rows.push({ label: t('Altura'), chips: [[260, t('Baja')], [360, t('Media')], [480, t('Alta')]].map(([v, n]) => chip(n, (Number(b.height) || 360) === v, () => { b.height = v; })) });
        rows.push({ label: t('Esquinas'), chips: [[0, t('Rectas')], [16, t('Suaves')], [28, t('Redondas')]].map(([v, n]) => chip(n, (Number(b.radius) || 0) === v, () => { b.radius = v; })) });
      } else if (b.type === 'buttons') {
        if (b.variant !== 'outline') rows.push({ label: t('Color de fondo'), color: { get: () => b.bg || '', set: (v) => set('bg', v)(), none: true } });
        rows.push({ label: b.variant === 'outline' ? t('Color del borde y del texto') : t('Color del texto'), color: { get: () => b.color || '', set: (v) => set('color', v)(), none: true } });
        rows.push({ label: t('Esquinas'), chips: [['', t('Tema')], ['square', t('Recto')], ['round', t('Redondeado')], ['pill', t('Píldora')]].map(([v, n]) => chip(n, (b.radius || '') === v, () => set('radius', v)())) });
        rows.push({ label: t('Tamaño'), chips: [['s', t('Pequeño')], ['', t('Mediano')], ['l', t('Grande')]].map(([v, n]) => chip(n, (b.size || '') === v, () => set('size', v)())) });
        rows.push({ label: t('Ancho'), chips: [chip(t('Normal'), !b.full, () => { delete b.full; }), chip(t('Completo'), !!b.full, () => { b.full = true; })] });
      }
      return rows;
    },
    openStyle(id, reopen) {
      const loc = this.locate(id);
      let el = $('#sty-pop');
      if (!loc) { this.closeStyle(); return; }
      if (!el) {
        el = document.createElement('div'); el.id = 'sty-pop'; el.className = 'sty-pop hidden';
        document.body.appendChild(el);
        document.addEventListener('mousedown', (e) => { if (this.pop && !e.target.closest('#sty-pop, [data-sty]')) this.closeStyle(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.pop) this.closeStyle(); });
      }
      const b = loc.b, rows = [...this.styleRows(b), ...(this.designRows ? this.designRows(b) : [])];
      if (!rows.length) { this.closeStyle(); return; }
      const T = TYPES()[b.type];
      const h = [`<div class="sp-title"><span class="ms">${T.icon}</span>${esc(T.name)}<button class="sp-x" title="${t('Cerrar')}"><span class="ms">close</span></button></div>`];
      let sec = null; // apartado del panel «Diseño» al que pertenece cada fila (se abren y se cierran)
      const isOpen = (key) => this.secOpen[key] ?? (key === 'saved' && this.savedStyles().length > 0);
      rows.forEach((r, ri) => {
        if (r.head) {
          sec = r.head;
          h.push(`<button class="sp-head ${isOpen(sec) ? 'open' : ''}" data-hd="${sec}" aria-expanded="${isOpen(sec)}"><span class="ms">${r.icon || 'tune'}</span><span class="sp-ht">${esc(r.label)}</span><span class="ms sp-chev">expand_more</span></button>`);
          return;
        }
        let body = '';
        if (r.chips) body = `<div class="sp-chips">${r.chips.map((c, ci) => `<button class="sp-chip ${c.on ? 'on' : ''}" data-r="${ri}" data-c="${ci}" ${c.off ? 'disabled' : ''} ${c.title ? `title="${esc(c.title)}"` : ''}>${c.ic ? `<span class="ms">${c.ic}</span>` : ''}${esc(c.t)}</button>`).join('')}</div>`;
        else if (r.color) {
          const cur = r.color.get() || '';
          body = `<div class="sp-chips sp-sws">${r.color.none ? `<button class="sp-chip ${!cur ? 'on' : ''}" data-r="${ri}" data-sw="">${t('Ninguno')}</button>` : ''}${window.ThemeUI ? window.ThemeUI.panelSwatches(ri, cur, SWATCH) : SWATCH.map((c) => `<button class="sp-sw ${cur.toLowerCase() === c ? 'on' : ''}" data-r="${ri}" data-sw="${c}" style="background:${c}" title="${c}"></button>`).join('')}<label class="sp-sw sp-custom" title="${t('Otro color')}"><span class="ms">palette</span><input type="color" data-r="${ri}" value="${/^#[0-9a-f]{6}$/i.test(cur) ? cur : '#888888'}"></label></div>`;
        } else if (r.grad) {
          const cur = r.grad.get() || '';
          body = `<div class="sp-chips sp-sws"><button class="sp-chip ${!cur ? 'on' : ''}" data-r="${ri}" data-gr="">${t('Ninguno')}</button>${SK().GRADIENTS.map((g) => `<button class="sp-sw ${cur === g.css ? 'on' : ''}" data-r="${ri}" data-gr="${esc(g.css)}" style="background:${g.css}" title="${esc(t(g.name))}"></button>`).join('')}</div>`;
        } else if (r.range) body = `<div class="sp-range"><input type="range" data-r="${ri}" min="${r.range.min}" max="${r.range.max}" step="${r.range.step}" value="${r.range.get()}"><output>${r.range.fmt(r.range.get())}</output></div>`;
        else if (r.html) body = `<div class="sp-chips sp-custom-row" data-r="${ri}">${r.html}</div>`;
        h.push(`<div class="sp-row ${sec && !isOpen(sec) ? 'hidden' : ''}"><div class="sp-lbl">${esc(r.label)}</div>${body}</div>`);
      });
      const keptSty = el.dataset.for === String(id) && this.setPopHtml(el, h.join(''));
      if (!keptSty) el.innerHTML = h.join('');
      el.dataset.for = String(id);
      el.classList.remove('hidden');
      // posición: bajo el botón «Estilo» (se conserva al reconstruir)
      const pos = this.pop || (this.pop = { id, x: 200, y: 120 });
      pos.id = id;
      const w = el.offsetWidth, hh = el.offsetHeight;
      el.style.left = Math.max(8, Math.min(innerWidth - w - 8, pos.x)) + 'px';
      el.style.top = Math.max(8, Math.min(innerHeight - hh - 8, pos.y)) + 'px';
      $('.sp-x', el).onclick = () => { this.closeStyle(); if (!this.repaintBlock(id)) this.render(); };
      $$('.sp-head', el).forEach((x) => (x.onclick = () => { this.secOpen[x.dataset.hd] = !isOpen(x.dataset.hd); this.openStyle(id, true); }));
      $$('.sp-chip[data-c]', el).forEach((x) => (x.onclick = () => { const c = rows[Number(x.dataset.r)].chips[Number(x.dataset.c)]; if (c.raw) c.raw(); else this.changeBlock(id, c.fn); }));
      $$('[data-sw]', el).forEach((x) => (x.onclick = () => this.changeBlock(id, () => { const before = { bg: b.bg, color: b.color }; rows[Number(x.dataset.r)].color.set(x.dataset.sw); window.ThemeUI?.tagChanged(b, before, x.dataset.sw, x.dataset.th || ''); })));
      $$('[data-gr]', el).forEach((x) => (x.onclick = () => this.changeBlock(id, () => rows[Number(x.dataset.r)].grad.set(x.dataset.gr))));
      $$('input[type=color]', el).forEach((x) => {
        const r = rows[Number(x.dataset.r)];
        x.oninput = () => this.live(() => r.color.set(x.value));
        x.onchange = () => { this.popLock = false; this.popSnap = false; this.openStyle(id, true); };
      });
      $$('input[type=range]', el).forEach((x) => {
        const r = rows[Number(x.dataset.r)];
        x.oninput = () => { $('output', x.parentElement).textContent = r.range.fmt(Number(x.value)); this.live(() => r.range.set(Number(x.value))); };
        x.onchange = () => { this.popLock = false; this.popSnap = false; this.openStyle(id, true); };
      });
      $$('.sp-custom-row', el).forEach((x) => rows[Number(x.dataset.r)].wire(x));
      void reopen;
    },
  });
})();
