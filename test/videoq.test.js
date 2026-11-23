const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Q = require('../renderer/vidq');
const V = require('../src/videoq');
const { mergeDuplicates, buildDraft } = require('../src/transform');

// fetch simulado: HEAD con Content-Length según la tabla (o sin él, para probar la descarga parcial)
const fakeFetch = (sizes, { noHead = [] } = {}) => async (url, opts = {}) => {
  const size = sizes[url];
  if (size === undefined) throw new Error('sin red');
  const h = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });
  if (opts.method === 'HEAD') return { ok: true, status: 200, headers: h(noHead.includes(url) ? {} : { 'content-length': String(size) }) };
  return { ok: true, status: 206, headers: h({ 'content-range': `bytes 0-0/${size}` }) };
};

test('tamaño remoto: HEAD y, si no hay Content-Length, descarga parcial', async () => {
  const f = fakeFetch({ a: 500, b: 900 }, { noHead: ['b'] });
  assert.equal(await V.sizeOf('a', f), 500);
  assert.equal(await V.sizeOf('b', f), 900);
  assert.equal(await V.sizeOf('zzz', f), 0);
});

const vid = (url, extra = {}) => ({ type: 'video', url: url + '-poster', videoUrl: url, ...extra });

test('mejor versión: se elige la mayor de cada vídeo entre Instagram y Facebook', async () => {
  const sizes = { ig1: 290e3, fb1: 4e6, ig2: 8e6, fb2: 1e6 };
  const post = { source: 'instagram', id: '1', media: [{ type: 'image', url: 'img' }, vid('ig1'), vid('ig2')], alsoOn: [{ source: 'facebook', id: '9', media: [vid('fb1'), vid('fb2')] }] };
  const r = await V.bestVersionPost(post, { sizeFn: (u) => V.sizeOf(u, fakeFetch(sizes)) });
  assert.deepEqual(r.media.filter((m) => m.type === 'video').map((m) => m.videoUrl), ['fb1', 'ig2']);
  assert.equal(r.media[0].url, 'img');
  assert.equal(r.media[1].url, 'ig1-poster'); // la portada y el orden son los de la principal
});

test('mejor versión: si las listas no casan, gana la de mayor tamaño total', async () => {
  const sizes = { ig1: 5e6, fb1: 3e6, fb2: 4e6 };
  const post = { source: 'instagram', id: '1', media: [vid('ig1')], alsoOn: [{ source: 'facebook', id: '9', media: [vid('fb1'), vid('fb2')] }] };
  const r = await V.bestVersionPost(post, { sizeFn: async (u) => sizes[u] });
  assert.deepEqual(r.media.map((m) => m.videoUrl), ['fb1', 'fb2']);
  const r2 = await V.bestVersionPost({ ...post, alsoOn: [{ source: 'facebook', id: '9', media: [vid('fb1'), vid('fb2')].map((m) => ({ ...m, videoUrl: m.videoUrl === 'fb2' ? 'ig1x' : m.videoUrl })) }] }, { sizeFn: async (u) => ({ ig1: 9e6, fb1: 1e6, ig1x: 1e6 }[u]) });
  assert.deepEqual(r2.media.map((m) => m.videoUrl), ['ig1']);
});

test('mejor versión: candidatas extra (nodo de vídeo de Facebook) y fallos de red', async () => {
  const post = { source: 'facebook', id: '1', media: [vid('fb1', { link: 'https://www.facebook.com/page/videos/1234567890/' })] };
  assert.equal(V.facebookVideoId(post.media[0]), '1234567890');
  const r = await V.bestVersionPost(post, { sizeFn: async (u) => ({ fb1: 1e6, node: 6e6 }[u] || 0), extraUrls: async () => ['node'] });
  assert.equal(r.media[0].videoUrl, 'node');
  const bad = await V.bestVersionPost(post, { sizeFn: async () => { throw new Error('x'); }, extraUrls: async () => { throw new Error('graph'); } });
  assert.equal(bad.media[0].videoUrl, 'fb1'); // sin tamaños ni nodo: se queda como estaba
  const node = await V.facebookNodeSource(post.media[0], { graph: 'g', token: 't', fetchFn: async () => ({ json: async () => ({ source: 'https://x/v.mp4' }) }) });
  assert.deepEqual(node, ['https://x/v.mp4']);
  assert.deepEqual(await V.facebookNodeSource(post.media[0], { graph: 'g', token: 't', fetchFn: async () => ({ json: async () => ({ error: { message: 'no' } }) }) }), []);
});

