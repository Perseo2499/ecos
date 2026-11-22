// Editor de páginas (fase 2), parte de la interfaz:
//  · «Secciones listas»: galería con miniaturas (las incluidas y «Mis secciones») que inserta la sección ya maquetada
//  · «Guardar como sección»: guarda una sección, unas columnas o una portada en CFG.blockSections (sin fotos)
//  · Vista por dispositivo (Ordenador | Tablet | Móvil) del lienzo del editor
// Los datos y la lógica pura están en renderer/sections.js.

window.SectionsUI = (() => {
  const SK = () => window.Sections;
  const thumb = (rows) => SK().thumbHtml(rows);

  // Abre la galería; devuelve una promesa con la lista de bloques elegidos (nuevos, con identificadores) o null
  function open() {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const d = document.createElement('div');
      d.className = 'dlg-scrim';
      const card = (key, icon, name, desc, rows, del) => `<div class="sg-item"><button type="button" class="sg-card" data-k="${escHtml(key)}"><span class="ms fill">${icon}</span>${thumb(rows)}<b>${escHtml(name)}</b><small>${escHtml(desc)}</small></button>${del ? `<button type="button" class="sg-del" data-del="${escHtml(key)}" title="${t('Borrar esta sección')}"><span class="ms">delete</span></button>` : ''}</div>`;
      const own = () => SK().validUserSections(CFG.blockSections);
      const ownHtml = () => {
        const list = own();
        return list.length
          ? `<div class="sg-grid">${list.map(({ s, index }) => card('u:' + index, 'bookmark', s.name, t('{n} bloques', { n: s.blocks.length }), SK().thumbOf(s.blocks), true)).join('')}</div>`
          : `<p class="hint">${t('Todavía no has guardado ninguna. Usa «Guardar como sección» en la barra de una sección, unas columnas o una portada.')}</p>`;
      };
      d.innerHTML = `<div class="dlg sg-dlg" role="dialog" aria-modal="true">
        <h2>${t('Secciones listas')}</h2>
        <p class="hint">${t('Elige una sección y se añade ya maquetada, con textos de ejemplo que sustituyes por los tuyos.')}</p>
        <div class="sg-grid">${SK().SECTIONS.map((s) => card('b:' + s.id, s.icon, t(s.name), t(s.desc), s.thumb)).join('')}</div>
        <div class="section-label">${t('Mis secciones')}</div>
        <div id="sg-own">${ownHtml()}</div>
        <div class="dlg-actions"><button class="btn text" data-r="x">${t('Cancelar')}</button></div></div>`;
      const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } };
      function close(list) {
        d.classList.add('out'); setTimeout(() => d.remove(), 160);
        document.removeEventListener('keydown', key, true);
        if (prev && prev.focus) prev.focus();
        resolve(list);
      }
      const pick = (k) => {
        const src = k.startsWith('b:') ? SK().SECTIONS.find((s) => 'b:' + s.id === k)?.blocks : (CFG.blockSections || [])[Number(k.slice(2))]?.blocks;
        if (!src) return;
        close(window.BlockEditor.fromTemplate(JSON.parse(JSON.stringify(src))));
      };
      const wire = () => {
        $$('.sg-card', d).forEach((b) => (b.onclick = () => pick(b.dataset.k)));
        $$('.sg-del', d).forEach((b) => (b.onclick = async (e) => {
          e.stopPropagation();
          const i = Number(b.dataset.del.slice(2));
          try {
            CFG = await window.api.setConfig({ blockSections: (CFG.blockSections || []).filter((_, k) => k !== i) });
            $('#sg-own', d).innerHTML = ownHtml(); wire();
            toast(t('Sección borrada'));
          } catch (err) { toastError(err); }
        }));
      };
      wire();
      $('[data-r="x"]', d).onclick = () => close(null);
      d.addEventListener('mousedown', (e) => { if (e.target === d) close(null); });
      document.addEventListener('keydown', key, true);
      document.body.appendChild(d);
      $('.sg-card', d).focus();
    });
  }

  // Guarda una sección, unas columnas o una portada como sección propia (sin fotos)
  async function save(block) {
    if (!block) return;
    const name = await askTemplateName(t('Nombre de la sección'));
    if (!name) return;
    try {
      const sec = SK().makeUserSection(name, block);
      CFG = await window.api.setConfig({ blockSections: [...(CFG.blockSections || []), sec] });
      toast(t('Sección «{p}» guardada en «Mis secciones» (sin fotos)', { p: sec.name }));
    } catch (e) { toastError(e); }
  }

  // --- Vista por dispositivo ---------------------------------------------------------------------------------------
  const DEV_KEY = 'ecos.device';
  function setDevice(dev, remember = true) {
    const d = ['tablet', 'mobile'].includes(dev) ? dev : 'desktop';
    const ed = $('#editor');
    if (!ed) return;
    ed.dataset.device = d;
    $$('#ed-dev [data-dev]').forEach((b) => b.classList.toggle('on', b.dataset.dev === d));
    if (remember) { try { localStorage.setItem(DEV_KEY, d); } catch { /* sin almacenamiento: no se recuerda */ } }
  }
  (() => {
    let saved = 'desktop';
    try { saved = localStorage.getItem(DEV_KEY) || 'desktop'; } catch { /* idem */ }
    $$('#ed-dev [data-dev]').forEach((b) => (b.onclick = () => setDevice(b.dataset.dev)));
    setDevice(saved, false);
  })();

  return { open, save, setDevice };
})();
