// Ecos · Textos que dependen del idioma, arranque y acceso con contraseña.
// (Comparte el ámbito global con los demás archivos de renderer/app, que se cargan en orden desde index.html.)

// ---------------------------------------------------------------- textos que dependen del idioma
function refreshTexts() {
  window.I18N.apply(document);
  if (typeof clRefreshTexts === 'function') clRefreshTexts();
  renderStatus(); updateCount(); renderFeed(); renderAi(); renderManualCount();
  if ($('#bn-token')) checkTokenExpiry();
  if (CFG.startMode) renderMode(CFG.startMode);
  if (blog.loaded) loadBlog();
  window.api.updateStatus().then(renderUpdate).catch(() => {});
}

// ---------------------------------------------------------------- arranque
async function afterConfigLoaded() {
  exported = CFG.exported || {};
  $('#f-merge').checked = CFG.format?.mergeDuplicates !== false;
  fillConnections(); fillFormat(); renderTemplates(); renderAi(); renderStatus();
  renderDevCard();
  renderBeta();
  renderSecurity();
  if (CFG.startMode) renderMode(CFG.startMode);
  applyPrefs();
}
window.api.onToast((m) => toast(t(m)));

// ---------------------------------------------------------------- Acceso con contraseña y doble factor
async function lockGate() {
  let st;
  try { st = await window.api.lockState(); } catch { return; }
  if (!st.locked) { startAutoLock(st); return; }
  // aspecto de la pantalla de acceso con las preferencias (tema, idioma) sin abrir nada más
  CFG = { prefs: st.prefs || {} };
  window.I18N.setLang(prefs().lang); window.I18N.apply(document);
  document.documentElement.dataset.theme = prefs().vinyl || prefs().theme === 'dark' || (prefs().theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  document.documentElement.style.setProperty('--accent', prefs().accent || '#3c6e5f');
  window.Vinyl?.apply({ vinyl: !!prefs().vinyl, silk: prefs().silk !== false });
  $('#lock').classList.remove('hidden');
  document.body.classList.add('locked');
  $('#lock-pass').focus();
  await new Promise((resolve) => {
    let needCode = !!st.needCode;
    const showCode = () => { $('#lock-pass-row').classList.add('hidden'); $('#lock-code-row').classList.remove('hidden'); $('#lock-msg').textContent = t('Escribe el código de tu app de autenticación (o un código de recuperación).'); $('#lock-code').focus(); };
    if (needCode) showCode();
    // Windows Hello: botón y, al abrir, se pide directamente la huella/cara/PIN
    const done = async () => { $('#lock').classList.add('hidden'); document.body.classList.remove('locked'); $('#lock-pass').value = ''; $('#lock-code').value = ''; startAutoLock(await window.api.lockState()); resolve(); };
    const hello = async () => {
      $('#lock-err').textContent = ''; $('#lock-hello').disabled = true;
      try {
        const r = await window.api.lockHello();
        if (r?.needCode) { needCode = true; showCode(); return; }
        await done();
      } catch (err) { $('#lock-err').textContent = t(err.message); }
      finally { $('#lock-hello').disabled = false; }
    };
    if (st.hello && !needCode) { $('#lock-hello').classList.remove('hidden'); $('#lock-hello').onclick = hello; setTimeout(hello, 400); }
    $('#lock-form').onsubmit = async (e) => {
      e.preventDefault();
      $('#lock-err').textContent = '';
      $('#lock-go').disabled = true;
      try {
        const r = await window.api.lockUnlock(needCode ? { code: $('#lock-code').value } : { password: $('#lock-pass').value });
        if (r?.needCode) { needCode = true; showCode(); return; }
        await done();
      } catch (err) {
        $('#lock-err').textContent = t(err.message.replace(/\d+ s\.$/, '{s} s.'), { s: (err.message.match(/(\d+) s\.$/) || [])[1] });
        $('#lock-box')?.classList.add('shake');
        (needCode ? $('#lock-code') : $('#lock-pass')).select();
      } finally { $('#lock-go').disabled = false; }
    };
    $('#lock-forgot').onclick = async (e) => {
      e.preventDefault();
      if (!await ask(t('Si restableces el acceso se quitará la contraseña y se BORRARÁN las claves guardadas (Meta, WordPress e IA): tendrás que volver a conectarlas. Tus entradas, ajustes y plantillas se conservan. ¿Continuar?'), { danger: true, ok: t('Restablecer') })) return;
      await window.api.lockReset();
    };
  });
}
// Bloqueo automático tras un rato sin usar Ecos
let lastActive = Date.now(), autoTimer = null;
function startAutoLock(st) {
  clearInterval(autoTimer);
  if (!st?.enabled || !st.auto) return;
  ['mousemove', 'keydown', 'mousedown', 'wheel'].forEach((ev) => document.addEventListener(ev, () => (lastActive = Date.now()), { passive: true }));
  autoTimer = setInterval(() => { if (Date.now() - lastActive > st.auto * 60000) window.api.lockNow().catch(() => {}); }, 20000);
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l' && !document.body.classList.contains('locked')) {
    e.preventDefault();
    if (CFG.lock) window.api.lockNow(); else toast(t('Para bloquear Ecos, activa una contraseña en Ajustes → Seguridad.'));
  }
});

