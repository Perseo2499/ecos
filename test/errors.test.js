// Pruebas de friendlyError: los errores técnicos salen en español claro y el original queda como detalle.
const test = require('node:test');
const assert = require('node:assert/strict');
const { friendlyError, looksTechnical, errorHtml } = require('../renderer/errors');

const f = (m) => friendlyError(new Error(m));
const noEnglish = (s) => !/\b(Cannot|undefined|function|fetch|Failed|ECONN|ETIMEDOUT|Forbidden|Unauthorized)\b/.test(s);

test('errores de JavaScript con datos incompletos', () => {
  for (const m of ["Cannot read properties of undefined (reading 'length')", "Cannot read properties of null (reading 'join')", 'x.map is not a function', 'foo is not iterable', 'bar is not defined']) {
    const r = f(m);
    assert.ok(r.translated, m);
    assert.match(r.text, /datos incompletos/);
    assert.ok(noEnglish(r.text));
    assert.equal(r.detail, m);
  }
});

test('errores de red', () => {
  assert.match(f('Failed to fetch').text, /No se ha podido conectar/);
  assert.match(f('connect ECONNREFUSED 127.0.0.1:443').text, /rechazado la conexión/);
  assert.match(f('connect ETIMEDOUT 1.2.3.4:443').text, /tardado demasiado/);
  assert.match(f('getaddrinfo ENOTFOUND example.com').text, /No se encuentra esa dirección/);
  assert.match(f("Error invoking remote method 'blog:list': Error: read ECONNRESET").text, /cortado la conexión/);
});

test('códigos de WordPress', () => {
  assert.match(f('HTTP 401').text, /usuario o la contraseña/);
  assert.match(f('WordPress: Sorry, you are not allowed to do that.').text, /no tiene permiso/);
  assert.match(f('Request failed with status 403').text, /no tiene permiso/);
  assert.match(f('404 Not Found').text, /no ha encontrado/);
  assert.match(f('Request failed with status 500').text, /problema interno/);
  assert.match(f('503 Service Unavailable').text, /problema interno/);
});

test('los mensajes que ya están en español no se tocan', () => {
  for (const m of ['Esta web no tiene activada la API de WordPress (wp-json)', 'Escribe tu usuario y la contraseña de aplicación', 'Fecha no válida.', 'No existe la categoría «Viajes»']) {
    const r = f(m);
    assert.equal(r.text, m);
    assert.equal(r.translated, false);
  }
});

test('inglés desconocido: frase genérica con el original como detalle; vacío y cadenas sueltas', () => {
  const r = f('Something totally unexpected happened');
  assert.match(r.text, /problema técnico/);
  assert.equal(r.detail, 'Something totally unexpected happened');
  assert.match(friendlyError('Failed to fetch').text, /conectar/);
  assert.match(friendlyError(null).text, /error inesperado/);
  assert.match(friendlyError({}).text, /problema técnico|\[object Object\]/);
});

test('looksTechnical y errorHtml', () => {
  assert.ok(looksTechnical('Failed to fetch'));
  assert.ok(!looksTechnical('Hecho en 3 entradas. 1 con error: «x»'));
  const h = errorHtml(new Error("Cannot read properties of undefined (reading 'x')"));
  assert.match(h, /<details/);
  assert.match(h, /Cannot read properties/);
  assert.ok(!/<details/.test(errorHtml(new Error('Fecha no válida.'))));
  // el detalle va escapado
  assert.ok(!/<script/.test(errorHtml(new Error('<script>alert(1)</script> is not a function'))));
});
