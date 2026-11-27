const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const T = require('../src/transform');
const { parseBlocks } = require('../src/parseblocks');
const W = require('../src/wpself');
const B = require('../scripts/build-wp-plugin');

const blocks = [
  { id: 'c1', type: 'carousel', images: [{ id: 1, url: 'a.jpg' }, { id: 2, url: 'b.jpg' }] },
  { id: 'i1', type: 'image', img: { id: 3, url: 'c.jpg' }, fx: 'zoom', caption: '' },
];

test('composición con helper: sin <script>, con los marcadores para el complemento', () => {
  const on = T.composeBlocks(blocks, { helper: true });
  assert.doesNotMatch(on, /<script/);
  assert.match(on, /data-ecos-carousel/);
  assert.match(on, /<style class="ecos-fx">/);
  const off = T.composeBlocks(blocks);
  assert.match(off, /<script>new Function\(atob\(/);
  assert.equal(off.replace(/<script[\s\S]*?<\/script>/g, ''), on);
});

test('vídeo suelto: sin helper lleva el script, con helper no, y ecos-vp sigue', () => {
  const vb = [{ id: 'v1', type: 'video', url: 'v.mp4', video: { id: 5, url: 'v.mp4' }, images: [{ type: 'video', id: 5, url: 'v.mp4' }] }];
  const off = T.composeBlocks(vb), on = T.composeBlocks(vb, { helper: true });
  assert.doesNotMatch(on, /<script/);
  if (/ecos-vp/.test(off)) { assert.match(off, /ecos-vjs/); assert.match(on, /ecos-vp/); }
});

test('parseo de vuelta igual con y sin helper', () => {
  const strip = (b) => JSON.stringify(b, (k, v) => (k === 'id' ? undefined : v));
  const on = parseBlocks(T.composeBlocks(blocks, { helper: true }));
  assert.equal(strip(on), strip(parseBlocks(T.composeBlocks(blocks))));
  assert.equal(on.filter((b) => b.type === 'carousel').length, 1);
});

test('estado del complemento: instalado, desactualizado y ausente', () => {
  assert.deepEqual(W.parseHelperStatus(null, '1.0.0'), { installed: false, version: '', outdated: false, caches: [], bundled: '1.0.0' });
  assert.equal(W.parseHelperStatus({ code: 'rest_no_route' }, '1.0.0').installed, false);
  const ok = W.parseHelperStatus({ plugin: 'ecos', version: '1.0.0', caches: ['LiteSpeed Cache'] }, '1.0.0');
  assert.equal(ok.installed, true); assert.equal(ok.outdated, false); assert.deepEqual(ok.caches, ['LiteSpeed Cache']);
  assert.equal(W.parseHelperStatus({ plugin: 'ecos', version: '0.9.5' }, '1.0.0').outdated, true);
  assert.equal(W.parseHelperStatus({ plugin: 'ecos', version: '1.10.0' }, '1.9.0').outdated, false);
  assert.match(W.helperBundledVersion(), /^\d+\.\d+\.\d+$/);
});

test('el .zip del complemento contiene ecos.php y los assets, y es válido', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ecoszip-')), 'ecos.zip');
  const r = B.build(out);
  assert.deepEqual(r.files.sort(), ['ecos/assets/ecos-anim.js', 'ecos/assets/ecos-carousel.js', 'ecos/assets/ecos-hit.js', 'ecos/assets/ecos-more.js', 'ecos/assets/ecos-videos.js', 'ecos/assets/ecos.css', 'ecos/ecos.php', 'ecos/includes/export.php', 'ecos/includes/render.php', 'ecos/includes/seo.php', 'ecos/includes/stats.php', 'ecos/includes/theme.php', 'ecos/uninstall.php']);
  const buf = fs.readFileSync(out);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  assert.equal(buf.readUInt16LE(buf.length - 22 + 10), 13);
  assert.match(fs.readFileSync(path.join(B.PLUGIN, 'assets', 'ecos.css'), 'utf8'), /ecos-zoom/);
  const php = fs.readFileSync(path.join(B.PLUGIN, 'ecos.php'), 'utf8');
  assert.match(php, /Plugin Name:\s+Ecos para WordPress/);
  assert.match(php, /Requires at least:\s+6\.0/);
  assert.match(php, /Requires PHP:\s+7\.4/);
  assert.doesNotMatch(php, /\beval\s*\(/);
  assert.match(php, /permission_callback/);
  for (const [cmd, args] of [['unzip', ['-tq', out]], ['php', ['-l', path.join(B.PLUGIN, 'ecos.php')]]]) {
    try { execFileSync(cmd, args); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
});
