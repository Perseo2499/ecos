// Ecos · Revisar enlaces: en el editor (borrador abierto) y en el Blog (entradas seleccionadas, WordPress propio).
// Comprueba si los enlaces funcionan, avisa y propone una alternativa cuando han cambiado.
// (Comparte el ámbito global con los demás archivos de renderer/app.)

const LK_TAGS = () => ({
  ok: t('Funciona'), moved: t('Ha cambiado de dirección'), broken: t('Roto'), unknown: t('No se pudo comprobar'),
});
const LK_SRC = () => ({
  redirect: t('la web la redirige ahí'), https: t('versión segura https'),
  site: t('la misma entrada en tu web'), archive: t('copia guardada en el Archivo de Internet'),
});
const lkShort = (u, n = 64) => { const s = String(u).replace(/^https?:\/\/(www\.)?/i, ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// «12 enlaces: 9 funcionan, 2 han cambiado, 1 roto»
function lkSummary(results) {
  const c = { ok: 0, moved: 0, broken: 0, unknown: 0 };
  for (const r of results) c[r.status]++;
  const n = (k, one, many) => (c[k] ? t(c[k] === 1 ? one : many, { n: c[k] }) : '');
  const parts = [n('ok', '1 funciona', '{n} funcionan'), n('moved', '1 ha cambiado', '{n} han cambiado'),
    n('broken', '1 roto', '{n} rotos'), n('unknown', '1 sin comprobar', '{n} sin comprobar')].filter(Boolean);
  return `${t(results.length === 1 ? '1 enlace' : '{n} enlaces', { n: results.length })}${parts.length ? ': ' + parts.join(', ') : ''}`;
}

// Parte común de una fila: texto del enlace, dirección, etiqueta de estado y alternativa
function lkRowHtml(r) {
  const alt = r.suggestion
    ? `<div class="lk-alt"><span class="ms">subdirectory_arrow_right</span><span>${t('Alternativa:')} <a href="#" class="lk-open" data-u="${escHtml(r.suggestion)}" title="${escHtml(r.suggestion)}">${escHtml(lkShort(r.suggestion))}</a>
      <span class="lk-src">(${escHtml(LK_SRC()[r.suggestionSource] || '')})</span></span></div>` : '';
  return `<div class="lk-main">
      <div class="lk-text">${r.text ? escHtml(r.text) : `<i>${t(r.kind === 'image' ? 'Imagen' : 'Sin texto')}</i>`}${r.kind === 'image' ? ' <span class="ms lk-img" title="' + escHtml(t('Imagen')) + '">image</span>' : ''}</div>
      <a href="#" class="lk-url lk-open" data-u="${escHtml(r.url)}" title="${escHtml(r.url)}">${escHtml(lkShort(r.url))}</a>
      <div class="lk-state"><span class="lk-tag ${r.status}">${escHtml(LK_TAGS()[r.status])}</span>${r.note ? `<span class="lk-note">${escHtml(t(r.note))}</span>` : ''}</div>
      ${alt}
    </div>`;
}
const lkBindOpen = (root) => $$('.lk-open', root).forEach((a) => (a.onclick = (e) => { e.preventDefault(); window.api.open(a.dataset.u); }));

// Ventana con progreso; devuelve { box, body, actions, close, progress }
let lkProgressFn = null;
try { window.api.onLinksProgress?.((p) => lkProgressFn?.(p)); } catch { /* sin canal de progreso */ }
function lkModal(title) {
  const m = document.createElement('div');
  m.className = 'modal lk-modal';
  m.innerHTML = `<div class="modal-box wide lk-box"><h2><span class="ms">link</span><span class="lk-title"></span></h2>
    <div class="lk-sum hint"></div><div class="lk-body"></div>
    <div class="modal-actions"><button class="btn text lk-close">${t('Cerrar')}</button></div></div>`;
  $('.lk-title', m).textContent = title;
  const close = () => { lkProgressFn = null; m.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $('.lk-close', m).onclick = close;
  m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
  document.body.appendChild(m);
  const body = $('.lk-body', m);
  return {
    box: m, body, sum: $('.lk-sum', m), actions: $('.modal-actions', m), close,
    progress(label) {
      body.innerHTML = `<div class="lk-prog"><div class="lk-bar"><i></i></div><p class="hint">${escHtml(label)}</p></div>`;
      lkProgressFn = (p) => { const bar = $('.lk-bar i', body); if (bar) { bar.style.width = Math.round(100 * p.done / Math.max(1, p.total)) + '%'; $('.lk-prog .hint', body).textContent = t('Comprobando enlaces… {a} de {b}', { a: p.done, b: p.total }); } };
    },
  };
}

// ---------------------------------------------------------------- Editor
// Recorre todos los campos de un bloque que pueden llevar enlaces (fn recibe el HTML y devuelve el nuevo)
function lkMapBlock(b, fn) {
  if (typeof b.html === 'string') b.html = fn(b.html);
  if (Array.isArray(b.items)) b.items = b.items.map((x) => (typeof x === 'string' ? fn(x) : x));
  if (Array.isArray(b.rows)) b.rows = b.rows.map((r) => (Array.isArray(r) ? r.map((c) => (typeof c === 'string' ? fn(c) : c)) : r));
  if (typeof b.caption === 'string') b.caption = fn(b.caption);
  if (typeof b.markup === 'string') b.markup = fn(b.markup);
}
function lkCollectDraft() {
  const found = new Map();
  const add = (l, flags) => { const o = found.get(l.url) || { url: l.url, text: l.text || '', kind: l.kind, canChange: false, canRemove: false }; if (!o.text && l.text) o.text = l.text; Object.assign(o, Object.fromEntries(Object.entries(flags).filter(([, v]) => v))); found.set(l.url, o); };
  for (const b of draft.blocks) {
    lkMapBlock({ ...b }, (s) => { for (const l of window.LinkUtil.extractLinks(s)) add(l, { canChange: true, canRemove: l.kind !== 'image' }); return s; });
    if ((b.type === 'buttons' || b.type === 'embed') && /^https?:\/\//i.test(b.url || '')) add({ url: b.url.replace(/&amp;/g, '&').trim(), text: b.type === 'buttons' ? (window.LinkUtil.extractLinks(`<a href="${escHtml(b.url)}">${b.html || ''}</a>`)[0]?.text || '') : t('Vídeo incrustado') }, { canChange: b.type === 'buttons' });
  }
  return [...found.values()];
}
function lkApplyDraft(url, to) { // to === null → quitar el enlace
  window.BlockEditor.change(() => {
    for (const b of draft.blocks) {
      if (to === null) { lkMapBlock(b, (s) => window.LinkUtil.unlinkInHtml(s, url)); continue; }
      if (b.type !== 'embed') lkMapBlock(b, (s) => window.LinkUtil.replaceLinkInHtml(s, url, to));
      if (b.type === 'buttons' && (b.url || '').replace(/&amp;/g, '&').trim() === url) b.url = to;
    }
  });
}
async function lkEditorOpen() {
  const links = lkCollectDraft();
  if (!links.length) return toast(t('Esta entrada no tiene enlaces que revisar.'));
  const M = lkModal(t('Revisar enlaces'));
  M.progress(t('Comprobando enlaces… {a} de {b}', { a: 0, b: links.length }));
  let results;
  try { results = await window.api.checkLinks(links.map((l) => l.url)); } catch (e) { M.close(); throw e; }
  const by = new Map(results.map((r) => [r.url, r]));
  const rows = links.map((l) => ({ ...by.get(l.url), url: l.url, text: l.text, kind: l.kind, canChange: l.canChange, canRemove: l.canRemove }));
  M.sum.textContent = lkSummary(rows);
  const order = { broken: 0, moved: 1, unknown: 2, ok: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status]);
  const usable = (r) => r.suggestion && r.canChange && r.status !== 'ok';
  const all = document.createElement('button');
  all.className = 'btn tonal lk-all';
  const syncAll = () => { const n = rows.filter((r) => usable(r) && !r.done).length; all.classList.toggle('hidden', !n); all.innerHTML = `<span class="ms">auto_fix_high</span>${escHtml(t('Usar todas las alternativas'))} (${n})`; };
  M.actions.prepend(all);
  M.body.innerHTML = `<div class="lk-list">${rows.map((r, k) => `<div class="lk-row" data-k="${k}">${lkRowHtml(r)}<div class="lk-acts"></div></div>`).join('')}</div>`;
  lkBindOpen(M.body);
  const finish = (k, msg) => { const el = $(`.lk-row[data-k="${k}"]`, M.body); rows[k].done = true; $('.lk-acts', el).innerHTML = `<span class="lk-done"><span class="ms">check_circle</span>${escHtml(msg)}</span>`; el.classList.add('done'); syncAll(); };
  rows.forEach((r, k) => {
    const acts = $(`.lk-row[data-k="${k}"] .lk-acts`, M.body);
    const mk = (label, icon, fn, cls = 'tonal') => { const b = document.createElement('button'); b.className = `btn ${cls} small lk-btn`; b.innerHTML = `<span class="ms">${icon}</span>${escHtml(label)}`; b.onclick = fn; acts.appendChild(b); };
    if (usable(r)) mk(t('Usar esta'), 'check', () => { lkApplyDraft(r.url, r.suggestion); finish(k, t('Cambiado (puedes deshacerlo con Ctrl+Z)')); });
    if (r.status === 'broken' && !r.suggestion && r.canRemove) mk(t('Quitar el enlace'), 'link_off', () => { lkApplyDraft(r.url, null); finish(k, t('Enlace quitado (puedes deshacerlo con Ctrl+Z)')); }, 'text');
  });
  all.onclick = () => {
    const todo = rows.map((r, k) => [r, k]).filter(([r]) => usable(r) && !r.done);
    window.BlockEditor.change(() => {
      for (const [r] of todo) {
        for (const b of draft.blocks) {
          if (b.type !== 'embed') lkMapBlock(b, (s) => window.LinkUtil.replaceLinkInHtml(s, r.url, r.suggestion));
          if (b.type === 'buttons' && (b.url || '').replace(/&amp;/g, '&').trim() === r.url) b.url = r.suggestion;
        }
      }
    });
    for (const [, k] of todo) finish(k, t('Cambiado (puedes deshacerlo con Ctrl+Z)'));
    toast(t(todo.length === 1 ? '1 enlace cambiado. Puedes deshacerlo con Ctrl+Z.' : '{n} enlaces cambiados. Puedes deshacerlo con Ctrl+Z.', { n: todo.length }));
  };
  syncAll();
}
$('#d-links').onclick = (e) => busy(e.currentTarget, lkEditorOpen);

// ---------------------------------------------------------------- Blog (en lote)
async function linksBulk(items) {
  const sel = items.filter((i) => i.status !== 'trash');
  if (!sel.length) return;
  const M = lkModal(t('Revisar enlaces'));
  M.progress(t('Leyendo las entradas…'));
  const groups = new Map();
  for (const i of sel) { const ty = i.type === 'page' ? 'page' : 'post'; groups.set(ty, [...(groups.get(ty) || []), i.id]); }
  let posts = [];
  try {
    for (const [type, ids] of groups) posts.push(...(await window.api.blogCheckLinks({ ids, type })).map((p) => ({ ...p, type })));
  } catch (e) { M.close(); throw e; }
  const withLinks = posts.filter((p) => p.links.length);
  const total = withLinks.reduce((n, p) => n + p.links.length, 0);
  const bad = withLinks.map((p) => ({ ...p, links: p.links.filter((l) => l.status !== 'ok') })).filter((p) => p.links.length);
  M.sum.textContent = t('{n} entradas revisadas · {m} enlaces', { n: posts.length, m: total });
  if (!bad.length) { M.body.innerHTML = `<div class="empty"><span class="ms">task_alt</span><span>${t('Todos los enlaces funcionan.')}</span></div>`; return; }
  const apply = document.createElement('button');
  apply.className = 'btn filled';
  M.actions.appendChild(apply);
  const flat = [];
  M.body.innerHTML = `<div class="lk-list">${bad.map((p) => `<div class="lk-group"><div class="lk-gt">${escHtml(decodeEntities(p.title))}</div>${p.links.map((l) => {
    const k = flat.push({ id: p.id, type: p.type, from: l.url, to: l.suggestion }) - 1;
    return `<div class="lk-row">${lkRowHtml(l)}${l.suggestion ? `<label class="lk-chk"><input type="checkbox" data-k="${k}"${l.status === 'unknown' ? '' : ' checked'}><span>${t('Cambiar por la alternativa')}</span></label>` : ''}</div>`;
  }).join('')}</div>`).join('')}</div>`;
  lkBindOpen(M.body);
  const picked = () => $$('input[data-k]:checked', M.body).map((c) => flat[Number(c.dataset.k)]);
  const sync = () => { const n = picked().length; apply.disabled = !n; apply.textContent = t('Aplicar {n} cambios', { n }); apply.classList.toggle('hidden', !flat.some((f) => f.to)); };
  $$('input[data-k]', M.body).forEach((c) => (c.onchange = sync));
  sync();
  apply.onclick = () => busy(apply, async () => {
    const ch = picked(), n = ch.length;
    if (!n || !await ask(t('¿Cambiar {n} enlaces en tu web? Se guardará directamente en las entradas y no se puede deshacer desde Ecos.', { n }), { danger: true, ok: t('Cambiar enlaces') })) return;
    const r = await window.api.blogFixLinks(ch);
    M.close();
    toast(r.errors.length ? t('{n} entradas cambiadas; {e} con error', { n: r.done, e: r.errors.length }) : t('{n} entradas cambiadas', { n: r.done }), !!r.errors.length);
    loadBlog();
  });
}
