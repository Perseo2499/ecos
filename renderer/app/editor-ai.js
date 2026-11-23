// Ecos · Editor de entradas (IA: reescribir como artículo y normalizar formato). Sigue a app/editor.js y comparte su ámbito global (se cargan en orden desde index.html).
// Opciones de «Convertir en artículo» (se configuran antes de pulsar y se recuerdan)
const AI_OPTS_DEF = { length: 'same', tone: 'same', web: false, headings: true, spelling: true, notes: '' };
const aiOpts = () => ({ ...AI_OPTS_DEF, ...(prefs().aiArticle || {}) });
function renderAiOpts() {
  const o = aiOpts();
  $$('#ai-opts [data-opt]').forEach((el) => {
    const k = el.dataset.opt;
    if (el.classList.contains('seg')) $$('button', el).forEach((b) => b.classList.toggle('active', b.dataset.v === o[k]));
    else if (el.type === 'checkbox') el.checked = !!o[k];
    else el.value = o[k] || '';
  });
  const L = { shorter: t('más breve'), longer: t('más extensa') }, T = { friendly: t('cercano'), formal: t('formal'), activist: t('reivindicativo') };
  $('#ai-opts-sum').textContent = [L[o.length], T[o.tone], o.web && t('con internet')].filter(Boolean).join(' · ');
}
const saveAiOpts = (patch) => savePrefs({ aiArticle: { ...aiOpts(), ...patch } }).then(renderAiOpts);
$$('#ai-opts [data-opt]').forEach((el) => {
  const k = el.dataset.opt;
  if (el.classList.contains('seg')) $$('button', el).forEach((b) => (b.onclick = () => saveAiOpts({ [k]: b.dataset.v })));
  else if (el.type === 'checkbox') el.onchange = () => saveAiOpts({ [k]: el.checked });
  else el.onchange = () => saveAiOpts({ [k]: el.value.trim() });
});
renderAiOpts();

