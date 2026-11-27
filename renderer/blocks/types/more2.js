// Editor de bloques · «Más bloques» (2): donación, evento, audio o pódcast, PDF, imagen con puntos interactivos, antes/después y preguntas frecuentes.
// Las piezas comunes (campos, foto pequeña, selector de iconos) están en more.js; la lógica y la salida a WordPress, en renderer/moreblocks.js.
(function () {
  const E = window.BlockEditor, K = window.BlockKit, M = window.MoreBlocks;
  const { $, $$, t, esc, has } = K;
  const chip = (...a) => E.mbChip(...a);

  const row = (cls, ...kids) => { const d = document.createElement('div'); d.className = cls; d.append(...kids.filter(Boolean)); return d; };
  const lbl = (txt, el) => { const l = document.createElement('label'); l.className = 'mb-lbl'; const s = document.createElement('span'); s.textContent = t(txt); l.append(s, el); return l; };

  Object.assign(E.mbRows, {
    donate(b) { return [{ label: t('Alineación del botón'), chips: [chip(t('Izquierda'), b.align !== 'center', () => { delete b.align; }), chip(t('Centrado'), b.align === 'center', () => { b.align = 'center'; })] }]; },
    event(b) { return [{ label: t('Mapa de la dirección dentro del evento'), chips: [chip(t('Sin mapa'), !b.showMap, () => { delete b.showMap; }), chip(t('Con mapa'), !!b.showMap, () => { b.showMap = true; })] }]; },
    pdf(b) {
      return [
        { label: t('Vista previa dentro de la página'), chips: [chip(t('Sí'), b.preview !== false, () => { b.preview = true; }), chip(t('No'), b.preview === false, () => { b.preview = false; })] },
        { label: t('Botón de descarga'), chips: [chip(t('Sí'), b.download !== false, () => { b.download = true; }), chip(t('No'), b.download === false, () => { b.download = false; })] },
        { label: t('Altura de la vista previa'), chips: [[400, t('Baja')], [600, t('Media')], [800, t('Alta')], [1000, t('Muy alta')]].map(([v, n]) => chip(n, (Number(b.height) || 600) === v, () => { b.height = v; })) },
      ];
    },
    faq(b) { return [{ label: t('Solo una pregunta abierta a la vez'), chips: [chip(t('No'), !b.one, () => { b.one = false; }), chip(t('Sí'), !!b.one, () => { b.one = true; })] }]; },
    compare(b) { return [{ label: t('Posición inicial del deslizador'), chips: [0, 25, 50, 75, 100].map((v) => chip(v + '%', (has(b.pos) ? Number(b.pos) : 50) === v, () => { b.pos = v; })) }]; },
  });

  // --- Donación ------------------------------------------------------------------------------------------------------------
  const PRESETS = [['bizum', 'phone_iphone', 'Bizum'], ['paypal', 'payments', 'PayPal'], ['transfer', 'account_balance', 'Transferencia'], ['link', 'link', 'Enlace libre']];
  E.types.donate = function (b, i, body, extra) {
    const box = document.createElement('div');
    box.className = 'mb-don';
    box.append(this.mbText('div', b, b, 'title', 'Título', 'mb-title'), this.mbText('div', b, b, 'html', 'Texto de apoyo (opcional)', 'mb-text'));
    const f = document.createElement('div');
    f.className = 'mb-fields';
    const p = b.preset || 'bizum';
    if (p === 'bizum') f.append(lbl('Número de Bizum', this.mbInput(b, b, 'value', '600 000 000', { type: 'tel' })));
    if (p === 'transfer') f.append(lbl('IBAN', this.mbInput(b, b, 'value', 'ES00 0000 0000 0000 0000 0000')), lbl('Titular de la cuenta', this.mbInput(b, b, 'holder', 'Nombre del titular')));
    if (p === 'paypal') f.append(lbl('Usuario de paypal.me o enlace', this.mbInput(b, b, 'value', 'paypal.me/tuusuario')), lbl('O el identificador de un botón de PayPal (hosted)', this.mbInput(b, b, 'hosted', 'Opcional, p. ej. ABCD1234')));
    if (p === 'link') f.append(lbl('Enlace de donación', this.mbInput(b, b, 'url', 'https://…', { type: 'url' })));
    f.append(lbl(p === 'bizum' ? 'Texto del botón (copia el número)' : p === 'transfer' ? 'Texto del botón (copia el IBAN)' : 'Texto del botón', this.mbInput(b, b, 'label', p === 'link' ? 'Donar' : p === 'paypal' ? 'Donar con PayPal' : 'Copiar', { trim: false })));
    const am = document.createElement('input');
    am.className = 'mb-in'; am.placeholder = '5, 10, 25'; am.value = (b.amounts || []).join(', ');
    let snap = false;
    am.oninput = () => { if (!snap) { this.snapshot(); snap = true; } b.amounts = (am.value.match(/\d+/g) || []).map(Number).filter((n) => n > 0).slice(0, 6); this.onChange(); };
    am.onblur = () => { snap = false; };
    f.append(lbl('Importes sugeridos en € (opcional)', am));
    box.appendChild(f);
    const kind = { bizum: 'Se verá el número y un botón que lo copia.', paypal: 'Un botón por importe y otro para donar otra cantidad.', transfer: 'Se verá el IBAN y un botón que lo copia.', link: 'Un botón que lleva a tu enlace.' }[p];
    box.insertAdjacentHTML('beforeend', `<div class="hint mb-note"><span class="ms">info</span>${t(kind)}</div>`);
    body.appendChild(box);
    extra.innerHTML = PRESETS.map(([k, ic, n]) => `<button class="lv ${p === k ? 'on' : ''}" data-p="${k}" title="${n}"><span class="ms">${ic}</span><span class="lbl">${t(n)}</span></button>`).join('');
    $$('[data-p]', extra).forEach((x) => (x.onclick = () => this.change(() => { b.preset = x.dataset.p; }, b.id)));
    this.styleBtn(extra, b);
  };

  // --- Evento ----------------------------------------------------------------------------------------------------------------
  E.types.event = function (b, i, body, extra) {
    const allDay = !!b.start && !b.start.includes('T');
    const box = document.createElement('div');
    box.className = 'mb-ev';
    const type = allDay ? 'date' : 'datetime-local';
    const dates = row('mb-fields two', lbl('Empieza', this.mbInput(b, b, 'start', '', { type })), lbl('Termina (opcional)', this.mbInput(b, b, 'end', '', { type })));
    const when = document.createElement('div');
    when.className = 'mb-ev-when';
    const refresh = () => { when.innerHTML = b.start ? `<span class="ms">event</span><span>${esc(M.whenText(b.start, M.parseDT(b.end) && M.parseDT(b.end).all === M.parseDT(b.start)?.all ? b.end : ''))}</span>` : `<span class="hint">${t('Elige la fecha y la hora de inicio.')}</span>`; };
    refresh();
    $$('input', dates).forEach((x) => x.addEventListener('input', refresh));
    const place = this.mbInput(b, b, 'place', 'Calle Mayor 1, Madrid', { trim: false });
    place.addEventListener('input', () => { const l = $('.mb-ev-place', box); if (l) l.href = M.mapLink(place.value); });
    box.append(this.mbText('div', b, b, 'title', 'Nombre del evento', 'mb-title'), dates, when, lbl('Lugar (con enlace a Google Maps)', place),
      this.mbText('div', b, b, 'html', 'Descripción (opcional)', 'mb-text'), lbl('Enlace del evento (opcional, va en el calendario)', this.mbInput(b, b, 'url', 'https://…', { type: 'url' })));
    if (b.showMap && (b.place || '').trim()) box.insertAdjacentHTML('beforeend', `<div class="ed-map-frame" style="height:200px;border-radius:12px"><iframe src="${esc(window.Sections.mapUrl(b.place))}" loading="lazy" title="${esc(b.place)}"></iframe></div>`);
    const btns = row('mb-ev-btns');
    btns.innerHTML = `<span class="ed-btn"><span class="ms">calendar_add_on</span> ${t('Añadir al calendario')}</span><span class="ed-btn outline">Google Calendar</span>`;
    box.appendChild(btns);
    body.appendChild(box);
    extra.innerHTML = `<button class="lv ${allDay ? 'on' : ''}" data-ad="1" title="${t('Todo el día')}"><span class="ms">today</span><span class="lbl">${t('Todo el día')}</span></button><button class="lv ${b.showMap ? 'on' : ''}" data-mp="1" title="${t('Mostrar un mapa')}"><span class="ms">map</span><span class="lbl">${t('Mapa')}</span></button>`;
    $('[data-ad]', extra).onclick = () => this.change(() => {
      const strip = (v, d) => (allDay ? (v ? v + (d ? 'T18:00' : '') : v) : (v || '').slice(0, 10));
      b.start = strip(b.start, true); if (b.end) b.end = strip(b.end, true);
    }, b.id);
    $('[data-mp]', extra).onclick = () => this.change(() => { b.showMap = !b.showMap; }, b.id);
    this.styleBtn(extra, b);
  };

  // --- Audio o pódcast --------------------------------------------------------------------------------------------------------
  E.types.audio = function (b, i, body, extra) {
    const embed = b.mode === 'embed';
    const box = document.createElement('div');
    box.className = 'mb-aud';
    const url = this.mbInput(b, b, 'url', embed ? 'Enlace de Spotify, iVoox o SoundCloud' : 'Dirección del archivo de audio (.mp3, .m4a…)', { type: 'url', after: (v) => { const d = K.detectEmbed(v); if (embed) { if (d?.provider === 'spotify' || d?.provider === 'soundcloud') b.provider = d.provider; else delete b.provider; } } });
    const prev = document.createElement('div');
    prev.className = 'mb-aud-prev';
    const show = () => {
      const u = (b.url || '').trim();
      if (!/^https?:\/\//i.test(u)) { prev.innerHTML = `<span class="ms">${embed ? 'podcasts' : 'headphones'}</span><span class="hint">${embed ? t('Pega el enlace del episodio y aquí lo verás.') : t('Pega la dirección del archivo de audio (por ejemplo, el de tu biblioteca de medios de WordPress).')}</span>`; return; }
      if (!embed) prev.innerHTML = `<audio controls preload="none" src="${esc(u)}"></audio>`;
      else { const d = K.detectEmbed(u); prev.innerHTML = d?.player ? `<iframe src="${esc(d.player)}" height="152" loading="lazy" title="${esc(d.name)}" allow="encrypted-media"></iframe>` : `<span class="ms">podcasts</span><span class="hint">${esc(u)}</span>`; }
    };
    show();
    url.addEventListener('change', show);
    box.append(this.mbText('div', b, b, 'title', 'Título del episodio', 'mb-title'), this.mbText('div', b, b, 'html', 'Descripción (opcional)', 'mb-text'), url, prev);
    body.appendChild(box);
    extra.innerHTML = [['file', 'audio_file', 'Archivo'], ['embed', 'podcasts', 'Spotify, iVoox…']].map(([k, ic, n]) => `<button class="lv ${(embed ? 'embed' : 'file') === k ? 'on' : ''}" data-m="${k}" title="${t(n)}"><span class="ms">${ic}</span><span class="lbl">${t(n)}</span></button>`).join('');
    $$('[data-m]', extra).forEach((x) => (x.onclick = () => this.change(() => { b.mode = x.dataset.m; if (b.mode === 'file') delete b.provider; }, b.id)));
    this.styleBtn(extra, b, true);
  };

  // --- PDF incrustado -----------------------------------------------------------------------------------------------------------
  E.types.pdf = function (b, i, body, extra) {
    const box = document.createElement('div');
    box.className = 'mb-pdf';
    const url = this.mbInput(b, b, 'url', 'Dirección del PDF (https://…/documento.pdf)', { type: 'url' });
    const prev = document.createElement('div');
    prev.className = 'mb-pdf-prev';
    const show = () => {
      const u = (b.url || '').trim();
      const name = esc(plain(b.name) || decodeURIComponent(u.split('?')[0].split('/').pop() || '') || 'documento.pdf');
      prev.innerHTML = /^https?:\/\//i.test(u)
        ? `<div class="mb-pdf-file"><span class="ms">picture_as_pdf</span><b>${name}</b>${b.download === false ? '' : `<span class="ed-btn">${t('Descargar')}</span>`}</div>${b.preview !== false ? `<object data="${esc(u)}" type="application/pdf" style="width:100%;height:${Math.min(320, Number(b.height) || 600)}px"><span class="hint">${t('Aquí verás la vista previa del PDF.')}</span></object>` : ''}`
        : `<span class="ms">picture_as_pdf</span><span class="hint">${t('Pega la dirección de un PDF (por ejemplo, el de tu biblioteca de medios de WordPress).')}</span>`;
    };
    const plain = (h) => String(h || '').replace(/<[^>]+>/g, '').trim();
    show();
    url.addEventListener('change', show);
    box.append(this.mbText('div', b, b, 'title', 'Título (opcional)', 'mb-title'), this.mbText('div', b, b, 'html', 'Descripción (opcional)', 'mb-text'), url, lbl('Nombre que se muestra del archivo', this.mbInput(b, b, 'name', 'memoria-2025.pdf', { trim: false })), prev);
    body.appendChild(box);
    this.styleBtn(extra, b, false);
  };

  // --- Imagen con puntos interactivos ----------------------------------------------------------------------------------------------
  E.mbSel = {};
  E.types.hotspots = function (b, i, body, extra) {
    b.points = b.points || [];
    const box = document.createElement('div');
    box.className = 'mb-pts';
    if (!b.img?.url) {
      const dz = this.dropZone(t('Elige o suelta aquí la foto'), (m) => this.change(() => { b.img = { ...m }; }, b.id));
      this.acceptPhoto(dz, (m) => { b.img = m; });
      box.appendChild(dz);
    } else {
      const stage = document.createElement('div');
      stage.className = 'mb-pts-stage';
      stage.innerHTML = `<img src="${esc(b.img.url)}" alt="" draggable="false">`;
      const sel = Math.min(this.mbSel[b.id] ?? 0, b.points.length - 1);
      b.points.forEach((p, k) => {
        const m = document.createElement('button');
        m.type = 'button'; m.className = 'mb-pt' + (k === sel ? ' on' : ''); m.textContent = String(k + 1);
        m.style.left = M.clampInt(p.x, 0, 100, 50) + '%'; m.style.top = M.clampInt(p.y, 0, 100, 50) + '%';
        m.title = t('Arrastra para mover el punto');
        m.onmousedown = (e) => {
          e.preventDefault(); e.stopPropagation();
          const r = stage.getBoundingClientRect(); let moved = false, nx = p.x, ny = p.y;
          const move = (ev) => { moved = true; nx = Math.round(Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100))); ny = Math.round(Math.max(0, Math.min(100, ((ev.clientY - r.top) / r.height) * 100))); m.style.left = nx + '%'; m.style.top = ny + '%'; };
          const up = () => {
            document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
            this.mbSel[b.id] = k;
            if (moved) this.change(() => { p.x = nx; p.y = ny; }, b.id); else this.repaintBlock(b.id);
          };
          document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        };
        stage.appendChild(m);
      });
      stage.onclick = (e) => {
        if (e.target.closest('.mb-pt') || b.points.length >= 12) return;
        const r = stage.getBoundingClientRect();
        const x = Math.round(((e.clientX - r.left) / r.width) * 100), y = Math.round(((e.clientY - r.top) / r.height) * 100);
        this.mbSel[b.id] = b.points.length;
        this.change(() => b.points.push({ x, y, title: '', html: '' }), b.id);
      };
      box.appendChild(stage);
      box.insertAdjacentHTML('beforeend', `<div class="hint mb-note"><span class="ms">ads_click</span>${t('Pulsa sobre la foto para colocar un punto; arrástralo para moverlo. En la web se abre al pulsarlo (también con el teclado).')}</div>`);
      b.points.forEach((p, k) => {
        const r = row('mb-pt-row' + (k === this.mbSel[b.id] ? ' on' : ''));
        const num = document.createElement('span');
        num.className = 'mb-pt-n'; num.textContent = String(k + 1);
        const txt = row('mb-pt-txt', this.mbText('div', b, p, 'title', 'Título del punto', 'mb-title'), this.mbText('div', b, p, 'html', 'Texto que aparece al pulsar', 'mb-text'));
        const del = document.createElement('button');
        del.className = 'mb-del'; del.title = t('Quitar el punto'); del.innerHTML = '<span class="ms">close</span>';
        del.onclick = () => this.change(() => { b.points.splice(k, 1); this.mbSel[b.id] = 0; }, b.id);
        r.append(num, txt, del);
        r.onfocusin = () => { if (this.mbSel[b.id] !== k) { this.mbSel[b.id] = k; $$('.mb-pt', stage()).forEach((m, q) => m.classList.toggle('on', q === k)); } };
        box.appendChild(r);
      });
    }
    function stage() { return box.querySelector('.mb-pts-stage'); }
    body.appendChild(box);
    extra.innerHTML = '';
    if (b.img?.url) extra.insertAdjacentHTML('beforeend', `<button class="lv" data-ch="1" title="${t('Cambiar la foto')}"><span class="ms">add_photo_alternate</span><span class="lbl">${t('Cambiar foto')}</span></button>`);
    $('[data-ch]', extra)?.addEventListener('click', () => this.pickFromTray((m) => this.change(() => { b.img = { ...m }; }, b.id), 'image'));
    this.styleBtn(extra, b);
  };

  // --- Comparador antes / después ----------------------------------------------------------------------------------------------------
  E.types.compare = function (b, i, body, extra) {
    const box = document.createElement('div');
    box.className = 'mb-cmp';
    const slots = row('mb-cmp-slots');
    [['Antes', 0], ['Después', 1]].forEach(([n, k]) => {
      const s = row('mb-cmp-slot', Object.assign(document.createElement('b'), { textContent: t(n) }), this.mbImg(b, b, k ? 'after' : 'before', { label: k ? 'Foto de después' : 'Foto de antes', cls: 'wide' }));
      slots.appendChild(s);
    });
    box.appendChild(slots);
    const a = b.before, z = b.after;
    if (a?.url && z?.url) {
      const st = document.createElement('div');
      st.className = 'mb-cmp-stage';
      const pos = has(b.pos) ? Number(b.pos) : 50;
      st.innerHTML = `<img src="${esc(z.url)}" alt="" draggable="false"><img class="top" src="${esc(a.url)}" alt="" draggable="false" style="clip-path:inset(0 ${100 - pos}% 0 0)"><span class="mb-cmp-bar" style="left:${pos}%"></span><span class="mb-cmp-tag a">${t('Antes')}</span><span class="mb-cmp-tag b">${t('Después')}</span>`;
      const rg = document.createElement('input');
      rg.type = 'range'; rg.min = '0'; rg.max = '100'; rg.value = String(pos); rg.className = 'mb-cmp-range';
      rg.setAttribute('aria-label', t('Posición inicial del deslizador'));
      rg.oninput = () => { $('.top', st).style.clipPath = `inset(0 ${100 - Number(rg.value)}% 0 0)`; $('.mb-cmp-bar', st).style.left = rg.value + '%'; };
      rg.onchange = () => this.change(() => { b.pos = Number(rg.value); }, b.id);
      st.appendChild(rg);
      box.appendChild(st);
    } else box.insertAdjacentHTML('beforeend', `<div class="hint mb-note"><span class="ms">compare</span>${t('Elige las dos fotos (mismo encuadre) y aquí verás el deslizador.')}</div>`);
    body.appendChild(box);
    this.styleBtn(extra, b, false);
  };

  // --- Preguntas frecuentes ---------------------------------------------------------------------------------------------------------
  E.types.faq = function (b, i, body, extra) {
    const box = document.createElement('div');
    box.className = 'mb-faq';
    b.items.forEach((it, k) => {
      const d = document.createElement('div');
      d.className = 'mb-faq-item';
      d.append(this.mbText('div', b, it, 'q', 'Pregunta', 'mb-q'), this.mbText('div', b, it, 'html', 'Respuesta', 'mb-a'), this.mbDel(b, b.items, k));
      box.appendChild(d);
    });
    body.appendChild(box);
    extra.innerHTML = `<button class="lv ${b.one ? 'on' : ''}" data-one="1" title="${t('Solo una pregunta abierta a la vez')}"><span class="ms">filter_1</span><span class="lbl">${t('Solo una abierta')}</span></button>`;
    $('[data-one]', extra).onclick = () => this.change(() => { b.one = !b.one; }, b.id);
    this.mbAddBtn(extra, 'Añadir pregunta', () => this.change(() => b.items.push({ q: '', html: '' }), b.id));
    this.styleBtn(extra, b);
  };
})();
