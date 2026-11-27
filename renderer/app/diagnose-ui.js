// Ecos · Interfaz del diagnóstico de conexión, la tarjeta «Tu web» (Conexiones) y los informes de errores (Ajustes → Avanzado).
// La lógica está en renderer/diagnose.js y renderer/webenv.js (puras y probadas). Ámbito global como el resto de renderer/app.

// ---------------------------------------------------------------- Diagnóstico de conexión
(() => {
  const ICON = { ok: '✓', fail: '✗', warn: '!', skip: '–', running: '', pending: '' };
  let modal = null, runId = 0, results = [], running = false, info = {};
  const tr = (s, p) => t(s, p);

  function build() {
    modal = document.createElement('div');
    modal.id = 'dg-modal'; modal.className = 'modal hidden';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'dg-title');
    modal.innerHTML = `<div class="modal-box wide">
      <h2 id="dg-title"><span class="ms">network_check</span><span></span></h2>
      <p class="hint" data-k="intro"></p>
      <div class="dg-sum" id="dg-sum" aria-live="polite"></div>
      <ul class="dg-steps" id="dg-steps"></ul>
      <label class="fr-chk dg-opt"><input type="checkbox" id="dg-ai"><span data-k="ai"></span></label>
      <div class="modal-actions">
        <button type="button" class="btn text" id="dg-copy"></button>
        <button type="button" class="btn outlined" id="dg-again"></button>
        <button type="button" class="btn filled" id="dg-close"></button>
      </div></div>`;
    document.body.appendChild(modal);
    $('#dg-title span:last-child', modal).textContent = tr('Diagnóstico de conexión');
    $('[data-k="intro"]', modal).textContent = tr('Ecos comprueba, paso a paso, qué falla entre tu ordenador y tu web. Esto puede tardar unos segundos.');
    $('[data-k="ai"]', modal).textContent = tr('Incluir una prueba mínima de la IA (gasta una petición)');
    $('#dg-copy', modal).innerHTML = `<span class="ms">content_copy</span><span>${escHtml(tr('Copiar informe'))}</span>`;
    $('#dg-again', modal).innerHTML = `<span class="ms">refresh</span><span>${escHtml(tr('Repetir'))}</span>`;
    $('#dg-close', modal).textContent = tr('Cerrar');
    $('#dg-close', modal).onclick = close;
    $('#dg-again', modal).onclick = () => run();
    $('#dg-copy', modal).onclick = copyReport;
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) close(); });
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }
  function close() { modal?.classList.add('hidden'); }

  function rowHtml(s) {
    const st = s.status || 'pending';
    const pp = s.p && s.p.dir ? { ...s.p, dir: tr(s.p.dir) } : s.p;
    const d = s.detail ? tr(s.detail, pp) : '', a = s.advice && st !== 'ok' && st !== 'running' ? tr(s.advice, pp) : '';
    return `<li class="dg-step ${st}" data-id="${s.id}"><span class="dg-ic" aria-hidden="true">${ICON[st] || ''}</span>
      <div><div class="dg-t">${escHtml(tr(s.title))}<span class="sr-only"> — ${escHtml(tr(st === 'ok' ? 'correcto' : st === 'fail' ? 'fallo' : st === 'warn' ? 'aviso' : st === 'skip' ? 'omitido' : 'en curso'))}</span></div>
      ${d ? `<div class="dg-d">${escHtml(d)}</div>` : ''}${a ? `<div class="dg-a">${escHtml(a)}</div>` : ''}${s.raw ? `<code class="dg-raw">${escHtml(window.Diagnose.scrub(s.raw))}</code>` : ''}</div>
      <span class="dg-ms">${s.ms != null && st !== 'skip' && st !== 'running' ? s.ms + ' ms' : ''}</span></li>`;
  }
  function renderAll() {
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    $('#dg-steps', modal).innerHTML = window.Diagnose.STEPS.map(([id, title]) => rowHtml(byId[id] || { id, title, status: 'pending' })).join('');
    const sum = $('#dg-sum', modal), done = results.filter((r) => r.status !== 'running');
    if (running) { sum.className = 'dg-sum'; sum.textContent = tr('Comprobando…'); }
    else {
      const s = window.Diagnose.summarize(done);
      sum.className = 'dg-sum ' + s.level;
      sum.textContent = s.level === 'ok' ? tr('Todo en orden.') : s.level === 'warn' ? tr('Hay {n} aviso(s), pero Ecos debería funcionar.', { n: s.warn }) : tr('Se han encontrado {n} problema(s). Mira el consejo bajo cada uno.', { n: s.bad });
    }
    $('#dg-again', modal).disabled = running; $('#dg-copy', modal).disabled = running || !done.length;
  }
  async function run() {
    const id = ++runId; running = true; results = []; renderAll();
    try {
      const r = await window.api.diagRun({ runId: id, testAi: $('#dg-ai', modal).checked });
      if (id !== runId) return;
      results = r.steps; info = r.info || {};
    } catch (e) { if (id === runId) { results = [{ id: 'internet', title: 'Internet en general', status: 'fail', detail: 'No se ha podido ejecutar el diagnóstico.', raw: String(e.message || e) }]; } }
    running = false; renderAll();
  }
  function copyReport() {
    const text = window.Diagnose.formatReport(results.filter((s) => s.status !== 'running'), { ...info, date: info.date || new Date().toISOString() });
    (async () => { try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } toast(t('Informe copiado (sin contraseñas ni claves)')); })();
  }
  window.api.onDiagStep(({ runId: id, step }) => {
    if (!modal || id !== runId || !running) return;
    const i = results.findIndex((r) => r.id === step.id);
    if (i >= 0) results[i] = step; else results.push(step);
    renderAll();
  });
  window.openDiagnostics = () => {
    if (!modal) build();
    modal.classList.remove('hidden');
    $('#dg-close', modal).focus();
    run();
  };
  document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-diag]'); if (b) window.openDiagnostics(); });
})();