// IA en el editor: el texto se reescribe con las opciones elegidas; las fotos, vídeos y su orden se conservan
$('#ai-article').onclick = (e) => busy(e.target, async () => {
  const TEXT = ['paragraph', 'heading', 'quote', 'list'];
  if (draft.blocks.some((b) => TEXT.includes(b.type)) && !await ask(t('La IA reescribirá los textos de la entrada (las fotos y vídeos se quedan). ¿Continuar?'))) return;
  const opts = { ...aiOpts(), notes: $('#ai-opts [data-opt="notes"]').value.trim() };
  const E0 = window.BlockEditor;
  // Hay texto en la entrada: se reescribe por tramos y cada bloque que no es texto se queda exactamente donde está
  const seg = aiSegments(draft.blocks, E0);
  if (seg.segments.length) {
    const r = await window.api.aiArticle({ title: $('#d-title').value, text: seg.segments.map((s) => s.text).join('\n\n'), segments: seg.segments, layout: seg.layout, opts });
    if (r.title) { $('#d-title').value = r.title; autoTitle(); }
    if (r.excerpt) $('#d-excerpt').value = r.excerpt;
    let missing = 0;
    E0.change(() => {
      // de atrás adelante, para que los índices de cada tramo sigan valiendo
      for (const run of [...seg.runs].reverse()) {
        const got = (r.sections || []).find((s) => s.id === run.id);
        const nb = got && aiBlocks(got.blocks, E0, run.blocks);
        if (!nb || !nb.length) { missing++; continue; }
        run.arr.splice(run.start, run.blocks.length, ...nb);
      }
      if (r.sources?.length) draft.blocks.push(E0.create('heading', { level: 3, html: escHtml(t('Fuentes')) }), E0.create('list', { items: r.sources.map((s) => `<a href="${escHtml(s.url)}">${escHtml(s.title || s.url)}</a>`) }));
    });
    const cur = $('#d-tags').value.split(',').map((x) => x.trim()).filter(Boolean);
    $('#d-tags').value = [...new Set([...cur, ...(r.tags || [])])].join(', ');
    toast(missing ? t('Listo. {n} tramo(s) se han dejado como estaban porque la IA no los devolvió. Revisa el texto antes de enviarlo.', { n: missing }) : t('Listo: el texto está reescrito y las fotos siguen en su sitio. Revísalo antes de enviarlo (Ctrl+Z para deshacer).'));
    return;
  }
  // Sin texto todavía (entrada recién creada desde redes): se escribe a partir de la publicación original
  const text = draft.sourceText || window.BlockEditor.plainText();
  const r = await window.api.aiArticle({ title: $('#d-title').value, text, opts });
  $('#d-title').value = r.title; autoTitle();
  $('#d-excerpt').value = r.excerpt;
  window.BlockEditor.change(() => {
    const media = draft.blocks.filter((b) => !TEXT.includes(b.type));
    const E = window.BlockEditor;
    const body = r.blocks.filter((b) => b.text.trim()).map((b) => (b.kind === 'h2' ? E.create('heading', { level: 2, html: escHtml(b.text) }) : E.create('paragraph', { html: escHtml(b.text) })));
    // las fotos se reparten tras el primer párrafo para que no queden todas al final
    const firstP = Math.max(0, body.findIndex((b) => b.type === 'paragraph'));
    let blocks = body.length ? [...body.slice(0, firstP + 1), ...media.slice(0, 1), ...body.slice(firstP + 1), ...media.slice(1)] : media;
    // fuentes de internet al final, como lista de enlaces
    if (r.sources?.length) {
      blocks = [...blocks, E.create('heading', { level: 3, html: escHtml(t('Fuentes')) }),
        E.create('list', { items: r.sources.map((s) => `<a href="${escHtml(s.url)}">${escHtml(s.title || s.url)}</a>`) })];
    }
    draft.blocks = blocks;
  });
  const cur = $('#d-tags').value.split(',').map((x) => x.trim()).filter(Boolean);
  $('#d-tags').value = [...new Set([...cur, ...r.tags])].join(', ');
  toast(t('Listo. Revisa el texto antes de enviarlo.'));
});
// Tramos de texto de la entrada (también dentro de secciones y columnas): bloques de texto seguidos entre dos bloques
// que no son texto. Devuelve { runs: [{ id, arr, start, blocks }], segments: [{ id, text }], layout }
function aiSegments(blocks, E) {
  const TEXT = ['paragraph', 'heading', 'quote', 'list'];
  const plain = (h) => { const d = document.createElement('div'); d.innerHTML = String(h || '').replace(/<br\s*\/?>/gi, '\n'); return d.textContent.replace(/\n{3,}/g, '\n\n').trim(); };
  const asText = (b) => b.type === 'heading' ? `## ${plain(b.html)}` : b.type === 'list' ? (b.items || []).map((x) => `- ${plain(x)}`).join('\n') : b.type === 'quote' ? `> ${plain(b.html)}` : plain(b.html);
  const runs = [], layout = [];
  const NAME = { image: 'foto', gallery: 'galería', carousel: 'carrusel', video: 'vídeo', embed: 'publicación insertada', mediatext: 'imagen con texto', separator: 'separador', buttons: 'botón', table: 'tabla', group: 'sección', columns: 'columnas', cover: 'portada' };
  const walk = (arr, depth) => {
    let cur = null;
    arr.forEach((b, i) => {
      if (TEXT.includes(b.type) && (b.html || b.items?.length)) {
        if (!cur) { cur = { id: 'T' + (runs.length + 1), arr, start: i, blocks: [] }; runs.push(cur); layout.push('  '.repeat(depth) + `[[${cur.id}]]`); }
        cur.blocks.push(b);
        return;
      }
      cur = null;
      layout.push('  '.repeat(depth) + `[· ${NAME[b.type] || b.type}]`);
      for (const k of E.kids(b)) walk(k, depth + 1);
    });
  };
  walk(blocks, 0);
  return { runs, segments: runs.map((r) => ({ id: r.id, text: r.blocks.map(asText).join('\n\n') })), layout: layout.join('\n') };
}
// Bloques del editor a partir de lo que devuelve la IA para un tramo (las listas seguidas van juntas; se conserva el
// formato del primer párrafo original: alineación, tamaño, color…)
function aiBlocks(list, E, orig = []) {
  const fmt = orig.find((b) => b.type === 'paragraph') || {};
  const keep = Object.fromEntries(['align', 'size', 'font', 'color', 'bg', 'spacing'].filter((k) => fmt[k]).map((k) => [k, fmt[k]]));
  const out = [];
  for (const x of list || []) {
    const txt = String(x.text || '').trim();
    if (!txt) continue;
    if (x.kind === 'li') { const last = out[out.length - 1]; if (last?.type === 'list') last.items.push(escHtml(txt)); else out.push(E.create('list', { items: [escHtml(txt)] })); continue; }
    if (x.kind === 'h2' || x.kind === 'h3') out.push(E.create('heading', { level: x.kind === 'h3' ? 3 : 2, html: escHtml(txt) }));
    else if (x.kind === 'quote') out.push(E.create('quote', { html: escHtml(txt) }));
    else out.push(E.create('paragraph', { html: escHtml(txt).replace(/\n/g, '<br>'), ...keep }));
  }
  return out;
}

// Normalizar formato: el formato habitual del blog sin tocar el texto (sin IA, al instante; se deshace con Ctrl+Z)
const NORM_LABEL = () => ({ 'títulos→párrafos': t('texto que estaba en títulos'), estilos: t('colores, tamaños y fuentes sueltos'), limpieza: t('código sobrante'), vacíos: t('bloques vacíos'),
  subtítulos: t('subtítulos'), mayúsculas: t('textos en MAYÚSCULAS'), niveles: t('niveles de los títulos'), listas: t('listas'), galerías: t('fotos seguidas → galería'), separadores: t('separadores repetidos') });
$('#d-normalize').onclick = () => {
  const E = window.BlockEditor;
  const r = window.Normalize.normalizeBlocks(draft.blocks, (type, extra) => E.create(type, extra));
  if (!r.changes) return toast(t('La entrada ya tiene el formato habitual.'));
  E.change(() => { draft.blocks = r.blocks; });
  const what = Object.keys(r.notes).map((k) => NORM_LABEL()[k] || k).join(', ');
  toast(t('Formato normalizado: {w}. Puedes deshacerlo con Ctrl+Z.', { w: what }));
};
