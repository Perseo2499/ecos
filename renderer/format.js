// Barra de formato del editor de entradas: tipo de bloque, fuente, tamaño, negrita/cursiva/subrayado/
// tachado, enlaces, color y resaltado, alineación, superíndice/subíndice/código, letra capital, quitar
// formato y ayuda de la IA para el bloque. Actúa sobre el bloque con el foco (BlockEditor.active).
// También pinta el panel «Revisión» (palabras, tiempo de lectura, estructura y comprobaciones).
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const t = (s, v) => window.I18N.t(s, v);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const E = () => window.BlockEditor;
  const bar = $('#fmt');
  const pop = $('#fmt-pop');
  if (!bar) return;

  // Paleta común de todos los selectores de color del editor (marca, blanco, negro y grises); «Otro color» aparte
  const TEXT_COLORS = window.Sections.PALETTE;
  const BG_COLORS = window.Sections.PALETTE;

  // --- Selección: se guarda para poder volver a ella tras usar un desplegable o un campo
  let range = null;
  document.addEventListener('selectionchange', () => {
    const a = E()?.active, s = getSelection();
    if (a && s.rangeCount && a.el.contains(s.anchorNode)) { range = s.getRangeAt(0).cloneRange(); state(); }
  });
  function restore() {
    const a = E().active;
    if (!a || !document.contains(a.el)) return false;
    a.el.focus();
    if (range && a.el.contains(range.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(range); }
    return true;
  }
  const hasSel = () => { const s = getSelection(); return s.rangeCount && !s.isCollapsed && E().active?.el.contains(s.anchorNode); };
  const fire = () => E().active?.el.dispatchEvent(new Event('input'));
  // El texto de «Imagen y texto» también admite alineación, tamaño, fuente, color… (no se convierte en título ni lista)
  const isText = (b) => b && (E().TEXT_TYPES.includes(b.type) || b.type === 'mediatext');

  // --- Formato del bloque (alineación, tamaño, fuente, colores, letra capital)
  function setBlock(prop, val, themeSlug, themeV) {
    const a = E().active;
    if (!a || !isText(a.b)) { window.toast?.(t('Pulsa primero dentro del texto que quieres cambiar. (El título de la página no es un bloque: su alineación la pone el tema de tu web.)'), true); return; }
    E().snapshot();
    if (val) a.b[prop] = val; else delete a.b[prop];
    window.ThemeUI?.tag(a.b, prop, val ? themeSlug : '', themeV); // colores, tamaños y fuentes de tu web
    E().applyStyle(a.styleEl, a.b);
    E().onChange();
    state();
  }

  // --- Formato en línea con etiquetas (<mark> de color, <code>)
  function wrap(tag, attrs = {}) {
    restore();
    if (!hasSel()) return false;
    const s = getSelection(), r = s.getRangeAt(0);
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.appendChild(r.extractContents());
    r.insertNode(el);
    const nr = document.createRange(); nr.selectNodeContents(el); s.removeAllRanges(); s.addRange(nr);
    fire();
    return true;
  }
  // Quita las marcas de color que toca la selección
  function unwrapMarks() {
    restore();
    const a = E().active, s = getSelection();
    if (!a || !s.rangeCount) return;
    const r = s.getRangeAt(0);
    $$('mark', a.el).filter((m) => r.intersectsNode(m)).forEach((m) => m.replaceWith(...m.childNodes));
    fire();
  }

  // --- Ventanita (colores, enlace, IA) bajo un botón de la barra
  function openPop(anchor, html, wire) {
    pop.innerHTML = html;
    pop.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
    pop.style.top = r.bottom + 6 + 'px';
    wire(pop);
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!pop.contains(e.target) && !anchor.contains(e.target)) { closePop(); document.removeEventListener('mousedown', off); } }), 0);
  }
  const closePop = () => { pop.classList.add('hidden'); setTimeout(place, 0); };
  // los botones de la ventanita no quitan el foco al texto
  pop.addEventListener('mousedown', (e) => { if (e.target.closest('button, .sw')) e.preventDefault(); });

  function colorPop(anchor, kind) {
    const list = kind === 'bg' ? BG_COLORS : TEXT_COLORS;
    const sel = hasSel();
    openPop(anchor, `
      <div class="pop-title">${kind === 'bg' ? t('Resaltado') : t('Color del texto')} <span class="hint">· ${sel ? t('texto seleccionado') : t('todo el bloque')}</span></div>
      ${window.ThemeUI?.barSwatches() || ''}<div class="sw-grid">${list.map((c) => `<span class="sw" data-c="${c}" style="background:${c}" title="${c}"></span>`).join('')}</div>
      <div class="pop-row"><label class="btn text small"><span class="ms">palette</span>${t('Otro color')}<input type="color" class="pick"></label><span class="spacer"></span><button class="btn text small" data-clear><span class="ms">format_color_reset</span>${t('Quitar')}</button></div>`,
    (p) => {
      const apply = (c, slug) => {
        // color de tu web: la marca lleva la clase estándar has-<nombre>-color (o -background-color) y se ve con la hoja del tema
        if (sel && slug) wrap('mark', { style: 'background-color:rgba(0, 0, 0, 0)', class: `has-inline-color has-${slug}-${kind === 'bg' ? 'background-' : ''}color` });
        else if (sel) wrap('mark', { style: kind === 'bg' ? `background-color:${c}` : `background-color:rgba(0, 0, 0, 0);color:${c}`, class: 'has-inline-color' });
        else setBlock(kind === 'bg' ? 'bg' : 'color', c, slug);
        closePop();
      };
      $$('.sw', p).forEach((x) => (x.onclick = () => apply(x.dataset.c, x.dataset.th || '')));
      $('.pick', p).onchange = (e) => apply(e.target.value);
      $('[data-clear]', p).onclick = () => { if (sel) unwrapMarks(); else setBlock(kind === 'bg' ? 'bg' : 'color', null); closePop(); };
    });
  }

  function link() {
    const a = E().active;
    if (!a) return;
    const s = getSelection();
    const cur = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest('a');
    if (!hasSel() && !cur) { window.toast?.(t('Selecciona el texto que quieres enlazar.'), true); return; }
    if (cur && !hasSel()) { const r = document.createRange(); r.selectNodeContents(cur); s.removeAllRanges(); s.addRange(r); range = r.cloneRange(); }
    openPop($('[data-x="link"]', bar), `
      <div class="pop-title">${t('Enlace')}</div>
      <div class="pop-row"><input class="pill-input" id="lk-url" placeholder="https://…" value="${esc(cur?.getAttribute('href') || '')}"></div>
      <div class="pop-row"><span class="hint">${t('También vale un correo (mailto:…) o un teléfono (tel:…).')}</span></div>
      <div class="pop-row"><span class="spacer"></span>${cur ? `<button class="btn text small danger" data-un>${t('Quitar enlace')}</button>` : ''}<button class="btn filled small" data-ok>${t('Aplicar')}</button></div>`,
    (p) => {
      const inp = $('#lk-url', p);
      inp.focus(); inp.select();
      const ok = () => {
        let u = inp.value.trim();
        if (!u) return;
        if (!/^(https?:|mailto:|tel:|#)/i.test(u)) u = (/^[^\s@]+@[^\s@]+$/.test(u) ? 'mailto:' : 'https://') + u;
        restore(); document.execCommand('createLink', false, u); closePop();
      };
      $('[data-ok]', p).onclick = ok;
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } if (e.key === 'Escape') closePop(); };
      $('[data-un]', p)?.addEventListener('click', () => { restore(); document.execCommand('unlink'); closePop(); });
    });
  }

  // --- IA sobre el bloque activo
  const AI_ACTIONS = () => [
    ['improve', 'auto_fix_high', t('Mejorar la redacción')], ['fix', 'spellcheck', t('Corregir ortografía y gramática')],
    ['shorter', 'compress', t('Hacerlo más breve')], ['longer', 'expand', t('Desarrollarlo un poco más')],
    ['friendly', 'sentiment_satisfied', t('Tono más cercano')], ['formal', 'work', t('Tono más formal')],
    ['headline', 'title', t('Proponer un título mejor')],
  ];
  function aiPop(anchor) {
    const a = E().active;
    if (!a || !isText(a.b) && !['details', 'buttons'].includes(a.b.type)) { window.toast?.(t('Haz clic en un bloque de texto primero.'), true); return; }
    if (!window.CFG_AI_READY?.()) { window.toast?.(t('Configura una IA en «Conexiones» para usar estos botones.'), true); return; }
    openPop(anchor, `<div class="pop-title">${t('IA para este bloque')}</div>` + AI_ACTIONS().map(([k, i, n]) => `<button class="pop-item" data-k="${k}"><span class="ms">${i}</span>${n}</button>`).join(''),
      (p) => $$('[data-k]', p).forEach((x) => (x.onclick = async () => {
        closePop();
        const b = a.b;
        const html = b.type === 'list' ? (b.items || []).join('<br>') : b.html || '';
        if (!html.replace(/<[^>]+>/g, '').trim()) { window.toast?.(t('El bloque está vacío.'), true); return; }
        a.el.closest('.blk')?.classList.add('ai-busy');
        try {
          const out = await window.api.aiRewrite({ html, action: x.dataset.k, title: $('#d-title').value, kind: b.type });
          E().change(() => {
            if (x.dataset.k === 'headline') { b.html = out.replace(/<br\s*\/?>/gi, ' '); if (b.type === 'paragraph') { b.type = 'heading'; b.level = 2; } }
            else if (b.type === 'list') b.items = out.split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
            else b.html = out;
          });
          window.toast?.(t('Listo. Puedes deshacerlo con Ctrl+Z.'));
        } catch (e) { window.toastError?.(e); } finally { $$('.ai-busy').forEach((x) => x.classList.remove('ai-busy')); }
      })));
  }

  // --- Barra
  bar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  setTimeout(() => place(), 0);
  $$('[data-cmd]', bar).forEach((b) => (b.onclick = () => { restore(); document.execCommand(b.dataset.cmd); fire(); state(); }));
  $$('[data-al]', bar).forEach((b) => (b.onclick = () => setBlock('align', b.dataset.al === 'left' ? null : b.dataset.al)));
  $('[data-x="color"]', bar).onclick = (e) => colorPop(e.currentTarget, 'color');
  $('[data-x="bg"]', bar).onclick = (e) => colorPop(e.currentTarget, 'bg');
  $('[data-x="link"]', bar).onclick = link;
  $('[data-x="code"]', bar).onclick = () => { if (!wrap('code')) window.toast?.(t('Selecciona el texto primero.'), true); };
  $('[data-x="drop"]', bar).onclick = () => { const a = E().active; if (a?.b.type === 'paragraph') setBlock('dropCap', !a.b.dropCap); };
  $('[data-x="clear"]', bar).onclick = () => {
    const a = E().active; if (!a) return;
    if (hasSel()) { restore(); document.execCommand('removeFormat'); unwrapMarks(); document.execCommand('unlink'); fire(); }
    else if (isText(a.b)) { E().change(() => ['align', 'size', 'font', 'color', 'bg', 'dropCap', 'shadow', 'spacing', 'th'].forEach((k) => delete a.b[k])); }
  };
  $('[data-x="ai"]', bar).onclick = (e) => aiPop(e.currentTarget);
  $('#fmt-font').onchange = (e) => { const f = window.ThemeUI?.pickFont(e.target.value) || { value: e.target.value, slug: '' }; setBlock('font', f.value, f.slug, f.css); };
  $('#fmt-ls').onchange = (e) => setBlock('spacing', e.target.value);
  $('[data-x="shadow"]', bar).onclick = () => { const a = E().active; if (a && isText(a.b)) setBlock('shadow', !a.b.shadow); };
  $('#fmt-size').onchange = (e) => { const z = window.ThemeUI?.pickSize(e.target.value) || { value: e.target.value, slug: '' }; setBlock('size', z.value, z.slug); };
  $('#fmt-type').onchange = (e) => {
    const a = E().active, v = e.target.value;
    if (!a || !isText(a.b) || a.b.type === 'mediatext') return;
    if (v === 'paragraph') E().convert(a.b, 'paragraph');
    else if (/^h\d$/.test(v)) { if (a.b.type === 'heading') E().change(() => (a.b.level = Number(v[1]))); else E().convert(a.b, 'heading', { level: Number(v[1]) }); E().focus(a.b.id); }
    else if (v === 'quote') E().convert(a.b, 'quote');
    else if (v === 'ul' || v === 'ol') { if (a.b.type === 'list') E().change(() => (a.b.ordered = v === 'ol')); else E().convert(a.b, 'list', { ordered: v === 'ol' }); }
  };

  // --- Barra flotante (como la mini barra de Word): aparece sobre el texto seleccionado, medio transparente hasta que
  // se acerca el ratón; se va al quitar la selección o al alejarse. Con «Barra de formato fija» (Ajustes) queda arriba.
  const fixed = () => typeof prefs === 'function' && !!prefs().fmtFixed;
  let near = false, ctxHold = 0;
  const popOpen = () => !pop.classList.contains('hidden');
  const selRect = () => {
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed) return null;
    const n = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
    if (!n?.closest('#ed-canvas .rt')) return null;
    const r = s.getRangeAt(0).getBoundingClientRect();
    return r.width || r.height ? r : null;
  };
  function place() {
    if (fixed()) { bar.classList.remove('float', 'hide', 'faint'); bar.style.left = bar.style.top = ''; return; }
    bar.classList.add('float');
    const r = selRect();
    const busyBar = bar.contains(document.activeElement) || popOpen() || Date.now() < ctxHold;
    if (!r) { if (!busyBar) bar.classList.add('hide'); return; }
    bar.classList.remove('hide');
    const w = bar.offsetWidth, h = bar.offsetHeight;
    const top0 = $('#editor .ed-top, #editor header')?.getBoundingClientRect().bottom || 64;
    let top = r.top - h - 10;
    if (top < top0 + 6) top = r.bottom + 10; // sin sitio arriba: debajo de la selección
    bar.style.left = Math.round(Math.min(innerWidth - w - 12, Math.max(12, r.left + r.width / 2 - w / 2))) + 'px';
    bar.style.top = Math.round(Math.min(innerHeight - h - 8, top)) + 'px';
    bar.classList.toggle('faint', !near && !busyBar);
  }
  document.addEventListener('selectionchange', () => requestAnimationFrame(place));
  document.addEventListener('scroll', () => { if (!bar.classList.contains('hide')) place(); }, true);
  addEventListener('resize', () => place());
  // nítida al acercar el ratón (a menos de ~70 px), tenue al alejarlo y oculta si se aleja mucho
  document.addEventListener('mousemove', (e) => {
    if (fixed() || bar.classList.contains('hide')) return;
    const b = bar.getBoundingClientRect();
    const dx = Math.max(b.left - e.clientX, 0, e.clientX - b.right), dy = Math.max(b.top - e.clientY, 0, e.clientY - b.bottom);
    const d = Math.hypot(dx, dy);
    near = d < 70;
    bar.classList.toggle('faint', !near && !bar.contains(document.activeElement) && !popOpen());
    if (d > 260 && !bar.contains(document.activeElement) && !popOpen() && selRect() && !e.buttons) bar.classList.add('away');
    else bar.classList.remove('away');
  });
  // clic derecho sobre texto seleccionado: la barra aparece (el menú normal de copiar/pegar sigue saliendo)
  document.addEventListener('contextmenu', (e) => {
    if (fixed() || !e.target.closest?.('#ed-canvas .rt') || !selRect()) return;
    ctxHold = Date.now() + 400; near = true; bar.classList.remove('away'); place();
  });
  window.FormatBarPlace = place;
  // Clic derecho en el texto: se marca para que el menú normal (copiar, pegar, ortografía) añada las opciones de formato
  document.addEventListener('contextmenu', (e) => {
    const rt = e.target.closest?.('#ed-canvas .rt');
    if (!rt) return;
    const a = E()?.active;
    window.api.ctxMark?.(a && E().TEXT_TYPES.includes(a.b.type) ? 'text' : 'other');
  }, true);
  // Órdenes del menú: las mismas que los botones de la barra
  window.api.onCtxCmd?.((c) => {
    const a = E()?.active;
    if (!a) return;
    near = true; place(); bar.classList.remove('hide', 'away', 'faint');
    const click = (sel) => $(sel, bar)?.click();
    if (c === 'link') return link();
    if (c === 'clear') return click('[data-x="clear"]');
    if (c === 'color' || c === 'bg') return click(`[data-x="${c}"]`);
    if (c === 'ai') return click('[data-x="ai"]');
    if (c.startsWith('align:')) return click(`[data-al="${c.slice(6)}"]`);
    if (c.startsWith('type:')) { const s = $('#fmt-type'); s.value = c.slice(5); s.dispatchEvent(new Event('change')); }
  });

  // Estado de la barra según el bloque y la selección
  function state() {
    const a = E()?.active;
    const ok = !!a && document.contains(a.el);
    bar.classList.toggle('off', !ok);
    const text = ok && isText(a.b);
    $$('select, [data-al], [data-x="drop"], [data-x="shadow"]', bar).forEach((x) => (x.disabled = !text));
    $$('[data-cmd], [data-x="link"], [data-x="color"], [data-x="bg"], [data-x="code"], [data-x="clear"], [data-x="ai"]', bar).forEach((x) => (x.disabled = !ok));
    if (!ok) return;
    const b = a.b;
    if (text) {
      $('#fmt-type').value = b.type === 'heading' ? 'h' + (b.level || 2) : b.type === 'list' ? (b.ordered ? 'ol' : 'ul') : b.type === 'mediatext' ? 'paragraph' : b.type;
      $('#fmt-type').disabled = b.type === 'mediatext';
      $('#fmt-font').value = b.font || '';
      $('#fmt-size').value = window.ThemeUI?.sizeValue(b) ?? (b.size || '');
      $('#fmt-ls').value = b.spacing || '';
      $('[data-x="shadow"]', bar).classList.toggle('on', !!b.shadow);
      $$('[data-al]', bar).forEach((x) => { x.classList.toggle('on', (b.align || 'left') === x.dataset.al); x.disabled = !['paragraph', 'heading', 'mediatext'].includes(b.type); });
      $('[data-x="drop"]', bar).disabled = b.type !== 'paragraph';
      $('[data-x="drop"]', bar).classList.toggle('on', !!b.dropCap);
    }
    $('[data-x="color"] .cbar', bar).style.background = b.color || 'currentColor';
    $('[data-x="bg"] .cbar', bar).style.background = b.bg || 'transparent';
    for (const x of $$('[data-cmd]', bar)) { let on = false; try { on = document.queryCommandState(x.dataset.cmd); } catch { /* nada */ } x.classList.toggle('on', on); }
  }

  // --- Panel «Revisión»: cifras, estructura y comprobaciones antes de publicar
  let timer = null;
  function review() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const ed = E(), box = $('#d-review');
      if (!ed?.draft || !box) return;
      const { words, minutes } = ed.stats();
      const blocks = ed.flat();
      const heads = blocks.filter((b) => b.type === 'heading' && (b.html || '').replace(/<[^>]+>/g, '').trim());
      const imgs = blocks.flatMap((b) => (b.img ? [b.img] : b.images || [])).filter((i) => i.type !== 'video');
      const noAlt = imgs.filter((i) => !(i.alt || '').trim()).length;
      const title = $('#d-title').value.trim();
      const checks = [
        [title.length >= 10 && title.length <= 70, title.length > 70 ? t('El título es largo ({n} caracteres); mejor menos de 70.', { n: title.length }) : t('Título de buena longitud'), title.length < 10 ? t('Escribe un título más descriptivo') : null],
        [!!ed.draft.featuredImageId, t('Imagen destacada elegida'), t('Elige una imagen destacada (arrástrala encima del título)')],
        [!!$('#d-excerpt').value.trim(), t('Tiene extracto'), t('Añade un extracto: es lo que se ve en buscadores y redes')],
        [!imgs.length || !noAlt, t('Todas las fotos tienen descripción'), t('{n} foto(s) sin descripción (alt)', { n: noAlt })],
        [words < 350 || heads.length > 0, t('Texto bien estructurado'), t('Texto largo sin títulos: divídelo con alguno (H2)')],
      ];
      const ext = window.VidQ ? window.VidQ.collectExpiring(ed.draft.blocks) : [];
      box.innerHTML = `
        <div class="rv-stats"><div><b>${words}</b><span>${t('palabras')}</span></div><div><b>${minutes}</b><span>${t('min de lectura')}</span></div><div><b>${imgs.length}</b><span>${t('fotos')}</span></div></div>
        ${checks.map(([ok, good, bad]) => `<div class="rv-check ${ok ? 'ok' : 'warn'}"><span class="ms fill">${ok ? 'check_circle' : 'error'}</span>${esc(ok ? good : bad || good)}</div>`).join('')}
        ${ext.length ? `<div class="rv-check warn rv-ext"><span class="ms fill">schedule</span><span>${esc(t('{n} medio(s) de Instagram o Facebook caducan: súbelos a tu web', { n: ext.length }))}<br><button class="btn tonal small" data-ext="1"><span class="ms">cloud_upload</span><span>${esc(t('Subirlos a mi web'))}</span></button></span></div>` : ''}
        ${heads.length ? `<div class="rv-outline">${heads.map((h) => `<a href="#" data-id="${h.id}" class="lvl${h.level || 2}">${esc(h.html.replace(/<[^>]+>/g, ''))}</a>`).join('')}</div>` : ''}`;
      $('[data-ext]', box)?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const r = await window.api.externalizeMedia(ed.draft.blocks);
        const n = Object.keys(r.map || {}).length;
        if (n) ed.change(() => window.VidQ.replaceUrls(ed.draft.blocks, r.map));
        if (r.failed) toast(t('No se ha podido subir {n} medio(s)', { n: r.failed }), true);
        else toast(t('Subidos {n} medio(s) a tu web', { n }));
      }));
      $$('.rv-outline a', box).forEach((x) => (x.onclick = (e) => { e.preventDefault(); const el = $(`.blk[data-id="${x.dataset.id}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); ed.focus(x.dataset.id, true); }));
      $('#ed-count').textContent = t('{n} palabras · {m} min', { n: words, m: minutes });
    }, 250);
  }
  ['#d-title', '#d-excerpt'].forEach((s) => $(s)?.addEventListener('input', review));

  window.FormatBar = { update: state, link, review };
})();