test('al juntar duplicados, la publicación guarda también los medios de la otra red', () => {
  const d = '2026-01-01T10:00:00Z';
  const a = { source: 'instagram', id: 'a', text: 'Hola mundo desde el campamento', date: d, media: [vid('ig1')] };
  const b = { source: 'facebook', id: 'b', text: 'Hola mundo desde el campamento', date: d, media: [vid('fb1')] };
  const [m] = mergeDuplicates([a, b]);
  assert.equal(m.alsoOn.length, 1);
  assert.deepEqual(m.alsoOn[0].media.map((x) => x.videoUrl).concat(m.media.map((x) => x.videoUrl)).sort(), ['fb1', 'ig1']);
});

test('decisión de transcodificar', () => {
  assert.equal(Q.needsTranscode({ width: 360, height: 480, size: 1e6 }), false);
  assert.equal(Q.needsTranscode({ width: 1080, height: 1920, size: 10e6 }), false);
  assert.equal(Q.needsTranscode({ width: 1920, height: 2560, size: 10e6 }), true); // lado corto 1920
  assert.equal(Q.needsTranscode({ width: 2160, height: 3840, size: 1e6 }), true);
  assert.equal(Q.needsTranscode({ width: 720, height: 1280, size: 21 * 1024 * 1024 }), true); // pesa > 20 MB
  assert.equal(Q.needsTranscode({ size: 25 * 1024 * 1024 }), true); // sin medidas, solo peso
  assert.equal(Q.needsTranscode({}), false);
  assert.deepEqual(Q.targetSize(1920, 2560), { width: 1080, height: 1440 });
  assert.deepEqual(Q.targetSize(3840, 2160), { width: 1920, height: 1080 });
  assert.deepEqual(Q.targetSize(360, 480), { width: 360, height: 480 }); // nunca se amplía
  assert.deepEqual(Q.targetSize(721, 481), { width: 722, height: 482 }); // medidas pares
});

test('direcciones de CDN de Meta', () => {
  for (const u of ['https://scontent.cdninstagram.com/v/t51/a.jpg', 'https://scontent-mad1-1.xx.fbcdn.net/v/x.mp4?oh=1', 'https://video.fbcdn.net/v/y', 'https://scontent-fra5-1.cdninstagram.com/o1/v/t16/f1/m86/a.mp4', 'https://scontent.xx.fbcdn.net/a'])
    assert.equal(Q.isMetaCdn(u), true, u);
  for (const u of ['https://asociacionelin.com/wp-content/uploads/a.jpg', 'https://www.instagram.com/p/abc/', 'https://www.facebook.com/x', 'https://fbcdn.net.evil.com/a', 'https://notcdninstagram.com/a', '', null, 'data:image/png;base64,AAA'])
    assert.equal(Q.isMetaCdn(u), false, String(u));
});

