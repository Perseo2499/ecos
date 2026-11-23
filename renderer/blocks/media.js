// Editor de bloques · fotos y vídeos: la foto dentro de un bloque (★, ×, alt, arrastrar), las zonas para soltar, elegir de la bandeja y
// la bandeja de fotos y vídeos.
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { $, $$, t, esc, ghost, startDrag, endDrag } = K;

  Object.assign(E, {
    // Foto dentro de un bloque: ★ destacada, × quitar, alt, arrastrar para ordenar o sacar de la galería
    // Foto dentro de un bloque: ★ destacada, × quitar, alt; se arrastra a cualquier sitio
    photo(img, remove, block, index = null) {
      const fig = document.createElement('div');
      const isVid = img.type === 'video';
      fig.className = 'ph' + (isVid ? ' vid' : '') + (this.draft.featuredImageId === img.id ? ' featured' : '');
      fig.draggable = true;
      fig.innerHTML = `${isVid ? `<video src="${esc(img.url)}"${img.poster ? ` poster="${esc(img.poster)}"` : ''} muted preload="metadata" draggable="false"></video><span class="ms fill play">play_circle</span>` : `<img src="${esc(img.url)}" alt="" draggable="false">`}
        <button class="star" title="${t('Usar como imagen destacada (sale del cuerpo y va arriba)')}"><span class="ms fill">star</span></button>
        <button class="del" title="${t('Quitar')}"><span class="ms">close</span></button>
        <input class="alt" placeholder="${t('Descripción (alt)')}" draggable="false">`;
      $('.alt', fig).value = img.alt || '';
      $('.alt', fig).oninput = (e) => { img.alt = e.target.value; this.onChange(); };
      $('.star', fig).onclick = () => this.change(() => { this.draft.featuredImageId = img.id; this.draft.keepFeaturedInBody = false; this.liftFeatured(); });
      $('.del', fig).onclick = remove;
      $(isVid ? 'video' : 'img', fig).onclick = () => this.onOpenMedia(img);
      if (isVid) {
        $('.alt', fig).remove();
        const rep = $('.star', fig); // en los vídeos, el sitio de la estrella lo ocupa «Sustituir por el original»
        rep.className = 'rep'; rep.title = t('Sustituir por el original'); rep.innerHTML = '<span class="ms">high_quality</span>';
        rep.onclick = (e) => { e.stopPropagation(); this.vqMenu(rep, block.id, (bb) => (index !== null ? bb.images[index] : bb.img)); };
        this.vqBadge(fig, $('video', fig), img);
      }
      fig.ondragstart = (e) => {
        if (e.target.tagName === 'INPUT') { e.preventDefault(); return; }
        e.stopPropagation();
        K.drag = { kind: 'photo', block: block.id, index };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-ecos', 'photo');
        ghost(e, isVid ? `<span class="ms">movie</span>${esc(t('Vídeo'))}` : `<img src="${esc(img.url)}" alt="">`);
        startDrag(fig);
      };
      fig.ondragend = () => { K.drag = null; endDrag(); };
      // Dentro de una galería o carrusel: soltar sobre una foto la coloca en su lugar
      if (index !== null) {
        this.acceptPhoto(fig, (got, d) => {
          const b = this.locate(block.id).b;
          let at = index;
          if (d.kind === 'photo' && d.block === block.id && d.index < index) at -= 1; // ya se sacó de antes
          b.images.splice(at + (d.kind === 'photo' && d.block === block.id && d.index < index ? 1 : 0), 0, got);
        }, { video: true });
      }
      return fig;
    },

    dropZone(label, onMedia, small = false, kind = 'image') {
      const z = document.createElement('div');
      z.className = 'drop-zone' + (small ? ' small' : '');
      z.innerHTML = `<span class="ms">${kind === 'video' ? 'movie' : 'add_photo_alternate'}</span><span>${esc(label)}</span>`;
      z.onclick = () => this.pickFromTray(onMedia, kind);
      return z;
    },

    // Acepta fotos/vídeos soltados desde la bandeja (o desde otra galería)
    // Compatibilidad: acepta fotos (de la bandeja o de otros bloques) en un contenedor
    acceptMedia(el, onMedia) { this.acceptPhoto(el, (img) => onMedia(img)); },

    pickFromTray(onMedia, kind) {
      const tray = $('#d-media');
      tray.classList.add('picking');
      const items = $$('.tray-item', tray).filter((x) => kind === 'any' || (kind === 'video') === (x.dataset.type === 'video'));
      const done = () => { tray.classList.remove('picking'); items.forEach((x) => (x.onclick = null)); };
      items.forEach((x) => (x.onclick = () => { done(); onMedia({ ...this.media[Number(x.dataset.i)] }); this.renderMedia(); }));
      setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!tray.contains(e.target)) { done(); document.removeEventListener('mousedown', off); } }), 0);
    },


    // --- Bandeja de fotos y vídeos ---------------------------------------------------
    renderMedia() {
      const tray = $('#d-media');
      const used = new Set(JSON.stringify(this.draft.blocks).match(/"id":\d+/g) || []);
      tray.innerHTML = this.media.length ? '' : `<p class="hint">${t('Sin fotos')}</p>`;
      this.media.forEach((m, i) => {
        const it = document.createElement('div');
        it.className = 'tray-item' + (used.has(`"id":${m.id}`) ? ' used' : '');
        it.dataset.i = i; it.dataset.type = m.type;
        it.draggable = true;
        it.innerHTML = m.type === 'video'
          ? `${m.poster ? `<img src="${esc(m.poster)}" alt="" draggable="false">` : `<video src="${esc(m.url)}" muted preload="metadata"></video>`}<span class="ms fill play">play_circle</span>`
          : `<img src="${esc(m.url)}" alt="" draggable="false">`;
        it.ondragstart = (e) => {
          K.drag = { kind: 'media', media: { ...m } }; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/x-ecos', 'media');
          ghost(e, m.type === 'video' ? `<span class="ms">movie</span>${esc(t('Vídeo'))}` : `<img src="${esc(m.url)}" alt="">`); startDrag(it);
        };
        it.ondragend = () => { K.drag = null; endDrag(); };
        it.ondblclick = () => this.onOpenMedia(m);
        // ✕: quitar de la bandeja (y de la entrada, si está en ella). No se borra de la biblioteca de la web.
        const del = document.createElement('button');
        del.className = 'tray-del'; del.title = t('Quitar de la bandeja'); del.innerHTML = '<span class="ms">close</span>';
        del.draggable = false;
        del.onmousedown = (e) => e.stopPropagation();
        del.onclick = async (e) => {
          e.stopPropagation();
          const inBody = used.has(`"id":${m.id}`) || this.draft.featuredImageId === m.id;
          if (inBody && !await window.ask(t('Esta foto está puesta en la entrada. ¿Quitarla de la bandeja y también de la entrada? (Sigue en la biblioteca de medios de tu web.)'), { ok: t('Quitar'), danger: true })) return;
          this.change(() => {
            const d = this.draft, same = (x) => x && x.id === m.id;
            d.hiddenMedia = [...new Set([...(d.hiddenMedia || []), m.id])];
            d.extraMedia = (d.extraMedia || []).filter((x) => !same(x));
            if (d.featuredImageId === m.id) d.featuredImageId = null;
            const prune = (arr) => {
              for (let k = arr.length - 1; k >= 0; k--) if (['image', 'video'].includes(arr[k].type) && (same(arr[k].img) || same(arr[k].video))) arr.splice(k, 1);
              for (const b of arr) { if (b.images) b.images = b.images.filter((x) => !same(x)); if (same(b.img)) b.img = null; for (const l of this.kids(b)) prune(l); }
            };
            prune(d.blocks);
          });
          this.media = this.media.filter((x) => x.id !== m.id);
          this.renderMedia();
        };
        it.appendChild(del);
        tray.appendChild(it);
      });
      // Soltar en la bandeja una foto de la entrada la quita del contenido
      if (!tray.dataset.wired) {
        tray.dataset.wired = '1';
        const zone = tray.parentElement;
        zone.addEventListener('dragover', (e) => { if (K.drag?.kind === 'photo') { e.preventDefault(); zone.classList.add('over'); } });
        zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('over'); });
        zone.addEventListener('drop', (e) => {
          zone.classList.remove('over');
          if (K.drag?.kind !== 'photo') return;
          e.preventDefault();
          const d = K.drag; K.drag = null; endDrag();
          this.change(() => this.take(d));
        });
      }
    },
  });
})();
