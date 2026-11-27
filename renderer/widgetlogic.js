// Lógica pura de los widgets de WordPress (zonas /wp/v2/sidebars y widgets /wp/v2/widgets): normalizar, mover entre
// zonas, añadir un widget de bloque y calcular lo mínimo que hay que guardar. Sin pantalla ni red.
(function (root) {
  const INACTIVE = 'wp_inactive_widgets';
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const plain = (s) => String(s || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  // 'block' (editor de bloques de Ecos) · 'text' · 'html' · 'image' (formulario sencillo) · 'other' (solo lectura)
  const KINDS = { block: 'block', text: 'text', custom_html: 'html', media_image: 'image' };
  const kindOf = (w) => KINDS[w && w.idBase] || 'other';
  // Campos del formulario sencillo de cada tipo clásico
  const FORM = {
    text: [['title', 'text'], ['text', 'area']],
    html: [['title', 'text'], ['content', 'area']],
    image: [['title', 'text'], ['url', 'text'], ['alt', 'text'], ['caption', 'area'], ['link_url', 'text']],
  };
  function label(w) {
    const r = w.raw || {};
    if (kindOf(w) === 'block') return plain(r.content).slice(0, 70) || 'Bloque';
    return plain(r.title) || plain(r.text || r.content).slice(0, 50) || w.name || w.idBase || w.id;
  }

  // Respuestas de la API → zonas [{ id, name, description, inactive, widgets: [{ id, idBase, kind, raw, rendered }] }]
  function normalize(sidebars, widgets) {
    const byId = new Map((widgets || []).map((w) => [String(w.id), {
      id: String(w.id), idBase: w.id_base || '', name: w.name || '', raw: clone((w.instance && w.instance.raw) || {}), rendered: String(w.rendered || ''), editable: !!(w.instance && w.instance.raw) || w.id_base === 'block',
    }]));
    const zones = (sidebars || []).map((s) => ({
      id: s.id, name: s.name || s.id, description: String(s.description || '').replace(/<[^>]+>/g, ''), inactive: s.id === INACTIVE,
      widgets: (s.widgets || []).map((x) => byId.get(String(typeof x === 'object' ? x.id : x))).filter(Boolean).map((w) => ({ ...clone(w), kind: kindOf(w) })),
    }));
    return zones.sort((a, b) => (a.inactive ? 1 : 0) - (b.inactive ? 1 : 0));
  }

  const locate = (zones, id) => { for (const z of zones) { const i = z.widgets.findIndex((w) => String(w.id) === String(id)); if (i >= 0) return { zone: z, index: i, widget: z.widgets[i] }; } return null; };
  function move(zones, id, toZone, index) {
    const z = clone(zones), at = locate(z, id), dest = z.find((x) => x.id === toZone);
    if (!at || !dest) return { zones, ok: false };
    at.zone.widgets.splice(at.index, 1);
    const i = index === undefined || index === null ? dest.widgets.length : Math.max(0, Math.min(dest.widgets.length, index));
    dest.widgets.splice(i, 0, at.widget);
    return { zones: z, ok: true };
  }
  let seq = 0;
  // Widget de bloque nuevo (sin guardar todavía): id «new-N»
  function addBlock(zones, zoneId, content, tmp) {
    const z = clone(zones), dest = z.find((x) => x.id === zoneId);
    if (!dest) return { zones, ok: false };
    const w = { id: tmp || 'new-' + ++seq, idBase: 'block', name: 'Bloque', raw: { content: String(content || '') }, rendered: '', editable: true, kind: 'block', isNew: true };
    dest.widgets.push(w);
    return { zones: z, ok: true, widget: w };
  }
  function remove(zones, id) { const z = clone(zones), at = locate(z, id); if (at) at.zone.widgets.splice(at.index, 1); return z; }
  function setRaw(zones, id, patch) { const z = clone(zones), at = locate(z, id); if (at) at.widget.raw = { ...at.widget.raw, ...patch }; return z; }
  const isNew = (id) => /^new-/.test(String(id));

  // Lo mínimo para pasar de las zonas guardadas a las de ahora:
  //  del: ids a borrar · add: [{ tmp, idBase, sidebar, raw }] · upd: [{ id, raw }] (solo los cambiados) ·
  //  order: [{ sidebar, widgets: [ids o «new-N»] }] solo de las zonas cuya lista cambia (o que reciben widgets nuevos fuera del final)
  function diff(orig, cur) {
    const oldW = new Map(), curW = new Map();
    orig.forEach((z) => z.widgets.forEach((w) => oldW.set(String(w.id), w)));
    cur.forEach((z) => z.widgets.forEach((w) => curW.set(String(w.id), w)));
    const del = [...oldW.keys()].filter((id) => !curW.has(id));
    const add = [], upd = [], order = [];
    for (const z of cur) for (const w of z.widgets) {
      if (isNew(w.id)) add.push({ tmp: w.id, idBase: w.idBase, sidebar: z.id, raw: w.raw });
      else { const o = oldW.get(String(w.id)); if (o && w.editable !== false && JSON.stringify(o.raw) !== JSON.stringify(w.raw)) upd.push({ id: w.id, raw: w.raw }); }
    }
    for (const z of cur) {
      const o = orig.find((x) => x.id === z.id);
      const had = (o ? o.widgets.map((w) => String(w.id)) : []).filter((id) => curW.has(id) || false);
      // lo que quedaría tras borrar y crear: los que ya estaban (menos borrados) y los nuevos al final
      const after = [...had.filter((id) => !del.includes(id) && z.widgets.some((w) => String(w.id) === id)), ...z.widgets.filter((w) => isNew(w.id)).map((w) => String(w.id))];
      const want = z.widgets.map((w) => String(w.id));
      const moved = want.some((id) => !isNew(id) && !(o && o.widgets.some((w) => String(w.id) === id)));
      const left = o ? o.widgets.some((w) => curW.has(String(w.id)) && !z.widgets.some((x) => String(x.id) === String(w.id))) : false;
      if (moved || left || after.join('|') !== want.join('|')) order.push({ sidebar: z.id, widgets: want });
    }
    return { del, add, upd, order, count: del.length + add.length + upd.length + order.length };
  }

  // Para «Deshacer»: zonas objetivo = la copia guardada; los widgets que ya no existen se vuelven a crear (ids «new-r…»)
  function revert(snapshot, current) {
    const have = new Set(); current.forEach((z) => z.widgets.forEach((w) => have.add(String(w.id))));
    return clone(snapshot).map((z) => ({ ...z, widgets: z.widgets.map((w) => (have.has(String(w.id)) ? w : { ...w, id: 'new-r' + w.id, isNew: true })) }));
  }

  const api = { revert, INACTIVE, KINDS, FORM, kindOf, label, normalize, locate, move, addBlock, remove, setRaw, isNew, diff, plain, clone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WidgetLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
