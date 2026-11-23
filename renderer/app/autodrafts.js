// Ecos · Borradores automáticos con las publicaciones nuevas de las redes (Ajustes → Avisos).
// Nunca publica: crea BORRADORES en WordPress (fotos y vídeos incluidos) y los marca como pasados al blog.
// La lógica de qué se procesa está en renderer/autodrafts.js (pura y probada). Comparte el ámbito global con app/*.js.

// ---------------------------------------------------------------- opciones en Ajustes → Avisos
function renderAutoDraftOpts() {
  const p = prefs();
  const on = p.autoDrafts === true, ai = !!CFG.aiConfigured;
  $('#s-auto-drafts').checked = on;
  $('#s-auto-sub').classList.toggle('hidden', !on);
  $('#s-auto-ai').checked = p.autoDraftAi === true && ai;
  $('#s-auto-ai').disabled = !ai;
  $('#s-auto-ai-hint').classList.toggle('hidden', ai);
  const sel = $('#s-auto-cat');
  const names = [...new Set([...(categories || []).map((c) => c.name), ...(p.autoDraftCat ? [p.autoDraftCat] : [])])];
  sel.innerHTML = `<option value="">${escHtml(t('Sin categoría por defecto'))}</option>` + names.map((n) => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
  sel.value = p.autoDraftCat || '';
}
$('#s-auto-drafts').onchange = () => savePrefs({ autoDrafts: $('#s-auto-drafts').checked }).then(() => { if ($('#s-auto-drafts').checked) checkNewSocial(); });
$('#s-auto-ai').onchange = () => savePrefs({ autoDraftAi: $('#s-auto-ai').checked });
$('#s-auto-cat').onchange = () => savePrefs({ autoDraftCat: $('#s-auto-cat').value });

// ---------------------------------------------------------------- creación en segundo plano
let autoRunning = false;
const autoLog = (msg, e) => { try { window.api.logRenderer?.({ kind: 'borrador automático', message: `${msg}${e ? ': ' + (e.message || e) : ''}`, stack: e?.stack }); } catch { /* sin registro */ } };

// Un borrador a partir de una publicación (ya juntada Instagram+Facebook), como el flujo manual pero sin abrir el editor
async function autoDraftOne(p) {
  const d = (await window.api.buildDraft([p])) || {};
  const E0 = window.BlockEditor;
  const blocks = Array.isArray(d.blocks) ? d.blocks : [];
  let title = d.title || '', excerpt = '', tags = (d.tags || []).map(String), out = blocks;
  const pr = prefs();
  if (pr.autoDraftAi && CFG.aiConfigured && E0?.create) {
    try {
      const E = { create: (ty, x) => E0.create(ty, x), kids: (b) => E0.kids(b), change: (fn) => fn() };
      const r = await aiArticleCore({ blocks, title, sourceText: d.sourceText, opts: { ...aiOpts(), notes: '' }, E });
      title = r.title || title; excerpt = r.excerpt || '';
      tags = [...new Set([...tags, ...(r.tags || [])])];
      if (r.mode === 'whole') out = r.blocks;
    } catch (e) { autoLog('La IA no pudo convertir ' + AutoDrafts.keysOf(p)[0] + ' en artículo; se crea el borrador con el texto original', e); }
  }
  const cat = pr.autoDraftCat ? [pr.autoDraftCat] : (CFG.format?.categories || '').split(',').map((c) => c.trim()).filter(Boolean);
  const imgs = (E0?.flat ? E0.flat(out) : out).flatMap((b) => (b.img ? [b.img] : b.images || []));
  const res = await window.api.publish({
    postId: null, type: 'post', parent: 0, title: title.trim() || t('(sin título)'), excerpt, blocks: out, tags, categories: cat,
    status: 'draft', scheduleAt: null, featuredImageId: d.featuredImageId, featuredImageUrl: imgs.find((i) => i.id === d.featuredImageId)?.url || '',
    keepDate: false, date: d.date, keys: AutoDrafts.keysOf(p), slug: '', recreate: false, pageBg: null,
  });
  exported = res.exported || exported;
  if (d.failed?.length) autoLog(`${d.failed.length} archivo(s) no subidos en ${AutoDrafts.keysOf(p)[0]}`, d.failed[0]);
  return res;
}

// fresh: publicaciones nuevas detectadas. Hasta 5 por ronda; un fallo no detiene el resto.
async function runAutoDrafts(fresh) {
  if (autoRunning || prefs().autoDrafts !== true || !CFG.wpConnected || !fresh?.length) return;
  autoRunning = true;
  try {
    await refreshExported(true); // lo ya exportado, al día
    let claims = AutoDrafts.activeClaims(CFG.autoDraftClaims);
    const { todo } = AutoDrafts.select(fresh, { isExported: (p) => !!liveExport(p), claims });
    let ok = 0, bad = 0;
    for (const p of todo) {
      claims = AutoDrafts.claim(claims, p); // marcada ANTES de empezar: si la app se cierra a mitad no se duplica
      CFG = await window.api.setConfig({ autoDraftClaims: claims });
      try { await autoDraftOne(p); claims = AutoDrafts.release(claims, p); ok++; }
      catch (e) { claims = AutoDrafts.fail(claims, p); bad++; autoLog('No se pudo crear el borrador de ' + AutoDrafts.keysOf(p)[0], e); }
      CFG = await window.api.setConfig({ autoDraftClaims: claims });
    }
    if (!ok && !bad) return;
    renderFeed(); blog.loaded = false;
    NS.fresh = NS.fresh.filter((p) => !liveExport(p));
    if (!NS.fresh.length) { NS.seen = true; if (NS.newest) window.api.setConfig({ lastSeenPostDate: NS.newest }).then((c) => { CFG = c; }).catch(() => {}); }
    paintSocialBadge();
    if ($('#tab-home').classList.contains('active')) Home.render();
    if (ok) toast(t(ok === 1 ? 'Ecos ha preparado {n} borrador con tu publicación nueva' : 'Ecos ha preparado {n} borradores con tus publicaciones nuevas', { n: ok }), false, { duration: 12000, action: { label: t('Ver borradores'), onClick: showAutoDrafts } });
    if (bad) toast(t(bad === 1 ? 'No se ha podido preparar {n} borrador automático (mira el registro).' : 'No se han podido preparar {n} borradores automáticos (mira el registro).', { n: bad }), true);
  } catch (e) { autoLog('Ronda de borradores automáticos', e); }
  finally { autoRunning = false; }
}
// Blog → Entradas → Borradores
function showAutoDrafts() {
  showTab('blog');
  $('#b-type [data-type="post"]')?.click();
  $('#b-status').value = 'draft'; blog.page = 1; loadBlog();
}
// Comprobación periódica (además de la del arranque)
setInterval(() => { if (prefs().autoDrafts === true && !autoRunning && !document.body.classList.contains('editing')) checkNewSocial(); }, 30 * 60 * 1000);
