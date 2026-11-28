// Ecos · Editor de entradas: SEO completo (Yoast SEO y Rank Math). Palabras clave, dirección canónica, indexación,
// datos para Facebook y X, y un análisis sencillo con puntuación. Se lee de WordPress al abrir y se guarda al enviar
// (ruta ecos/v1/seo del complemento 1.8.0). La lógica pura está en app/seo-meta.js; sigue a app/editor-share.js.
const SeoPanel = (() => {
  const SM = window.SeoMeta;
  const DEF = SM.sanitize({ title: '', description: '', focusKw: '', extraKw: [], canonical: '', noindex: false, nofollow: false, ogTitle: '', ogDesc: '', ogImage: '', ogImageId: 0, twTitle: '', twDesc: '', twImage: '', twImageId: 0 });
  let info = { plugin: null, helper: false, premium: null, both: false, via: null };
  let orig = { ...DEF }, cur = { ...DEF }, token = 0, loadErr = '';
  const box = () => $('#d-seo2');
  const PLUGIN = { yoast: 'Yoast SEO', rankmath: 'Rank Math' };
  const cap = () => SM.capability(info);
  const can = (f) => cap().can && cap().fields.includes(f);

  // Fotos de la entrada para elegir una como imagen de redes
  function photos() {
    const all = [...window.BlockEditor.flat(draft.blocks || []).flatMap((b) => (b.img ? [b.img] : b.images || [])), ...(window.BlockEditor?.media || []), ...(draft.extraMedia || [])];
    const seen = new Set();
    return all.filter((i) => i && i.url && i.type !== 'video' && !seen.has(i.url) && seen.add(i.url));
  }

  async function load() {
    const my = ++token;
    info = { plugin: null, helper: false, premium: null, both: false, via: null }; orig = { ...DEF }; cur = { ...DEF }; loadErr = '';
    const kw = $('#d-kw');
    if (CFG.wpMode === 'selfhosted') {
      try {
        const r = await window.api.wpSeoGet(draft?.postId || 0);
        if (my !== token) return;
        info = { plugin: r.plugin || null, helper: !!r.helper, premium: r.premium, both: !!r.both, via: r.via || null };
        if (r.error) loadErr = r.error;
        if (r.fields) { orig = { ...DEF, ...SM.sanitize(r.fields) }; cur = { ...orig, extraKw: [...(orig.extraKw || [])] }; if (orig.focusKw) kw.value = orig.focusKw; }
        // Rank Math no publica su descripción en la REST: se lee y se guarda con el complemento (ecos/v1/seo)
        const ta = $('#d-seodesc');
        if (viaHelper() && r.fields && ta && !ta.value.trim() && orig.description) ta.value = orig.description;
      } catch (e) { if (my !== token) return; loadErr = String(e.message || e); }
    }
    cur.focusKw = kw.value.trim();
    build();
    if (typeof renderShare === 'function') renderShare();
  }

  const viaHelper = () => info.via === 'helper';
  // Lo que hay ahora (con la palabra clave del campo de arriba y, si va por el complemento, la descripción del editor)
  function fields() { cur.focusKw = ($('#d-kw')?.value || '').trim(); if (viaHelper()) cur.description = ($('#d-seodesc')?.value || '').trim(); return cur; }
  // Título para buscadores propio de la entrada (sin las plantillas «%title% %sep%…» de Rank Math, que solo WordPress sabe rellenar)
  const seoTitle = () => { const v = String(fields().title || ''); return /%[a-z_]+(\([^)]*\))?%/i.test(v) ? '' : v; };
  // Solo lo que cambió y se puede guardar
  function pending() {
    const ok = new Set(cap().fields);
    const d = SM.diff(orig, fields());
    return Object.fromEntries(Object.entries(d).filter(([k]) => ok.has(k) && (k !== 'description' || viaHelper())));
  }
  // Lo que no se podrá guardar (hay cambios pero falta plugin o complemento)
  const blocked = () => (cap().can ? {} : Object.fromEntries(Object.entries(SM.diff(orig, { ...fields(), focusKw: orig.focusKw })).filter(([k]) => k !== 'focusKw' && k !== 'description')));

  async function afterSend(postId) {
    if (!postId || CFG.wpMode !== 'selfhosted') return;
    const ch = pending();
    if (!Object.keys(ch).length) {
      if (Object.keys(blocked()).length) toast(seoWhy(), true);
      return;
    }
    try {
      const r = await window.api.wpSeoSave(postId, ch);
      if (r.fields) { orig = { ...DEF, ...SM.sanitize(r.fields) }; cur = { ...orig, extraKw: [...(orig.extraKw || [])] }; cur.focusKw = ($('#d-kw')?.value || '').trim(); orig.focusKw = r.fields.focusKw || ''; if (viaHelper() && $('#d-seodesc')) $('#d-seodesc').value = orig.description || ''; }
      toast(t('Datos de SEO guardados en {p}.', { p: PLUGIN[info.plugin] || 'SEO' }));
    } catch (e) { toast(t('La entrada se envió, pero no se pudo guardar el SEO avanzado: {m}', { m: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }), true); }
  }

  function seoWhy() {
    const w = cap().why;
    if (w === 'noPlugin') return t('Tu web no tiene Yoast SEO ni Rank Math: la palabra clave, la dirección canónica, la indexación y los datos para redes no se pueden guardar.');
    if (w === 'noHelper') return t('Para guardar la palabra clave, la dirección canónica, la indexación y los datos para redes hace falta el complemento de Ecos 1.8.0 (Conexiones → Complemento).');
    return '';
  }

  const esc = (s) => escHtml(String(s ?? ''));
  const inp = (id, f, label, ph, tag = 'input') => `<div class="field"><label for="${id}">${label}</label>${tag === 'textarea' ? `<textarea id="${id}" rows="2" data-f="${f}" ${can(f) ? '' : 'disabled'} placeholder="${esc(ph || '')}">${esc(cur[f])}</textarea>` : `<input id="${id}" data-f="${f}" value="${esc(cur[f])}" ${can(f) ? '' : 'disabled'} placeholder="${esc(ph || '')}" autocomplete="off" spellcheck="false">`}</div>`;
  const imgField = (p, label) => {
    const ph = photos();
    return `<div class="field"><label for="sp-${p}-img">${label}</label>
      <div class="sp-img"><input id="sp-${p}-img" data-f="${p}Image" value="${esc(cur[p + 'Image'])}" ${can(p + 'Image') ? '' : 'disabled'} placeholder="https://…" autocomplete="off" spellcheck="false">
      <select data-pick="${p}" ${can(p + 'Image') && ph.length ? '' : 'disabled'} aria-label="${esc(t('Elegir una foto de la entrada'))}"><option value="">${t('Una foto de la entrada…')}</option>${ph.map((i, n) => `<option value="${n}">${esc(i.name || i.alt || i.url.split('/').pop())}</option>`).join('')}</select></div></div>`;
  };

  function build() {
    const b = box(); if (!b) return;
    const c = cap();
    const both = info.both ? `<div class="sp-note warn" id="sp-both"><span class="ms">warning</span><span>${esc(t('Tienes Yoast SEO y Rank Math activos a la vez: Ecos usa Rank Math. Desactiva uno de los dos en wp-admin → Plugins para evitar etiquetas duplicadas.'))}</span></div>` : '';
    const note = both + (!c.can ? `<div class="sp-note warn"><span class="ms">info</span><span>${esc(seoWhy())}${c.why === 'noPlugin' && CFG.wpMode === 'selfhosted' ? ` <button type="button" class="btn text small" data-sp="recheck"><span class="ms">refresh</span>${t('Volver a comprobar')}</button>` : ''}</span></div>`
      : loadErr ? `<div class="sp-note warn"><span class="ms">info</span><span>${esc(loadErr)}</span></div>`
        : c.why === 'noPremium' ? `<div class="sp-note"><span class="ms">info</span><span>${t('Las palabras clave secundarias son de Yoast SEO Premium: aquí solo se guarda la principal.')}</span></div>` : '');
    const open = (k) => (b.querySelector(`details[data-k="${k}"]`)?.open ? ' open' : '');
    b.innerHTML = `<div class="section-label">${t('SEO avanzado')}${info.plugin ? ` <span class="sp-plug">${esc(PLUGIN[info.plugin])}</span>` : ''}</div>
      ${note}
      ${can('title') ? inp('sp-title', 'title', t('Título para buscadores'), t('Si lo dejas vacío, el de la entrada')) : ''}
      ${can('extraKw') ? `<div class="field"><label for="sp-kw2">${t('Palabras clave secundarias')}</label><input id="sp-kw2" value="${esc((cur.extraKw || []).join(', '))}" placeholder="${esc(t('Separadas por comas'))}" autocomplete="off"></div>` : ''}
      ${inp('sp-canon', 'canonical', t('Dirección canónica (URL)'), t('Solo si esta entrada es copia de otra'))}
      <div class="sp-robots">
        <label class="chip"><input type="checkbox" id="sp-noindex" ${cur.noindex ? 'checked' : ''} ${can('noindex') ? '' : 'disabled'}><span>${t('No mostrar en buscadores')} <small>noindex</small></span></label>
        <label class="chip"><input type="checkbox" id="sp-nofollow" ${cur.nofollow ? 'checked' : ''} ${can('nofollow') ? '' : 'disabled'}><span>${t('No seguir sus enlaces')} <small>nofollow</small></span></label>
      </div>
      <details class="sp-soc" data-k="og"${open('og')}><summary><span class="ms">thumb_up</span>${t('Facebook y redes (Open Graph)')}</summary>
        ${inp('sp-og-title', 'ogTitle', t('Título'), t('Si lo dejas vacío, el de la entrada'))}${inp('sp-og-desc', 'ogDesc', t('Descripción'), t('Si lo dejas vacío, la de buscadores'), 'textarea')}${imgField('og', t('Imagen'))}</details>
      <details class="sp-soc" data-k="tw"${open('tw')}><summary><span class="ms">alternate_email</span>${t('X (Twitter)')}</summary>
        ${inp('sp-tw-title', 'twTitle', t('Título'), t('Si lo dejas vacío, el de Facebook'))}${inp('sp-tw-desc', 'twDesc', t('Descripción'), t('Si lo dejas vacío, la de Facebook'), 'textarea')}${imgField('tw', t('Imagen'))}</details>
      <div id="sp-ana" class="sp-ana"></div>`;
    refresh();
  }

  const MSG = {
    titleLen: (c) => (c.level === 'ok' ? t('El título tiene {n} caracteres: buena longitud.', c) : t('El título tiene {n} caracteres: lo ideal son entre 30 y 60.', c)),
    descLen: (c) => (!c.n ? t('Falta la descripción para buscadores (ideal: entre 70 y 155 caracteres).') : c.level === 'ok' ? t('La descripción tiene {n} caracteres: buena longitud.', c) : t('La descripción tiene {n} caracteres: lo ideal son entre 70 y 155.', c)),
    textLen: (c) => (c.level === 'ok' ? t('El texto tiene {n} palabras.', c) : t('El texto tiene {n} palabras: para posicionar mejor, escribe 300 o más.', c)),
    kwSet: () => t('Escribe una palabra clave (arriba): la búsqueda que quieres cubrir.'),
    kwTitle: (c) => (c.level === 'ok' ? t('La palabra clave está en el título.') : c.level === 'warn' ? t('La palabra clave está en el título, pero mejor al principio.') : t('Pon la palabra clave en el título.')),
    kwSlug: (c) => (c.level === 'ok' ? t('La palabra clave está en la dirección de la entrada.') : c.level === 'warn' ? t('Solo parte de la palabra clave está en la dirección.') : t('Pon la palabra clave en la dirección de la entrada.')),
    kwIntro: (c) => (c.level === 'ok' ? t('La palabra clave está en el primer párrafo.') : c.level === 'warn' ? t('La palabra clave aparece al principio, pero no en el primer párrafo.') : t('Menciona la palabra clave en el primer párrafo.')),
    kwHeading: (c) => (c.level === 'ok' ? t('La palabra clave está en algún subtítulo.') : c.none ? t('No hay subtítulos: usa alguno con la palabra clave.') : t('Pon la palabra clave en algún subtítulo.')),
    kwAlt: (c) => (c.level === 'ok' ? t('La palabra clave está en el texto alternativo de una foto.') : c.noImg ? t('Añade una foto con texto alternativo que incluya la palabra clave.') : t('Pon la palabra clave en el texto alternativo de alguna foto.')),
    kwDesc: (c) => (c.level === 'ok' ? t('La palabra clave está en la descripción.') : t('Pon la palabra clave en la descripción.')),
    density: (c) => (c.level === 'ok' ? t('Densidad de la palabra clave: {n} % ({times} veces).', c) : c.times ? t('Densidad de la palabra clave: {n} % ({times} veces): lo ideal es entre 0,5 y 2,5 %.', c) : t('La palabra clave no aparece en el texto: úsala de forma natural.')),
    altMissing: (c) => (c.level === 'ok' ? t('Todas las fotos tienen texto alternativo.') : t('{n} foto(s) sin texto alternativo.', c)),
    canonicalBad: () => t('La dirección canónica no es una URL válida.'),
  };
  function analysis() {
    const blocks = window.BlockEditor.flat(draft.blocks || []);
    const txt = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const imgs = blocks.flatMap((x) => (x.img ? [x.img] : x.images || []));
    const f = fields();
    return SM.analyze({
      title: seoTitle() || $('#d-title').value, desc: (typeof seoField === 'function' ? seoField().value : '') || '', keyword: f.focusKw, slug: slugify($('#d-slug').value) || slugify($('#d-title').value),
      paragraphs: blocks.filter((x) => x.type === 'paragraph').map((x) => txt(x.html)).filter(Boolean), headings: blocks.filter((x) => x.type === 'heading').map((x) => txt(x.html)).filter(Boolean),
      alts: imgs.map((i) => i.alt).filter(Boolean), imgCount: imgs.length, text: window.BlockEditor.plainText(), canonical: f.canonical,
    });
  }
  function refresh() {
    const el = $('#sp-ana'); if (!el || !draft) return;
    const r = analysis();
    const order = { bad: 0, warn: 1, ok: 2 };
    const rows = [...r.checks].sort((a, b) => order[a.level] - order[b.level]);
    const icon = { ok: 'check_circle', warn: 'warning', bad: 'error' };
    el.innerHTML = `<div class="sp-score ${r.level}" role="img" aria-label="${esc(t('Puntuación de SEO: {n} de 100', { n: r.score }))}"><b>${r.score}</b><span>/100</span></div>
      <div class="sp-ana-h"><b>${t('Análisis de la entrada')}</b><small>${t('Un análisis sencillo hecho en Ecos, sin IA.')}</small></div>
      <ul class="sp-checks">${rows.map((c) => `<li class="${c.level}"><span class="ms">${icon[c.level]}</span><span>${esc((MSG[c.code] || (() => c.code))({ ...c, n: typeof c.n === 'number' ? String(c.n).replace('.', ',') : c.n }))}</span></li>`).join('')}</ul>`;
  }

  // Cambios en los campos
  const fromInput = (e) => {
    const el = e.target;
    if (el.id === 'sp-kw2') cur.extraKw = SM.splitKw(el.value);
    else if (el.id === 'sp-noindex') cur.noindex = el.checked;
    else if (el.id === 'sp-nofollow') cur.nofollow = el.checked;
    else if (el.dataset.f) cur[el.dataset.f] = el.value.trim();
    else if (el.dataset.pick) {
      const ph = photos()[Number(el.value)]; if (!ph) return;
      cur[el.dataset.pick + 'Image'] = ph.url; cur[el.dataset.pick + 'ImageId'] = Number(ph.id) || 0;
      const t2 = $(`#sp-${el.dataset.pick}-img`); if (t2) t2.value = ph.url;
      el.value = '';
    } else return;
    if (el.dataset.f === 'ogImage' || el.dataset.f === 'twImage') cur[el.dataset.f + 'Id'] = 0; // una dirección escrita a mano no tiene número de foto
    if (el.dataset.f === 'ogImage' || el.dataset.f === 'twImage') { const orgId = orig[el.dataset.f + 'Id']; if (cur[el.dataset.f] === orig[el.dataset.f]) cur[el.dataset.f + 'Id'] = orgId; }
    if (typeof autosaveSoon === 'function') autosaveSoon();
    renderShare();
  };
  document.addEventListener('DOMContentLoaded', () => {});
  // «Volver a comprobar»: vacía la caché del plugin SEO (por si se acaba de instalar) y vuelve a leer
  async function recheck(btn) {
    btn.disabled = true;
    try { await loadSeoInfo(true); await load(); } finally { btn.disabled = false; }
  }
  const wire = () => { const b = box(); if (b && !b.dataset.wired) { b.dataset.wired = '1'; b.addEventListener('input', fromInput); b.addEventListener('change', fromInput); b.addEventListener('click', (e) => { const r = e.target.closest('[data-sp="recheck"]'); if (r) recheck(r); }); } };
  wire();
  return { load, fields, seoTitle, pending, blocked, afterSend, refresh, info: () => info, wire };
})();
window.SeoPanel = SeoPanel;