// Diálogo con campos (contraseñas, códigos)
function askFields(title, fields, { ok = t('Aceptar'), html = '' } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'dlg-scrim';
    d.innerHTML = `<form class="dlg dlg-form" autocomplete="off"><span class="ms fill dlg-ic">shield_lock</span><p class="dlg-msg"></p>${html}
      ${fields.map((f, i) => `<div class="field"><input data-i="${i}" type="${f.type || 'password'}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} placeholder="${escHtml(f.label)}" autocomplete="new-password"></div>`).join('')}
      <p class="lock-err"></p>
      <div class="dlg-actions"><button type="button" class="btn text" data-r="0">${t('Cancelar')}</button><button type="submit" class="btn filled" data-r="1">${escHtml(ok)}</button></div></form>`;
    $('.dlg-msg', d).textContent = title;
    const close = (v) => { d.remove(); resolve(v); };
    $('[data-r="0"]', d).onclick = () => close(null);
    $('form', d).onsubmit = async (e) => {
      e.preventDefault();
      const vals = $$('input[data-i]', d).map((x) => x.value);
      const err = fields.map((f, i) => f.check?.(vals[i], vals)).find(Boolean);
      if (err) { $('.lock-err', d).textContent = err; return; }
      close(vals);
    };
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
    document.body.appendChild(d);
    $('input[data-i]', d)?.focus();
  });
}

// Ajustes → Seguridad
function renderSecurity() {
  const L = CFG.lock;
  $('#sec-status').textContent = L ? t('Ecos pide contraseña al abrirse. Las claves de Meta, WordPress y la IA están cifradas con ella.')
    : t('Ecos se abre sin contraseña. Activa una para proteger las claves y el contenido si otras personas usan este ordenador.');
  const acts = $('#sec-pass-actions');
  acts.innerHTML = L
    ? `<button class="btn tonal" data-s="change"><span class="ms">password</span>${t('Cambiar contraseña')}</button><button class="btn text" data-s="lock"><span class="ms">lock</span>${t('Bloquear ahora')}</button><button class="btn text danger" data-s="off">${t('Quitar contraseña')}</button>`
    : `<button class="btn filled" data-s="on"><span class="ms">lock</span>${t('Activar contraseña')}</button>`;
  $('#sec-more').classList.toggle('hidden', !L);
  if (L) {
    $('#sec-auto').value = String(L.auto ?? 15);
    $('#sec-2fa-status').textContent = L.twoFactor ? t('Activado. Quedan {n} códigos de recuperación.', { n: L.recoveryLeft }) : t('Pide también un código de Google Authenticator u otra app de autenticación.');
    $('#sec-2fa-actions').innerHTML = L.twoFactor ? `<button class="btn text danger" data-s="2fa-off">${t('Desactivar')}</button>` : `<button class="btn tonal" data-s="2fa-on"><span class="ms">phonelink_lock</span>${t('Activar')}</button>`;
  }
  $$('#set-security [data-s]').forEach((b) => (b.onclick = () => busy(b, () => secAction(b.dataset.s))));
  // Windows Hello (solo en Windows con Hello configurado)
  if (L) window.api.helloStatus().then((h) => {
    $('#sec-hello').classList.toggle('hidden', !h.windows);
    $('#sec-hello-status').textContent = !h.supported ? t('Configura Windows Hello en Windows (Configuración → Cuentas → Opciones de inicio de sesión) para usarlo aquí.')
      : h.enabled ? t('Activado: Ecos se abre con tu huella, cara o PIN de Windows (la contraseña sigue valiendo).') : t('Entra con tu huella, cara o PIN de Windows en lugar de escribir la contraseña.');
    $('#sec-hello-actions').innerHTML = !h.supported ? '' : h.enabled ? `<button class="btn text danger" data-h="off">${t('Desactivar')}</button>` : `<button class="btn tonal" data-h="on"><span class="ms">fingerprint</span>${t('Activar')}</button>`;
    $$('#sec-hello [data-h]').forEach((b) => (b.onclick = () => busy(b, async () => {
      if (b.dataset.h === 'on') {
        const v = await askFields(t('Para activar Windows Hello, escribe tu contraseña de Ecos. Después Windows te pedirá la huella, la cara o el PIN.'), [{ label: t('Contraseña actual') }], { ok: t('Activar') });
        if (!v) return;
        CFG = await window.api.helloEnable({ current: v[0] }); toast(t('Windows Hello activado.'));
      } else { CFG = await window.api.helloDisable(); toast(t('Windows Hello desactivado.')); }
      renderSecurity();
    })));
  }).catch(() => {});
}
const min8 = (v) => (v.length < 8 ? t('La contraseña debe tener al menos 8 caracteres') : null);
const same = (v, all) => (v !== all[all.length - 2] ? t('Las contraseñas no coinciden') : null);
async function secAction(a) {
  if (a === 'on') {
    const v = await askFields(t('Elige una contraseña para Ecos (al menos 8 caracteres). Si la olvidas, tendrás que volver a conectar Meta, WordPress y la IA.'), [{ label: t('Contraseña nueva'), check: min8 }, { label: t('Repite la contraseña'), check: same }], { ok: t('Activar') });
    if (!v) return;
    CFG = await window.api.lockSet({ password: v[0] }); toast(t('Contraseña activada. Ecos la pedirá al abrirse.'));
  }
  if (a === 'change') {
    const v = await askFields(t('Cambiar la contraseña de Ecos'), [{ label: t('Contraseña actual') }, { label: t('Contraseña nueva'), check: min8 }, { label: t('Repite la contraseña'), check: same }], { ok: t('Cambiar') });
    if (!v) return;
    CFG = await window.api.lockSet({ current: v[0], password: v[1] }); toast(t('Contraseña cambiada.'));
  }
  if (a === 'off') {
    const v = await askFields(t('Para quitar la contraseña, escríbela. Las claves seguirán cifradas con Windows.'), [{ label: t('Contraseña actual') }], { ok: t('Quitar contraseña') });
    if (!v) return;
    CFG = await window.api.lockDisable({ current: v[0] }); toast(t('Contraseña quitada.'));
  }
  if (a === 'lock') return window.api.lockNow();
  if (a === '2fa-on') {
    const r = await window.api.totpBegin();
    const v = await askFields(t('Escanea el código con Google Authenticator (u otra app de autenticación) y escribe el código de 6 cifras que muestra.'),
      [{ label: t('Código de 6 cifras'), type: 'text', inputmode: 'numeric', check: (x) => (/^\d{6}$/.test(x.trim()) ? null : t('Escribe las 6 cifras')) }],
      { ok: t('Activar'), html: `<img class="qr" src="${r.qr}" alt=""><div class="hint">${t('¿No puedes escanearlo? Escribe esta clave en la app:')} <code>${escHtml(r.secret)}</code></div>` });
    if (!v) return;
    const res = await window.api.totpConfirm(v[0].trim());
    CFG = res.cfg;
    await askFields(t('Doble factor activado. Guarda estos códigos de recuperación en un lugar seguro: cada uno sirve una vez para entrar si pierdes el móvil.'), [],
      { ok: t('Ya los he guardado'), html: `<pre class="codes">${res.codes.join('\n')}</pre><button type="button" class="btn text" id="copy-codes"><span class="ms">content_copy</span>${t('Copiar')}</button>` });
  }
  if (a === '2fa-off') {
    const v = await askFields(t('Para desactivar el doble factor, escribe tu contraseña.'), [{ label: t('Contraseña actual') }], { ok: t('Desactivar') });
    if (!v) return;
    CFG = await window.api.totpDisable({ current: v[0] }); toast(t('Doble factor desactivado.'));
  }
  renderSecurity();
}
document.addEventListener('click', (e) => { if (e.target.closest('#copy-codes')) { navigator.clipboard.writeText($('.codes').textContent); toast(t('Copiado')); } });
$('#sec-auto').onchange = async () => { CFG = await window.api.lockAuto(Number($('#sec-auto').value)); startAutoLock(await window.api.lockState()); toast(t('Guardado')); };

window.api.onConfigChanged((c) => { CFG = { ...CFG, ...c }; renderStatus(); });

(async () => {
  await lockGate(); // con contraseña: la pantalla de acceso va antes que nada
  CFG = await window.api.getConfig();
  window.I18N.setLang(prefs().lang);
  window.I18N.apply(document);
  await afterConfigLoaded();
  updateCount(); renderFeed(); renderManualCount();
  window.api.updateStatus().then(renderUpdate).catch(() => {});
  window.api.appInfo().then((i) => ($('#about-info').textContent = `${t('Versión')} ${i.version || "–"} · Electron ${i.electron || "–"} · ${i.platform || "–"}`)).catch(() => {});
  initChangelogUi().then(() => maybeShowWhatsNew()).catch(() => {});
  Home.show(); // Inicio es lo primero que se ve (se pinta enseguida y se rellena al llegar los datos)
  if (CFG.wpConnected) { loadCategories(); refreshExported(true); }
  checkTokenExpiry();
  if (typeof checkEmergency === "function") checkEmergency(); // aviso si la última copia de emergencia es antigua
  if (CFG.metaConnected) {
    try { renderPages(await window.api.metaAccounts()); checkNewSocial(); } catch (e) { toastError(e); }
  }
  if (!CFG.wizardDone) openWizard();
  showRecoverBanner();
})();
