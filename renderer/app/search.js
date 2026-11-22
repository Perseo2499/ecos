// Ecos · Buscador general (Ctrl+K o la lupa de la barra de arriba).
// Busca a la vez, mientras se escribe, en entradas y páginas de WordPress, medios, publicaciones de redes cargadas,
// y en una lista fija de ajustes y acciones. Sin tildes ni mayúsculas. Flechas para moverse, Enter para abrir, Esc para cerrar.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

const GS = (() => {
  let root = null, input, listEl, items = [], sel = 0, gen = 0, timer = null, pool = null, poolAt = 0;
  let remote = { q: '', post: [], page: [], loading: false };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tokens = (q) => norm(q).split(/\s+/).filter(Boolean);
  const hit = (hay, toks) => { const h = norm(hay); return toks.every((k) => h.includes(k)); };
  // Texto con la coincidencia resaltada (el resaltado se calcula sobre el texto sin tildes y se traslada al original)
  function hl(text, toks) {
    text = String(text || '');
    if (!toks.length) return escHtml(text);
    const map = []; let n = '';
    for (let i = 0; i < text.length; i++) { const c = norm(text[i]); for (let k = 0; k < c.length; k++) map.push(i); n += c; }
    const at = n.indexOf(toks[0]);
    if (at < 0) return escHtml(text);
    const s = map[at], e = map[at + toks[0].length - 1] + 1;
    return `${escHtml(text.slice(0, s))}<mark>${escHtml(text.slice(s, e))}</mark>${escHtml(text.slice(e))}`;
  }
  const settingsAt = (id) => () => { showTab('settings'); setTimeout(() => $(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 90); };
  const NEXT_THEME = { system: 'light', light: 'dark', dark: 'system' };
  // Lista fija de acciones y ajustes (se crea al abrir para que los textos salgan en el idioma actual)
  const commands = () => [
    { icon: 'edit_square', label: t('Nueva entrada'), kw: 'crear escribir post articulo', run: () => newDraft({ type: 'post' }) },
    { icon: 'note_add', label: t('Nueva página'), kw: 'crear escribir pagina', run: () => newDraft({ type: 'page' }) },
    { icon: 'download', label: t('Cargar publicaciones'), kw: 'instagram facebook meta redes traer', run: () => { showTab('posts'); $('#load').click(); } },
    { icon: 'home', label: t('Ir a Inicio'), kw: 'portada resumen', run: () => showTab('home') },
    { icon: 'dynamic_feed', label: t('Ir a Redes'), kw: 'redes instagram facebook', run: () => showTab('posts') },
    { icon: 'article', label: t('Ir a Blog'), kw: 'entradas', run: () => Home.goBlog('post') },
    { icon: 'description', label: t('Ir a Páginas'), kw: 'paginas', run: () => Home.goBlog('page') },
    { icon: 'photo_library', label: t('Ir a Medios'), kw: 'fotos imagenes biblioteca videos', run: () => Home.goBlog('media') },
    { icon: 'account_tree', label: t('Ir a Estructura'), kw: 'menu mapa web arbol categorias', run: () => Home.goBlog('structure') },
    { icon: 'calendar_month', label: t('Ir a Calendario'), kw: 'programadas fechas', run: () => Home.goBlog('calendar') },
    { icon: 'hub', label: t('Ir a Conexiones'), kw: 'meta wordpress ia claves', run: () => showTab('connections') },
    { icon: 'settings', label: t('Ir a Ajustes'), kw: 'opciones configuracion preferencias', run: () => showTab('settings') },
    { icon: 'shield_lock', label: t('Ajustes → Seguridad'), kw: 'contraseña bloqueo hello doble factor 2fa', run: settingsAt('#set-security') },
    { icon: 'backup', label: t('Ajustes → Copia de seguridad'), kw: 'exportar importar configuracion', run: settingsAt('#set-backup') },
    { icon: 'cloud_download', label: t('Copia de seguridad de la web'), kw: 'descargar entradas paginas fotos wxr xml zip', run: settingsAt('#bw') },
    { icon: 'notifications', label: t('Ajustes → Avisos'), kw: 'notificaciones', run: settingsAt('#set-notify') },
    { icon: 'palette', label: t('Ajustes → Personalización'), kw: 'tema color aspecto vinilo zoom', run: settingsAt('#set-look') },
    { icon: 'translate', label: t('Ajustes → Idioma'), kw: 'ingles español language', run: settingsAt('#set-lang') },
    { icon: 'settings_backup_restore', label: t('Restaurar copia'), kw: 'copia de seguridad restaurar recuperar entradas updraft', run: () => openRestore() },
    { icon: 'filter_none', label: t('Buscar fotos repetidas'), kw: 'duplicadas medios limpiar', run: () => { Home.goBlog('media'); setTimeout(() => findDuplicates().catch((e) => toastError(e)), 120); } },
    { icon: 'contrast', label: t('Cambiar tema'), kw: 'claro oscuro modo color', run: () => { const next = NEXT_THEME[prefs().theme] || 'light'; savePrefs({ theme: next }); toast(t('Tema: {x}', { x: next === 'dark' ? t('oscuro') : next === 'light' ? t('claro') : t('automático') })); } },
  ];

  function build() {
    root = document.createElement('div');
    root.className = 'gs-scrim hidden';
    root.innerHTML = `<div class="gs-box" role="dialog" aria-modal="true" aria-label="${escHtml(t('Buscar en todo'))}">
      <div class="gs-in"><span class="ms">search</span><input type="text" autocomplete="off" spellcheck="false" aria-label="${escHtml(t('Buscar en todo'))}"><kbd>Esc</kbd></div>
      <div class="gs-list" role="listbox"></div>
      <div class="gs-foot"><span><kbd>↑</kbd><kbd>↓</kbd> ${t('moverse')}</span><span><kbd>Enter</kbd> ${t('abrir')}</span><span><kbd>Esc</kbd> ${t('cerrar')}</span></div></div>`;
    document.body.appendChild(root);
    input = $('input', root); listEl = $('.gs-list', root);
    input.placeholder = t('Busca entradas, páginas, fotos, publicaciones o ajustes…');
    input.oninput = () => query(input.value);
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    listEl.addEventListener('mousemove', (e) => { const r = e.target.closest('.gs-it'); if (r && Number(r.dataset.i) !== sel) { sel = Number(r.dataset.i); mark(); } });
    listEl.addEventListener('click', (e) => { const r = e.target.closest('.gs-it'); if (r) go(Number(r.dataset.i)); });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(sel); }
      else if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
    });
  }
  const move = (d) => { if (!items.length) return; sel = (sel + d + items.length) % items.length; mark(true); };
  function mark(scroll) {
    $$('.gs-it', listEl).forEach((r) => { const on = Number(r.dataset.i) === sel; r.classList.toggle('on', on); r.setAttribute('aria-selected', on); if (on && scroll) r.scrollIntoView({ block: 'nearest' }); });
  }

  // Resultados con lo que ya se tiene (acciones, medios en caché, publicaciones de redes) + lo que llega de WordPress
  function collect(q) {
    const toks = tokens(q);
    const cmds = commands().filter((c) => !toks.length || hit(c.label + ' ' + c.kw, toks));
    if (!toks.length) return [{ group: t('Sugerencias'), list: cmds.slice(0, 8).map((c) => ({ ...c, title: c.label })) }];
    const groups = [];
    const wp = (type, label, icon) => {
      const l = remote[type].map((p) => ({ icon, title: decodeEntities(p.title || '') || t('(sin título)'), sub: `${STATUS()[p.status] || p.status} · ${fmtDay(p.date)}`, run: () => openPost(p.id, type) }));
      if (l.length) groups.push({ group: label, list: l });
    };
    wp('post', t('Entradas'), 'article'); wp('page', t('Páginas'), 'description');
    if (pool) {
      const l = pool.filter((m) => hit(`${m.name} ${m.alt || ''}`, toks)).slice(0, 6)
        .map((m) => ({ icon: m.type === 'video' ? 'movie' : 'image', thumb: m.tiny || m.thumb || (m.type === 'image' ? m.url : ''), title: m.name, sub: [m.type === 'video' ? t('Vídeo') : t('Foto'), m.width ? `${m.width}×${m.height}` : '', mediaDate(m.date)].filter(Boolean).join(' · '), run: () => openMedia(m) }));
      if (l.length) groups.push({ group: t('Medios'), list: l });
    }
    const soc = (posts || []).filter((p) => hit(p.text, toks)).slice(0, 5)
      .map((p) => ({ icon: p.source === 'instagram' ? 'photo_camera' : 'groups', thumb: postThumb(p), title: (p.text || t('Sin texto')).replace(/\s+/g, ' ').slice(0, 90), sub: `${p.source === 'instagram' ? 'Instagram' : 'Facebook'} · ${fmtDay(p.date)}${liveExport(p) ? ' · ' + t('Ya en el blog') : ''}`, run: () => openSocial(p) }));
    if (soc.length) groups.push({ group: t('Publicaciones de redes'), list: soc });
    if (cmds.length) groups.push({ group: t('Ajustes y acciones'), list: cmds.slice(0, 6).map((c) => ({ ...c, title: c.label })) });
    return groups;
  }
  function paint(q) {
    const toks = tokens(q), groups = collect(q);
    items = []; let h = '';
    for (const g of groups) {
      h += `<div class="gs-g">${escHtml(g.group)}</div>`;
      for (const it of g.list) {
        h += `<div class="gs-it" role="option" data-i="${items.length}">${it.thumb ? `<img src="${escHtml(it.thumb)}" alt="" loading="lazy">` : `<span class="gs-ic ms">${it.icon}</span>`}
          <div class="gs-t"><b>${hl(it.title, toks)}</b>${it.sub ? `<span>${escHtml(it.sub)}</span>` : ''}</div><span class="ms gs-go">keyboard_return</span></div>`;
        items.push(it);
      }
    }
    if (!items.length) h = `<div class="gs-none"><span class="ms">search_off</span><span>${remote.loading ? t('Buscando…') : t('Sin resultados para «{q}»', { q })}</span></div>`;
    else if (remote.loading) h += `<div class="gs-wait"><span class="ms">progress_activity</span>${t('Buscando en tu web…')}</div>`;
    listEl.innerHTML = h;
    sel = Math.min(sel, Math.max(0, items.length - 1));
    mark();
  }
  function query(q) {
    clearTimeout(timer);
    const my = ++gen;
    q = q.trim();
    sel = 0;
    if (remote.q !== q) remote = { q, post: [], page: [], loading: false };
    const wantRemote = q.length >= 2 && CFG.wpConnected;
    remote.loading = wantRemote;
    paint(q);
    if (!wantRemote) return;
    timer = setTimeout(async () => {
      const ask1 = (type) => window.api.blogList({ type, status: 'any', search: q, number: 5 }).then((r) => r.items, () => []);
      const [post, page] = await Promise.all([ask1('post'), ask1('page')]);
      if (my !== gen) return; // se ha seguido escribiendo
      remote = { q, post, page, loading: false };
      paint(q);
    }, 280);
  }

  async function openPost(id, type) { try { await openFromWp(id, null, type); } catch (e) { toastError(e); } }
  function openMedia(m) {
    Home.goBlog('media');
    setTimeout(() => { const i = $('#b-media .mg-search'); if (i) { i.value = m.name; i.dispatchEvent(new Event('input', { bubbles: true })); } }, 60);
  }
  function openSocial(p) {
    $('#f-show').value = 'all'; $('#f-search').value = (p.text || '').split('\n')[0].slice(0, 40);
    renderFeed(); renderFeedCal(); showTab('posts');
  }
  function go(i) { const it = items[i]; if (!it) return; close(); it.run(); }

  async function loadPool() {
    if (CFG.wpMode !== 'selfhosted' || !CFG.wpConnected || (pool && Date.now() - poolAt < 120000)) return;
    poolAt = Date.now();
    try { pool = await window.api.mediaAll(false); if (root && !root.classList.contains('hidden')) paint(input.value.trim()); } catch { /* sin biblioteca */ }
  }
  function open() {
    if (document.body.classList.contains('locked') || document.body.classList.contains('editing')) return;
    if (!root) build();
    root.classList.remove('hidden');
    input.value = ''; remote = { q: '', post: [], page: [], loading: false }; sel = 0; gen++;
    paint('');
    input.focus();
    loadPool();
  }
  function close() { if (root) root.classList.add('hidden'); }
  const isOpen = () => !!root && !root.classList.contains('hidden');
  return { open, close, isOpen, norm };
})();

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
    if (e.defaultPrevented) return; // en el editor, Ctrl+K sigue siendo «insertar enlace»
    e.preventDefault();
    GS.isOpen() ? GS.close() : GS.open();
  }
});
$('#gs-open').onclick = () => GS.open();
