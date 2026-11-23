const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const { updateLatestYml } = require('../scripts/update-latest-yml');

const b64 = (buf) => crypto.createHash('sha512').update(buf).digest('base64');

test('update-latest-yml: recalcula sha512 y size del instalador firmado y respeta el resto', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-yml-'));
  const exe = path.join(dir, 'Ecos-Setup-1.2.3.exe');
  const portable = path.join(dir, 'Ecos-1.2.3-portable.exe');
  fs.writeFileSync(exe, Buffer.from('instalador firmado, distinto del original'));
  const yml = path.join(dir, 'latest.yml');
  fs.writeFileSync(yml, yaml.dump({
    version: '1.2.3',
    files: [
      { url: 'Ecos-Setup-1.2.3.exe', sha512: 'VIEJO', size: 1, blockMapSize: 5 },
      { url: 'Ecos-1.2.3-portable.exe', sha512: 'OTRO', size: 7 },
    ],
    path: 'Ecos-Setup-1.2.3.exe',
    sha512: 'VIEJO',
    releaseDate: '2026-01-01T00:00:00.000Z',
  }));
  const blockmap = exe + '.blockmap';
  fs.writeFileSync(blockmap, Buffer.alloc(42));

  const r = await updateLatestYml(yml, exe, { blockmap });
  const out = yaml.load(fs.readFileSync(yml, 'utf8'));
  const data = fs.readFileSync(exe);
  assert.equal(r.size, data.length);
  assert.equal(out.files[0].sha512, b64(data));
  assert.equal(out.files[0].size, data.length);
  assert.equal(out.files[0].blockMapSize, 42);
  assert.equal(out.sha512, b64(data));
  assert.equal(out.version, '1.2.3');
  assert.equal(out.releaseDate, '2026-01-01T00:00:00.000Z');
  // el portable no se toca
  assert.deepEqual(out.files[1], { url: 'Ecos-1.2.3-portable.exe', sha512: 'OTRO', size: 7 });
  void portable;

  // sin blockmap: se quita blockMapSize (la descarga diferencial deja de usarse)
  await updateLatestYml(yml, exe);
  assert.equal('blockMapSize' in yaml.load(fs.readFileSync(yml, 'utf8')).files[0], false);
});

test('update-latest-yml: falla si el instalador no está en latest.yml', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-yml-'));
  const yml = path.join(dir, 'latest.yml');
  fs.writeFileSync(yml, yaml.dump({ version: '1', files: [{ url: 'a.exe', sha512: 'x', size: 1 }] }));
  const exe = path.join(dir, 'b.exe'); fs.writeFileSync(exe, 'x');
  await assert.rejects(() => updateLatestYml(yml, exe), /no menciona/);
});
