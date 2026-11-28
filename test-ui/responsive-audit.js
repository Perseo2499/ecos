// Detector de textos cortados / desbordes (compartido por test-ui/responsive.test.js y las auditorías manuales).
// auditInPage se ejecuta DENTRO de la página: devuelve la lista de problemas visibles.
function auditInPage() {
  const out = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('.hidden,[hidden],.ov-measure'); };
  const name = (e) => (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' «' + (e.textContent || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 24) + '»';
  const sel = '.btn, .chip, .tabs button, .vnav a, .vnav button, .pill, .seg button, .seg label, .b-tabs button, .ed-bar button, .ed-dev button';
  document.querySelectorAll(sel).forEach((e) => {
    if (!vis(e) || e.closest('.modal-box, .q-panel, #ins-menu, .ov-menu')) return;
    if (e.scrollWidth > e.clientWidth + 1) out.push('recorte: ' + name(e) + ' ' + e.scrollWidth + '>' + e.clientWidth);
    const t = [...e.querySelectorAll('span:not(.ms)')].find((s) => s.textContent.trim() && !s.children.length);
    if (t) { const lh = parseFloat(getComputedStyle(t).lineHeight) || 20; if (t.getBoundingClientRect().height > lh * 1.6 && getComputedStyle(t).display !== 'none') out.push('varias líneas: ' + name(e)); }
  });
  document.querySelectorAll('.filters select, .b-filters select, #page').forEach((e) => {
    if (!vis(e) || !e.selectedOptions[0]) return;
    const cs = getComputedStyle(e); const c = document.createElement('canvas').getContext('2d'); c.font = cs.font;
    if (c.measureText(e.selectedOptions[0].textContent).width > e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24) out.push('select recortado: ' + name(e));
  });
  document.querySelectorAll('.ed-bar, .appbar, .tabs, .b-tabs, #b-type').forEach((e) => {
    if (!vis(e)) return;
    const kids = [...e.children].filter(vis); if (kids.length < 2) return;
    const rs = kids.map((k) => k.getBoundingClientRect());
    if (Math.min(...rs.map((r) => r.bottom)) <= Math.max(...rs.map((r) => r.top))) out.push('barra en varias líneas: ' + name(e));
  });
  const W = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > W + 1) out.push('la página desborda en horizontal: ' + document.documentElement.scrollWidth + '>' + W);
  document.querySelectorAll('.appbar *, .ed-bar *').forEach((e) => { if (vis(e) && !e.closest('.q-panel,.ov-menu') && e.getBoundingClientRect().right > W + 1) out.push('fuera de la ventana: ' + name(e)); });
  return out;
}
module.exports = { auditInPage };
