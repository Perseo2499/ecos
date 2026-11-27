// Ecos · Entorno de tu web (WordPress, PHP, límites, plugins) y avisos de incompatibilidad. Lógica pura: sirve en la app y en las pruebas.
// parseEnv(status, root, headers) → entorno; analyzeEnv(env, opts) → avisos [{id, level, title, text, p}] (texto en español; `p` son los datos para {n}).
(function (root) {
  const MIN_WP = '6.2', MIN_PHP = '7.4', LOW_UPLOAD = 8 * 1048576;
  const verParts = (v) => String(v || '').replace(/[^\d.]/g, '').split('.').filter(Boolean).map(Number);
  const versionLess = (a, b) => {
    const x = verParts(a), y = verParts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0; }
    return false;
  };
  // «64M», «2G», «512K», «-1» (sin límite), «67108864» → bytes (Infinity si no hay límite; 0 si no se entiende)
  function parseSize(v) {
    if (typeof v === 'number') return v < 0 ? Infinity : Math.max(0, v);
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*([kmgt]?)b?\s*$/i.exec(String(v ?? ''));
    if (!m) return 0;
    const n = Number(m[1]); if (n < 0) return Infinity;
    return Math.round(n * ({ '': 1, k: 1024, m: 1048576, g: 1073741824, t: 1099511627776 }[m[2].toLowerCase()]));
  }
  function fmtSize(b) {
    if (b === Infinity) return '∞';
    if (b >= 1073741824) return +(b / 1073741824).toFixed(1) + ' GB';
    if (b >= 1048576) return Math.round(b / 1048576) + ' MB';
    if (b >= 1024) return Math.round(b / 1024) + ' KB';
    return b + ' B';
  }
  // Plugins de seguridad que a veces bloquean /wp-json (por su carpeta o por su espacio de nombres REST)
  const SECURITY = [
    { re: /^wordfence(\/|$)/, name: 'Wordfence' },
    { re: /^better-wp-security$|^ithemes-security|^solid-security/, name: 'iThemes / Solid Security' },
    { re: /^all-in-one-wp-security|^aiowps/, name: 'All In One WP Security' },
    { re: /^sucuri/, name: 'Sucuri Security' },
    { re: /^disable-json-api$|^disable-wp-rest-api|^wp-rest-api-controller$|^disable-rest-api/, name: 'un plugin que desactiva la API REST' },
    { re: /^shield-security|^wp-simple-firewall|^icwp-wpsf/, name: 'Shield Security' },
    { re: /^wp-cerber|^cerber/, name: 'WP Cerber' },
    { re: /^bulletproof-security|^bps/, name: 'BulletProof Security' },
  ];
  // Plugins de caché y si Ecos sabe vaciarlos (los mismos que detecta el complemento)
  const CACHES = [
    { re: /^litespeed-cache$/, name: 'LiteSpeed Cache', purge: true }, { re: /^wp-rocket$/, name: 'WP Rocket', purge: true },
    { re: /^w3-total-cache$/, name: 'W3 Total Cache', purge: true }, { re: /^wp-super-cache$/, name: 'WP Super Cache', purge: true },
    { re: /^wp-fastest-cache$/, name: 'WP Fastest Cache', purge: true }, { re: /^sg-cachepress$|^sg-optimizer$/, name: 'SiteGround Optimizer', purge: true },
    { re: /^breeze$/, name: 'Breeze', purge: true }, { re: /^wp-optimize$/, name: 'WP-Optimize', purge: true },
    { re: /^cache-enabler$/, name: 'Cache Enabler', purge: false }, { re: /^hyper-cache$/, name: 'Hyper Cache', purge: false },
    { re: /^comet-cache$/, name: 'Comet Cache', purge: false }, { re: /^swift-performance(-lite)?$/, name: 'Swift Performance', purge: false },
    { re: /^nitropack$/, name: 'NitroPack', purge: false }, { re: /^powered-cache$/, name: 'Powered Cache', purge: false },
    { re: /^flying-press$/, name: 'FlyingPress', purge: false }, { re: /^hummingbird-performance$/, name: 'Hummingbird', purge: false },
  ];
  const slugOf = (p) => String(p?.slug || p?.name || '').toLowerCase();

  // status = respuesta de /ecos/v1/status (o null sin complemento); rootJson = respuesta de /wp-json/ (o null); headers = cabeceras de la web
  function parseEnv(status, rootJson, headers, at = Date.now()) {
    const st = status && status.plugin === 'ecos' ? status : null;
    const e = st?.env || {};
    const hdr = headers || {};
    const phpHdr = /php\/(\d+\.\d+(?:\.\d+)?)/i.exec(String(hdr['x-powered-by'] || ''));
    const lim = e.limits || {};
    const namespaces = Array.isArray(rootJson?.namespaces) ? rootJson.namespaces.map(String) : [];
    const upload = parseSize(lim.upload_max_filesize), post = parseSize(lim.post_max_size);
    const wpMax = Number(lim.wp_max_upload) || 0;
    return {
      at,
      source: st ? 'plugin' : (rootJson ? 'rest' : 'none'),
      site: { name: String(rootJson?.name || ''), url: String(rootJson?.url || ''), description: String(rootJson?.description || '') },
      wp: String(e.wp_version || ''), php: String(e.php_version || (phpHdr && phpHdr[1]) || ''),
      theme: e.theme ? { name: String(e.theme.name || ''), version: String(e.theme.version || '') } : null,
      plugins: Array.isArray(e.plugins) ? e.plugins.map((p) => ({ slug: String(p.slug || ''), name: String(p.name || ''), version: String(p.version || '') })) : null,
      limits: st && e.limits ? {
        upload_max_filesize: String(lim.upload_max_filesize || ''), post_max_size: String(lim.post_max_size || ''), memory_limit: String(lim.memory_limit || ''),
        // lo máximo que cabe en una subida: lo que calcula WordPress o, si no, el menor de los dos límites
        maxUpload: wpMax || Math.min(upload || Infinity, post || Infinity),
      } : null,
      rest: st && e.rest ? { enabled: e.rest.enabled !== false, appPasswords: e.rest.app_passwords !== false } : null,
      multisite: !!e.multisite,
      namespaces,
      helper: { installed: !!st, version: st ? String(st.version || '') : '' },
      caches: st && Array.isArray(st.caches) ? st.caches.map(String) : [],
    };
  }

  function securityFound(env) {
    const found = new Set();
    for (const p of env.plugins || []) for (const s of SECURITY) if (s.re.test(slugOf(p))) found.add(s.name);
    for (const ns of env.namespaces || []) for (const s of SECURITY) if (s.re.test(String(ns).toLowerCase())) found.add(s.name);
    return [...found];
  }
  function cachesWithoutPurge(env) {
    const out = [];
    for (const p of env.plugins || []) for (const c of CACHES) if (c.re.test(slugOf(p)) && !c.purge && !(env.caches || []).includes(c.name)) out.push(c.name);
    return out;
  }
  // ¿Cabe un archivo de `bytes` en lo que admite la web? → { ok, limit, text }
  function uploadCheck(env, bytes) {
    const limit = env?.limits?.maxUpload;
    if (!limit || limit === Infinity || !(bytes > 0)) return { ok: true, limit: limit || 0, text: '' };
    if (bytes <= limit) return { ok: true, limit, text: '' };
    return { ok: false, limit, text: `Este archivo pesa ${fmtSize(bytes)} y tu web solo admite subidas de hasta ${fmtSize(limit)}. Pide a tu hosting que suba «upload_max_filesize» y «post_max_size» (o reduce el archivo).` };
  }

  // Avisos: level 'error' (algo no va a funcionar), 'warn' (puede dar problemas) o 'info'
  function analyzeEnv(env, { bundled = '', uploadBytes = 0 } = {}) {
    const w = [];
    if (!env) return w;
    if (env.wp && versionLess(env.wp, MIN_WP)) w.push({ id: 'wp-old', level: 'error', title: 'WordPress está desactualizado', text: 'Tu web usa WordPress {n} y Ecos necesita al menos la {min}. Algunos bloques y funciones pueden no verse o no guardarse. Actualiza WordPress desde Escritorio → Actualizaciones.', p: { n: env.wp, min: MIN_WP } });
    if (env.php && versionLess(env.php, MIN_PHP)) w.push({ id: 'php-old', level: 'error', title: 'PHP es demasiado antiguo', text: 'Tu web usa PHP {n} y el complemento de Ecos necesita PHP {min} o superior. Pide a tu hosting que cambie la versión de PHP (suele estar en el panel de control).', p: { n: env.php, min: MIN_PHP } });
    if (env.rest && env.rest.enabled === false) w.push({ id: 'rest-off', level: 'error', title: 'La API REST está desactivada', text: 'Ecos habla con WordPress por su API REST. Reactívala (algún plugin o ajuste de seguridad la ha desactivado).' });
    if (env.rest && env.rest.appPasswords === false) w.push({ id: 'apppw-off', level: 'error', title: 'Las contraseñas de aplicación están desactivadas', text: 'Sin ellas Ecos no puede entrar en tu web. Suele pasar si la web no usa HTTPS o si un plugin de seguridad las desactiva.' });
    const sec = securityFound(env);
    if (sec.length) w.push({ id: 'security', level: 'warn', title: 'Plugin de seguridad que puede bloquear a Ecos', text: 'Tienes {n}. Algunos plugins de seguridad bloquean la API REST o las contraseñas de aplicación. Si Ecos no puede conectar, permite el acceso a /wp-json en su configuración.', p: { n: sec.join(', ') } });
    const nocache = cachesWithoutPurge(env);
    if (nocache.length) w.push({ id: 'cache-nopurge', level: 'warn', title: 'Caché que Ecos no sabe vaciar', text: 'Tu web usa {n}. Tras enviar una entrada puede seguir viéndose la versión antigua hasta que vacíes la caché a mano.', p: { n: nocache.join(', ') } });
    if (env.helper?.installed && bundled && versionLess(env.helper.version, bundled)) w.push({ id: 'helper-old', level: 'warn', title: 'Complemento de Ecos desactualizado', text: 'Tienes la v{n} y esta versión de Ecos trae la v{b}. Instala el .zip de nuevo en Conexiones → Complemento de Ecos.', p: { n: env.helper.version, b: bundled } });
    if (env.source === 'rest' && !env.helper?.installed) w.push({ id: 'no-helper', level: 'info', title: 'Sin el complemento solo se ve lo básico', text: 'Instala el complemento de Ecos (Conexiones) para ver versiones, límites y plugins de tu web, y para vaciar la caché automáticamente.' });
    const lim = env.limits?.maxUpload;
    if (lim && lim !== Infinity) {
      if (uploadBytes > lim) w.push({ id: 'upload-small', level: 'error', title: 'El archivo es mayor que el límite de subida', text: uploadCheck(env, uploadBytes).text });
      else if (lim < LOW_UPLOAD) w.push({ id: 'upload-low', level: 'warn', title: 'Límite de subida bajo', text: 'Tu web solo admite subidas de hasta {n}. Las fotos grandes y los vídeos no se subirán. Pide a tu hosting que suba «upload_max_filesize» y «post_max_size».', p: { n: fmtSize(lim) } });
    }
    const mem = parseSize(env.limits?.memory_limit);
    if (mem && mem !== Infinity && mem < 128 * 1048576) w.push({ id: 'memory-low', level: 'info', title: 'Poca memoria para PHP', text: 'El límite de memoria es {n}. Con entradas muy grandes la web podría fallar al guardar; pide al hosting que lo suba a 256 MB.', p: { n: fmtSize(mem) } });
    return w;
  }
  const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (m, k) => (p && p[k] != null ? p[k] : m));

  const api = { parseEnv, analyzeEnv, uploadCheck, parseSize, fmtSize, versionLess, securityFound, cachesWithoutPurge, fill, SECURITY, CACHES, MIN_WP, MIN_PHP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WebEnv = api;
})(typeof window !== 'undefined' ? window : globalThis);
