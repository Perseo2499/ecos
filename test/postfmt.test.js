// Lógica pura del detalle de publicaciones (renderer/postfmt.js): texto seguro con enlaces y etiquetas, duración y «hace X».
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../renderer/postfmt.js');

test('escapa HTML y conserva saltos de línea', () => {
  const h = F.formatText('<img src=x onerror=alert(1)> & "hola"\nsegunda\r\ntercera');
  assert.ok(!h.includes('<img'));
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;hola&quot;<br>segunda<br>tercera/);
});
test('enlaces http(s): href escapado, sin signos finales, abren fuera', () => {
  const h = F.formatText('Mira https://example.org/a?x=1&y=2). Y http://b.es/c, fin');
  assert.match(h, /<a href="https:\/\/example\.org\/a\?x=1&amp;y=2" class="pd-link" rel="noopener noreferrer" target="_blank">example\.org\/a\?x=1&amp;y=2<\/a>\)\./);
  assert.match(h, /<a href="http:\/\/b\.es\/c"[^>]*>b\.es\/c<\/a>, fin/);
});
test('no crea enlaces con otros esquemas ni deja romper el atributo', () => {
  assert.ok(!/<a /.test(F.formatText('javascript:alert(1) data:text/html,<b>')));
  const h = F.formatText('http://x.com/"onmouseover="alert(1)');
  assert.ok(!/href="[^"]*"[^>]*onmouseover/.test(h.replace(/&quot;/g, '')));
  assert.ok(!h.includes('"onmouseover="'));
});
test('hashtags y menciones resaltados, también con tildes; no dentro de enlaces ni de entidades', () => {
  const h = F.formatText('Hola #Navidad2026 y #solidaridad @ana_lopez, @elin.org. mail a@b.com http://x.org/p#frag #ñandú');
  assert.match(h, /<span class="pd-tag">#Navidad2026<\/span>/);
  assert.match(h, /<span class="pd-men">@ana_lopez<\/span>,/);
  assert.match(h, /<span class="pd-men">@elin\.org<\/span>\./);
  assert.match(h, /<span class="pd-tag">#ñandú<\/span>/);
  assert.ok(!h.includes('pd-men">@b.com'));
  assert.ok(!/pd-tag">#frag/.test(h));
  assert.ok(!F.formatText("rock & roll 'x' &#39;").includes('pd-tag'));
});
test('entradas raras', () => {
  assert.equal(F.formatText(null), '');
  assert.equal(F.formatText(undefined), '');
  assert.equal(F.formatText(''), '');
});
test('duración de vídeo', () => {
  assert.equal(F.fmtDuration(75), '1:15');
  assert.equal(F.fmtDuration(9), '0:09');
  assert.equal(F.fmtDuration(3725), '1:02:05');
  assert.equal(F.fmtDuration(null), '');
  assert.equal(F.fmtDuration('x'), '');
  assert.equal(F.fmtDuration(0), '');
});
test('hace X en español e inglés', () => {
  const now = new Date(2026, 10, 27, 12).getTime();
  assert.equal(F.relTime(now - 3 * 86400e3, now, 'es'), 'hace 3 días');
  assert.equal(F.relTime(now - 2 * 3600e3, now, 'en'), '2 hours ago');
  assert.equal(F.relTime(now - 800 * 86400e3, now, 'es'), 'hace 2 años');
  assert.equal(F.relTime('no', now, 'es'), '');
});
