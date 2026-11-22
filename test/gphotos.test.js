// Pruebas de Google Fotos (Photos Picker API) con una red simulada: no se llama nunca a Google.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const G = require('../src/gphotos');

const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, arrayBuffer: async () => new TextEncoder().encode('FOTO').buffer });
const cfg0 = () => ({ gpClientId: 'cid', gpClientSecret: 'sec', gpRefreshToken: 'rt', gpAccessToken: 'at', gpTokenExpires: new Date(Date.now() + 3600e3).toISOString() });

test('Google Fotos: URL de autorización con PKCE, offline y consent', async () => {
  let url, challenge;
  const g = G.make({
    loginInBrowser: async (name, fn) => { assert.equal(name, 'google'); url = new URL(fn('ST')); return new URLSearchParams({ code: 'CODE', state: 'ST' }); },
    fetch: async (u, o) => {
      assert.equal(u, G.TOKEN_URL);
      const b = new URLSearchParams(o.body);
      challenge = url.searchParams.get('code_challenge');
      assert.equal(crypto.createHash('sha256').update(b.get('code_verifier')).digest('base64url'), challenge);
      assert.equal(b.get('code'), 'CODE'); assert.equal(b.get('grant_type'), 'authorization_code');
      assert.equal(b.get('client_secret'), 'sec'); assert.equal(b.get('redirect_uri'), 'http://localhost:53682/google');
      return json({ access_token: 'A', refresh_token: 'R', expires_in: 3600 });
    },
  });
  const r = await g.login({ gpClientId: 'cid', gpClientSecret: 'sec' });
  assert.equal(r.accessToken, 'A'); assert.equal(r.refreshToken, 'R');
  const q = url.searchParams;
  assert.equal(q.get('client_id'), 'cid'); assert.equal(q.get('scope'), G.SCOPE);
  assert.equal(q.get('access_type'), 'offline'); assert.equal(q.get('prompt'), 'consent');
  assert.equal(q.get('code_challenge_method'), 'S256'); assert.equal(q.get('state'), 'ST');
});

test('Google Fotos: refresco del token y reconexión si Google lo rechaza', async () => {
  const cfg = { ...cfg0(), gpAccessToken: 'viejo', gpTokenExpires: new Date(Date.now() - 1000).toISOString() };
  let saved = 0;
  const g = G.make({ save: () => saved++, fetch: async (u, o) => { const b = new URLSearchParams(o.body); assert.equal(b.get('grant_type'), 'refresh_token'); assert.equal(b.get('refresh_token'), 'rt'); return json({ access_token: 'nuevo', expires_in: 3600 }); } });
  assert.equal(await g.ensureToken(cfg), 'nuevo');
  assert.equal(cfg.gpAccessToken, 'nuevo'); assert.equal(saved, 1);
  assert.equal(await g.ensureToken(cfg), 'nuevo'); // vigente: no vuelve a llamar
  const bad = { ...cfg0(), gpTokenExpires: '' };
  const g2 = G.make({ fetch: async () => json({ error: 'invalid_grant' }, 400) });
  await assert.rejects(() => g2.ensureToken(bad), /Vuelve a conectar Google Fotos/);
  assert.equal(bad.gpRefreshToken, '');
});

