// Ecos · Editor de entradas (buscadores, redes y compartir en Facebook/Instagram). Sigue a app/editor.js y comparte su ámbito global (se cargan en orden desde index.html).
// ---------------------------------------------------------------- Buscadores y redes
// «¡Primer día en Rabat!» → «primer-dia-en-rabat» (como hace WordPress)
const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
// Bloque «Cómo se verá»: vista previa en Google y en redes, contadores, avisos, sugerencias de la IA.
// La lógica pura (cortes, niveles, avisos, mensajes) está en app/seo.js.
let seoInfo = { plugin: null, key: null, writable: false, via: null, both: false }; // plugin SEO de la web (si lo hay y deja escribir su campo)
let wpSt = null, wpUrl = ''; // estado y dirección de la entrada en WordPress
let shareTab = 'google', seoSugg = null;
async function loadSeoInfo(force) {
  seoInfo = { plugin: null, key: null, writable: false, via: null, both: false }; seoSugg = null;
  try { if (CFG.wpMode === 'selfhosted') seoInfo = (await window.api.wpSeoInfo(!!force)) || seoInfo; } catch { /* sin conexión: se usa el extracto */ }
  $('#seo-desc-field').classList.toggle('hidden', !seoInfo.writable);
  renderShare();
}
// Campo donde vive la descripción para buscadores
const seoField = () => (seoInfo.writable ? $('#d-seodesc') : $('#d-excerpt'));
const siteHost = () => (CFG.wpPublicUrl || 'https://' + (CFG.wpSite || 'tu-web.com')).replace(/\/$/, '').replace(/^https?:\/\//, '');
const shareImage = () => {
  const all = [...window.BlockEditor.flat(draft.blocks || []).flatMap((b) => (b.img ? [b.img] : b.images || [])), ...(window.BlockEditor?.media || []), ...(draft.extraMedia || [])];
  return all.find((i) => i.id === draft.featuredImageId) || all.find((i) => i.type !== 'video' && i.url);
};
const SEO_PLUGIN = { yoast: 'Yoast SEO', rankmath: 'Rank Math' };
function seoWarnTexts(w) {
  return w.map((x) => ({
    titleLong: t('El título tiene {n} caracteres: Google lo cortará a partir del 60.', { n: x.n }),
    noDesc: t('Falta la descripción: Google elegirá un trozo del texto.'),
    descLong: t('La descripción tiene {n} caracteres: Google la cortará a partir del 155.', { n: x.n }),
    kwTitle: t('La palabra clave no aparece en el título.'),
    noImage: t('Sin imagen destacada: al compartir no saldrá foto.'),
    slugLong: t('La dirección de la entrada es muy larga ({n} caracteres): mejor más corta.', { n: x.n }),
  }[x.code]));
}
function renderShare() {
  const box = $('#d-share'); if (!box || !draft) return;
  const host = siteHost();
  const title = $('#d-title').value.trim();
  const slug = slugify($('#d-slug').value) || slugify(title);
  $('#d-slug').placeholder = slugify(title) || 'direccion-de-la-entrada';
  $('#d-slug-base').textContent = host + '/…/';
  const img = shareImage();
  const plain = window.BlockEditor?.plainText?.() || '';
  const real = seoField().value.trim(); // lo que de verdad se guardará
  const desc = real || Seo.cut(plain, 200);
  const sTitle = window.SeoPanel?.seoTitle?.() || ''; // título para buscadores propio (Yoast / Rank Math), si lo hay
  const shownTitle = sTitle || title || t('Sin título');
  const warn = seoWarnTexts(Seo.warnings({ title: sTitle || title, desc: real, keyword: $('#d-kw').value, hasImage: !!draft.featuredImageId, slug }));
  const help = seoInfo.writable ? t('La descripción se guarda en el campo de {p}.', { p: SEO_PLUGIN[seoInfo.plugin] || 'SEO' })
    : seoInfo.plugin ? t('Tu web tiene {p}, pero no deja escribir su descripción desde Ecos: se usa el extracto de arriba. Con el Complemento de Ecos 1.8.1 sí se puede (Conexiones → Complemento).', { p: SEO_PLUGIN[seoInfo.plugin] })
      : t('Tu web no tiene un plugin de SEO: la descripción para buscadores es el extracto de arriba.');
  const cnt = (n, lv, max) => `<span class="seo-count ${lv}">${n}/${max}</span>`;
  const tl = Seo.clean(sTitle || title).length, dl = Seo.clean(real).length;
  const sg = seoSugg ? `<div class="seo-sugg"><b>${t('Propuesta de la IA')}</b>
      ${seoSugg.title ? `<div class="seo-sg-row"><div><small>${t('Título')} · ${Seo.clean(seoSugg.title).length}</small><div>${escHtml(seoSugg.title)}</div></div><button class="btn tonal small" data-seo="use-title">${t('Usar')}</button></div>` : ''}
      ${seoSugg.description ? `<div class="seo-sg-row"><div><small>${t('Descripción')} · ${Seo.clean(seoSugg.description).length}</small><div>${escHtml(seoSugg.description)}</div></div><button class="btn tonal small" data-seo="use-desc">${t('Usar')}</button></div>` : ''}
      <button class="btn text small" data-seo="discard">${t('Descartar')}</button></div>` : '';
  const xf = window.SeoPanel?.fields() || {};
  const soc = SeoMeta.social({ ...xf, host, title, seoTitle: sTitle, desc, featured: img?.url || '' });
  const canShare = wpSt === 'publish' && CFG.metaConnected && wpUrl && CFG.shareFacebook === true;
  box.innerHTML = `<div class="section-label">${t('Cómo se verá')}</div>
    <div class="seo-tabs" role="tablist"><button role="tab" class="${shareTab === 'google' ? 'on' : ''}" data-seo="tab-google">Google</button><button role="tab" class="${shareTab === 'social' ? 'on' : ''}" data-seo="tab-social">Facebook</button><button role="tab" class="${shareTab === 'x' ? 'on' : ''}" data-seo="tab-x">X</button></div>
    ${shareTab === 'google'
    ? `<div class="sc-google"><div class="sc-g-url">${escHtml(SeoMeta.googleUrl(host, slug, xf.canonical))}</div><div class="sc-g-title">${escHtml(Seo.cut(shownTitle, 60))}</div><div class="sc-g-desc">${escHtml(Seo.cut(desc, 155))}</div></div>`
    : shareTab === 'x'
      ? `<div class="sc-x">${soc.x.image ? `<img src="${escHtml(soc.x.image)}" alt="">` : '<div class="sc-noimg"><span class="ms">image</span></div>'}
      <div class="sc-body"><div class="sc-title">${escHtml(soc.x.title || shownTitle)}</div><div class="sc-desc">${escHtml(soc.x.desc)}</div><div class="sc-host">${escHtml(soc.x.host)}</div></div></div>`
      : `<div class="sc-card">${soc.fb.image ? `<img src="${escHtml(soc.fb.image)}" alt="">` : '<div class="sc-noimg"><span class="ms">image</span></div>'}
      <div class="sc-body"><div class="sc-host">${escHtml(soc.fb.host)}</div><div class="sc-title">${escHtml(soc.fb.title || shownTitle)}</div><div class="sc-desc">${escHtml(soc.fb.desc)}</div></div></div>`}
    <div class="seo-counts"><span>${t('Título')} ${cnt(tl, Seo.titleLevel(sTitle || title), 60)}</span><span>${t('Descripción')} ${cnt(dl, Seo.descLevel(real), 155)}</span></div>
    <div class="hint seo-help">${escHtml(help)}</div>
    ${warn.length ? `<ul class="seo-warns">${warn.map((x) => `<li><span class="ms">warning</span>${escHtml(x)}</li>`).join('')}</ul>` : `<div class="seo-ok"><span class="ms">check_circle</span>${t('Todo en orden para buscadores.')}</div>`}
    ${sg}
    <div class="seo-actions">
      ${CFG.aiConfigured ? `<button class="btn tonal small" data-seo="ai"><span class="ms">auto_awesome</span>${t('Sugerir con IA')}</button>` : ''}
      ${canShare ? `<button class="btn tonal small" data-seo="fb"><span class="ms">share</span>${t('Compartir en Facebook')}</button>` : ''}
    </div>`;
  window.SeoPanel?.refresh();
}
$('#d-share').addEventListener('click', (e) => {
  const b = e.target.closest('[data-seo]'); if (!b) return;
  const act = b.dataset.seo;
  if (act === 'tab-google' || act === 'tab-social' || act === 'tab-x') { shareTab = act.slice(4); return renderShare(); }
  if (act === 'discard') { seoSugg = null; return renderShare(); }
  if (act === 'use-title') { $('#d-title').value = seoSugg.title; autoTitle(); seoSugg.title = ''; autosaveSoon(); }
  if (act === 'use-desc') { seoField().value = seoSugg.description; seoSugg.description = ''; autosaveSoon(); }
  if (act === 'use-title' || act === 'use-desc') { if (!seoSugg.title && !seoSugg.description) seoSugg = null; return renderShare(); }
  if (act === 'fb') return openFbShare();
  if (act === 'ai') {
    return busy(b, async () => {
      const r = await window.api.aiSeo({ title: $('#d-title').value.trim(), text: window.BlockEditor.plainText(), keyword: $('#d-kw').value.trim() });
      seoSugg = { title: r.title || '', description: r.description || '' }; renderShare();
    });
  }
});

// ---------------------------------------------------------------- Compartir en Facebook / Instagram
const copyText = async (s) => {
  try { await navigator.clipboard.writeText(s); return true; } catch { /* sin permiso: se prueba con un campo temporal */ }
  const ta = document.createElement('textarea'); ta.value = s; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* nada */ }
  ta.remove(); return ok;
};
async function openFbShare() {
  const link = wpUrl || lastSent?.url || '';
  if (!link) return toast(t('La entrada tiene que estar publicada para poder compartirla.'), true);
  let accs = [];
  try { accs = await window.api.metaAccounts(); } catch (e) { return toast(e.message || String(e), true); }
  if (!accs.length) return toast(t('Conecta primero con Meta en Conexiones.'), true);
  const title = $('#d-title').value.trim() || t('Sin título');
  const img = shareImage();
  const desc = $('#d-excerpt').value.trim() || Seo.cut(window.BlockEditor.plainText(), 160);
  const defId = $('#page')?.value;
  const prev = document.activeElement;
  const d = document.createElement('div');
  d.className = 'dlg-scrim';
  d.innerHTML = `<div class="dlg fbs" role="dialog" aria-modal="true">
    <h3>${t('Compartir en Facebook')}</h3>
    <div class="field"><label>${t('Página de Facebook')}</label><select id="fbs-page">${accs.map((a) => `<option value="${escHtml(a.pageId)}"${a.pageId === defId ? ' selected' : ''}>${escHtml(a.pageName)}</option>`).join('')}</select></div>
    <div class="field"><label>${t('Texto de la publicación')}</label><textarea id="fbs-text" rows="6"></textarea>
      <div class="hint">${t('El enlace de la entrada se añade solo y Facebook lo muestra como tarjeta.')}</div></div>
    <div class="sc-card">${img ? `<img src="${escHtml(img.url)}" alt="">` : '<div class="sc-noimg"><span class="ms">image</span></div>'}
      <div class="sc-body"><div class="sc-host">${escHtml(siteHost().toUpperCase())}</div><div class="sc-title">${escHtml(title)}</div><div class="sc-desc">${escHtml(Seo.cut(desc, 160))}</div></div></div>
    <div class="hint fbs-prev">${escHtml(link)}</div>
    <div class="hint fbs-ig">${t('Instagram no permite publicar enlaces: copia el texto y pégalo en Instagram («enlace en la bio»).')}</div>
    <div class="fbs-err hidden" role="alert"></div>
    <div class="dlg-actions"><button class="btn text" data-r="close">${t('Cancelar')}</button><button class="btn tonal" data-r="ig"><span class="ms">content_copy</span>${t('Copiar texto para Instagram')}</button><button class="btn filled" data-r="fb"><span class="ms">send</span>${t('Publicar en Facebook')}</button></div></div>`;
  $('#fbs-text', d).value = Seo.prefill($('#d-excerpt').value, window.BlockEditor.plainText());
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const close = () => { d.classList.add('out'); setTimeout(() => d.remove(), 160); document.removeEventListener('keydown', key, true); prev?.focus?.(); };
  d.addEventListener('mousedown', (e) => { if (e.target === d) close(); });
  document.addEventListener('keydown', key, true);
  $('[data-r="close"]', d).onclick = close;
  $('[data-r="ig"]', d).onclick = async () => {
    const txt = Seo.igText($('#fbs-text', d).value, t('Enlace en la bio'));
    toast(await copyText(txt) ? t('Texto copiado para Instagram.') : t('No se pudo copiar el texto.'), false);
  };
  $('[data-r="fb"]', d).onclick = (e) => busy(e.currentTarget, async () => {
    const err = $('.fbs-err', d); err.classList.add('hidden');
    const pageId = $('#fbs-page', d).value;
    const done = Object.values(exported || {}).find((x) => x.postId === draft.postId && x.sharedFb);
    if (done && !await ask(t('Esta entrada ya se compartió en Facebook ({p}) el {d}. ¿Compartirla otra vez?', { p: done.sharedFb.pageName || 'Facebook', d: fmtDate(done.sharedFb.at) }), { ok: t('Compartir otra vez') })) return;
    const m = Seo.fbMessage($('#fbs-text', d).value, link);
    try {
      const r = await window.api.metaShare({ pageId, message: m.message, link: m.link, postId: draft.postId });
      exported = r.exported || exported;
      close();
      toast(t('Compartido en Facebook.'));
      if (r.url && await ask(t('Entrada compartida en Facebook. ¿Quieres verla?'), { ok: t('Ver en Facebook'), cancel: t('Cerrar') })) window.api.open(r.url);
    } catch (ex) {
      const msg = String(ex.message || ex);
      if (/NEED_PUBLISH_PERMISSION/.test(msg)) {
        // falta el permiso de publicar: se pide aparte (y se explica qué hacer si la app de Meta no lo tiene)
        err.innerHTML = `${t('Para publicar en tu página, Ecos necesita el permiso de Meta «Publicar en la página» (pages_manage_posts).')}
          <button class="btn tonal small" data-perm>${t('Conceder permiso')}</button>
          <details><summary>${t('Si Meta dice «Invalid Scopes»')}</summary>${t('Tu app de Meta aún no tiene ese permiso. En developers.facebook.com → tu app → Casos de uso → «Administrar todo en tu página» (o Facebook Login) → Personalizar → Permisos, añade «pages_manage_posts». Después pulsa «Conceder permiso» otra vez.')}</details>`;
        err.classList.remove('hidden');
        $('[data-perm]', err).onclick = (ev) => busy(ev.currentTarget, async () => {
          await window.api.metaLogin({ publish: true });
          err.classList.add('hidden');
          toast(t('Permiso concedido. Pulsa «Publicar en Facebook» otra vez.'));
        });
      } else { err.textContent = msg; err.classList.remove('hidden'); }
    }
  });
  document.body.appendChild(d);
  $('#fbs-text', d).focus();
}

