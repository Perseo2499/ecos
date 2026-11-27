// Editor de bloques · panel de diseño universal (apartado «Diseño» del panel «Estilo» de CUALQUIER bloque), menú «⋯» de la barra
// (copiar y pegar estilo, guardar como estilo), estilos guardados y la vista del diseño en el editor.
// La lógica pura (valores, salida a WordPress, lectura) está en renderer/design.js.
(function () {
  const E = window.BlockEditor, K = window.BlockKit, D = window.Design;
  const { $, $$, t, esc, has, SWATCH } = K;
  const SK = () => window.Sections;

  // Tipos de bloque con texto propio (llevan el apartado «Tipografía»)
  const TYPO = ['paragraph', 'heading', 'list', 'quote', 'mediatext', 'buttons', 'details', 'table', 'toc', 'group', 'columns', 'cover'];
  const TEXTY = ['paragraph', 'heading', 'list', 'quote', 'mediatext']; // con espaciado de letras propio (b.spacing)
  const CLIP_KEY = 'ecos.styleClip';

  Object.assign(E, {
    secOpen: {}, // apartados del panel abiertos (se conservan al reconstruirlo)
    styleClip: null, // el estilo copiado

    // Cambia el diseño de un bloque (con las claves de siempre de cada tipo): se lee, se mezcla y se vuelve a escribir
    setDesign(b, patch) {
      const s = D.pick(b);
      for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === null || v === '' || v === false) delete s[k]; else s[k] = v; }
      D.apply(b, s);
    },

    // --- Estilos guardados (configuración local) ------------------------------------------------------------------
    savedStyles() { return D.validSaved(typeof CFG !== 'undefined' ? CFG.designStyles : []); },
    async storeSaved(list) {
      try { const c = await window.api.setConfig({ designStyles: list }); if (typeof CFG !== 'undefined' && c) CFG = c; else if (typeof CFG !== 'undefined') CFG.designStyles = list; } catch { if (typeof CFG !== 'undefined') CFG.designStyles = list; }
      if (this.pop) this.openStyle(this.pop.id, true);
    },
    copyStyle(b) {
      this.styleClip = D.pick(b);
      try { localStorage.setItem(CLIP_KEY, JSON.stringify(this.styleClip)); } catch { /* sin almacenamiento */ }
      K.info(t('Estilo copiado'));
    },
    clip() {
      if (this.styleClip) return this.styleClip;
      try { const c = JSON.parse(localStorage.getItem(CLIP_KEY) || 'null'); if (c && typeof c === 'object') return (this.styleClip = D.clean(c)); } catch { /* idem */ }
      return null;
    },
    pasteStyle(b) {
      const c = this.clip();
      if (!c) return;
      this.change(() => { D.apply(b, c); }, b.id);
    },

    // --- Filas del apartado «Diseño» -------------------------------------------------------------------------------------
    designRows(b) {
      const cur = D.pick(b);
      const rows = [];
      const chip = (txt, on, fn, o = {}) => ({ t: txt, on, fn, ...o });
      const patch = (p) => () => this.setDesign(b, p);
      const head = (key, label, icon) => rows.push({ head: key, label, icon });
      const scale = (label, key, sub) => {
        const val = sub ? cur.p?.[sub] : cur[key];
        const all = () => ['t', 'r', 'b', 'l'].map((k) => cur.p?.[k]);
        const on = (v) => (key === 'p' && !sub ? all().every((x) => x === v) : val === v);
        const unset = key === 'p' && !sub ? all().every((x) => x === undefined) : !has(val);
        const set = (v) => () => {
          if (key === 'p') { const p = { ...(cur.p || {}) }; if (sub) { if (v === undefined) delete p[sub]; else p[sub] = v; } else for (const k of 'trbl') { if (v === undefined) delete p[k]; else p[k] = v; } this.setDesign(b, { p: Object.keys(p).length ? p : undefined }); } else this.setDesign(b, { [key]: v });
        };
        rows.push({ label, chips: [chip(t('Normal'), unset, set(undefined)), ...D.SC.map((v, i) => chip(D.SC_N[i], on(v), set(v), { title: v + ' px' }))] });
      };
      // el color liso y el degradado de fondo se excluyen
      const colorRow = (label, key, none = true) => rows.push({ label, color: { get: () => cur[key] || '', set: (v) => this.setDesign(b, { [key]: v || undefined, ...(key === 'fbg' && v ? { fgr: undefined } : {}) }), none } });
      const gradRow = (label, key) => rows.push({ label, grad: { get: () => cur[key] || '', set: (v) => this.setDesign(b, { [key]: v || undefined, ...(key === 'fgr' && v ? { fbg: undefined } : {}) }) } });
      const isCover = b.type === 'cover';

      // Mis estilos
      const saved = this.savedStyles();
      head('saved', t('Mis estilos'), 'bookmarks');
      rows.push({
        label: saved.length ? t('Pulsa una ficha para aplicarla') : t('Guarda el estilo de un bloque con «⋯ → Guardar como estilo…»'),
        html: saved.map((s, i) => `<span class="dz-card"><button class="sp-chip dz-apply" data-si="${i}" title="${esc(D.summary(s.style).map((x) => t(x)).join(' · '))}"><span class="ms">style</span>${esc(s.name)}</button><button class="dz-del" data-sd="${i}" title="${t('Borrar este estilo')}"><span class="ms">close</span></button></span>`).join(''),
        wire: (root) => {
          $$('[data-si]', root).forEach((x) => (x.onclick = () => this.changeBlock(b.id, () => D.apply(b, saved[Number(x.dataset.si)].style))));
          $$('[data-sd]', root).forEach((x) => (x.onclick = () => this.storeSaved(saved.filter((_, k) => k !== Number(x.dataset.sd)))));
        },
      });

      // Espaciado
      head('sp', t('Espaciado'), 'space_bar');
      scale(t('Exterior arriba'), 'mt');
      scale(t('Exterior abajo'), 'mb');
      scale(t('Interior (todos los lados)'), 'p');
      const sides = [['t', t('Arriba')], ['r', t('Derecha')], ['b', t('Abajo')], ['l', t('Izquierda')]];
      rows.push({
        label: t('Interior por lado'),
        html: `<div class="dz-sides">${sides.map(([k, n]) => `<label>${esc(n)}<select data-ps="${k}"><option value="">${t('Normal')}</option>${D.SC.map((v, i) => `<option value="${v}" ${cur.p?.[k] === v ? 'selected' : ''}>${D.SC_N[i]}</option>`).join('')}${has(cur.p?.[k]) && !D.SC.includes(cur.p[k]) ? `<option value="${cur.p[k]}" selected>${cur.p[k]} px</option>` : ''}</select></label>`).join('')}</div>`,
        wire: (root) => $$('[data-ps]', root).forEach((x) => (x.onchange = () => this.changeBlock(b.id, () => { const p = { ...(cur.p || {}) }; if (x.value === '') delete p[x.dataset.ps]; else p[x.dataset.ps] = Number(x.value); this.setDesign(b, { p: Object.keys(p).length ? p : undefined }); }))),
      });

      // Bordes, esquinas y sombra
      head('bd', t('Bordes y sombra'), 'border_style');
      rows.push({ label: t('Grosor del borde'), chips: [chip(t('Ninguno'), !cur.bw, patch({ bw: undefined, bs: undefined, bc: undefined })), ...D.BW.map((v) => chip(v + ' px', cur.bw === v, patch({ bw: v })))] });
      if (cur.bw) {
        rows.push({ label: t('Estilo del borde'), chips: [['', t('Sólido')], ['dashed', t('Guiones')], ['dotted', t('Puntos')]].map(([v, n]) => chip(n, (cur.bs || '') === v, patch({ bs: v || undefined }))) });
        colorRow(t('Color del borde'), 'bc', false);
      }
      rows.push({ label: t('Esquinas redondeadas'), chips: [[0, t('Rectas')], [8, t('Suaves')], [16, t('Medias')], [28, t('Redondas')], [999, t('Píldora')]].map(([v, n]) => chip(n, (cur.rd || 0) === v, patch({ rd: v || undefined }))) });
      rows.push({ label: t('Sombra'), chips: [chip(t('Ninguna'), !cur.sh, patch({ sh: undefined })), ...Object.keys(D.SHADOWS).map((k) => chip(t(D.SHADOW_N[k]), cur.sh === k, patch({ sh: k })))] });

      // Fondo
      head('bg', t('Fondo'), 'format_color_fill');
      if (!isCover) {
        colorRow(t('Color de fondo'), 'fbg');
        gradRow(t('Degradado de fondo'), 'fgr');
        rows.push({
          label: t('Imagen de fondo'),
          chips: [
            { t: t('Poner una imagen…'), ic: 'wallpaper', on: false, raw: () => this.pickFromTray((m) => this.changeBlock(b.id, () => this.setDesign(b, { bgi: { url: m.url, x: 0.5, y: 0.5, dim: cur.bgi?.dim || 0 } })), 'image') },
            chip(t('Quitar imagen'), false, patch({ bgi: undefined }), { off: !cur.bgi }),
          ],
        });
        if (cur.bgi) {
          const f = { x: cur.bgi.x ?? 0.5, y: cur.bgi.y ?? 0.5 };
          rows.push({
            label: t('Punto focal de la imagen'),
            html: `<div class="sp-focal" title="${t('Pulsa en la parte de la foto que siempre debe verse')}"><img src="${esc(cur.bgi.url)}" alt="" draggable="false"><i style="left:${Math.round(f.x * 100)}%;top:${Math.round(f.y * 100)}%"></i></div>`,
            wire: (root) => {
              const box = $('.sp-focal', root);
              box.onclick = (e) => { const r = $('img', box).getBoundingClientRect(); const x = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100) / 100, y = Math.round(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) * 100) / 100; this.changeBlock(b.id, () => this.setDesign(b, { bgi: { ...cur.bgi, x, y } })); };
            },
          });
          rows.push({ label: t('Oscurecido de la imagen'), range: { min: 0, max: 80, step: 10, get: () => cur.bgi.dim || 0, set: (v) => this.setDesign(b, { bgi: { ...cur.bgi, dim: v } }), fmt: (v) => v + '%' } });
        }
      }
      // vídeo de fondo: solo en secciones y portadas
      if (b.type === 'group') rows.push({ label: t('Vídeo de fondo'), chips: [{ t: t('Poner un vídeo de fondo…'), ic: 'movie', on: false, raw: () => this.pickFromTray((m) => this.change(() => { Object.assign(b, { type: 'cover', bgVideo: { id: m.id, url: m.url }, img: null, overlay: '#000000', dim: 40, height: 300 }); delete b.pad; }), 'video') }] });
      if (isCover) rows.push({ label: t('Vídeo de fondo'), chips: [{ t: b.bgVideo ? t('Cambiar el vídeo…') : t('Poner un vídeo de fondo…'), ic: 'movie', on: !!b.bgVideo, raw: () => this.pickFromTray((m) => this.change(() => { b.bgVideo = { id: m.id, url: m.url }; b.img = null; delete b.focalPoint; delete b.parallax; if (Number(b.dim ?? 50) >= 100) b.dim = 50; }, b.id), 'video') }, chip(t('Quitar el vídeo'), false, () => { delete b.bgVideo; }, { off: !b.bgVideo })] });

      // Ancho y alineación
      head('w', t('Ancho y alineación'), 'width');
      const floatImg = b.type === 'image' && b.align;
      rows.push({ label: t('Ancho'), chips: [['', t('Contenido')], ['wide', t('Ancho')], ['full', t('Completo')]].map(([v, n]) => chip(n, (cur.wd || '') === v, patch({ wd: v || undefined }), { off: !!floatImg, title: floatImg ? t('Una foto colocada a un lado no se ensancha') : '' })) });
      if (b.type === 'paragraph' || b.type === 'heading') rows.push({ label: t('Alineación'), chips: [['', t('Izquierda')], ['center', t('Centro')], ['right', t('Derecha')], ['justify', t('Justificada')]].map(([v, n]) => chip(n, (b.align || '') === v, () => { if (v) b.align = v; else delete b.align; })) });
      else if (b.type === 'buttons') rows.push({ label: t('Alineación'), chips: [['left', t('Izquierda')], ['center', t('Centro')], ['right', t('Derecha')]].map(([v, n]) => chip(n, (b.align || 'left') === v, () => { b.align = v; })) });
      else if (!D.OWN_ALIGN.includes(b.type)) rows.push({ label: t('Alineación'), chips: [['', t('Izquierda')], ['center', t('Centro')], ['right', t('Derecha')]].map(([v, n]) => chip(n, (cur.da || '') === v, patch({ da: v || undefined }))) });

      // Por dispositivo
      head('dev', t('Por dispositivo'), 'devices');
      rows.push({ label: t('Ocultar en…'), chips: [['hm', t('Móvil'), 'smartphone'], ['ht', t('Tableta'), 'tablet_mac'], ['hd', t('Escritorio'), 'computer']].map(([k, n, ic]) => ({ t: n, ic, on: !!cur[k], fn: patch({ [k]: cur[k] ? undefined : true }) })) });
      rows.push({ label: t('Tamaño de letra en móvil'), chips: [chip(t('Igual'), !cur.fsm, patch({ fsm: undefined })), ...D.FSM.map((v) => chip(v + ' px', cur.fsm === v, patch({ fsm: v })))] });
      rows.push({ label: t('Espaciado interior en móvil'), chips: [chip(t('Igual'), !has(cur.pm), patch({ pm: undefined })), ...D.SC.map((v, i) => chip(D.SC_N[i], cur.pm === v, patch({ pm: v }), { title: v + ' px' }))] });

      // Animación al aparecer
      head('an', t('Animación'), 'animation');
      const AN = { fade: 'Aparecer', up: 'Deslizar desde abajo', left: 'Deslizar desde la izquierda', right: 'Deslizar desde la derecha', zoom: 'Ampliar' };
      rows.push({ label: t('Al aparecer en pantalla'), chips: [chip(t('Ninguna'), !cur.an, patch({ an: undefined, ad: undefined, ay: undefined })), ...D.ANIMS.map((k) => chip(t(AN[k]), cur.an === k, patch({ an: k })))] });
      if (cur.an) {
        rows.push({ label: t('Duración'), chips: [[300, 'Rápida'], [600, 'Normal'], [900, 'Lenta'], [1200, 'Muy lenta']].map(([v, n]) => chip(t(n), (cur.ad || 600) === v, patch({ ad: v === 600 ? undefined : v }))) });
        rows.push({ label: t('Retardo'), chips: D.DELAY.map((v) => chip(v ? (v / 1000).toString().replace('.', ',') + ' s' : t('Sin retardo'), (cur.ay || 0) === v, patch({ ay: v || undefined }))) });
        rows.push({ label: t('Vista previa'), chips: [{ t: t('Ver la animación'), ic: 'play_arrow', on: false, raw: () => this.previewAnim(b) }] });
      }

      // Tipografía
      if (TYPO.includes(b.type)) {
        head('ty', t('Tipografía'), 'text_fields');
        rows.push({
          label: t('Fuente'),
          html: `<select class="dz-font" data-gf><option value="">${t('La de tu web')}</option><optgroup label="Google Fonts">${D.FONTS.map((f) => `<option value="${f.slug}" ${cur.gf === f.slug ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</optgroup></select><div class="hint dz-gf-note">${t('Las fuentes de Google se cargan desde los servidores de Google (hace falta el complemento de Ecos).')}</div>`,
          wire: (root) => { $('[data-gf]', root).onchange = (e) => this.changeBlock(b.id, () => { this.setDesign(b, { gf: e.target.value || undefined }); if (e.target.value) delete b.font; }); },
        });
        rows.push({ label: t('Interlineado'), chips: [chip(t('Normal'), !cur.lh, patch({ lh: undefined })), ...D.LH.map((v) => chip(v.replace('.', ','), cur.lh === v, patch({ lh: v })))] });
        if (TEXTY.includes(b.type)) rows.push({ label: t('Espaciado de letras'), chips: [chip(t('Normal'), !b.spacing, () => { delete b.spacing; }), ...D.SPACINGS.map((v) => chip(v.replace('.', ',').replace('px', ' px'), b.spacing === v, () => { b.spacing = v; }))] });
        rows.push({ label: t('Transformación'), chips: [chip(t('Normal'), !cur.tt, patch({ tt: undefined })), chip(t('MAYÚSCULAS'), cur.tt === 'uppercase', patch({ tt: 'uppercase' })), chip(t('minúsculas'), cur.tt === 'lowercase', patch({ tt: 'lowercase' })), chip(t('Capitalizada'), cur.tt === 'capitalize', patch({ tt: 'capitalize' }))] });
        rows.push({ label: t('Texto con degradado'), grad: { get: () => cur.tg || '', set: (v) => this.setDesign(b, { tg: v || undefined }) } });
        colorRow(t('Resaltado decorativo (subrayado grueso)'), 'hl');
      }
      return rows;
    },

    // Vista previa de la animación en el editor: el bloque entra como lo hará en la web
    previewAnim(b) {
      const el = $(`.blk[data-id="${CSS.escape(String(b.id))}"] > .blk-body`);
      const c = el && (el.firstElementChild || el);
      if (!c || !c.animate) return;
      const from = { fade: {}, up: { transform: 'translateY(32px)' }, left: { transform: 'translateX(-40px)' }, right: { transform: 'translateX(40px)' }, zoom: { transform: 'scale(.88)' } }[b.an] || {};
      c.animate([{ opacity: 0, ...from }, { opacity: 1, transform: 'none' }], { duration: b.ad || 600, delay: b.ay || 0, easing: 'cubic-bezier(.2,0,0,1)', fill: 'backwards' });
    },

    // --- Menú «⋯» de la barra del bloque -------------------------------------------------------------------------------------
    closeDz() { $('#dz-menu')?.classList.add('hidden'); this.dzOpen = null; },
    openDz(btn, b) {
      let el = $('#dz-menu');
      if (!el) {
        el = document.createElement('div'); el.id = 'dz-menu'; el.className = 'sty-pop dz-menu hidden';
        document.body.appendChild(el);
        document.addEventListener('mousedown', (e) => { if (this.dzOpen && !e.target.closest('#dz-menu, [data-dz]')) this.closeDz(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.dzOpen) this.closeDz(); });
      }
      if (this.dzOpen === b.id && !el.classList.contains('hidden')) { this.closeDz(); return; }
      this.dzOpen = b.id;
      const canPaste = !!this.clip();
      el.innerHTML = `<button class="dz-item" data-a="copy"><span class="ms">content_copy</span>${t('Copiar estilo')}</button>`
        + `<button class="dz-item" data-a="paste" ${canPaste ? '' : 'disabled'}><span class="ms">content_paste</span>${t('Pegar estilo')}</button>`
        + `<button class="dz-item" data-a="save"><span class="ms">bookmark_add</span>${t('Guardar como estilo…')}</button>`
        + `<button class="dz-item" data-a="synced"><span class="ms">sync</span>${t('Guardar como bloque sincronizado…')}</button>`
        + `<div class="dz-save hidden"><input class="dz-name" maxlength="40" placeholder="${t('Nombre del estilo')}"><button class="sp-chip on" data-a="ok">${t('Guardar')}</button></div>`;
      el.classList.remove('hidden');
      const r = btn.getBoundingClientRect();
      el.style.left = Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, r.left)) + 'px';
      el.style.top = Math.max(8, Math.min(innerHeight - el.offsetHeight - 8, r.bottom + 6)) + 'px';
      const name = $('.dz-name', el);
      const ok = async () => {
        const s = D.makeSaved(name.value, b);
        if (!s.name) { name.focus(); return; }
        this.closeDz();
        await this.storeSaved([...this.savedStyles().filter((x) => x.name !== s.name), s]);
        K.info(t('Estilo «{n}» guardado', { n: s.name }));
      };
      $('[data-a="copy"]', el).onclick = () => { this.copyStyle(b); this.closeDz(); };
      $('[data-a="paste"]', el).onclick = () => { this.closeDz(); this.pasteStyle(b); };
      $('[data-a="synced"]', el).onclick = () => { this.closeDz(); this.saveAsSynced?.(this.sel?.length > 1 && this.sel.includes(b.id) ? this.sel : [b.id]); };
      $('[data-a="save"]', el).onclick = () => { $('.dz-save', el).classList.remove('hidden'); name.focus(); };
      $('[data-a="ok"]', el).onclick = ok;
      name.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } };
    },

    // --- Lo que se añade a cada bloque al dibujarlo: botones «Estilo» y «⋯», diseño y ocultos por dispositivo -----------------------
    decorateBlock(el, b, extra) {
      if (b.type === 'raw' || b.type === 'synced') return;
      if (!$('[data-sty]', extra)) this.styleBtn(extra, b, extra.children.length > 0);
      extra.insertAdjacentHTML('beforeend', `<button class="lv" data-dz="1" title="${t('Más opciones de estilo')}"><span class="ms">more_horiz</span></button>`);
      $('[data-dz]', extra).onclick = (e) => this.openDz(e.currentTarget, b);
      this.paintDesign(el, b);
    },
    // El diseño en el editor: las mismas clases que en la web (menos ancho, dispositivo y animación) y su CSS
    paintDesign(el, b) {
      const body = $(':scope > .blk-body', el), c = body?.firstElementChild;
      el.classList.remove('hid-m', 'hid-t', 'hid-d');
      if (b.hm) el.classList.add('hid-m'); if (b.ht) el.classList.add('hid-t'); if (b.hd) el.classList.add('hid-d');
      if (b.hm || b.ht || b.hd) { body.dataset.hidM = t('Oculto en móvil'); body.dataset.hidT = t('Oculto en tableta'); body.dataset.hidD = t('Oculto en escritorio'); }
      if (!c) return;
      for (const k of [...c.classList]) if (/^ecos-(d|font)-/.test(k)) c.classList.remove(k);
      if (!D.hasDesign(b)) return;
      const pv = D.preview(b);
      c.classList.add(...pv.cls);
      this.dzCss(pv.fx.filter((k) => k.startsWith('dyn:')).map((k) => k.slice(4)));
      // lo que pone la barra de formato en línea (resaltado: margen interior y esquinas) cede ante el diseño
      if (has(b.rd)) c.style.borderRadius = '';
      if (b.p) c.style.padding = '';
      if (D.fontBySlug(b.gf)) c.style.fontFamily = '';
      // texto con degradado de fondo y resaltado de párrafo (los de la barra de formato no lo pintan)
      if (b.gradient && TEXTY.includes(b.type)) { c.style.backgroundImage = b.gradient; c.style.backgroundColor = ''; }
      this.fontLink();
    },
    // CSS de las clases de diseño dentro del editor (las estáticas una vez; los colores y las imágenes de fondo, según se usan)
    dzCss(rules) {
      let st = $('#ecos-dz');
      if (!st) {
        st = document.createElement('style'); st.id = 'ecos-dz'; document.head.appendChild(st);
        this._dz = new Set(); st.textContent = D.STATIC_CSS().replace(/(box-shadow|border-radius|border-width|border-style):([^;}!]+)(?=[;}])/g, '$1:$2!important'); // en el editor, el diseño manda sobre los estilos del propio editor
      }
      const fresh = rules.filter((r) => !this._dz.has(r));
      if (fresh.length) { fresh.forEach((r) => this._dz.add(r)); st.textContent += fresh.join(''); }
    },
    // Las fuentes de Google usadas en la entrada (si no hay red, el editor usa la fuente del sistema)
    fontLink() {
      const slugs = this.flat().map((x) => x.gf).filter((s) => D.fontBySlug(s));
      const url = D.fontsUrl(slugs);
      let l = $('#ecos-gf');
      if (!url) { l?.remove(); return; }
      if (!l) { l = document.createElement('link'); l.id = 'ecos-gf'; l.rel = 'stylesheet'; document.head.appendChild(l); }
      if (l.getAttribute('href') !== url) l.setAttribute('href', url);
    },
  });
  void SWATCH; void SK;
})();
