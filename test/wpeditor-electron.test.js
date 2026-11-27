// Ventana real del editor de WordPress con Electron (scripts/wped-electron-check.js) contra un servidor local que imita wp-admin.
// Solo en Linux con xvfb-run y Electron instalado; en lo demás se omite.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const bin = path.join(ROOT, 'node_modules', '.bin', 'electron');
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const can = process.platform === 'linux' && fs.existsSync(bin) && has('xvfb-run') && fs.existsSync(path.join(ROOT, 'node_modules', 'electron', 'dist'));

test('ventana de Electron: guardar y leer, cancelar, cerrar, un solo uso, sin Node y navegación limitada', { skip: !can && 'sin xvfb-run o Electron', timeout: 120000 }, () => {
  const r = spawnSync('xvfb-run', ['-a', bin, '--no-sandbox', path.join(ROOT, 'scripts', 'wped-electron-check.js')], { encoding: 'utf8', timeout: 100000, cwd: ROOT });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, 'sin resultado: ' + (r.stderr || '').slice(-400));
  const res = JSON.parse(line.slice(7));
  assert.deepEqual(res.errors, []);
  assert.ok(Object.keys(res.checks).length >= 20);
});
