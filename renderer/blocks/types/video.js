// Editor de bloques · vídeo suelto y contenido de otras webs (YouTube, Vimeo…), aspecto del vídeo, aviso de baja resolución y
// sustituir por el original.
(function () {
  const E = window.BlockEditor, K = window.BlockKit;
  const { $, $$, t, esc, detectEmbed, toast, info } = K;

  Object.assign(E, {
    // Vídeo suelto: recorte, marco, efecto y colocación (igual en el editor y en la web)
    vidLook(wrap, b) {
      const v = $('video', wrap);
      if (!v) return;
      if (b.ratio) { v.style.aspectRatio = b.ratio; v.style.objectFit = 'cover'; }
      if (b.frame === 'rounded') wrap.style.borderRadius = '16px';
      if (b.frame === 'border') wrap.style.border = '2px solid #333333';
      if (b.frame === 'shadow') wrap.style.boxShadow = '6px 6px 9px rgba(0, 0, 0, 0.2)';
      wrap.classList.toggle('ecos-zoom', b.fx === 'zoom');
      wrap.classList.toggle('ecos-bn', b.fx === 'bw');
      if (['left', 'right', 'center'].includes(b.align)) {
        wrap.classList.add('vid-' + b.align);
        wrap.style.width = ({ 33: 250, 50: 380, 75: 570 }[b.width] || 380) + 'px';
      }
    },

    // --- Calidad del vídeo: etiqueta «Baja resolución» y «Sustituir por el original» -----------------------
    // Pone la etiqueta sobre el vídeo si su lado corto es < 720. Si aún no se conocen las medidas, se leen al cargar el vídeo
    // y se guardan en el propio vídeo (sin repintar ni deshacer: no cambia nada visible salvo la etiqueta).
    vqBadge(host, video, obj) {
      if (!video || !obj) return;
      const tag = document.createElement('span');
      tag.className = 'vq-low hidden';
      tag.title = t('Este vídeo viene así de Instagram o Facebook, con poca resolución. Si tienes el original, usa «Sustituir por el original».');
      tag.innerHTML = `<span class="ms fill">warning</span>${esc(t('Baja resolución'))}`;
      host.appendChild(tag);
      const show = () => tag.classList.toggle('hidden', !window.VidQ.lowRes(obj));
      show();
      if (!(Number(obj.width) > 0 && Number(obj.height) > 0)) {
        video.addEventListener('loadedmetadata', () => {
          if (!video.videoWidth || !video.videoHeight || (obj.width && obj.height)) return;
          obj.width = video.videoWidth; obj.height = video.videoHeight;
          show(); this.onChange?.();
        }, { once: true });
      }
    },
    // Menú pequeño con las dos procedencias del original; el resultado sustituye url, id, portada y medidas
    vqMenu(anchor, blockId, resolve) {
      $$('.vq-menu').forEach((x) => x.remove());
      const r = anchor.getBoundingClientRect();
      const m = document.createElement('div');
      m.className = 'vq-menu';
      m.innerHTML = `<button data-s="gp"><span class="ms">photo_library</span>${esc(t('Desde Google Fotos'))}</button><button data-s="pc"><span class="ms">computer</span>${esc(t('Desde el ordenador'))}</button>`;
      m.style.left = Math.max(8, Math.min(r.left, innerWidth - 220)) + 'px';
      m.style.top = Math.min(r.bottom + 6, innerHeight - 110) + 'px';
      document.body.appendChild(m);
      const close = () => { m.remove(); document.removeEventListener('mousedown', away, true); };
      const away = (e) => { if (!m.contains(e.target)) close(); };
      setTimeout(() => document.addEventListener('mousedown', away, true), 0);
      $$('button', m).forEach((b) => (b.onclick = async () => {
        close();
        let nv = null;
        try { nv = await this.onReplaceVideo?.(b.dataset.s); } catch (e) { toast(e.message || String(e)); return; }
        if (!nv?.url) return;
        this.changeBlock(blockId, () => {
          const bb = this.locate(blockId)?.b, tgt = bb && resolve(bb);
          if (!tgt) return;
          for (const k of ['id', 'url', 'poster', 'width', 'height', 'size']) delete tgt[k];
          Object.assign(tgt, { id: nv.id, url: nv.url, ...(nv.poster ? { poster: nv.poster } : {}), ...(nv.width && nv.height ? { width: nv.width, height: nv.height } : {}) });
        });
        info(t('Vídeo sustituido por el original'));
      }));
    },

    urlField(label, onOk, focus = false) {
      const f = document.createElement('div');
      f.className = 'url-field';
      f.innerHTML = `<span class="ms">link</span><input placeholder="${esc(label)}"><button class="btn tonal small">${t('Insertar')}</button>`;
      const inp = $('input', f);
      const go = () => {
        const emb = detectEmbed(inp.value);
        if (!emb) { inp.classList.add('bad'); toast(t('Pega un enlace completo de YouTube, Vimeo, TikTok, Dailymotion, Spotify, SoundCloud, X, Instagram, Facebook o de un archivo de vídeo.')); return; }
        onOk(emb);
      };
      $('button', f).onclick = go;
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
      inp.onpaste = () => setTimeout(() => { if (detectEmbed(inp.value)) go(); }, 0);
      if (focus) requestAnimationFrame(() => inp.focus());
      return f;
    },
  });

  E.types.video = function (b, i, body, extra) {
    if (!b.video) {
      body.appendChild(this.dropZone(t('Arrastra aquí un vídeo de la bandeja'), (m) => this.change(() => (b.video = m)), false, 'video'));
      body.appendChild(this.urlField(t('…o pega el enlace del vídeo (YouTube, Vimeo, TikTok, archivo .mp4…)'), (emb) => {
        if (emb.file) this.change(() => (b.video = { url: emb.url }));
        else this.replaceBlock(b, this.create('embed', { url: emb.url, provider: emb.provider }), false);
      }));
      return;
    }
    const v = document.createElement('video');
    v.src = b.video.url; v.controls = false; v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true; v.preload = 'metadata'; if (b.video.poster) v.poster = b.video.poster;
    v.title = t('Toca para pausar o seguir'); v.style.cursor = 'pointer'; v.onclick = () => { if (v.paused) v.play().catch(() => {}); else v.pause(); };
    const vw = document.createElement('div');
    vw.className = 'vid-wrap';
    vw.appendChild(v);
    this.vidLook(vw, b);
    this.vqBadge(vw, v, b.video);
    body.appendChild(vw);
    body.appendChild(this.editable('figcaption', b.caption, t('Pie del vídeo (opcional)'), (h) => (b.caption = h), { block: b }));
    extra.innerHTML = `<button class="lv" data-vrep="1" title="${t('Cambia este vídeo por el original (más nitidez) sin perder su sitio, estilo ni pie')}"><span class="ms">high_quality</span><span class="lbl">${t('Sustituir por el original')}</span></button>`;
    $('[data-vrep]', extra).onclick = (e) => this.vqMenu(e.currentTarget, b.id, (bb) => bb.video);
    this.styleBtn(extra, b);
  };

  E.types.embed = function (b, i, body, extra) {
    if (!b.url) {
      body.appendChild(this.urlField(t('Pega el enlace (YouTube, Vimeo, TikTok, Spotify, X, Instagram…)'), (emb) => {
        if (emb.file) this.replaceBlock(b, this.create('video', { video: { url: emb.url } }), false);
        else this.change(() => { b.url = emb.url; b.provider = emb.provider; }, b.id);
      }, true));
      return;
    }
    const emb = detectEmbed(b.url) || { name: b.provider === 'facebook' ? 'Facebook' : 'Instagram' };
    if (emb.player) {
      const fr = document.createElement('div');
      fr.className = 'embed-frame' + (b.provider === 'spotify' ? ' audio' : '');
      fr.innerHTML = `<iframe src="${esc(emb.player)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`;
      body.appendChild(fr);
    } else {
      body.innerHTML = `<div class="embed-box"><span class="ms fill">smart_display</span><div><b>${esc(emb.name || b.provider)}</b><div class="hint">${esc(b.url)}</div><div class="hint">${t('Tu web mostrará aquí el contenido original.')}</div></div></div>`;
    }
    if (!['instagram', 'facebook'].includes(b.provider) || b.caption) body.appendChild(this.editable('figcaption', b.caption, t('Pie (opcional)'), (h) => (b.caption = h)));
    extra.innerHTML = `<button class="lv" data-u="1" title="${t('Cambiar enlace')}"><span class="ms">link</span></button>`;
    $('[data-u]', extra).onclick = () => this.change(() => { b.url = ''; b.provider = ''; }, b.id);
  };
})();