test('Google Fotos: sondeo hasta mediaItemsSet, paginación y descarga con Bearer', async () => {
  const cfg = cfg0();
  const calls = []; let polls = 0; let clock = 0;
  const fetch = async (u, o = {}) => {
    calls.push([o.method || 'GET', u, o.headers?.Authorization]);
    if (u.endsWith('/v1/sessions') && o.method === 'POST') return json({ id: 'S1', pickerUri: 'https://photos.google.com/picker/S1', pollingConfig: { pollInterval: '2s', timeoutIn: '600s' }, mediaItemsSet: false });
    if (u.endsWith('/v1/sessions/S1') && o.method === 'GET') return json({ id: 'S1', mediaItemsSet: ++polls >= 3 });
    if (u.includes('/v1/mediaItems?')) {
      const q = new URL(u).searchParams;
      assert.equal(q.get('sessionId'), 'S1'); assert.equal(q.get('pageSize'), '100');
      return q.get('pageToken') === 'P2'
        ? json({ mediaItems: [{ id: 'b', type: 'VIDEO', createTime: '2024-05-02T10:00:00Z', mediaFile: { baseUrl: 'https://lh3/b', mimeType: 'video/mp4', filename: 'b.mp4' } }] })
        : json({ mediaItems: [{ id: 'a', type: 'PHOTO', createTime: '2024-05-01T10:00:00Z', mediaFile: { baseUrl: 'https://lh3/a', mimeType: 'image/jpeg', filename: 'a.jpg' } }], nextPageToken: 'P2' });
    }
    if (u.startsWith('https://lh3/')) return json({});
    if (o.method === 'DELETE') return json({});
    throw new Error('URL inesperada ' + u);
  };
  const sleeps = [];
  const g = G.make({ fetch, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  const s = await g.createSession(cfg);
  assert.equal(s.pickerUri, 'https://photos.google.com/picker/S1');
  await g.pollSession(cfg, s);
  assert.equal(polls, 3); assert.deepEqual(sleeps, [2000, 2000, 2000]);
  const items = await g.listItems(cfg, 'S1');
  assert.deepEqual(items.map((i) => i.id), ['a', 'b']);
  const img = await g.download(cfg, items[0]);
  const vid = await g.download(cfg, items[1]);
  assert.equal(img.buf.toString(), 'FOTO'); assert.equal(img.type, 'image'); assert.equal(img.date, '2024-05-01T10:00:00Z');
  assert.equal(vid.type, 'video');
  assert.ok(calls.some((c) => c[1] === 'https://lh3/a=d' && c[2] === 'Bearer at'));
  assert.ok(calls.some((c) => c[1] === 'https://lh3/b=dv' && c[2] === 'Bearer at'));
  await g.deleteSession(cfg, 'S1');
  assert.ok(calls.some((c) => c[0] === 'DELETE' && c[1].endsWith('/sessions/S1')));
});

test('Google Fotos: cancelar o agotar el tiempo corta el sondeo; HEIC se pide como JPEG', async () => {
  const cfg = cfg0(); let clock = 0;
  const g = G.make({ fetch: async () => json({ mediaItemsSet: false }), now: () => clock, sleep: async (ms) => { clock += ms; } });
  await assert.rejects(() => g.pollSession(cfg, { id: 'S', pollingConfig: { pollInterval: '5s', timeoutIn: '20s' } }), /agotado el tiempo/);
  await assert.rejects(() => g.pollSession(cfg, { id: 'S' }, { isCancelled: () => true }), (e) => e.cancelled);
  let asked;
  const g2 = G.make({ fetch: async (u) => { asked = u; return json({}); } });
  const d = await g2.download(cfg, { id: 'h', mediaFile: { baseUrl: 'https://lh3/h', mimeType: 'image/heic', filename: 'IMG_1.HEIC' } });
  assert.equal(asked, 'https://lh3/h=w4096-h4096'); assert.equal(d.name, 'IMG_1.jpg');
});

test('Google Fotos: lectura del JSON de credenciales (installed, web e inválidos)', () => {
  assert.deepEqual(G.parseCredentials(JSON.stringify({ installed: { client_id: 'i', client_secret: 's' } })), { clientId: 'i', clientSecret: 's' });
  assert.deepEqual(G.parseCredentials('﻿' + JSON.stringify({ web: { client_id: 'w', client_secret: 'x', redirect_uris: ['http://localhost:53682/google'] } })), { clientId: 'w', clientSecret: 'x' });
  assert.throws(() => G.parseCredentials(JSON.stringify({ web: { client_id: 'w', client_secret: 'x', redirect_uris: ['https://miweb.com/cb'] } })), /Aplicación web/);
  assert.throws(() => G.parseCredentials('no es json'), /no es un JSON válido/);
  assert.throws(() => G.parseCredentials('{"otra":1}'), /no parece de credenciales/);
  assert.throws(() => G.parseCredentials(JSON.stringify({ installed: { client_id: 'i' } })), /falta/);
});

test('Google Fotos: búsqueda de credenciales solo con la forma esperada', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-'));
  const good = JSON.stringify({ installed: { client_id: 'i', client_secret: 's' } });
  fs.writeFileSync(path.join(d, 'client_secret_1.json'), good);
  fs.writeFileSync(path.join(d, 'otro.json'), good);
  fs.writeFileSync(path.join(d, 'ajeno.json'), JSON.stringify({ password: 'x' }));
  fs.writeFileSync(path.join(d, 'client_secret_malo.json'), '{"x":1}');
  const found = G.findCredentialFiles([d, path.join(d, 'no-existe')]);
  assert.deepEqual(found.map((f) => path.basename(f)), ['client_secret_1.json', 'otro.json']);
  fs.rmSync(d, { recursive: true });
});