// ---------------------------------------------------------------- Tarjeta «Tu web»
(() => {
  const WE = window.WebEnv;
  async function renderEnv(force) {
    const card = $('#env-card'); if (!card) return;
    const self = (CFG.wpMode || 'selfhosted') === 'selfhosted';
    card.classList.toggle('hidden', !self);
    if (!self) return;
    const grid = $('#env-grid'), warns = $('#env-warns');
    let v = { env: null, warnings: [] };
    if (CFG.wpConnected) { try { v = await (force ? window.api.envRefresh() : window.api.envGet()); } catch (e) { if (force) toastError(e); } }
    const env = v.env;
    if (!env) {
      grid.innerHTML = '';
      warns.innerHTML = `<p class="hint">${escHtml(CFG.wpConnected ? t('Aún no se han podido leer los datos de tu web. Pulsa «Comprobar de nuevo».') : t('Conecta tu WordPress para ver aquí la versión, los límites y los plugins de tu web.'))}</p>`;
      $('#env-when').textContent = '';
      return;
    }
    const L = env.limits;
    const items = [
      [t('WordPress'), env.wp || '–'], [t('PHP'), env.php || '–'],
      [t('Tema'), env.theme ? `${env.theme.name} ${env.theme.version}`.trim() : '–'],
      [t('Subida máxima'), L ? WE.fmtSize(L.maxUpload) : '–'], [t('Memoria de PHP'), L?.memory_limit || '–'],
      [t('Complemento de Ecos'), env.helper?.installed ? 'v' + env.helper.version : t('No instalado')],
      [t('Plugins activos'), env.plugins ? String(env.plugins.length) : '–'],
      [t('Caché'), env.caches?.length ? env.caches.join(', ') : '–'],
    ];
    grid.innerHTML = items.map(([k, val]) => `<div class="env-item"><small>${escHtml(k)}</small><b>${escHtml(val)}</b></div>`).join('');
    const icon = { error: 'error', warn: 'warning', info: 'info' };
    warns.innerHTML = (v.warnings || []).map((w) => `<div class="env-warn ${w.level}" role="note"><span class="ms fill">${icon[w.level] || 'info'}</span><div><b>${escHtml(t(w.title))}</b><p>${escHtml(t(w.text, w.p))}</p></div></div>`).join('')
      || `<p class="hint">${escHtml(t('No se ha detectado ningún problema de compatibilidad.'))}</p>`;
    $('#env-when').textContent = t('Leído {d}', { d: new Date(env.at).toLocaleString() });
  }
  window.renderEnvCard = renderEnv;
  $('#env-refresh').onclick = (e) => busy(e.currentTarget, () => renderEnv(true));
  document.addEventListener('click', (e) => { if (e.target.closest?.('[data-tab="connections"]')) renderEnv(false); });
  window.api.onConfigChanged?.(() => renderEnv(false));
  setTimeout(() => renderEnv(false), 600);
})();

