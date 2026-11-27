// Ecos · Lógica pura del flujo editorial entre varias personas (sirve en la app y en las pruebas):
// qué puede hacer cada rol, transiciones de estado (borrador → pendiente de revisión → publicada), hilos de notas internas,
// anclas de bloque (clase ecos-a-<id corto>), detección de cambios hechos por otra persona y resumen de actividad.
(function (root) {
  const has = (v) => v !== undefined && v !== null && v !== '';

  // ---------------------------------------------------------------- Capacidades → acciones
  // Sin datos de la persona (versiones anteriores, WordPress.com) se supone que puede publicar
  const canPublish = (me) => !me || me.canPublish !== false;
  // Revisar lo de otras personas pide poder publicar y editar entradas ajenas (editor, administrador)
  const canReview = (me) => canPublish(me) && (!me || me.canEditOthers !== false);
  // Acción principal del botón de enviar según el rol
  const primaryAction = (me) => (canPublish(me) ? 'publish' : 'submit');
  // Acciones disponibles para una entrada en un estado: save (guardar tal cual), submit, withdraw, publish, schedule, approve, approveSchedule, return, unpublish
  function actions(me, status) {
    const st = status || 'draft';
    const pub = canPublish(me), rev = canReview(me);
    const a = new Set(['save']);
    if (!pub) {
      if (st === 'draft') a.add('submit');
      if (st === 'pending') a.add('withdraw');
      return [...a];
    }
    if (['draft', 'pending', 'future', 'private'].includes(st)) a.add('publish');
    if (['draft', 'pending', 'publish', 'private'].includes(st)) a.add('schedule');
    if (st === 'publish' || st === 'future') a.add('unpublish');
    if (st === 'draft') a.add('submit');
    if (st === 'pending' && rev) { a.add('approve'); a.add('approveSchedule'); a.add('return'); }
    return [...a];
  }
  // Transición de estado: { ok, status } o { ok: false, reason }. date: fecha ISO para programar.
  function transition(status, action, me, { date } = {}) {
    const st = status || 'draft';
    const fail = (reason) => ({ ok: false, reason });
    if (!actions(me, st).includes(action) && action !== 'save') return fail(canPublish(me) ? 'invalid' : 'forbidden');
    switch (action) {
      case 'save': return { ok: true, status: st };
      case 'submit': return { ok: true, status: 'pending' };
      case 'withdraw': return { ok: true, status: 'draft' };
      case 'publish': case 'approve': return { ok: true, status: 'publish' };
      case 'schedule': case 'approveSchedule': {
        const t = new Date(date).getTime();
        if (!Number.isFinite(t)) return fail('date');
        return t > Date.now() ? { ok: true, status: 'future', date } : fail('past');
      }
      case 'return': case 'unpublish': return { ok: true, status: 'draft' };
      default: return fail('invalid');
    }
  }
  // Estado con el que enviar lo elegido en el editor: quien no puede publicar manda a revisión
  function sendStatus(when, me) {
    if (canPublish(me)) return when;
    return when === 'publish' || when === 'future' ? 'pending' : when;
  }

  // ---------------------------------------------------------------- Notas internas: hilos
  const tm = (d) => { const n = new Date(d).getTime(); return Number.isFinite(n) ? n : 0; };
  // notes: lista plana { id, parent, anchor, block, resolved, kind, date, author, text }. Devuelve los hilos ordenados por fecha.
  function buildThreads(notes) {
    const list = [...(notes || [])].sort((a, b) => tm(a.date) - tm(b.date) || a.id - b.id);
    const ids = new Set(list.map((n) => n.id));
    const roots = list.filter((n) => !n.parent || !ids.has(n.parent));
    const replies = new Map();
    for (const n of list) if (n.parent && ids.has(n.parent)) { (replies.get(n.parent) || replies.set(n.parent, []).get(n.parent)).push(n); }
    // las respuestas de respuestas cuelgan del hilo raíz
    const flatReplies = (id, seen = new Set()) => (replies.get(id) || []).flatMap((r) => (seen.has(r.id) ? [] : (seen.add(r.id), [r, ...flatReplies(r.id, seen)])));
    const threads = roots.map((r) => {
      const rep = flatReplies(r.id).sort((a, b) => tm(a.date) - tm(b.date) || a.id - b.id);
      return { id: r.id, root: r, replies: rep, anchor: r.anchor || '', block: r.block || '', resolved: !!r.resolved, kind: r.kind || 'note', count: 1 + rep.length, last: (rep[rep.length - 1] || r).date };
    });
    const byAnchor = {};
    for (const th of threads) if (th.anchor) (byAnchor[th.anchor] = byAnchor[th.anchor] || []).push(th);
    return {
      threads, byAnchor,
      general: threads.filter((th) => !th.anchor),
      open: threads.filter((th) => !th.resolved).length,
      openByAnchor: Object.fromEntries(Object.entries(byAnchor).map(([k, v]) => [k, v.filter((th) => !th.resolved).length])),
    };
  }
  // Hilos anclados a un bloque que ya no existe (se borró): anchorSet = anclas presentes en el contenido
  const orphanThreads = (threads, anchorSet) => (threads || []).filter((th) => th.anchor && !anchorSet.has(th.anchor));
  // Contador que se ve en el margen de un bloque: hilos abiertos y total
  const markCount = (built, anc) => ({ open: built.openByAnchor[anc] || 0, total: (built.byAnchor[anc] || []).length });
  // Una nota la puede borrar su autora o quien puede editar entradas ajenas
  const canDeleteNote = (note, me) => !!me && (Number(note?.author?.id) === Number(me.id) || me.canEditOthers === true);

  // ---------------------------------------------------------------- Anclas de bloque
  const ANCHOR_RE = /^[a-z0-9]{4,12}$/;
  const validAnchor = (a) => typeof a === 'string' && ANCHOR_RE.test(a);
  // Recorre cualquier estructura de bloques (hijos, columnas, pestañas…) y avisa de cada bloque con tipo
  function walk(node, fn, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) { for (const x of node) walk(x, fn, depth + 1); return; }
    if (typeof node.type === 'string') fn(node);
    for (const k of Object.keys(node)) { const v = node[k]; if (v && typeof v === 'object' && k !== 'img' && k !== 'images' && k !== 'th') walk(v, fn, depth + 1); }
  }
  // anc → bloque
  function collectAnchors(blocks) {
    const m = new Map();
    walk(blocks, (b) => { if (validAnchor(b.anc) && !m.has(b.anc)) m.set(b.anc, b); });
    return m;
  }
  function newAnchor(used, rnd = Math.random) {
    for (let i = 0; i < 50; i++) {
      let s = '';
      while (s.length < 6) s += Math.floor(rnd() * 36).toString(36);
      if (!used.has(s)) return s;
    }
    return 'a' + Date.now().toString(36).slice(-7);
  }
  // Da un ancla estable al bloque si no la tiene (se escribe como clase ecos-a-<id> y vuelve igual al reabrir)
  function ensureAnchor(block, blocks, rnd) {
    if (validAnchor(block.anc)) return block.anc;
    block.anc = newAnchor(new Set(collectAnchors(blocks).keys()), rnd);
    return block.anc;
  }
  // Copias de bloques (duplicar) repiten el ancla: la primera se queda con ella y las demás la pierden
  function dedupeAnchors(blocks) {
    const seen = new Set(); let removed = 0;
    walk(blocks, (b) => {
      if (b.anc === undefined) return;
      if (!validAnchor(b.anc)) { delete b.anc; return; }
      if (seen.has(b.anc)) { delete b.anc; removed++; } else seen.add(b.anc);
    });
    return removed;
  }
  const anchorClass = (anc) => (validAnchor(anc) ? 'ecos-a-' + anc : '');
  const anchorFromClass = (cls) => { const m = String(cls || '').split(/\s+/).map((c) => /^ecos-a-([a-z0-9]{4,12})$/.exec(c)).find(Boolean); return m ? m[1] : ''; };

  // ---------------------------------------------------------------- Cambios de otras personas
  // opened: fecha de modificación cuando se abrió; cur: { modified, by:{id,name} } ahora; meId: yo.
  // Devuelve null (nada que avisar) o { who, at, mine:false }
  function foreignChange({ opened, cur, meId, dismissed }) {
    if (!cur || !has(cur.modified) || !has(opened)) return null;
    const a = tm(opened), b = tm(cur.modified);
    if (!a || !b || b <= a) return null;
    if (dismissed && tm(dismissed) >= b) return null;
    const by = cur.by || null;
    if (by && Number(by.id) && Number(by.id) === Number(meId)) return null; // lo cambié yo (en otra ventana o en WordPress)
    return { who: by?.name || '', at: cur.modified };
  }
  // «hace un momento / 2 min / 3 h / 4 d» en partes, para que la pantalla lo traduzca
  function agoParts(from, now = Date.now()) {
    const s = Math.max(0, (now - tm(from)) / 1000);
    if (s < 60) return { unit: 'now', n: 0 };
    if (s < 3600) return { unit: 'min', n: Math.floor(s / 60) };
    if (s < 86400) return { unit: 'h', n: Math.floor(s / 3600) };
    return { unit: 'd', n: Math.floor(s / 86400) };
  }

  // ---------------------------------------------------------------- Actividad reciente y avisos
  // items: entradas modificadas recientemente { id, title, status, date, modified, author, editor, returned }
  function activityFeed(items, meId, { limit = 8 } = {}) {
    const out = [];
    for (const it of items || []) {
      const who = it.editor?.name ? it.editor : it.author || null;
      let kind = 'changed';
      if (it.returned) kind = 'returned';
      else if (it.status === 'pending') kind = 'review';
      else if (it.status === 'future') kind = 'scheduled';
      else if (it.status === 'publish' && Math.abs(tm(it.modified) - tm(it.date)) < 10 * 60 * 1000) kind = 'published';
      out.push({ id: it.id, title: it.title || '', kind, who: who?.name || '', whoAvatar: who?.avatar || '', mine: !!who && Number(who.id) === Number(meId), at: it.modified || it.date, status: it.status });
    }
    return out.sort((a, b) => tm(b.at) - tm(a.at)).slice(0, limit);
  }
  // prev: { pending:[ids], returned:[ids] } de la comprobación anterior (null la primera vez: no se avisa de lo que ya había)
  function reviewAlerts(prev, now, meId) {
    if (!prev) return { pending: [], returned: [] };
    const sp = new Set(prev.pending || []), sr = new Set(prev.returned || []);
    return {
      pending: (now?.pending || []).filter((p) => !sp.has(p.id) && Number(p.author?.id) !== Number(meId)),
      returned: (now?.returned || []).filter((p) => !sr.has(p.id)),
    };
  }
  const snapshot = (now) => ({ pending: (now?.pending || []).map((p) => p.id), returned: (now?.returned || []).map((p) => p.id) });

  const api = {
    canPublish, canReview, primaryAction, actions, transition, sendStatus,
    buildThreads, orphanThreads, markCount, canDeleteNote,
    validAnchor, collectAnchors, newAnchor, ensureAnchor, dedupeAnchors, anchorClass, anchorFromClass,
    foreignChange, agoParts, activityFeed, reviewAlerts, snapshot,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Editorial = api;
})(typeof window !== 'undefined' ? window : globalThis);
