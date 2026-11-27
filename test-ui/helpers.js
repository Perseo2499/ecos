// Utilidades comunes de las pruebas de interfaz (Playwright + node --test).
// Capturas: solo si se define ECOS_UI_SHOTS (carpeta de salida), p. ej. `ECOS_UI_SHOTS=/tmp/capturas npm run test:ui`.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const INDEX_URL = 'file://' + path.join(ROOT, 'renderer', 'index.html');

// Playwright del repo (devDependency) o, si no está, el global preinstalado.
function loadPlaywright() {
  const tries = ['playwright', process.env.PLAYWRIGHT_MODULE, '/opt/node-tools/node_modules/playwright'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch { /* siguiente */ } }
  throw new Error('No se encuentra Playwright: ejecuta «npm install» (y «npx playwright install chromium»).');
}
const { chromium } = loadPlaywright();

const launch = () => chromium.launch();

// Abre una página con el recolector de errores (de página y de consola).
async function newPage(browser, { viewport = { width: 1300, height: 820 }, ...ctxOpts } = {}) {
  const ctx = await browser.newContext({ viewport, ...ctxOpts });
  const page = await ctx.newPage();
  const errs = [];
  page.errs = errs;
  page.on('pageerror', (e) => errs.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' | ')));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|net::ERR/.test(m.text())) errs.push('console: ' + m.text()); });
  return page;
}

const shotsDir = process.env.ECOS_UI_SHOTS ? path.resolve(process.env.ECOS_UI_SHOTS) : '';
async function shot(page, name, opts = {}) {
  if (!shotsDir) return;
  fs.mkdirSync(shotsDir, { recursive: true });
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: path.join(shotsDir, name + '.png'), ...opts });
}

// Comprobaciones «blandas»: se anotan todas y al final se falla con la lista completa.
function checker() {
  const fails = [];
  const check = (name, cond, extra) => {
    if (!cond) fails.push(name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
    if (process.env.ECOS_UI_VERBOSE) console.log((cond ? 'ok   ' : 'FAIL ') + name);
  };
  check.done = () => assert.deepEqual(fails, [], 'Comprobaciones fallidas:\n - ' + fails.join('\n - '));
  return check;
}

async function openApp(page, url = INDEX_URL) { await page.goto(url); await page.waitForTimeout(500); }

module.exports = { ROOT, INDEX_URL, launch, newPage, shot, checker, openApp, assert };