// ---------------------------------------------------------------- Informes de errores
(() => {
  const list = $('#crash-list');
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };
  async function render() {
    let items = [];
    try { const r = await window.api.crashList(); if (Array.isArray(r)) items = r; } catch { /* sin informes */ }
    $('#crash-clear').disabled = !items.length;
    list.innerHTML = items.length ? '' : `<li class="hint">${escHtml(t('No hay informes guardados.'))}</li>`;
    for (const r of items) {
      const li = document.createElement('li'); li.className = 'crash-item';
      li.innerHTML = `<div class="crash-row"><span class="crash-msg"></span>
        <button type="button" class="btn text" data-a="view"></button><button type="button" class="btn text" data-a="copy"></button>
        <button type="button" class="btn text" data-a="send"></button><button type="button" class="btn text danger" data-a="del"></button></div>
        <div class="crash-meta"></div><pre class="hidden"></pre>`;
      $('.crash-msg', li).textContent = r.message; $('.crash-msg', li).title = r.message;
      $('.crash-meta', li).textContent = `${fmtDate(r.at)} · v${r.version} · ${r.source}${r.count > 1 ? ' · ×' + r.count : ''}${r.sent ? ' · ' + t('enviado') : ''}`;
      $('pre', li).textContent = `${r.message}\n\n${r.stack}`;
      for (const [a, label] of [['view', t('Ver')], ['copy', t('Copiar')], ['send', t('Enviar')], ['del', t('Borrar')]]) $(`[data-a="${a}"]`, li).textContent = label;
      $('[data-a="view"]', li).onclick = () => $('pre', li).classList.toggle('hidden');
      $('[data-a="copy"]', li).onclick = async () => { try { const text = await window.api.crashText(r.id); await navigator.clipboard.writeText(text); toast(t('Copiado')); } catch (e) { toastError(e); } };
      $('[data-a="send"]', li).onclick = async () => { try { await window.api.crashSend(r.id); toast(t('Se ha abierto GitHub con la incidencia rellenada. Revísala antes de enviarla.')); render(); } catch (e) { toastError(e); } };
      $('[data-a="del"]', li).onclick = async () => { try { await window.api.crashRemove(r.id); render(); } catch (e) { toastError(e); } };
      list.appendChild(li);
    }
  }
  $('#crash-clear').onclick = async () => {
    if (!await ask(t('Se borrarán todos los informes guardados en este ordenador. ¿Continuar?'), { danger: true, ok: t('Borrar') })) return;
    try { await window.api.crashClear(); render(); } catch (e) { toastError(e); }
  };
  $('#s-crash').onchange = () => savePrefs({ crashReports: $('#s-crash').checked });
  window.syncCrashUi = () => { $('#s-crash').checked = prefs().crashReports === true; };
  window.syncCrashUi();
  render();
  // Aviso discreto cuando ocurre un fallo nuevo (solo con el interruptor activado)
  window.api.onCrashNew((r) => {
    render();
    if (prefs().crashReports !== true) return;
    toast(t('Ecos ha tenido un fallo'), true, { duration: 14000, action: { label: t('Enviar informe'), onClick: async () => { try { await window.api.crashSend(r.id); render(); } catch (e) { toastError(e); } } } });
  });
})();
