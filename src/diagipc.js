// Ecos · Conexión con main.js del diagnóstico de conexión, los informes de errores y el entorno de la web.
// (Todo en este archivo para que main.js solo tenga unas líneas.)
const os = require('os');
const path = require('path');
const crashreport = require('./crashreport');
const diagnose = require('../renderer/diagnose');
const WebEnv = require('../renderer/webenv');
const net = require('./diagnosenet');

// ---- Informes de errores (locales; se ofrecen al usuario solo si activa el interruptor en Ajustes → Avanzado)
function createCrash({ file, version, notify = () => {} }) {
  const store = crashreport.createStore({ file });
  let busy = false;
  const osName = `${process.platform} ${process.arch} (${os.release()})`;
  const fmt = (a) => (a instanceof Error ? (a.stack || a.message) : a && typeof a === 'object' ? (() => { try { return JSON.stringify(a); } catch { return String(a); } })() : String(a));
  function capture(args) {
    if (busy) return null;
    busy = true;
    try {
      const { message, stack } = crashreport.split(args.map(fmt).join(' '));
      if (!message) return null;
      const res = store.add({ source: /^\[ventana\]/.test(message) ? 'ventana' : 'main', message, stack, version, os: osName });
      if (!res.duplicate) notify(res.report);
      return res;
    } catch { return null; } finally { busy = false; }
  }
  return { store, capture };
}

// ---- Registro de los manejadores
function register(ctx) {
  const { handle, getCfg, saveCfg, shell, session, send, crash, isSelf, aiTest, metaCheck, appVersion } = ctx;
  const cfg = getCfg;

  // Diagnóstico de conexión: cada paso se envía a la ventana en cuanto termina (diag:step)
  handle('diag:run', async (opts = {}) => {
    const c = cfg();
    const aiId = c.ai?.active || 'anthropic';
    const rawUrl = (c.wpUrl || '').trim();
    const aiOk = (() => { try { return ctx.aiConfigured(); } catch { return false; } })();
    const dctx = {
      url: rawUrl, hasAuth: isSelf() && !!c.wpUser && !!c.wpAppPassword, bundled: require('./wpself').helperBundledVersion(),
      metaConnected: !!c.metaUserToken, metaTokenExpires: c.metaTokenExpires || null, gpConnected: !!c.gpRefreshToken,
      aiConfigured: aiOk, aiName: aiId, testAi: !!opts.testAi,
    };
    const deps = net.makeDeps(c, {
      proxy: async (u) => { try { return await session().resolveProxy(u); } catch { return 'DIRECT'; } },
      meta: metaCheck, ai: aiTest,
    });
    const run = await diagnose.runDiagnostics(dctx, deps, (s) => send('diag:step', { runId: opts.runId, step: s }));
    // lo que se ha visto de la web sirve también para la tarjeta «Tu web»
    return { steps: run.steps, info: { date: new Date().toISOString(), version: appVersion(), os: `${process.platform} ${process.arch}`, site: (() => { try { return new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl).hostname; } catch { return ''; } })() } };
  });

  // Entorno de la web (Conexiones → «Tu web»): al conectar y una vez al día
  let envBusy = null;
  const guard = (bytes, name) => {
    const env = cfg().webEnv;
    if (!env || !env.limits || Date.now() - (env.at || 0) > 7 * 864e5) return '';
    const r = WebEnv.uploadCheck(env, bytes);
    return r.ok ? '' : `«${String(name || '').slice(0, 60)}»: ${r.text}`;
  };
  require('./wpself').setUploadGuard(guard);
  async function refreshEnv(force = false) {
    const c = cfg();
    if (!isSelf() || !c.wpUrl || !c.wpSelfOk) { if (c.webEnv) { delete c.webEnv; saveCfg(); } return null; }
    if (!force && c.webEnv && Date.now() - (c.webEnv.at || 0) < 24 * 3600 * 1000) return c.webEnv;
    if (envBusy) return envBusy;
    envBusy = (async () => {
      try {
        const env = await net.collectEnv(c, WebEnv);
        if (env.source !== 'none') { c.webEnv = env; saveCfg(); }
        return c.webEnv || null;
      } catch { return c.webEnv || null; } finally { envBusy = null; }
    })();
    return envBusy;
  }
  const envView = () => { const e = cfg().webEnv || null; return { env: e, warnings: e ? WebEnv.analyzeEnv(e, { bundled: require('./wpself').helperBundledVersion() }) : [] }; };
  handle('env:get', async () => { await refreshEnv(false); return envView(); });
  handle('env:refresh', async () => { await refreshEnv(true); return envView(); });
  // Comprobar si un archivo cabe antes de subirlo (la interfaz lo puede usar con el peso de lo elegido)
  handle('env:uploadCheck', (bytes) => { const e = cfg().webEnv; return e ? WebEnv.uploadCheck(e, Number(bytes) || 0) : { ok: true, limit: 0, text: '' }; });
  const timer = setInterval(() => { refreshEnv(false).catch(() => {}); }, 6 * 3600 * 1000); timer.unref?.();
  setTimeout(() => refreshEnv(false).catch(() => {}), 15000).unref?.();

  // Informes de errores
  handle('crash:list', () => crash().store.list());
  handle('crash:text', (id) => { const r = crash().store.get(id); return r ? crashreport.reportText(r) : ''; });
  handle('crash:remove', (id) => crash().store.remove(String(id)));
  handle('crash:clear', () => { crash().store.clear(); return true; });
  handle('crash:send', async (id) => {
    const r = crash().store.get(String(id));
    if (!r) throw new Error('Ese informe ya no existe.');
    await shell.openExternal(crashreport.buildIssueUrl(r));
    crash().store.markSent(r.id);
    return true;
  });
  return { refreshEnv };
}

module.exports = { createCrash, register };
