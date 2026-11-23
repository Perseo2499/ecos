// Editor de bloques · el resto de tipos: tabla, botón, espacio, mapa, separador y bloque de WordPress que Ecos conserva tal cual.
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { $$, t, esc, SK } = K;

  E.types.table = function (b, i, body, extra) {
    const tb = document.createElement('table');
    tb.className = 'ed-table' + (b.stripes ? ' stripes' : '');
    b.rows.forEach((row, r) => {
      const tr = document.createElement('tr');
      row.forEach((c, k) => {
        const cell = this.editable(b.head && r === 0 ? 'th' : 'td', c, '', (h) => (b.rows[r][k] = h), {
          block: b,
          onKey(e) { if (e.key === 'Enter' && !e.shiftKey) e.preventDefault(); if (e.key === 'Tab') { e.preventDefault(); const cells = $$(`.blk[data-id="${b.id}"] [contenteditable]`); cells[cells.indexOf(e.target) + (e.shiftKey ? -1 : 1)]?.focus(); } },
        });
        tr.appendChild(cell);
      });
      tb.appendChild(tr);
    });
    body.appendChild(tb);
    body.appendChild(this.editable('figcaption', b.caption, t('Pie de tabla (opcional)'), (h) => (b.caption = h), { block: b }));
    const cols = b.rows[0]?.length || 0;
    extra.innerHTML = `<button class="lv" data-t="r+" title="${t('Añadir fila')}"><span class="ms">add_row_below</span></button>
      <button class="lv" data-t="r-" title="${t('Quitar la última fila')}" ${b.rows.length < 2 ? 'disabled' : ''}><span class="ms">remove</span><span class="ms">table_rows</span></button>
      <button class="lv" data-t="c+" title="${t('Añadir columna')}" ${cols >= 8 ? 'disabled' : ''}><span class="ms">add_column_right</span></button>
      <button class="lv" data-t="c-" title="${t('Quitar la última columna')}" ${cols < 2 ? 'disabled' : ''}><span class="ms">remove</span><span class="ms">view_column</span></button>
      <button class="lv ${b.head ? 'on' : ''}" data-t="h" title="${t('Primera fila como encabezado')}"><span class="ms">table_chart</span></button>
      <button class="lv ${b.stripes ? 'on' : ''}" data-t="s" title="${t('Filas a rayas')}"><span class="ms">reorder</span></button>`;
    const ops = { 'r+': () => b.rows.push(Array(cols).fill('')), 'r-': () => b.rows.pop(), 'c+': () => b.rows.forEach((r) => r.push('')), 'c-': () => b.rows.forEach((r) => r.pop()), h: () => (b.head = !b.head), s: () => (b.stripes = !b.stripes) };
    $$('[data-t]', extra).forEach((x) => (x.onclick = () => this.change(ops[x.dataset.t], b.id)));
  };

  E.types.buttons = function (b, i, body, extra) {
    const wrap = document.createElement('div');
    wrap.className = 'ed-btns' + (b.full ? ' full' : ''); wrap.style.justifyContent = b.align === 'center' ? 'center' : b.align === 'right' ? 'flex-end' : 'flex-start';
    const btn = this.editable('span', b.html, b.ph ? t(b.ph) : t('Texto del botón'), (h) => (b.html = h), { cls: 'ed-btn' + (b.variant === 'outline' ? ' outline' : ''), block: b, onKey(e) { if (e.key === 'Enter') e.preventDefault(); } });
    const st = btn.style;
    if (b.bg && b.variant !== 'outline') st.setProperty('--eb-bg', b.bg);
    if (b.color) st.setProperty('--eb-fg', b.color);
    if (b.radius) st.setProperty('--eb-r', { square: '0', round: '8px', pill: '9999px' }[b.radius]);
    if (b.size === 's') { st.setProperty('--eb-py', '8px'); st.setProperty('--eb-px', '18px'); st.setProperty('--eb-fs', '14px'); }
    if (b.size === 'l') { st.setProperty('--eb-py', '18px'); st.setProperty('--eb-px', '40px'); st.setProperty('--eb-fs', '20px'); }
    wrap.appendChild(btn);
    body.appendChild(wrap);
    const url = document.createElement('input');
    url.className = 'ed-btn-url'; url.placeholder = t('Enlace del botón (https://…)'); url.value = b.url || '';
    url.oninput = () => { b.url = url.value.trim(); this.onChange(); };
    body.appendChild(url);
    extra.innerHTML = ['left', 'center', 'right'].map((a) => `<button class="lv ${b.align === a ? 'on' : ''}" data-al="${a}" title="${t('Alineación')}"><span class="ms">format_align_${a}</span></button>`).join('')
      + `<span class="lv-sep"></span><button class="lv ${b.variant !== 'outline' ? 'on' : ''}" data-v="fill" title="${t('Relleno')}"><span class="ms fill">smart_button</span></button><button class="lv ${b.variant === 'outline' ? 'on' : ''}" data-v="outline" title="${t('Contorno')}"><span class="ms">smart_button</span></button>`;
    $$('[data-al]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.align = x.dataset.al), b.id)));
    $$('[data-v]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.variant = x.dataset.v), b.id)));
    this.styleBtn(extra, b);
  };

  E.types.spacer = function (b, i, body, extra) {
    body.innerHTML = `<div class="ed-spacer" style="height:${Number(b.height) || 40}px"><span>${Number(b.height) || 40} px</span></div>`;
    extra.innerHTML = [20, 40, 80, 120].map((h) => `<button class="lv ${Number(b.height) === h ? 'on' : ''}" data-h="${h}">${h}</button>`).join('');
    $$('[data-h]', extra).forEach((x) => (x.onclick = () => this.change(() => (b.height = Number(x.dataset.h)), b.id)));
  };

  E.types.map = function (b, i, body, extra) {
    const box = document.createElement('div');
    box.className = 'ed-map';
    const inp = document.createElement('input');
    inp.className = 'ed-map-addr'; inp.placeholder = t('Dirección (calle, número, ciudad)'); inp.value = b.address || '';
    const frame = document.createElement('div');
    frame.className = 'ed-map-frame'; frame.style.height = (Number(b.height) || 360) + 'px'; frame.style.borderRadius = (Number(b.radius) || 0) + 'px';
    const show = () => {
      const a = (b.address || '').trim();
      frame.innerHTML = a ? `<iframe src="${esc(SK().mapUrl(a))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${esc(a)}"></iframe>` : `<span class="ms">map</span><span>${t('Escribe una dirección y aquí verás el mapa')}</span>`;
    };
    let snap = false;
    inp.oninput = () => { if (!snap) { this.snapshot(); snap = true; } b.address = inp.value; this.onChange(); };
    inp.onblur = () => { snap = false; };
    inp.onchange = () => show();
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); show(); } };
    box.append(inp, frame);
    body.appendChild(box);
    show();
    this.styleBtn(extra, b, false);
  };

  E.types.separator = function (b, i, body) { body.innerHTML = '<hr>'; };

  E.types.raw = function (b, i, body) {
    const text = (b.markup || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    body.innerHTML = `<div class="raw-box"><span class="ms">code_blocks</span><div><b>${t('Bloque de WordPress «{n}»', { n: esc(b.label || 'html') })}</b><div class="hint">${t('Se hizo en WordPress; Ecos lo conserva tal cual al enviar.')}</div>${text ? `<div class="raw-text">${esc(text.slice(0, 220))}${text.length > 220 ? '…' : ''}</div>` : ''}</div></div>`;
  };
})();
