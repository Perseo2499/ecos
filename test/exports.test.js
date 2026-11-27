// Comprueba que toda función que se usa como require('./modulo').funcion existe de verdad en ese módulo
// (un nombre que no se exporta solo falla al usarlo: así se rompió «Describir con IA» con las CLI).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const files = [path.join(ROOT, 'main.js'), ...fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'src', f))];

test('las funciones usadas con require(…).nombre están exportadas', () => {
  const missing = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/require\('(\.{1,2}\/[^']+)'\)\.(\w+)/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      let mod;
      try { mod = require(target); } catch { continue; } // módulos que necesitan Electron
      if (!(m[2] in mod)) missing.push(`${path.relative(ROOT, file)}: ${m[1]}.${m[2]}`);
    }
  }
  assert.deepEqual(missing, []);
});

// Todos los archivos JavaScript de la app deben compilar (p. ej. una declaración repetida tras una fusión rompe el arranque)
test('todos los .js de la app son sintácticamente válidos', () => {
  const { execFileSync } = require('child_process');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  const all = [path.join(ROOT, 'main.js'), path.join(ROOT, 'preload.js'), ...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'renderer'))];
  const bad = [];
  for (const f of all) { try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad.push(path.relative(ROOT, f) + ': ' + String(e.stderr).split('\n').find((l) => /Error/.test(l))); } }
  assert.deepEqual(bad, []);
});
