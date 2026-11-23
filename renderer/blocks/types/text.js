// Editor de bloques · bloques de texto: párrafo, título, cita, lista (con o sin iconos), desplegable e índice.
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { $, $$, t, applyStyle, SK } = K;

  Object.assign(E, {
    // Paleta pequeña de símbolos para la lista con iconos
    iconPop(anchor, pick) {
      let pop = $('#ico-pop');
      if (!pop) { pop = document.createElement('div'); pop.id = 'ico-pop'; pop.className = 'ico-pop'; document.body.appendChild(pop); }
      pop.innerHTML = SK().ICONS.map((c) => `<button type="button" data-i="${c}">${c}</button>`).join('');
      pop.classList.remove('hidden');
      const r = anchor.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
      pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 4) + 'px';
      const off = (e) => { if (!pop.contains(e.target)) { pop.classList.add('hidden'); document.removeEventListener('mousedown', off, true); } };
      $$('button', pop).forEach((x) => (x.onclick = () => { pop.classList.add('hidden'); document.removeEventListener('mousedown', off, true); pick(x.dataset.i); }));
      setTimeout(() => document.addEventListener('mousedown', off, true), 0);
    },
  });

  E.types.paragraph = function (b, i, body, extra, arr, textBlock) {
    const p = textBlock('p'); applyStyle(p, b); body.appendChild(p); this.acceptSplitDrop(body.parentElement, p, b);
  };

  E.types.heading = function (b, i, body, extra, arr, textBlock) {
    const h = textBlock('h' + b.level, 'h'); applyStyle(h, b);
    body.appendChild(h);
    extra.innerHTML = [2, 3, 4, 5].map((l) => `<button class="lv ${b.level === l ? 'on' : ''}" data-l="${l}">H${l}</button>`).join('');
    $$('.lv', extra).forEach((x) => (x.onclick = () => { this.change(() => (b.level = Number(x.dataset.l)), b.id); this.refreshToc(); }));
  };

  E.types.quote = function (b, i, body, extra) {
    const q = document.createElement('blockquote');
    if (b.pull) q.className = 'pull';
    const qp = this.editable('p', b.html, (b.ph ? t(b.ph) : '') || t('Escribe aquí…'), (h) => (b.html = h), { cls: '', block: b, styleEl: q });
    q.appendChild(qp);
    q.appendChild(this.editable('cite', b.cite, t('Autor o fuente (opcional)'), (h) => (b.cite = h), { block: b, styleEl: q }));
    applyStyle(q, b);
    body.appendChild(q);
    extra.innerHTML = `<button class="lv ${!b.pull ? 'on' : ''}" data-p="0" title="${t('Cita normal')}"><span class="ms">format_quote</span></button><button class="lv ${b.pull ? 'on' : ''}" data-p="1" title="${t('Cita destacada (grande y centrada)')}"><span class="ms">format_quote</span>+</button>`;
    $$('[data-p]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.pull = x.dataset.p === '1'), b.id)));
  };

  E.types.list = function (b, i, body, extra) {
    const self = this;
    const iconic = Array.isArray(b.icons);
    const list = document.createElement(iconic ? 'div' : b.ordered ? 'ol' : 'ul');
    if (iconic) list.className = 'ed-ilist';
    b.items.forEach((it, k) => {
      const li = this.editable(iconic ? 'div' : 'li', it, (b.ph ? t(b.ph) : '') || t('Elemento'), (h) => (b.items[k] = h), {
        block: b, styleEl: list,
        onKey(e, el) {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); self.change(() => { b.items.splice(k + 1, 0, ''); if (iconic) b.icons.splice(k + 1, 0, b.icons[k] || SK().ICONS[0]); }, b.id); requestAnimationFrame(() => $$(`.blk[data-id="${b.id}"] .rt`)[k + 1]?.focus()); }
          if (e.key === 'Backspace' && !el.textContent.trim() && b.items.length > 1) { e.preventDefault(); self.change(() => { b.items.splice(k, 1); if (iconic) b.icons.splice(k, 1); }, b.id); }
        },
      });
      if (!iconic) { list.appendChild(li); return; }
      // con iconos: cada elemento lleva su símbolo, que se cambia pulsándolo
      const row = document.createElement('div');
      row.className = 'ed-irow';
      const ib = document.createElement('button');
      ib.type = 'button'; ib.className = 'ed-ico'; ib.textContent = b.icons[k] || '•'; ib.title = t('Elegir el icono');
      ib.onclick = () => this.iconPop(ib, (sym) => this.change(() => { b.icons[k] = sym; }, b.id));
      row.append(ib, li);
      list.appendChild(row);
    });
    applyStyle(list, b);
    body.appendChild(list);
    extra.innerHTML = iconic
      ? `<button class="lv on" data-ic="0" title="${t('Quitar los iconos')}"><span class="ms">checklist</span></button>`
      : `<button class="lv ${!b.ordered ? 'on' : ''}" data-o="0"><span class="ms">format_list_bulleted</span></button><button class="lv ${b.ordered ? 'on' : ''}" data-o="1"><span class="ms">format_list_numbered</span></button><span class="lv-sep"></span><button class="lv" data-ic="1" title="${t('Poner un icono en cada elemento')}"><span class="ms">checklist</span></button>`;
    $$('[data-o]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.ordered = x.dataset.o === '1'), b.id)));
    $$('[data-ic]', extra).forEach((x) => (x.onclick = () => this.change(() => { if (x.dataset.ic === '1') { b.icons = b.items.map(() => SK().ICONS[0]); b.ordered = false; } else delete b.icons; }, b.id)));
  };

  E.types.details = function (b, i, body) {
    const d = document.createElement('div');
    d.className = 'ed-details';
    const sum = this.editable('div', b.summary, (b.ph ? t(b.ph) : '') || t('Pregunta o título que se ve siempre'), (h) => (b.summary = h), { cls: 'ed-sum', block: b, onKey(e) { if (e.key === 'Enter') e.preventDefault(); } });
    d.append(sum, this.editable('div', b.html, t('Contenido que se muestra al pulsar…'), (h) => (b.html = h), { cls: 'ed-det', block: b }));
    body.appendChild(d);
  };

  E.types.toc = function (b, i, body) {
    const box = document.createElement('div');
    box.className = 'ed-toc';
    box.appendChild(this.editable('div', b.title, t('Título del índice (opcional)'), (h) => (b.title = h), { cls: 'ed-toc-title', onKey(e) { if (e.key === 'Enter') e.preventDefault(); } }));
    const ul = document.createElement('ul'); ul.className = 'toc-list';
    box.appendChild(ul);
    body.appendChild(box);
    requestAnimationFrame(() => this.refreshToc());
  };
})();
