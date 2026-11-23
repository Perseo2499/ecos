// Ecos · Editor de entradas (buscar y reemplazar). Sigue a app/editor.js y comparte su ámbito global (se cargan en orden desde index.html).
// ---------------------------------------------------------------- Buscar y reemplazar en la entrada
// Ctrl+F / Ctrl+H abren una barra sobre el lienzo; busca en el texto visible de los bloques, el título y el extracto.
const FR = { hits: [], i: -1 };
const frOpts = () => ({ caseSensitive: $('#fr-case').checked, wholeWord: $('#fr-word').checked });
const frOpen = () => !$('#fr-bar').classList.contains('hidden');
const frClearMarks = () => {
  try { if (CSS.highlights) { CSS.highlights.clear(); } } catch { /* sin API */ }
  $$('.fr-flash').forEach((x) => x.classList.remove('fr-flash'));
  $$('#d-title, #d-excerpt').forEach((x) => x.classList.remove('fr-cur'));
};
// Todas las coincidencias: título, extracto y bloques (en ese orden)
function frCompute() {
  const q = $('#fr-q').value, o = frOpts();
  const hits = [];
  for (const [id, field] of [['d-title', 'title'], ['d-excerpt', 'excerpt']]) {
    for (const m of window.FindReplace.findInText($('#' + id).value, q, o)) hits.push({ ...m, blockId: field, field });
  }
  hits.push(...window.FindReplace.findInBlocks(draft.blocks, q, o));
  FR.hits = hits;
  if (FR.i >= hits.length) FR.i = hits.length - 1;
  if (FR.i < 0 && hits.length) FR.i = 0;
}
// Rangos de texto del DOM de un elemento editable para la consulta
function frRanges(root, q, o) {
  const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    for (const m of window.FindReplace.findInText(n.nodeValue, q, o)) { const r = new Range(); r.setStart(n, m.start); r.setEnd(n, m.end); out.push(r); }
  }
  return out;
}
function frPaint(scroll) {
  frClearMarks();
  const n = FR.hits.length, cur = FR.hits[FR.i];
  $('#fr-count').textContent = !$('#fr-q').value ? '' : n ? t('{a} de {b}', { a: FR.i + 1, b: n }) : t('Sin resultados');
  $('#fr-bar').classList.toggle('none', !!$('#fr-q').value && !n);
  if (!n) return;
  const q = $('#fr-q').value, o = frOpts();
  const all = [], curR = [];
  $$('#d-blocks .blk [contenteditable]').forEach((el) => all.push(...frRanges(el, q, o)));
  let target = null;
  if (cur.field === 'title' || cur.field === 'excerpt') {
    target = $(cur.field === 'title' ? '#d-title' : '#d-excerpt'); target.classList.add('fr-cur');
  } else {
    target = $(`.blk[data-id="${cur.blockId}"]`);
    if (target) {
      target.classList.add('fr-flash');
      if (cur.field !== 'alt') {
        const ord = FR.hits.filter((h) => h.blockId === cur.blockId && h.field !== 'alt').indexOf(cur);
        const rs = $$('[contenteditable]', target).flatMap((el) => frRanges(el, q, o));
        if (rs[ord]) curR.push(rs[ord]);
      }
    }
  }
  try {
    if (window.Highlight && CSS.highlights) {
      CSS.highlights.set('ecos-find', new Highlight(...all));
      if (curR.length) CSS.highlights.set('ecos-find-cur', new Highlight(...curR));
    }
  } catch { /* sin API de resaltado: queda el bloque marcado */ }
  if (scroll && target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function frRefresh(scroll) { frCompute(); frPaint(scroll); }
function frGo(d) {
  frCompute();
  if (!FR.hits.length) return frPaint();
  FR.i = (FR.i + d + FR.hits.length) % FR.hits.length;
  frPaint(true);
}
function frOpenBar() {
  if ($('#editor').classList.contains('hidden')) return;
  const sel = String(getSelection() || '').trim();
  $('#fr-bar').classList.remove('hidden');
  if (sel && sel.length < 80 && !sel.includes('\n')) $('#fr-q').value = sel;
  $('#fr-q').focus(); $('#fr-q').select();
  FR.i = 0; frRefresh(!!$('#fr-q').value);
}
function frCloseBar() { $('#fr-bar').classList.add('hidden'); frClearMarks(); FR.hits = []; }
function frReplace(all) {
  frCompute();
  if (!FR.hits.length) return;
  const q = $('#fr-q').value, rep = $('#fr-r').value, o = frOpts(), F = window.FindReplace;
  const one = all ? null : FR.hits[FR.i];
  let count = 0;
  for (const [id, field] of [['d-title', 'title'], ['d-excerpt', 'excerpt']]) {
    if (one && one.field !== field) continue;
    const el = $('#' + id), r = F.replaceInText(el.value, q, rep, o, one ? one.start : undefined);
    if (r.count) { el.value = r.text; count += r.count; el.dispatchEvent(new Event('input')); }
  }
  if ((!one || (one.field !== 'title' && one.field !== 'excerpt')) && F.findInBlocks(draft.blocks, q, o).length) {
    window.BlockEditor.change(() => { count += F.replaceInBlocks(draft.blocks, q, rep, o, one || undefined).count; });
  }
  if (all) toast(t('{n} cambios', { n: count }));
  requestAnimationFrame(() => frRefresh(!all));
}
$('#ed-find').onclick = () => (frOpen() ? frCloseBar() : frOpenBar());
$('#fr-close').onclick = frCloseBar;
$('#fr-prev').onclick = () => frGo(-1);
$('#fr-next').onclick = () => frGo(1);
$('#fr-one').onclick = () => frReplace(false);
$('#fr-all').onclick = () => frReplace(true);
['#fr-q', '#fr-case', '#fr-word'].forEach((s) => $(s).addEventListener(s === '#fr-q' ? 'input' : 'change', () => { FR.i = 0; frRefresh(true); }));
$('#fr-bar').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); frCloseBar(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (e.target.id === 'fr-r') frReplace(false); else frGo(e.shiftKey ? -1 : 1); }
});
document.addEventListener('keydown', (e) => {
  if ($('#editor').classList.contains('hidden') || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'f' || k === 'h') { e.preventDefault(); frOpenBar(); if (k === 'h') $('#fr-r').focus(); }
}, true);
// Si se edita a mano con la barra abierta, se vuelven a contar las coincidencias
$('#ed-canvas').addEventListener('input', (e) => { if (frOpen() && !e.target.closest('#fr-bar')) { clearTimeout(FR.t); FR.t = setTimeout(() => frRefresh(false), 300); } });