test('sustitución de medios externos en bloques (poster de vídeo y fondos del carrusel incluidos)', () => {
  const ig = 'https://scontent.cdninstagram.com/a.jpg', fb = 'https://scontent-x.xx.fbcdn.net/b.jpg', ok = 'https://web.com/c.jpg';
  const blocks = [
    { id: 1, type: 'image', img: { id: 5, url: ig }, caption: `<a href="${ig}">no se toca</a>` },
    { id: 2, type: 'video', video: { url: ok, poster: fb, width: 360, height: 480 } },
    { id: 3, type: 'carousel', images: [{ type: 'video', url: 'https://web.com/v.mp4', poster: ig }, { type: 'image', url: fb }, { type: 'image', url: ok }] },
    { id: 4, type: 'columns', cols: [[{ id: 5, type: 'image', img: { url: ig } }]] },
  ];
  assert.deepEqual(Q.collectExpiring(blocks).sort(), [fb, ig].sort());
  const n = Q.replaceUrls(blocks, { [ig]: 'https://web.com/ig.jpg', [fb]: 'https://web.com/fb.jpg' });
  assert.equal(n, 5);
  assert.equal(blocks[1].video.poster, 'https://web.com/fb.jpg');
  assert.equal(blocks[2].images[0].poster, 'https://web.com/ig.jpg');
  assert.equal(blocks[3].cols[0][0].img.url, 'https://web.com/ig.jpg');
  assert.ok(blocks[0].caption.includes(ig)); // el texto no se toca
  assert.deepEqual(Q.collectExpiring(blocks), []);
});

test('el borrador conserva medidas y portada del vídeo subido', () => {
  const post = { source: 'instagram', id: '1', text: 'Un vídeo de prueba largo', date: '2026-01-01T10:00:00Z', media: [vid('ig1')] };
  const up = new Map([['ig1', { id: 7, url: 'https://web/v.mp4', poster: 'https://web/p.jpg', width: 1080, height: 1440 }]]);
  const d = buildDraft([post], up, {});
  const b = JSON.stringify(d);
  assert.ok(b.includes('https://web/p.jpg') && b.includes('"width":1080'));
});

test('etiqueta de baja resolución', () => {
  assert.equal(Q.lowRes({ width: 360, height: 480 }), true);
  assert.equal(Q.lowRes({ width: 480, height: 360 }), true);
  assert.equal(Q.lowRes({ width: 720, height: 1280 }), false);
  assert.equal(Q.lowRes({ width: 1080, height: 1920 }), false);
  assert.equal(Q.lowRes({ url: 'x' }), false); // sin medidas, no se avisa
  assert.equal(Q.lowRes(null), false);
});

test('lectura de medidas de la salida de ffmpeg', () => {
  const out = `Input #0, mov,mp4, from 'a.mp4':\n  Duration: 00:00:02.04, start: 0.000000, bitrate: 290 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 360x640 [SAR 1:1 DAR 9:16], 25 fps\n`;
  assert.deepEqual(V.parseInfo(out), { width: 360, height: 640, duration: 2.04 });
  assert.deepEqual(V.parseInfo(out.replace('25 fps', '25 fps\n    displaymatrix: rotation of -90.00 degrees')), { width: 640, height: 360, duration: 2.04 });
  assert.deepEqual(V.parseInfo('nada'), { width: 0, height: 0, duration: 0 });
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
test('ffmpeg real: 1920x2560 baja a 1080 de lado corto y se crea la portada', { skip: !hasFfmpeg && 'no hay ffmpeg' }, async () => {
  V.resetFfmpegCache();
  assert.ok(V.ffmpegPath());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecos-test-'));
  try {
    const src = path.join(dir, 'grande.mp4');
    const g = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x2560:rate=25:duration=2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', src]);
    assert.equal(g.status, 0);
    const r = await V.processVideo(src, { name: 'grande.mp4' });
    assert.equal(r.transcoded, true);
    assert.equal(Math.min(r.width, r.height), 1080);
    const info = await V.probe(r.file);
    assert.equal(Math.min(info.width, info.height), 1080);
    assert.ok(r.posterFile && fs.statSync(r.posterFile).size > 0);
    // uno pequeño no se toca, pero también tiene portada y medidas
    const small = path.join(dir, 'pequeno.mp4');
    spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=360x480:rate=25:duration=1', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', small]);
    const r2 = await V.processVideo(small);
    assert.equal(r2.transcoded, false);
    assert.equal(r2.file, small);
    assert.deepEqual([r2.width, r2.height], [360, 480]);
    assert.ok(r2.posterFile);
    fs.rmSync(r.dir, { recursive: true, force: true }); fs.rmSync(r2.dir, { recursive: true, force: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
