// Ecos · Lógica pura para varias personas (sirve en la app y en las pruebas): rol y permisos, autoría,
// «Solo las mías», aviso de «modificada desde que la abriste» y el guardián del bloqueo de edición.
(function (root) {
  // Nombre del rol de WordPress (el texto se traduce en la pantalla con t())
  const ROLES = { administrator: 'Administrador', editor: 'Editor', author: 'Autor', contributor: 'Colaborador', subscriber: 'Suscriptor' };
  const roleName = (slug) => ROLES[slug] || String(slug || '');
  // Sin datos de la persona (versiones anteriores, WordPress.com) se supone que puede publicar
  const canPublish = (me) => !me || me.canPublish !== false;
  // Estado con el que enviar según lo elegido y el rol: quien no puede publicar manda a revisión («pending»)
  // y tampoco puede programar (programar es publicar más tarde)
  function sendStatus(when, me) {
    if (canPublish(me)) return when;
    return when === 'publish' || when === 'future' ? 'pending' : when;
  }
  const initials = (name) => {
    const w = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '')[0] || '?').toUpperCase() + (w.length > 1 ? w[w.length - 1][0].toUpperCase() : '');
  };
  // «Solo las mías»: se queda con las entradas de esa persona (si no se sabe quién es, no se filtra)
  const filterMine = (items, meId) => (!Number(meId) ? items : (items || []).filter((x) => Number(x.author?.id) === Number(meId)));
  // ¿La entrada cambió en WordPress después de abrirla? Las dos fechas son ISO; si falta alguna, no se avisa
  function changedSince(opened, current) {
    const a = new Date(opened).getTime(), b = new Date(current).getTime();
    if (!opened || !current || !Number.isFinite(a) || !Number.isFinite(b)) return false;
    return b > a;
  }

  // Guardián del bloqueo de edición de una entrada: lo pide al abrir, lo renueva cada 60 s y lo suelta al cerrar.
  // api.acquire(id, force) → { supported, locked, user } ; api.release(id). Los temporizadores se pueden sustituir (pruebas).
  // Estados: 'idle' | 'mine' (la tengo yo) | 'other' (la tiene otra persona) | 'unsupported' (sin complemento)
  function createLockKeeper({ api, id, every = 60000, setInt = (...a) => setInterval(...a), clearInt = (...a) => clearInterval(...a), onChange = () => {} }) {
    let state = 'idle', user = null, timer = null, stopped = false;
    const emit = (s, u) => {
      const same = s === state && (u?.id || 0) === (user?.id || 0) && (u?.name || '') === (user?.name || '');
      state = s; user = u || null;
      if (!same) onChange(state, user);
    };
    const halt = () => { if (timer != null) { clearInt(timer); timer = null; } };
    async function tick(force) {
      if (stopped) return k.snapshot();
      let r;
      try { r = await api.acquire(id, !!force); } catch { return k.snapshot(); } // sin red: se queda como estaba
      if (stopped) { if (r && r.supported && !r.locked) api.release(id).catch(() => {}); return k.snapshot(); }
      if (!r || r.supported === false) { emit('unsupported'); halt(); }
      else if (r.error) { /* fallo puntual: se reintenta en la siguiente renovación */ }
      else if (r.locked) emit('other', r.user);
      else emit('mine');
      return k.snapshot();
    }
    const k = {
      snapshot: () => ({ state, user }),
      get state() { return state; },
      get user() { return user; },
      // Pide el bloqueo y empieza a renovarlo
      async start() {
        stopped = false; halt();
        const r = await tick(false);
        if (state !== 'unsupported' && !stopped) timer = setInt(() => { tick(false); }, every);
        return r;
      },
      // Comprobación puntual (antes de enviar)
      check: () => tick(false),
      // «Editar de todos modos»: se toma el bloqueo aunque lo tenga otra persona
      takeOver: () => tick(true),
      async stop() {
        stopped = true; halt();
        const had = state === 'mine';
        state = 'idle'; user = null;
        if (had) { try { await api.release(id); } catch { /* sin red */ } }
      },
    };
    return k;
  }

  const api = { ROLES, roleName, canPublish, sendStatus, initials, filterMine, changedSince, createLockKeeper };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MultiUser = api;
})(typeof window !== 'undefined' ? window : globalThis);
