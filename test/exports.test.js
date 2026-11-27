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
