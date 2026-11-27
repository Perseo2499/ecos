// Ecos · Diagnóstico de conexión. Lógica pura (sirve en la app y en las pruebas): clasifica errores de red en causa + consejo,
// analiza certificados, reloj y respuestas de WordPress, y ejecuta los pasos en orden con las comprobaciones que le pasen (`deps`).
// Cada paso: { id, title, status: 'running'|'ok'|'warn'|'fail'|'skip', detail, advice, p, raw, ms }. Los textos van en español;
// `p` son los datos para los {huecos} (la interfaz los traduce con t(texto, p)).
(function (root) {
  const fill = (s, p) => String(s ?? '').replace(/\{(\w+)\}/g, (m, k) => (p && p[k] != null ? p[k] : m));
  const codeOf = (e) => String((e && (e.code || (e.cause && e.cause.code))) || '');
  const textOf = (e) => (e == null ? '' : typeof e === 'string' ? e : String(e.message || e)) + ' ' + String((e && e.cause && (e.cause.message || '')) || '');

  // Error de red → { kind, cause, advice }
  function classifyError(e) {
    const code = codeOf(e), msg = textOf(e), all = code + ' ' + msg;
    const r = (kind, cause, advice) => ({ kind, cause, advice });
    if (/CERT_HAS_EXPIRED|certificate has expired|CERT_EXPIRED/i.test(all)) return r('cert-expired', 'El certificado de seguridad de la web ha caducado.', 'Avisa a quien gestiona la web o a tu hosting: hay que renovar el certificado (HTTPS).');
    if (/ERR_TLS_CERT_ALTNAME_INVALID|altnames|hostname\/IP does not match|CERT_COMMON_NAME_INVALID/i.test(all)) return r('cert-name', 'El certificado de seguridad no corresponde a esta dirección.', 'Revisa que la dirección esté bien escrita (con o sin «www») o pide a tu hosting que lo corrija.');
    if (/SELF_SIGNED|self[- ]signed|UNABLE_TO_VERIFY_LEAF|unable to verify the first certificate|UNABLE_TO_GET_ISSUER|CERT_UNTRUSTED/i.test(all)) return r('cert-untrusted', 'El certificado de seguridad de la web no es de confianza.', 'Si la web es tuya, instala un certificado válido (p. ej. Let\'s Encrypt). Si no, un antivirus o una red de empresa puede estar interceptando la conexión.');
    if (/CERT|SSL|TLS|ERR_SSL|EPROTO|handshake/i.test(all)) return r('cert', 'Ha fallado la conexión segura (HTTPS) con la web.', 'Comprueba la fecha y hora de tu ordenador y que ningún antivirus o VPN filtre el tráfico seguro.');
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|ERR_NAME_NOT_RESOLVED/i.test(all)) return r('dns', 'No se encuentra esa dirección en internet (DNS).', 'Revisa que la dirección esté bien escrita. Si es correcta, puede que el dominio haya caducado o que tu DNS falle: prueba otra red.');
    if (/ECONNREFUSED/i.test(all)) return r('refused', 'El servidor rechaza la conexión.', 'La web puede estar caída o el puerto bloqueado. Espera unos minutos y consulta con tu hosting.');
    if (/ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|timed? ?out|TimeoutError|AbortError|aborted/i.test(all)) return r('timeout', 'El servidor tarda demasiado en responder.', 'Prueba más tarde. Si pasa siempre, la web va muy lenta o un cortafuegos bloquea la conexión.');
    if (/ECONNRESET|socket hang up|EPIPE|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|other side closed|UND_ERR_SOCKET/i.test(all)) return r('reset', 'La conexión se corta nada más establecerse.', '¿Tienes una VPN o un antivirus que filtra el tráfico? Desactívalos un momento y vuelve a probar; también puede ser un bloqueo del servidor.');
    if (/EHOSTUNREACH|ENETUNREACH|ENETDOWN|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|network is unreachable/i.test(all)) return r('offline', 'No hay conexión de red.', 'Comprueba que tu ordenador está conectado a internet (Wi-Fi o cable).');
    if (/PROXY|ERR_TUNNEL|ERR_PROXY/i.test(all)) return r('proxy', 'Ha fallado el proxy de tu red.', 'Revisa la configuración de proxy de tu sistema o prueba en otra red.');
    if (/\b401\b|Unauthorized/i.test(all)) return r('auth', 'WordPress no acepta el usuario o la contraseña de aplicación.', 'Crea una contraseña de aplicación nueva en wp-admin → Usuarios → Perfil y cópiala en Conexiones.');
    if (/\b403\b|Forbidden/i.test(all)) return r('forbidden', 'La web ha denegado el acceso.', 'Puede ser un permiso del usuario o un cortafuegos / plugin de seguridad que bloquea a Ecos.');
    if (/\b404\b|Not Found|rest_no_route/i.test(all)) return r('notfound', 'La web no tiene esa dirección o la API de WordPress está desactivada.', 'Revisa la dirección y, en wp-admin → Ajustes → Enlaces permanentes, pulsa «Guardar cambios».');
    if (/\b(500|502|503|504)\b|Internal Server Error|Bad Gateway|Service Unavailable|Gateway/i.test(all)) return r('server', 'La web tiene un problema interno.', 'Suele ser momentáneo. Espera unos minutos; si sigue, avisa a tu hosting.');
    return r('unknown', 'Error de conexión desconocido.', 'Copia el informe y envíalo si el problema continúa.');
  }
  // ¿Parece un fallo de conexión (para ofrecer «Diagnosticar»)?
  const isConnectionProblem = (e) => ['dns', 'refused', 'timeout', 'reset', 'offline', 'proxy', 'cert', 'cert-expired', 'cert-name', 'cert-untrusted'].includes(classifyError(e).kind)
    || /Failed to fetch|fetch failed|NetworkError|No se puede conectar|net::ERR_/i.test(textOf(e));

  // Certificado (de tlsInfo) → { status, detail, advice, p }
  function certMatchesHost(san, host) {
    host = String(host || '').toLowerCase();
    const names = String(san || '').split(/,\s*/).map((x) => x.replace(/^(DNS|IP Address):/i, '').trim().toLowerCase()).filter(Boolean);
    return names.some((n) => n === host || (n.startsWith('*.') && host.split('.').slice(1).join('.') === n.slice(2) && host.split('.').length === n.split('.').length));
  }
  function analyzeTls(info, host, now = Date.now()) {
    if (!info) return { status: 'fail', detail: 'No se ha podido leer el certificado.', advice: 'Comprueba que la web responde por HTTPS.' };
    const days = Math.floor((new Date(info.validTo).getTime() - now) / 864e5);
    if (!(days === days)) return { status: 'warn', detail: 'No se ha podido leer la fecha del certificado.' };
    if (days < 0) return { status: 'fail', detail: 'El certificado caducó hace {n} días.', p: { n: -days }, advice: 'Avisa a quien gestiona la web o a tu hosting: hay que renovar el certificado (HTTPS).' };
    if (info.san && !certMatchesHost(info.san, host)) return { status: 'fail', detail: 'El certificado no es de {host}.', p: { host }, advice: 'Revisa que la dirección esté bien escrita (con o sin «www») o pide a tu hosting que lo corrija.' };
    if (info.authorized === false && !/expired/i.test(info.authorizationError || '')) return { status: 'warn', detail: 'El certificado no es de confianza ({err}).', p: { err: info.authorizationError || '?' }, advice: 'Si la web es tuya, instala un certificado válido. Si no, un antivirus o una red de empresa puede estar interceptando la conexión.' };
    if (days < 14) return { status: 'warn', detail: 'El certificado caduca en {n} días.', p: { n: days }, advice: 'Avisa a quien gestiona la web para que lo renueve antes de que caduque.' };
    return { status: 'ok', detail: 'Certificado válido, caduca en {n} días.', p: { n: days } };
  }
  // Cabecera Date de la web frente al reloj del ordenador
  function analyzeClock(dateHeader, now = Date.now()) {
    const t = Date.parse(dateHeader || '');
    if (!t) return { status: 'skip', detail: 'La web no ha indicado la hora; no se puede comparar.' };
    const secs = Math.round((now - t) / 1000), abs = Math.abs(secs);
    const fmt = abs >= 3600 ? Math.round(abs / 3600) + ' h' : abs >= 60 ? Math.round(abs / 60) + ' min' : abs + ' s';
    if (abs > 30 * 60) return { status: 'fail', detail: 'Tu reloj va {d} {dir}.', p: { d: fmt, dir: secs > 0 ? 'adelantado' : 'atrasado' }, advice: 'Con el reloj desajustado fallan los certificados y las claves. Activa «Establecer la hora automáticamente» en la configuración de fecha y hora de tu sistema.' };
    if (abs > 120) return { status: 'warn', detail: 'Tu reloj difiere {d} de la hora de la web.', p: { d: fmt }, advice: 'Sincroniza la hora de tu ordenador (hora automática) para evitar fallos con certificados y claves.' };
    return { status: 'ok', detail: 'La hora de tu ordenador coincide con la de la web.' };
  }
  // Respuesta de /wp-json bloqueada: ¿por qué plugin o servicio?
  function detectBlocker(status, headers, body) {
    const h = headers || {}, b = String(body || '').slice(0, 6000);
    const sig = [[/wordfence|wfwaf/i, 'Wordfence'], [/ithemes|solid security/i, 'iThemes / Solid Security'], [/all in one wp security|aiowps/i, 'All In One WP Security'], [/sucuri/i, 'Sucuri'], [/cloudflare|cf-ray/i, 'Cloudflare'], [/mod_security|modsecurity|not acceptable/i, 'ModSecurity (cortafuegos del servidor)'], [/imunify360/i, 'Imunify360'], [/siteground/i, 'SiteGround']];
    const hs = Object.entries(h).map(([k, v]) => k + ':' + v).join(' ');
    for (const [re, name] of sig) if (re.test(b) || re.test(hs)) return name;
    return '';
  }
  const isJson = (headers, body) => /json/i.test(String((headers || {})['content-type'] || '')) || /^\s*[{[]/.test(String(body || ''));
  const host = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

  const STEPS = [
    ['internet', 'Internet en general'], ['dns', 'DNS de tu web'], ['tls', 'Certificado de seguridad (HTTPS)'], ['web', 'La web responde'], ['wpjson', 'La API de WordPress (/wp-json)'],
    ['auth', 'Usuario y contraseña de aplicación'], ['helper', 'Complemento de Ecos'], ['meta', 'Meta (Facebook e Instagram)'], ['gphotos', 'Google Fotos'], ['ai', 'Inteligencia artificial'],
    ['proxy', 'Proxy o VPN'], ['clock', 'Reloj del ordenador'],
  ];
  const TITLE = Object.fromEntries(STEPS);

  // ctx = { url, hasAuth, bundled, metaConnected, metaTokenExpires, gpConnected, aiConfigured, aiName, testAi }
  // deps = { dns(host), tcp(host, port), tls(host), http(url, {auth}) → {status, headers, text, ms}, proxy(url), meta(), gphotos(), ai(), now() }
  async function runDiagnostics(ctx, deps, onStep = () => {}) {
    const out = [], state = { resetAfterConnect: false, skipWeb: false, skipSite: false };
    const now = () => (deps.now ? deps.now() : Date.now());
    const emit = (s) => { onStep(s); return s; };
    const run = async (id, fn) => {
      onStep({ id, title: TITLE[id], status: 'running' });
      const t0 = Date.now();
      let s;
      try { s = await fn(); } catch (e) { const c = classifyError(e); s = { status: 'fail', detail: c.cause, advice: c.advice, raw: String(e && e.message || e).slice(0, 300) }; }
      const step = { id, title: TITLE[id], status: 'ok', ...s, ms: Date.now() - t0 };
      out.push(step); emit(step);
    };
    const skip = (why) => ({ status: 'skip', detail: why });
    const url = ctx.url ? (/^https?:\/\//i.test(ctx.url) ? ctx.url : 'https://' + ctx.url) : '';
    const hostname = host(url), https = /^https:/i.test(url);
    let siteReachable = false, rootJson = null, dateHeader = '';

    await run('internet', async () => {
      const targets = ['www.google.com', 'www.cloudflare.com'];
      let lastErr = null;
      for (const h of targets) {
        try { await deps.dns(h); await deps.tcp(h, 443); return { status: 'ok', detail: 'Hay conexión a internet.' }; } catch (e) { lastErr = e; }
      }
      state.skipWeb = true;
      const c = classifyError(lastErr);
      return { status: 'fail', detail: c.kind === 'dns' || c.kind === 'unknown' ? 'No se puede salir a internet (ni resolver nombres ni conectar).' : c.cause, advice: 'Comprueba el Wi-Fi o el cable, reinicia el router y vuelve a probar. Si usas VPN o proxy, desactívalos un momento.', raw: String(lastErr && lastErr.message || '').slice(0, 200) };
    });

    await run('dns', async () => {
      if (!hostname) return { status: 'fail', detail: 'No hay una dirección de web configurada.', advice: 'Escribe la dirección de tu web en Conexiones → WordPress.' };
      if (state.skipWeb) return skip('Hace falta tener internet para comprobarlo.');
      try { const a = await deps.dns(hostname); return { status: 'ok', detail: '{host} se encuentra en internet.', p: { host: hostname }, ...(a && a[0] ? {} : {}) }; } catch (e) {
        state.skipSite = true; const c = classifyError(e);
        return { status: 'fail', detail: 'No se encuentra «{host}» en internet.', p: { host: hostname }, advice: c.advice, raw: String(e && e.message || '').slice(0, 200) };
      }
    });

    await run('tls', async () => {
      if (state.skipWeb || state.skipSite || !hostname) return skip('Pendiente de los pasos anteriores.');
      if (!https) return { status: 'warn', detail: 'Tu web usa http:// (sin cifrar).', advice: 'Pásala a https:// : sin HTTPS WordPress suele desactivar las contraseñas de aplicación.' };
      try { const a = analyzeTls(await deps.tls(hostname), hostname, now()); return a; } catch (e) {
        const c = classifyError(e); return { status: 'fail', detail: c.cause, advice: c.advice, raw: String(e && e.message || '').slice(0, 200) };
      }
    });

    await run('web', async () => {
      if (state.skipWeb || state.skipSite || !hostname) return skip('Pendiente de los pasos anteriores.');
      let r;
      try { r = await deps.http(url + (url.endsWith('/') ? '' : '/'), {}); } catch (e) {
        const c = classifyError(e);
        if (c.kind === 'reset') state.resetAfterConnect = true;
        return { status: 'fail', detail: c.cause, advice: c.advice, raw: String(e && e.message || '').slice(0, 200) };
      }
      dateHeader = (r.headers || {}).date || '';
      siteReachable = true;
      state.headers = r.headers || {};
      const secs = (r.ms / 1000).toFixed(1);
      if (r.status >= 500) return { status: 'fail', detail: 'La web responde con un error del servidor ({s}).', p: { s: r.status }, advice: 'Suele ser momentáneo. Espera unos minutos; si sigue, avisa a tu hosting.' };
      if (r.status >= 400 && r.status !== 401 && r.status !== 403) return { status: 'warn', detail: 'La portada responde con el código {s}.', p: { s: r.status }, advice: 'Revisa la dirección de la web.' };
      if (r.ms > 5000) return { status: 'warn', detail: 'La web responde, pero muy lenta ({n} s).', p: { n: secs }, advice: 'Una web lenta puede hacer fallar subidas largas. Consulta con tu hosting o prueba más tarde.' };
      return { status: 'ok', detail: 'La web responde en {n} s.', p: { n: secs } };
    });

    await run('wpjson', async () => {
      if (!siteReachable) return skip('Pendiente de que la web responda.');
      const base = url.replace(/\/+$/, '');
      const r = await deps.http(base + '/wp-json/', {});
      if (r.status === 200 && isJson(r.headers, r.text)) {
        try { rootJson = JSON.parse(r.text); } catch { rootJson = null; }
        return { status: 'ok', detail: 'La API de WordPress responde.' };
      }
      const blocker = detectBlocker(r.status, r.headers, r.text);
      if (r.status === 403 || r.status === 401 || r.status === 406 || r.status === 429) {
        return { status: 'fail', detail: blocker ? 'La API está bloqueada por {b}.' : 'La API de WordPress está bloqueada ({s}).', p: { b: blocker, s: r.status }, advice: 'Un plugin de seguridad o el cortafuegos del hosting bloquea /wp-json. Permite el acceso a /wp-json (y a tu IP) en su configuración.' };
      }
      if (r.status === 404 || (r.status === 200 && !isJson(r.headers, r.text))) {
        // ¿funciona con enlaces «feos»?
        try {
          const alt = await deps.http(base + '/?rest_route=/', {});
          if (alt.status === 200 && isJson(alt.headers, alt.text)) { try { rootJson = JSON.parse(alt.text); } catch { /* nada */ } return { status: 'warn', detail: 'La API solo responde con la dirección alternativa (?rest_route).', advice: 'En wp-admin → Ajustes → Enlaces permanentes pulsa «Guardar cambios» (y no uses «Simple» si puedes evitarlo).' }; }
        } catch { /* nada */ }
        return { status: 'fail', detail: 'La web no ofrece la API de WordPress en /wp-json.', advice: 'Puede estar desactivada por un plugin («Disable REST API») o no ser un WordPress. En wp-admin → Ajustes → Enlaces permanentes pulsa «Guardar cambios».' };
      }
      return { status: 'fail', detail: 'La API de WordPress responde con el código {s}.', p: { s: r.status }, advice: 'Espera unos minutos; si sigue, consulta con tu hosting.' };
    });

    await run('auth', async () => {
      if (!siteReachable) return skip('Pendiente de que la web responda.');
      if (!ctx.hasAuth) return skip('Aún no has conectado tu WordPress en Conexiones.');
      const r = await deps.http(url.replace(/\/+$/, '') + '/wp-json/wp/v2/users/me?context=edit', { auth: true });
      if (r.status === 200) {
        let me = null; try { me = JSON.parse(r.text); } catch { /* nada */ }
        const can = me && me.capabilities ? (me.capabilities.edit_posts || me.capabilities.publish_posts) : true;
        if (!can) return { status: 'warn', detail: 'La contraseña es válida, pero el usuario no puede editar entradas.', advice: 'Usa un usuario con rol Editor o Administrador.' };
        const roles = me && Array.isArray(me.roles) && me.roles.length ? me.roles.join(', ') : '';
        return { status: 'ok', detail: roles ? 'Contraseña válida (rol: {r}).' : 'Contraseña válida.', p: { r: roles } };
      }
      if (r.status === 401) return { status: 'fail', detail: 'WordPress no acepta el usuario o la contraseña de aplicación.', advice: 'Crea una contraseña de aplicación nueva en wp-admin → Usuarios → Perfil y cópiala en Conexiones. Usa la de aplicación, no tu contraseña normal.' };
      if (r.status === 403) return { status: 'fail', detail: 'El usuario no tiene permiso o algo bloquea la petición.', advice: 'Usa un usuario Editor o Administrador. Si ya lo es, un plugin de seguridad puede estar bloqueando las contraseñas de aplicación.' };
      return { status: 'fail', detail: 'WordPress responde con el código {s}.', p: { s: r.status }, advice: 'Vuelve a probar en unos minutos.' };
    });

    await run('helper', async () => {
      if (!siteReachable || !ctx.hasAuth) return skip(ctx.hasAuth ? 'Pendiente de que la web responda.' : 'Aún no has conectado tu WordPress en Conexiones.');
      let r; try { r = await deps.http(url.replace(/\/+$/, '') + '/wp-json/ecos/v1/status', { auth: true }); } catch (e) { const c = classifyError(e); return { status: 'warn', detail: c.cause, advice: c.advice }; }
      let st = null; try { st = JSON.parse(r.text); } catch { /* nada */ }
      if (r.status !== 200 || !st || st.plugin !== 'ecos') return { status: 'warn', detail: 'El complemento de Ecos no está instalado (es opcional).', advice: 'Instálalo desde Conexiones → Complemento de Ecos para vaciar la caché y ver datos de tu web.' };
      const WE = root.WebEnv || (typeof require === 'function' ? require('./webenv') : null);
      if (ctx.bundled && WE && WE.versionLess(st.version, ctx.bundled)) return { status: 'warn', detail: 'Instalado v{v}; esta versión de Ecos trae la v{b}.', p: { v: st.version, b: ctx.bundled }, advice: 'Instala el .zip de nuevo en Conexiones para actualizarlo.' };
      return { status: 'ok', detail: 'Instalado v{v}, al día.', p: { v: st.version } };
    });

    await run('meta', async () => {
      if (!ctx.metaConnected) return skip('Meta no está conectado.');
      if (ctx.metaTokenExpires) {
        const days = Math.floor((new Date(ctx.metaTokenExpires).getTime() - now()) / 864e5);
        if (days < 0) return { status: 'fail', detail: 'La conexión con Meta caducó.', advice: 'Pulsa «Conectar» en Conexiones → Meta para renovarla.' };
        if (days <= 10) return { status: 'warn', detail: 'La conexión con Meta caduca en {n} días.', p: { n: days }, advice: 'Renuévala desde Conexiones → Meta antes de que caduque.' };
      }
      if (deps.meta) {
        try { await deps.meta(); } catch (e) { return { status: 'fail', detail: 'Meta no acepta la conexión guardada.', advice: 'Pulsa «Conectar» en Conexiones → Meta para volver a entrar.', raw: String(e && e.message || '').slice(0, 200) }; }
      }
      return { status: 'ok', detail: ctx.metaTokenExpires ? 'Conexión válida hasta el {d}.' : 'Conexión válida.', p: { d: String(ctx.metaTokenExpires || '').slice(0, 10) } };
    });

    await run('gphotos', async () => {
      if (!ctx.gpConnected) return skip('Google Fotos no está conectado.');
      if (deps.gphotos) { try { await deps.gphotos(); } catch (e) { return { status: 'fail', detail: 'Google no acepta la conexión guardada.', advice: 'Pulsa «Conectar con Google» en Conexiones. Si tu app está en modo «Prueba», el permiso caduca a los 7 días.', raw: String(e && e.message || '').slice(0, 200) }; } }
      return { status: 'ok', detail: 'Conectado.' };
    });

    await run('ai', async () => {
      if (!ctx.aiConfigured) return skip('No hay ningún proveedor de IA configurado.');
      if (ctx.testAi && deps.ai) {
        try { const r = await deps.ai(); return { status: 'ok', detail: 'La IA responde ({n}).', p: { n: r || ctx.aiName || '' } }; } catch (e) { return { status: 'fail', detail: 'La IA no responde.', advice: 'Revisa la clave y el modelo en Conexiones → Inteligencia artificial, o la conexión a internet.', raw: String(e && e.message || '').slice(0, 200) }; }
      }
      return { status: 'ok', detail: 'Configurada: {n}. (Sin prueba.)', p: { n: ctx.aiName || '' } };
    });

    await run('proxy', async () => {
      let via = 'DIRECT';
      try { via = (deps.proxy && await deps.proxy(url || 'https://www.google.com')) || 'DIRECT'; } catch { /* nada */ }
      const proxied = via && !/^DIRECT$/i.test(String(via).trim());
      if (state.resetAfterConnect) return { status: 'fail', detail: 'La conexión se corta justo después de conectar.', advice: '¿Tienes una VPN o un antivirus que filtra el tráfico? Desactívalos un momento (o añade Ecos a sus excepciones) y vuelve a probar.' };
      if (proxied) return { status: 'warn', detail: 'Tu sistema usa un proxy ({v}).', p: { v: String(via).replace(/^PROXY\s+/i, '') }, advice: 'Si hay fallos de conexión, prueba sin proxy o pide a quien administra tu red que permita tu web.' };
      return { status: 'ok', detail: 'Sin proxy: conexión directa.' };
    });

    await run('clock', async () => (dateHeader ? analyzeClock(dateHeader, now()) : skip('Sin la hora de la web no se puede comparar.')));

    return { steps: out, rootJson, headers: state.headers || {} };
  }

  const ICON = { ok: '✓', fail: '✗', warn: '!', skip: '–', running: '…' };
  // Quita de un texto lo que no debe salir en un informe: contraseñas, claves, cabeceras y la parte «?…» de las direcciones
  function scrub(s) {
    return String(s ?? '')
      .replace(/(authorization["']?\s*[:=]\s*["']?)(?:(?:basic|bearer|token)\s+)?[^\s"',;}]+/gi, '$1[oculto]')
      .replace(/\b[A-Za-z0-9]{4}(?: [A-Za-z0-9]{4}){5}\b/g, '[oculto]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|EAA[A-Za-z0-9]{30,}|ya29\.[A-Za-z0-9._-]{20,})/g, '[oculto]')
      .replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/g, '$1?…')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1');
  }
  // Informe en texto, sin secretos
  function formatReport(steps, info = {}) {
    const L = [];
    L.push('Informe de diagnóstico de Ecos');
    if (info.date) L.push('Fecha: ' + info.date);
    if (info.version) L.push('Ecos: ' + info.version);
    if (info.os) L.push('Sistema: ' + info.os);
    if (info.site) L.push('Web: ' + info.site);
    L.push('');
    for (const s of steps) {
      if (s.status === 'running') continue;
      L.push(`${ICON[s.status] || '?'} ${s.title}${s.ms != null && s.status !== 'skip' ? ` (${s.ms} ms)` : ''}`);
      if (s.detail) L.push('    ' + fill(s.detail, s.p));
      if (s.advice && s.status !== 'ok') L.push('    → ' + fill(s.advice, s.p));
      if (s.raw) L.push('    detalle: ' + s.raw);
    }
    const bad = steps.filter((s) => s.status === 'fail').length, warn = steps.filter((s) => s.status === 'warn').length;
    L.push('', `Resultado: ${bad} fallo(s), ${warn} aviso(s).`);
    return scrub(L.join('\n'));
  }
  // Resumen para la cabecera del diálogo
  function summarize(steps) {
    const bad = steps.filter((s) => s.status === 'fail').length, warn = steps.filter((s) => s.status === 'warn').length;
    return { bad, warn, level: bad ? 'fail' : warn ? 'warn' : 'ok' };
  }

  const api = { classifyError, isConnectionProblem, analyzeTls, analyzeClock, certMatchesHost, detectBlocker, runDiagnostics, formatReport, summarize, scrub, fill, STEPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Diagnose = api;
})(typeof window !== 'undefined' ? window : globalThis);
