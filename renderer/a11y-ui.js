// Ecos · Revisión de accesibilidad (interfaz): el apartado del panel «Revisión» del editor, «Ir al bloque», los arreglos
// automáticos y el aviso antes de publicar. La lógica pura está en a11y.js.
(function () {
  const t = (s, v) => (window.I18N ? window.I18N.t(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => v?.[k] ?? m));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const E = () => window.BlockEditor;
  const IC = { error: 'error', aviso: 'warning', sugerencia: 'lightbulb' };
  const LV = { error: 'Error', aviso: 'Aviso', sugerencia: 'Sugerencia' };
  let open = null; // ¿desplegado? (null = según haya errores)

  // Análisis del borrador actual (con los colores del tema que el editor ya conoce)
  function analyze() {
    const ed = E();
    if (!ed?.draft) return null;
    const theme = {};
    for (const c of window.ThemeUI?.colors?.() || []) theme[c.slug] = c.color;
    return window.A11y.analyze(ed.draft.blocks || [], { theme });
  }
  const summary = (r) => {
    const c = r.counts, parts = [];
    if (c.error) parts.push(c.error === 1 ? t('1 error') : t('{n} errores', { n: c.error }));
    if (c.aviso) parts.push(c.aviso === 1 ? t('1 aviso') : t('{n} avisos', { n: c.aviso }));
    if (c.sugerencia) parts.push(c.sugerencia === 1 ? t('1 sugerencia') : t('{n} sugerencias', { n: c.sugerencia }));
    return t('Accesibilidad: {s}/100', { s: r.score }) + (parts.length ? ' · ' + parts.join(' · ') : '');
  };

  // Ir al bloque: se desplaza hasta él, lo marca un momento y, si es de texto, pone el cursor
  function goto(id, { alt = -1 } = {}) {
    const el = document.querySelector(`#d-blocks .blk[data-id="${CSS.escape(String(id))}"]`);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('a11y-flash'); setTimeout(() => el.classList.remove('a11y-flash'), 1800);
    if (alt >= 0 || alt === -2) {
      const inputs = [...el.querySelectorAll('.alt')];
      const inp = inputs[Math.max(0, alt)] || inputs[0];
      if (inp) { inp.focus(); return true; }
    }
    E()?.focus?.(id, true);
    return true;
  }

  async function fix(issue, btn) {
    const ed = E(), loc = ed?.locate(issue.blockId), f = issue.fix;
    if (!loc || !f) return;
    const A = window.A11y;
    if (f.kind === 'alt') {
      if (typeof window.api?.aiAlt === 'function') {
        const im = f.idx >= 0 ? (loc.b.images || [])[f.idx] : loc.b.img;
        let text = '', err = null;
        const label = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="spin" aria-hidden="true"></span><span>${esc(t('Describiendo…'))}</span>`;
        try { text = String(await window.api.aiAlt(im?.url, document.getElementById('d-title')?.value?.trim() || '') || '').trim(); } catch (e) { err = e; }
        btn.disabled = false; btn.innerHTML = label;
        if (text) { ed.changeBlock(issue.blockId, () => A.applyFix(ed.locate(issue.blockId).b, { ...f, text })); window.toast?.(t('Foto descrita con IA. Revisa el texto debajo de la foto.')); window.FormatBar?.review(); return; }
        // la IA ha fallado: se dice por qué (sin IA configurada, sin conexión…) y se abre el campo para escribirla a mano
        goto(issue.blockId, { alt: f.idx });
        if (err && typeof window.toastError === 'function') window.toastError(err);
        else window.toast?.(t('La IA no ha devuelto ninguna descripción. Escríbela debajo de la foto.'), true);
        return;
      }
      goto(issue.blockId, { alt: f.idx });
      window.toast?.(t('Escribe aquí qué se ve en la foto.'));
      return;
    }
    const run = () => A.applyFix(ed.locate(issue.blockId).b, f);
    if (f.kind === 'list') ed.change(run); else ed.changeBlock(issue.blockId, run);
    window.FormatBar?.review();
  }

  const altCount = (r) => r.issues.filter((i) => i.fix?.kind === 'alt').length;

  function html(r) {
    const o = open === null ? r.counts.error > 0 : open;
    const cls = r.score >= 90 ? 'good' : r.score >= 70 ? 'mid' : 'bad';
    const items = r.issues.map((i, k) => `<li class="a11y-i ${i.level}${i.info ? ' info' : ''}" data-k="${k}">
        <span class="ms fill a11y-ic" aria-hidden="true">${i.info ? 'info' : IC[i.level]}</span>
        <div class="a11y-t"><b><span class="a11y-lv">${esc(t(i.info ? 'Información' : LV[i.level]))}</span> ${esc(t(i.title, i.vars))}</b><span>${esc(t(i.why, i.vars))}</span>
          <div class="a11y-b">${i.blockId ? `<button class="btn text small" data-go="${k}"><span class="ms">my_location</span><span>${esc(t('Ir al bloque'))}</span></button>` : ''}${i.fix ? `<button class="btn tonal small" data-fix="${k}"><span class="ms">auto_fix_high</span><span>${esc(i.fix.kind === 'alt' && typeof window.api?.aiAlt === 'function' ? t('Describir con IA') : t(i.fix.label || 'Arreglar'))}</span></button>` : ''}</div></div></li>`).join('');
    return `<details class="a11y" ${o ? 'open' : ''}><summary class="a11y-sum ${cls}"><span class="a11y-score" aria-hidden="true">${r.score}</span><span class="a11y-st"><b>${esc(t('Accesibilidad'))}</b><span>${esc(r.issues.length ? summary(r).replace(/^[^·]*· ?/, '') : t('Sin problemas a la vista'))}</span></span><span class="ms a11y-chev" aria-hidden="true">expand_more</span></summary>
      ${altCount(r) > 1 && document.getElementById('ai-alts') ? `<div class="a11y-all"><button class="btn tonal small" data-allalt><span class="ms">auto_awesome</span><span>${esc(t('Describir con IA las {n} fotos sin descripción', { n: altCount(r) }))}</span></button></div>` : ''}
      <ul class="a11y-list">${items || `<li class="a11y-ok"><span class="ms fill">check_circle</span>${esc(t('Todo en orden: contraste, títulos, fotos y enlaces.'))}</li>`}</ul>
      <p class="hint a11y-note">${esc(t('Es una revisión automática: ayuda, pero no sustituye a probar la página con un lector de pantalla.'))}</p></details>`;
  }

  // Pinta el apartado dentro del panel «Revisión» (lo llama FormatBar.review)
  function render(box) {
    const r = analyze();
    if (!r || !box) return null;
    window.A11yUI.last = r;
    let host = box.querySelector('.a11y-host');
    if (!host) { host = document.createElement('div'); host.className = 'a11y-host'; box.appendChild(host); }
    host.innerHTML = html(r);
    const det = host.querySelector('details');
    det.addEventListener('toggle', () => { open = det.open; });
    host.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { const i = r.issues[+b.dataset.go]; goto(i.blockId, i.fix?.kind === 'alt' ? { alt: i.fix.idx } : {}); }));
    const all = host.querySelector('[data-allalt]');
    if (all) all.onclick = () => document.getElementById('ai-alts')?.click();
    host.querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => fix(r.issues[+b.dataset.fix], b)));
    return r;
  }

  // Antes de publicar → { ok, asked, line }. Con errores y la preferencia activada (por defecto) pregunta; si no, deja pasar y
  // devuelve `line` (la puntuación) para añadirla a la confirmación normal.
  async function beforePublish() {
    const r = analyze();
    if (!r) return { ok: true, asked: false, line: '' };
    const line = r.issues.some((i) => !i.info) ? ' ' + summary(r) : ' ' + t('Accesibilidad: {s}/100', { s: r.score });
    const warn = (typeof prefs === 'function' ? prefs() : {}).a11yWarn !== false;
    if (!warn || !r.counts.error) return { ok: true, asked: false, line };
    const go = await window.ask(t('{s}. Hay errores que dificultan la lectura a algunas personas (por ejemplo, fotos sin descripción o texto con poco contraste).', { s: summary(r) }), { ok: t('Publicar igualmente'), cancel: t('Revisar') });
    if (go) return { ok: true, asked: true, line };
    open = true;
    document.querySelector('#d-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.FormatBar?.review();
    return { ok: false, asked: true, line };
  }

  window.A11yUI = { render, analyze, summary, beforePublish, goto, fix, last: null };
})();
