// Ecos · «Más bloques»: pestañas, línea de tiempo, cifras, testimonios, tarjetas con icono, llamada a la acción, donación, evento,
// audio, PDF, puntos interactivos, antes/después y preguntas frecuentes.
// Lógica pura (sin DOM) compartida por el editor, la salida a WordPress (src/transform.js: compose) y la lectura de vuelta
// (src/parseblocks.js: read). Cada bloque sale como bloques estándar de WordPress (group, heading, paragraph, buttons, details,
// image, audio, file, embed…) con clases ecos-*; su CSS (CSS) va en el bloque ecos-fx y su guion (renderer/morefx.js) codificado o
// en el complemento. Sin JavaScript, todo se ve en orden y legible.
(function (root) {
  const has = (v) => v !== undefined && v !== null && v !== '';
  const clampInt = (v, a, b, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(a, Math.min(b, n)) : d; };
  const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i;

  // --- Iconos de las tarjetas: nombre de Material Symbols → emoji que sale en la web (no hace falta ninguna fuente) -----------------
  const ICONS = [
    ['favorite', '❤️'], ['star', '⭐'], ['home', '🏠'], ['mail', '✉️'], ['call', '📞'], ['location_on', '📍'], ['calendar_month', '📅'],
    ['schedule', '🕒'], ['group', '👥'], ['person', '👤'], ['school', '🎓'], ['work', '💼'], ['shopping_cart', '🛒'], ['local_shipping', '🚚'],
    ['payments', '💶'], ['savings', '🐷'], ['volunteer_activism', '💝'], ['handshake', '🤝'], ['public', '🌍'], ['eco', '🌱'], ['park', '🌳'],
    ['water_drop', '💧'], ['bolt', '⚡'], ['lightbulb', '💡'], ['build', '🔧'], ['settings', '⚙️'], ['security', '🔒'], ['verified', '✅'],
    ['thumb_up', '👍'], ['emoji_events', '🏆'], ['celebration', '🎉'], ['cake', '🎂'], ['restaurant', '🍽️'], ['local_cafe', '☕'],
    ['local_hospital', '🏥'], ['medical_services', '🩺'], ['pets', '🐾'], ['child_care', '🧸'], ['sports_soccer', '⚽'], ['music_note', '🎵'],
    ['mic', '🎤'], ['photo_camera', '📷'], ['movie', '🎬'], ['menu_book', '📖'], ['edit', '✏️'], ['brush', '🎨'], ['language', '🌐'],
    ['phone_iphone', '📱'], ['computer', '💻'], ['wifi', '📶'], ['cloud', '☁️'], ['search', '🔍'], ['info', 'ℹ️'], ['help', '❓'],
    ['warning', '⚠️'], ['flag', '🚩'], ['rocket_launch', '🚀'], ['diamond', '💎'], ['redeem', '🎁'], ['forum', '💬'], ['campaign', '📣'],
    ['newspaper', '📰'], ['directions_bus', '🚌'], ['directions_bike', '🚲'], ['flight', '✈️'], ['map', '🗺️'],
  ];
  const ICON_MAP = Object.fromEntries(ICONS);
  const isIconName = (s) => Object.prototype.hasOwnProperty.call(ICON_MAP, s);
  // Un icono es un nombre de la lista o un emoji / símbolo corto (sin etiquetas ni comillas)
  const safeGlyph = (s) => { const v = String(s || '').trim(); return v.length && v.length <= 12 && !/[<>&"'\s\x00-\x1f]/.test(v) && /[^\x00-\x7f]/.test(v) ? v : ''; };
  const iconValue = (s) => (isIconName(s) ? s : safeGlyph(s));
  const iconGlyph = (s) => (isIconName(s) ? ICON_MAP[s] : safeGlyph(s));

  // --- Fechas, calendario (.ics) y enlace a Google Calendar ---------------------------------------------------------------
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const p2 = (n) => String(n).padStart(2, '0');
  // «2026-12-05T18:30» o «2026-12-05» (todo el día) → { y, mo, d, h, mi, all } o null
  function parseDT(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
    if (!m) return null;
    const o = { y: +m[1], mo: +m[2], d: +m[3], h: m[4] === undefined ? 0 : +m[4], mi: m[5] === undefined ? 0 : +m[5], all: m[4] === undefined };
    const dt = new Date(Date.UTC(o.y, o.mo - 1, o.d, o.h, o.mi));
    if (dt.getUTCFullYear() !== o.y || dt.getUTCMonth() !== o.mo - 1 || dt.getUTCDate() !== o.d || o.h > 23 || o.mi > 59) return null;
    return o;
  }
  const stamp = (o) => `${o.y}${p2(o.mo)}${p2(o.d)}` + (o.all ? '' : `${p2(o.h)}${p2(o.mi)}`);
  // con «T» y segundos (formato de los calendarios)
  const tstamp = (o) => `${o.y}${p2(o.mo)}${p2(o.d)}` + (o.all ? '' : `T${p2(o.h)}${p2(o.mi)}00`);
  const fromStamp = (s) => { const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2}))?$/); return m ? `${m[1]}-${m[2]}-${m[3]}` + (m[4] ? `T${m[4]}:${m[5]}` : '') : ''; };
  function shift(o, mins) {
    const dt = new Date(Date.UTC(o.y, o.mo - 1, o.d, o.h, o.mi) + mins * 60000);
    return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), all: o.all };
  }
  const dayText = (o) => `${DAYS[new Date(Date.UTC(o.y, o.mo - 1, o.d)).getUTCDay()]} ${o.d} de ${MONTHS[o.mo - 1]} de ${o.y}`;
  const hm = (o) => `${p2(o.h)}:${p2(o.mi)}`;
  // Texto de la fecha y la hora que se ve en la web
  function whenText(start, end) {
    const a = parseDT(start), z = parseDT(end);
    if (!a) return '';
    let s = dayText(a) + (a.all ? '' : ', ' + hm(a));
    if (z) {
      const same = a.y === z.y && a.mo === z.mo && a.d === z.d;
      if (same) { if (!a.all && !z.all && hm(z) !== hm(a)) s += ' – ' + hm(z); }
      else s += ' – ' + dayText(z) + (z.all ? '' : ', ' + hm(z));
    }
    return s;
  }
  // Fin de un evento: el indicado, o una hora después (todo el día: el mismo día)
  function endOf(start, end) {
    const a = parseDT(start), z = parseDT(end);
    if (z && (z.all === a.all)) return z;
    return a.all ? a : shift(a, 60);
  }
  const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  // Líneas de más de 75 caracteres: se parten con un espacio al principio de la siguiente
  const fold = (line) => { const out = []; let l = line; while ([...l].length > 73) { const cut = [...l].slice(0, 73).join(''); out.push(cut); l = ' ' + l.slice(cut.length); } out.push(l); return out.join('\r\n'); };
  // Archivo .ics (hora local «flotante», sin zona: se abre a la hora indicada en el calendario de quien lo añade)
  function ics(ev) {
    const a = parseDT(ev.start);
    if (!a) return '';
    const z = endOf(ev.start, ev.end);
    const uid = 'ecos-' + stamp(a) + '-' + hash(String(ev.title || '') + String(ev.place || '')) + '@ecos';
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ecos//Evento//ES', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + tstamp({ ...a, all: false }) + 'Z'];
    if (a.all) { L.push('DTSTART;VALUE=DATE:' + tstamp(a), 'DTEND;VALUE=DATE:' + tstamp(shift(z, 1440))); }
    else L.push('DTSTART:' + tstamp(a), 'DTEND:' + tstamp(z));
    L.push('SUMMARY:' + icsText(ev.title || 'Evento'));
    if (has(ev.place)) L.push('LOCATION:' + icsText(ev.place));
    const desc = String(ev.text || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (desc) L.push('DESCRIPTION:' + icsText(desc));
    if (/^https?:\/\//i.test(ev.url || '')) L.push('URL:' + ev.url);
    L.push('END:VEVENT', 'END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  const icsUri = (ev) => { const s = ics(ev); return s ? 'data:text/calendar;charset=utf-8,' + encodeURIComponent(s) : ''; };
  function googleUrl(ev) {
    const a = parseDT(ev.start);
    if (!a) return '';
    const z = endOf(ev.start, ev.end);
    const dates = `${tstamp(a)}/${tstamp(a.all ? shift(z, 1440) : z)}`;
    const q = [['action', 'TEMPLATE'], ['text', ev.title || 'Evento'], ['dates', dates], ['location', ev.place || ''], ['details', String(ev.text || '').replace(/<[^>]+>/g, '').trim()]]
      .filter(([, v]) => v).map(([k, v]) => `${k}=${k === 'dates' ? v : encodeURIComponent(v)}`).join('&');
    return 'https://calendar.google.com/calendar/render?' + q;
  }
  const mapLink = (place) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(place || '').trim());
  function hash(s) { let h = 5381; for (const c of String(s)) h = ((h * 33) ^ c.codePointAt(0)) >>> 0; return h.toString(16).padStart(8, '0'); }

  // --- Salida a WordPress -----------------------------------------------------------------------------------------------
  const J = (o) => (Object.keys(o).length ? ' ' + JSON.stringify(o).replace(/--/g, '\\u002d\\u002d') : '');
  const wp = (name, attrs, html) => `<!-- wp:${name}${J(attrs)} -->\n${html}\n<!-- /wp:${name} -->`;
  const grp = (cls, kids) => { const k = kids.filter(Boolean); return wp('group', { layout: { type: 'constrained' }, className: cls }, `<div class="wp-block-group ${cls}">${k.length ? '\n' + k.join('\n\n') + '\n' : ''}</div>`); };
  const para = (html, cls) => (html ? wp('paragraph', cls ? { className: cls } : {}, `<p${cls ? ` class="${cls}"` : ''}>${html}</p>`) : '');
  const head = (level, html, cls) => (html ? wp('heading', { ...(level === 2 ? {} : { level }), ...(cls ? { className: cls } : {}) }, `<h${level} class="wp-block-heading${cls ? ' ' + cls : ''}">${html}</h${level}>`) : '');
  // Añade una clase al bloque exterior (comentario y etiqueta)
  function addClass(markup, cls) {
    const m = markup.match(/^<!-- wp:([a-z0-9/-]+)(?: (\{[\s\S]*?\}))? -->\n/);
    if (!m) return markup;
    const attrs = m[2] ? JSON.parse(m[2]) : {};
    attrs.className = [...new Set([...(attrs.className ? String(attrs.className).split(/\s+/) : []), cls])].join(' ');
    const ordered = {};
    for (const k of Object.keys(attrs)) if (!['style', 'layout', 'className'].includes(k)) ordered[k] = attrs[k];
    for (const k of ['style', 'layout', 'className']) if (k in attrs) ordered[k] = attrs[k];
    let rest = markup.slice(m[0].length);
    rest = rest.replace(/^(<[a-z0-9]+ class=")([^"]*)"/, (_x, a, c) => `${a}${[...new Set([...c.split(/\s+/), cls])].join(' ')}"`);
    return `<!-- wp:${m[1]}${J(ordered)} -->\n${rest}`;
  }
  const cols = (n) => `ecos-cols-${clampInt(n, 1, 4, 2)}`;
  const paras = (env, html) => env.sanitize(html).map((p) => para(p));
  const photo = (env, img, cap) => (img && img.url ? env.imageBlock(img, cap || '', {}) : '');

  // Varios botones en un mismo bloque «Botones» (el primero con su estilo, los demás aparte)
  function buttons(env, list, align) {
    const mk = list.map((x) => env.buttonsBlock({ ...x, align: x.align || align })).filter(Boolean);
    if (!mk.length) return '';
    let out = mk[0];
    for (const extra of mk.slice(1)) {
      const btn = (extra.match(/<!-- wp:button(?: \{[\s\S]*?\})? -->[\s\S]*?<!-- \/wp:button -->/) || [''])[0];
      out = out.replace(/(<\/div>\n<!-- \/wp:buttons -->)$/, `${btn}$1`);
    }
    return out;
  }

  const COMPOSE = {
    tabs(b, env) {
      const tabs = (b.cols || []).filter(Boolean);
      if (!tabs.length) return '';
      const items = tabs.map((c, k) => grp('ecos-tab', [head(3, env.inline(c.title || '') || `Pestaña ${k + 1}`), env.composeList(c.children || [])]));
      return grp('ecos-tabs' + (b.variant === 'pill' ? ' ecos-tabs-pill' : ''), items);
    },
    timeline(b, env) {
      const items = (b.items || []).filter((x) => x && (env.inline(x.title) || env.inline(x.html) || env.inline(x.date)));
      if (!items.length) return '';
      return grp('ecos-timeline' + (b.dir === 'h' ? ' ecos-tl-h' : ''), items.map((x) => grp('ecos-tl-item', [
        para(env.inline(x.date), 'ecos-tl-date'), head(3, env.inline(x.title), 'ecos-tl-title'), ...paras(env, x.html), photo(env, x.img),
      ])));
    },
    figures(b, env) {
      const items = (b.items || []).filter((x) => x && (env.inline(x.value) || env.inline(x.label)));
      if (!items.length) return '';
      return grp(`ecos-cifras ${cols(items.length)}` + (b.count ? ' ecos-count' : ''), items.map((x) => grp('ecos-cifra', [para(env.inline(x.value), 'ecos-cifra-num'), para(env.inline(x.label), 'ecos-cifra-txt')])));
    },
    testimonials(b, env) {
      const items = (b.items || []).filter((x) => x && (env.inline(x.html) || env.inline(x.name)));
      if (!items.length) return '';
      const q = (html) => { const ps = env.sanitize(html); return ps.length ? wp('quote', {}, `<blockquote class="wp-block-quote">${ps.map((p) => wp('paragraph', {}, `<p>${p}</p>`)).join('\n')}</blockquote>`) : ''; };
      const cls = 'ecos-testimonios ' + cols(b.slider ? 3 : items.length) + (b.slider ? ' ecos-t-slider' : '');
      return grp(cls, items.map((x) => grp('ecos-testimonio', [
        x.img && x.img.url ? env.imageBlock(x.img, '', { w: '88px', ratio: '1', frame: 'circle' }) : '', q(x.html), para(env.inline(x.name), 'ecos-t-nombre'), para(env.inline(x.role), 'ecos-t-cargo'),
      ])));
    },
    cards(b, env) {
      const items = (b.items || []).filter((x) => x && (env.inline(x.title) || env.inline(x.html)));
      if (!items.length) return '';
      return grp(`ecos-tarjetas ${cols(items.length)}`, items.map((x) => {
        const ic = iconValue(x.icon), glyph = iconGlyph(x.icon);
        const link = /^(https?:|mailto:|tel:|#)/i.test(x.url || '') ? para(`<a href="${env.esc(x.url)}">${env.inline(x.label) || 'Saber más'}</a>`, 'ecos-tarjeta-enlace') : '';
        return grp('ecos-tarjeta', [glyph ? para(env.esc(glyph), 'ecos-icono' + (isIconName(ic) ? ' ecos-ico-' + ic.replace(/_/g, '-') : '')) : '', head(3, env.inline(x.title), 'ecos-tarjeta-t'), ...paras(env, x.html), link]);
      }));
    },
    cta(b, env) {
      const btns = (b.buttons || []).filter((x) => x && env.inline(x.html)).slice(0, 2).map((x, k) => (k === 0
        ? { html: x.html, url: x.url, variant: 'fill', bg: b.btnBg, color: b.btnColor, radius: b.btnRadius, size: b.btnSize }
        : { html: x.html, url: x.url, variant: 'outline' }));
      const align = b.align === 'left' ? 'left' : 'center';
      const al = align === 'center' ? { align: 'center' } : {};
      const children = [{ type: 'heading', level: 2, html: b.title || '', ...al }, { type: 'paragraph', html: b.html || '', ...al }];
      const bm = buttons(env, btns, align);
      if (bm) children.push({ type: 'raw', markup: bm });
      const g = { type: 'group', pad: has(b.pad) ? b.pad : 'l', radius: has(b.radius) ? b.radius : 16, children, ...(b.bg ? { bg: b.bg } : {}), ...(b.gradient ? { gradient: b.gradient } : {}), ...(b.color ? { color: b.color } : {}), ...(b.width ? { width: b.width } : {}) };
      return addClass(env.groupBlock(g), 'ecos-cta');
    },
    donate(b, env) {
      const preset = ['bizum', 'paypal', 'transfer', 'link'].includes(b.preset) ? b.preset : 'bizum';
      const amounts = (b.amounts || []).map((a) => clampInt(a, 1, 100000, 0)).filter(Boolean).slice(0, 6);
      const kids = [head(3, env.inline(b.title)), ...paras(env, b.html)];
      const btns = [];
      const copy = (v) => '#ecos-copy-' + encodeURIComponent(String(v).replace(/\s+/g, ''));
      const money = (a) => `${a} €`;
      if (preset === 'bizum' && has(b.value)) {
        kids.push(para(`Bizum: <strong>${env.esc(b.value)}</strong>`, 'ecos-don-dato'));
        btns.push({ html: env.inline(b.label) || 'Copiar el número', url: copy(b.value) });
      } else if (preset === 'transfer' && has(b.value)) {
        kids.push(para(`IBAN: <strong>${env.esc(b.value)}</strong>`, 'ecos-don-dato'));
        if (has(b.holder)) kids.push(para(`Titular: ${env.esc(b.holder)}`, 'ecos-don-titular'));
        btns.push({ html: env.inline(b.label) || 'Copiar el IBAN', url: copy(b.value) });
      } else if (preset === 'paypal') {
        const user = String(b.value || '').replace(/^.*paypal\.me\//i, '').replace(/[^\w.-]/g, '');
        const hosted = String(b.hosted || '').replace(/[^\w-]/g, '');
        if (hosted) btns.push({ html: env.inline(b.label) || 'Donar con PayPal', url: 'https://www.paypal.com/donate/?hosted_button_id=' + hosted });
        else if (user) {
          for (const a of amounts) btns.push({ html: money(a), url: `https://www.paypal.me/${user}/${a}EUR`, variant: 'outline' });
          btns.push({ html: env.inline(b.label) || 'Donar con PayPal', url: `https://www.paypal.me/${user}` });
        }
      } else if (preset === 'link' && /^https?:\/\//i.test(b.url || '')) {
        btns.push({ html: env.inline(b.label) || 'Donar', url: b.url });
      }
      if (amounts.length && preset !== 'paypal') kids.push(para(`Importes sugeridos: ${amounts.map(money).join(' · ')}`, 'ecos-don-importes'));
      const bm = buttons(env, btns, b.align === 'center' ? 'center' : 'left');
      if (!bm && !kids.filter(Boolean).length) return '';
      return grp(`ecos-donar ecos-don-${preset}`, [...kids, bm]);
    },
    event(b, env) {
      const a = parseDT(b.start);
      if (!a && !env.inline(b.title)) return '';
      const z = a && parseDT(b.end) && parseDT(b.end).all === a.all ? parseDT(b.end) : null;
      let cls = 'ecos-evento' + (a ? ' ecos-ev-s-' + stamp(a) : '') + (z ? ' ecos-ev-e-' + stamp(z) : '');
      const place = String(b.place || '').replace(/\s+/g, ' ').trim();
      const text = env.sanitize(b.html).join('\n');
      const ev = { title: String(b.title || '').replace(/<[^>]+>/g, ''), start: b.start, end: z ? b.end : '', place, text, url: b.url };
      const kids = [head(3, env.inline(b.title)), a ? para(env.esc(whenText(b.start, z ? b.end : '')), 'ecos-ev-fecha') : '',
        place ? para(`<a href="${env.esc(mapLink(place))}">${env.esc(place)}</a>`, 'ecos-ev-lugar') : '', place && b.showMap ? env.mapBlock({ address: place, height: 280, radius: 12 }) : '', ...paras(env, b.html)];
      const btns = [];
      if (a) btns.push({ html: 'Añadir al calendario', url: icsUri(ev) }, { html: 'Google Calendar', url: googleUrl(ev), variant: 'outline' });
      const bm = buttons(env, btns, 'left');
      return grp(cls, [...kids, bm]);
    },
    audio(b, env) {
      const url = String(b.url || '').trim();
      let media = '';
      if (/^https?:\/\//i.test(url)) {
        media = b.mode === 'embed' ? env.embedFull({ url, provider: ['spotify', 'soundcloud'].includes(b.provider) ? b.provider : '' })
          : wp('audio', {}, `<figure class="wp-block-audio"><audio controls src="${env.esc(url)}"></audio></figure>`);
      }
      if (!media && !env.inline(b.title)) return '';
      return grp('ecos-audio', [head(3, env.inline(b.title)), ...paras(env, b.html), media]);
    },
    pdf(b, env) {
      const url = String(b.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return env.inline(b.title) ? grp('ecos-pdf', [head(3, env.inline(b.title))]) : '';
      const name = env.inline(b.name) || decodeURIComponent(url.split('?')[0].split('/').pop() || 'documento.pdf');
      const dl = b.download !== false, prev = b.preview !== false, h = clampInt(b.height, 200, 1400, 600);
      const attrs = { href: url, ...(prev ? { displayPreview: true } : {}), ...(h !== 600 ? { previewHeight: h } : {}), ...(dl ? {} : { showDownloadButton: false }) };
      const uid = 'wp-block-file--media-' + hash(url);
      const u = env.esc(url);
      const file = wp('file', attrs, `<div class="wp-block-file">${prev ? `<object class="wp-block-file__embed" data="${u}" type="application/pdf" style="width:100%;height:${h}px" aria-label="${name.replace(/<[^>]+>/g, '')}"></object>` : ''}<a id="${uid}" href="${u}">${name}</a>${dl ? `<a href="${u}" class="wp-block-file__button wp-element-button" download aria-describedby="${uid}">${env.inline(b.dlText) || 'Descargar'}</a>` : ''}</div>`);
      return grp('ecos-pdf', [head(3, env.inline(b.title)), ...paras(env, b.html), file]);
    },
    hotspots(b, env) {
      if (!b.img || !b.img.url) return '';
      const pts = (b.points || []).filter((p) => p && (env.inline(p.title) || env.inline(p.html)));
      return grp('ecos-puntos', [photo(env, b.img), ...pts.map((p) => grp(`ecos-punto ecos-px-${clampInt(p.x, 0, 100, 50)} ecos-py-${clampInt(p.y, 0, 100, 50)}`, [head(4, env.inline(p.title)), ...paras(env, p.html)]))]);
    },
    compare(b, env) {
      const a = b.before, z = b.after;
      if (!(a && a.url) && !(z && z.url)) return '';
      return grp(`ecos-compare ecos-cmp-${clampInt(b.pos, 0, 100, 50)}`, [photo(env, a), photo(env, z)]);
    },
    faq(b, env) {
      const items = (b.items || []).filter((x) => x && env.inline(x.q));
      if (!items.length) return '';
      const name = 'ecos-faq-' + hash(items.map((x) => x.q).join('|'));
      return grp('ecos-faq' + (b.one ? ' ecos-faq-uno' : ''), items.map((x) => wp('details', {}, `<details class="wp-block-details"${b.one ? ` name="${name}"` : ''}><summary>${env.inline(x.q)}</summary>${env.sanitize(x.html).map((p) => wp('paragraph', {}, `<p>${p}</p>`)).join('\n')}</details>`)));
    },
  };
  const TYPE_NAMES = Object.keys(COMPOSE);
  // Los usos de CSS / guion que cada bloque necesita (claves de FX_CSS)
  const FX = { tabs: ['tabs', 'more'], timeline: ['timeline'], figures: ['figures', 'more'], testimonials: ['testimonials'], cards: ['cards'], cta: ['cta'], donate: ['donate', 'more'],
    event: ['event', 'more'], audio: ['audio'], pdf: ['pdf'], hotspots: ['hotspots', 'more'], compare: ['compare', 'more'], faq: ['faq', 'more'] };

  // composición: devuelve '' si el bloque está vacío; `env` pone las herramientas de transform.js
  function compose(b, env) {
    const fn = COMPOSE[b.type];
    if (!fn) return null;
    const out = fn(b, env);
    if (out) for (const k of FX[b.type]) env.fx(k);
    return out;
  }

  // --- Lectura de vuelta ------------------------------------------------------------------------------------------------
  const classes = (t) => String(t.attrs?.className || '').split(/\s+/).filter(Boolean);
  const hasC = (t, c) => classes(t).includes(c);
  const emptyFree = (x) => x.name !== 'freeform' || x.inner.replace(/<[^>]+>|&nbsp;|\s/g, '');
  // Bloques de primer nivel dentro de un contenedor; null si hay texto suelto
  function kids(env, t) {
    const l = env.tokenize(t.inner).filter(emptyFree);
    return l.some((x) => x.name === 'freeform') ? null : l;
  }
  const joinP = (env, list) => list.map((x) => env.inner(x.inner, 'p')).join('<br><br>');
  const num = (t, re) => { for (const c of classes(t)) { const m = c.match(re); if (m) return Number(m[1]); } return undefined; };

  const READ = {
    tabs(t, env) {
      const ks = kids(env, t);
      if (!ks || !ks.length) return null;
      const cols = [];
      for (const k of ks) {
        if (k.name !== 'group' || !hasC(k, 'ecos-tab')) return null;
        const inn = kids(env, k);
        if (!inn || !inn.length || inn[0].name !== 'heading') return null;
        const lv = inn[0].attrs.level || 2;
        const rest = env.parseList(inn.slice(1).map((x) => x.raw).join('\n\n'));
        cols.push({ title: env.inner(inn[0].inner, 'h' + lv), width: '', children: rest });
      }
      return { type: 'tabs', cols, ...(hasC(t, 'ecos-tabs-pill') ? { variant: 'pill' } : {}) };
    },
    timeline(t, env) {
      const ks = kids(env, t);
      if (!ks || !ks.length) return null;
      const items = [];
      for (const k of ks) {
        if (k.name !== 'group' || !hasC(k, 'ecos-tl-item')) return null;
        const inn = kids(env, k);
        if (!inn) return null;
        const it = { date: '', title: '', html: '', img: null };
        const text = [];
        for (const x of inn) {
          if (x.name === 'paragraph' && hasC(x, 'ecos-tl-date')) it.date = env.inner(x.inner, 'p');
          else if (x.name === 'heading' && hasC(x, 'ecos-tl-title')) it.title = env.inner(x.inner, 'h' + (x.attrs.level || 2));
          else if (x.name === 'paragraph' && !classes(x).length) text.push(x);
          else if (x.name === 'image') it.img = env.imgOf(x.inner);
          else return null;
        }
        it.html = joinP(env, text);
        items.push(it);
      }
      return { type: 'timeline', items, dir: hasC(t, 'ecos-tl-h') ? 'h' : 'v' };
    },
    figures(t, env) {
      const ks = kids(env, t);
      if (!ks || !ks.length) return null;
      const items = [];
      for (const k of ks) {
        if (k.name !== 'group' || !hasC(k, 'ecos-cifra')) return null;
        const inn = kids(env, k);
        if (!inn) return null;
        const it = { value: '', label: '' };
        for (const x of inn) {
          if (x.name === 'paragraph' && hasC(x, 'ecos-cifra-num')) it.value = env.inner(x.inner, 'p');
          else if (x.name === 'paragraph' && hasC(x, 'ecos-cifra-txt')) it.label = env.inner(x.inner, 'p');
          else return null;
        }
        items.push(it);
      }
      return { type: 'figures', items, count: hasC(t, 'ecos-count') };
    },
    testimonials(t, env) {
      const ks = kids(env, t);
      if (!ks || !ks.length) return null;
      const items = [];
      for (const k of ks) {
        if (k.name !== 'group' || !hasC(k, 'ecos-testimonio')) return null;
        const inn = kids(env, k);
        if (!inn) return null;
        const it = { html: '', name: '', role: '', img: null };
        for (const x of inn) {
          if (x.name === 'image') it.img = env.imgOf(x.inner);
          else if (x.name === 'quote') it.html = env.all(x.inner, 'p').join('<br><br>');
          else if (x.name === 'paragraph' && hasC(x, 'ecos-t-nombre')) it.name = env.inner(x.inner, 'p');
          else if (x.name === 'paragraph' && hasC(x, 'ecos-t-cargo')) it.role = env.inner(x.inner, 'p');
          else return null;
        }
        items.push(it);
      }
      return { type: 'testimonials', items, ...(hasC(t, 'ecos-t-slider') ? { slider: true } : {}) };
    },
    cards(t, env) {
      const ks = kids(env, t);
      if (!ks || !ks.length) return null;
      const items = [];
      for (const k of ks) {
        if (k.name !== 'group' || !hasC(k, 'ecos-tarjeta')) return null;
        const inn = kids(env, k);
        if (!inn) return null;
        const it = { icon: '', title: '', html: '', url: '', label: '' };
        const text = [];
        for (const x of inn) {
          if (x.name === 'paragraph' && hasC(x, 'ecos-icono')) {
            const c = classes(x).find((y) => /^ecos-ico-[a-z-]+$/.test(y));
            const nm = c ? c.slice(9).replace(/-/g, '_') : '';
            it.icon = isIconName(nm) ? nm : env.decode(env.inner(x.inner, 'p'));
          } else if (x.name === 'heading' && hasC(x, 'ecos-tarjeta-t')) it.title = env.inner(x.inner, 'h' + (x.attrs.level || 2));
          else if (x.name === 'paragraph' && hasC(x, 'ecos-tarjeta-enlace')) { const a = env.inner(x.inner, 'p'); it.url = env.attr((a.match(/<a\b[^>]*>/) || [''])[0], 'href'); it.label = env.inner(a, 'a'); }
          else if (x.name === 'paragraph' && !classes(x).length) text.push(x);
          else return null;
        }
        it.html = joinP(env, text);
        items.push(it);
      }
      return { type: 'cards', items };
    },
    cta(t, env, d) {
      const attrs = { ...t.attrs };
      attrs.className = classes(t).filter((c) => c !== 'ecos-cta').join(' ');
      if (!attrs.className) delete attrs.className;
      const g = env.core({ ...t, attrs }, 'group', d);
      if (!g || g.type !== 'group') return null;
      const out = { type: 'cta', title: '', html: '', buttons: [] };
      const grab = (list) => {
        list.forEach((x, k) => {
          const o = { html: x.html, url: x.url };
          if (!out.buttons.length && x.variant !== 'outline') { if (x.bg) out.btnBg = x.bg; if (x.color) out.btnColor = x.color; if (x.radius) out.btnRadius = x.radius; if (x.size) out.btnSize = x.size; }
          out.buttons.push(o);
          void k;
        });
      };
      for (const c of g.children || []) {
        if (c.type === 'heading') { out.title = c.html; if (c.align) out.align = c.align; }
        else if (c.type === 'paragraph') { out.html = c.html; if (c.align && !out.align) out.align = c.align; }
        else if (c.type === 'buttons') grab([c]);
        else if (c.type === 'raw') {
          const bt = env.tokenize(c.markup).find((x) => x.name === 'buttons');
          if (!bt) return null;
          grab(env.tokenize(bt.inner).filter((x) => x.name === 'button').map((x) => env.core({ name: 'buttons', attrs: bt.attrs, inner: `<div class="wp-block-buttons">${x.raw}</div>`, raw: '' }, 'buttons', {})).filter((x) => x && x.type === 'buttons'));
        } else return null;
      }
      out.align = out.align === 'center' ? 'center' : 'left';
      for (const k of ['pad', 'radius', 'bg', 'gradient', 'color', 'width', 'p']) if (g[k] !== undefined) out[k] = g[k];
      // el borde fino y la sombra son del apartado «Diseño» (como en el resto de bloques): se devuelven a él
      if (g.border) { d.bw = 1; d.bc = g.border; }
      if (g.shadow) d.sh = 'm';
      out.title = out.title || '';
      return out;
    },
    donate(t, env) {
      const pc = classes(t).find((c) => /^ecos-don-(bizum|paypal|transfer|link)$/.test(c));
      const ks = kids(env, t);
      if (!pc || !ks) return null;
      const out = { type: 'donate', preset: pc.slice(9), title: '', html: '', amounts: [] };
      const text = [];
      for (const x of ks) {
        if (x.name === 'heading') out.title = env.inner(x.inner, 'h' + (x.attrs.level || 2));
        else if (x.name === 'paragraph' && hasC(x, 'ecos-don-dato')) out.value = env.decode((env.inner(env.inner(x.inner, 'p'), 'strong')));
        else if (x.name === 'paragraph' && hasC(x, 'ecos-don-titular')) out.holder = env.decode(env.inner(x.inner, 'p').replace(/^Titular:\s*/, ''));
        else if (x.name === 'paragraph' && hasC(x, 'ecos-don-importes')) out.amounts = (env.inner(x.inner, 'p').match(/\d+/g) || []).map(Number);
        else if (x.name === 'paragraph' && !classes(x).length) text.push(x);
        else if (x.name === 'buttons') {
          const bs = env.tokenize(x.inner).filter((y) => y.name === 'button').map((y) => {
            const a = (y.inner.match(/<a\b[^>]*>[\s\S]*?<\/a>/) || [''])[0];
            return { html: env.inner(a, 'a'), url: env.attr(a, 'href') };
          });
          const main = bs[bs.length - 1];
          if (!main) return null;
          out.label = main.html;
          if (out.preset === 'paypal') {
            const m = main.url.match(/paypal\.me\/([\w.-]+)/i), h = main.url.match(/hosted_button_id=([\w-]+)/);
            if (h) out.hosted = h[1]; else if (m) out.value = m[1]; else return null;
            if (!out.hosted) out.amounts = bs.slice(0, -1).map((y) => Number((y.url.match(/\/(\d+)EUR$/) || [])[1])).filter(Boolean);
          } else if (out.preset === 'link') out.url = main.url;
        } else return null;
      }
      out.html = joinP(env, text);
      return out;
    },
    event(t, env) {
      const ks = kids(env, t);
      const s = classes(t).map((c) => c.match(/^ecos-ev-s-(\d{8}(?:\d{4})?)$/)).find(Boolean), e = classes(t).map((c) => c.match(/^ecos-ev-e-(\d{8}(?:\d{4})?)$/)).find(Boolean);
      if (!ks || !hasC(t, 'ecos-evento')) return null;
      const out = { type: 'event', title: '', start: s ? fromStamp(s[1]) : '', end: e ? fromStamp(e[1]) : '', place: '', html: '' };
      const text = [];
      for (const x of ks) {
        if (x.name === 'heading') out.title = env.inner(x.inner, 'h' + (x.attrs.level || 2));
        else if (x.name === 'paragraph' && hasC(x, 'ecos-ev-fecha')) continue;
        else if (x.name === 'paragraph' && hasC(x, 'ecos-ev-lugar')) out.place = env.decode(env.inner(env.inner(x.inner, 'p'), 'a'));
        else if (x.name === 'html' && /class="ecos-mapa"/.test(x.inner)) out.showMap = true;
        else if (x.name === 'paragraph' && !classes(x).length) text.push(x);
        else if (x.name === 'buttons') continue;
        else return null;
      }
      out.html = joinP(env, text);
      return out;
    },
    audio(t, env) {
      const ks = kids(env, t);
      if (!ks) return null;
      const out = { type: 'audio', mode: 'file', url: '', title: '', html: '' };
      const text = [];
      for (const x of ks) {
        if (x.name === 'heading') out.title = env.inner(x.inner, 'h' + (x.attrs.level || 2));
        else if (x.name === 'paragraph' && !classes(x).length) text.push(x);
        else if (x.name === 'audio') out.url = env.attr((x.inner.match(/<audio\b[^>]*>/) || [''])[0], 'src');
        else if (x.name === 'embed' && x.attrs.url) { out.mode = 'embed'; out.url = x.attrs.url; const p = x.attrs.providerNameSlug; if (['spotify', 'soundcloud'].includes(p)) out.provider = p; }
        else return null;
      }
      out.html = joinP(env, text);
      return out;
    },
    pdf(t, env) {
      const ks = kids(env, t);
      if (!ks) return null;
      const out = { type: 'pdf', url: '', title: '', html: '' };
      const text = [];
      for (const x of ks) {
        if (x.name === 'heading') out.title = env.inner(x.inner, 'h' + (x.attrs.level || 2));
        else if (x.name === 'paragraph' && !classes(x).length) text.push(x);
        else if (x.name === 'file' && x.attrs.href) {
          out.url = x.attrs.href; out.preview = !!x.attrs.displayPreview; out.download = x.attrs.showDownloadButton !== false;
          if (x.attrs.previewHeight) out.height = x.attrs.previewHeight;
          const a = (x.inner.match(/<a\b(?![^>]*\bdownload\b)[^>]*>[\s\S]*?<\/a>/) || [''])[0];
          out.name = env.inner(a, 'a');
          const d = (x.inner.match(/<a\b[^>]*\bdownload\b[^>]*>[\s\S]*?<\/a>/) || [''])[0];
          if (d) out.dlText = env.inner(d, 'a');
        } else return null;
      }
      out.html = joinP(env, text);
      return out;
    },
    hotspots(t, env) {
      const ks = kids(env, t);
      if (!ks || !ks[0] || ks[0].name !== 'image') return null;
      const out = { type: 'hotspots', img: env.imgOf(ks[0].inner), points: [] };
      for (const k of ks.slice(1)) {
        if (k.name !== 'group' || !hasC(k, 'ecos-punto')) return null;
        const inn = kids(env, k);
        if (!inn) return null;
        const p = { x: num(k, /^ecos-px-(\d+)$/) ?? 50, y: num(k, /^ecos-py-(\d+)$/) ?? 50, title: '', html: '' };
        const text = [];
        for (const x of inn) { if (x.name === 'heading') p.title = env.inner(x.inner, 'h' + (x.attrs.level || 2)); else if (x.name === 'paragraph') text.push(x); else return null; }
        p.html = joinP(env, text);
        out.points.push(p);
      }
      return out.img ? out : null;
    },
    compare(t, env) {
      const ks = kids(env, t);
      if (!ks || !ks.length || ks.length > 2 || ks.some((x) => x.name !== 'image')) return null;
      const [before, after] = ks.map((x) => env.imgOf(x.inner));
      return { type: 'compare', before, ...(after ? { after } : {}), pos: num(t, /^ecos-cmp-(\d+)$/) ?? 50 };
    },
    faq(t, env) {
      const ks = kids(env, t);
      if (!ks || !ks.length) return null;
      const items = [];
      for (const k of ks) {
        if (k.name !== 'details') return null;
        items.push({ q: env.inner(k.inner, 'summary'), html: env.all(k.inner, 'p').join('<br><br>') });
      }
      return { type: 'faq', items, ...(hasC(t, 'ecos-faq-uno') ? { one: true } : {}) };
    },
  };
  // clase raíz → tipo
  const ROOT = { 'ecos-tabs': 'tabs', 'ecos-timeline': 'timeline', 'ecos-cifras': 'figures', 'ecos-testimonios': 'testimonials', 'ecos-tarjetas': 'cards', 'ecos-cta': 'cta',
    'ecos-donar': 'donate', 'ecos-evento': 'event', 'ecos-audio': 'audio', 'ecos-pdf': 'pdf', 'ecos-puntos': 'hotspots', 'ecos-compare': 'compare', 'ecos-faq': 'faq' };

  // Lee un bloque de WordPress (token { name, attrs, inner, raw }) y devuelve el bloque de Ecos o null si no es uno de estos
  function read(t, name, d, env) {
    if (name !== 'group') return null;
    const root = classes(t).find((c) => ROOT[c]);
    if (!root) return null;
    let b = null;
    try { b = READ[ROOT[root]](t, env, d); } catch { b = null; }
    if (!b) return null;
    return { id: env.bid(), ...b };
  }

  // --- Valores iniciales de cada bloque (los usa el editor; los textos de ejemplo van aparte, en el editor) ---------------
  const DEFAULTS = {
    tabs: () => ({ cols: [{ title: '', width: '', children: [] }, { title: '', width: '', children: [] }] }),
    timeline: () => ({ items: [{ date: '', title: '', html: '', img: null }, { date: '', title: '', html: '', img: null }, { date: '', title: '', html: '', img: null }], dir: 'v' }),
    figures: () => ({ items: [{ value: '', label: '' }, { value: '', label: '' }, { value: '', label: '' }], count: true }),
    testimonials: () => ({ items: [{ html: '', name: '', role: '', img: null }] }),
    cards: () => ({ items: [{ icon: 'star', title: '', html: '', url: '', label: '' }, { icon: 'favorite', title: '', html: '', url: '', label: '' }, { icon: 'lightbulb', title: '', html: '', url: '', label: '' }] }),
    cta: () => ({ title: '', html: '', buttons: [{ html: '', url: '' }], align: 'center', bg: '#1f2937', color: '#ffffff', pad: 'l' }),
    donate: () => ({ preset: 'bizum', title: '', html: '', value: '', amounts: [] }),
    event: () => ({ title: '', start: '', end: '', place: '', html: '' }),
    audio: () => ({ mode: 'file', url: '', title: '', html: '' }),
    pdf: () => ({ url: '', title: '', html: '', preview: true, download: true, height: 600 }),
    hotspots: () => ({ img: null, points: [] }),
    compare: () => ({ before: null, after: null, pos: 50 }),
    faq: () => ({ items: [{ q: '', html: '' }, { q: '', html: '' }], one: false }),
  };

  // --- CSS (va en el bloque ecos-fx y, con el complemento, en ecos.css) ---------------------------------------------------
  const A = 'var(--ecos-accent,var(--wp--preset--color--primary,#2563eb))';
  const LINE = 'color-mix(in srgb,currentColor 18%,transparent)';
  const SOFT = 'color-mix(in srgb,currentColor 6%,transparent)';
  const grid = (sel, n) => `${sel}.ecos-cols-${n}{grid-template-columns:repeat(${n},minmax(0,1fr))}`;
  const GRID = (sel) => `${sel}{display:grid;gap:1.5rem;margin:1.5em 0}${[2, 3, 4].map((n) => grid(sel, n)).join('')}${sel}.ecos-cols-1{grid-template-columns:1fr}@media(max-width:700px){${sel}[class*="ecos-cols-"]{grid-template-columns:1fr}}`;
  const CSS = {
    tabs: `.ecos-tabs{margin:1.5em 0}.ecos-tabs-js .ecos-tab>.wp-block-heading:first-child{display:none}.ecos-tabs-js .ecos-tab[hidden]{display:none}.ecos-tab-list{display:flex;flex-wrap:wrap;gap:.25rem;border-bottom:2px solid ${LINE};margin-bottom:1rem}.ecos-tab-btn{font:inherit;font-weight:600;padding:.6em 1.1em;border:0;background:none;color:inherit;opacity:.7;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px}.ecos-tab-btn:hover{opacity:1}.ecos-tab-btn[aria-selected="true"]{opacity:1;border-bottom-color:${A}}.ecos-tab-btn:focus-visible{outline:2px solid ${A};outline-offset:2px}.ecos-tabs-pill .ecos-tab-list{border-bottom:0;gap:.5rem}.ecos-tabs-pill .ecos-tab-btn{border:1px solid ${LINE};border-radius:999px;margin:0}.ecos-tabs-pill .ecos-tab-btn[aria-selected="true"]{background:${A};border-color:${A};color:#fff}.ecos-tabs:not(.ecos-tabs-js) .ecos-tab{margin-bottom:1.5rem}`,
    timeline: `.ecos-timeline{position:relative;margin:2em 0;padding-left:1.8rem;border-left:3px solid ${LINE}}.ecos-tl-item{position:relative;padding:0 0 2rem}.ecos-tl-item::before{content:"";position:absolute;left:calc(-1.8rem - 9px);top:.35rem;width:15px;height:15px;border-radius:50%;background:${A};border:3px solid var(--wp--preset--color--base,#fff)}.ecos-tl-date{margin:0;font-size:.85em;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${A}}.ecos-tl-title{margin:.2em 0 .4em}.ecos-tl-item .wp-block-image{margin:.8rem 0 0}.ecos-tl-item .wp-block-image img{border-radius:12px;max-width:100%;height:auto}.ecos-timeline.ecos-tl-h{display:flex;gap:1.5rem;overflow-x:auto;padding:1.6rem 0 .5rem;border-left:0;scroll-snap-type:x proximity}.ecos-tl-h .ecos-tl-item{flex:0 0 min(260px,78%);padding:1rem 0 0;border-top:3px solid ${LINE};scroll-snap-align:start}.ecos-tl-h .ecos-tl-item::before{left:0;top:-9px}`,
    figures: `${GRID('.ecos-cifras')}.ecos-cifra{text-align:center;padding:1.2rem .8rem;border-radius:16px;background:${SOFT}}.ecos-cifra-num{margin:0;font-size:clamp(2.2rem,6vw,3.6rem);font-weight:800;line-height:1.1;color:${A};font-variant-numeric:tabular-nums}.ecos-cifra-txt{margin:.3em 0 0;opacity:.8}`,
    testimonials: `${GRID('.ecos-testimonios')}.ecos-testimonio{padding:1.4rem;border-radius:16px;background:${SOFT};text-align:center}.ecos-testimonio .wp-block-image{margin:0 auto .8rem;display:flex;justify-content:center}.ecos-testimonio .wp-block-image img{width:88px;height:88px;border-radius:50%;object-fit:cover}.ecos-testimonio .wp-block-quote{margin:0 0 .8rem;border:0;padding:0;font-style:italic}.ecos-t-nombre{margin:0;font-weight:700}.ecos-t-cargo{margin:0;font-size:.88em;opacity:.7}.ecos-t-slider{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:1rem;padding-bottom:.6rem}.ecos-t-slider>.ecos-testimonio{flex:0 0 min(420px,86%);scroll-snap-align:center}@media(max-width:700px){.ecos-t-slider{display:flex}}`,
    cards: `${GRID('.ecos-tarjetas')}.ecos-tarjeta{padding:1.4rem;border-radius:16px;border:1px solid ${LINE};background:${SOFT};transition:transform .2s,box-shadow .2s}.ecos-tarjeta:hover{transform:translateY(-3px);box-shadow:0 10px 26px rgba(0,0,0,.12)}.ecos-icono{margin:0 0 .5rem;font-size:2.2rem;line-height:1}.ecos-tarjeta-t{margin:.1em 0 .4em;font-size:1.2em}.ecos-tarjeta p{margin:.3em 0}.ecos-tarjeta-enlace a{font-weight:700;color:${A}}@media(prefers-reduced-motion:reduce){.ecos-tarjeta{transition:none}.ecos-tarjeta:hover{transform:none}}`,
    cta: `.ecos-cta{text-align:center;margin:2em 0}.ecos-cta .wp-block-heading{margin-top:0}.ecos-cta .wp-block-buttons{margin-top:1.2rem}`,
    donate: `.ecos-donar{margin:1.5em 0;padding:1.5rem;border-radius:16px;border:1px solid ${LINE};background:${SOFT}}.ecos-donar .wp-block-heading{margin-top:0}.ecos-don-dato{font-size:1.15em;margin:.6em 0 .2em}.ecos-don-titular,.ecos-don-importes{margin:.2em 0;opacity:.8}.ecos-donar .wp-block-buttons{margin-top:1rem}`,
    event: `.ecos-evento{margin:1.5em 0;padding:1.5rem;border-radius:16px;border:1px solid ${LINE};border-left:6px solid ${A};background:${SOFT}}.ecos-evento .wp-block-heading{margin-top:0}.ecos-ev-fecha{font-weight:700;margin:.2em 0}.ecos-ev-fecha::first-letter{text-transform:uppercase}.ecos-ev-lugar{margin:.2em 0 .8em}.ecos-evento .ecos-mapa{margin:.8rem 0}.ecos-evento .wp-block-buttons{margin-top:1rem}`,
    audio: `.ecos-audio{margin:1.5em 0;padding:1.2rem;border-radius:16px;border:1px solid ${LINE};background:${SOFT}}.ecos-audio .wp-block-heading{margin-top:0}.ecos-audio audio{width:100%}.ecos-audio .wp-block-embed{margin:.5rem 0 0}`,
    pdf: `.ecos-pdf{margin:1.5em 0}.ecos-pdf .wp-block-heading{margin-top:0}.ecos-pdf .wp-block-file a:not(.wp-block-file__button){margin-right:.9em}.ecos-pdf .wp-block-file__embed{display:block;max-width:100%;border:1px solid ${LINE};border-radius:12px}`,
    hotspots: `.ecos-puntos{margin:1.5em 0}.ecos-puntos .wp-block-image img{display:block;width:100%;height:auto;border-radius:12px}.ecos-punto{margin:.8rem 0;padding:.8rem 1rem;border-left:4px solid ${A}}.ecos-punto .wp-block-heading{margin:0 0 .2em;font-size:1.05em}.ecos-punto p{margin:.2em 0}.ecos-pts-stage{position:relative;line-height:0}.ecos-pts-stage .wp-block-image{margin:0}.ecos-pts-js .ecos-punto{display:none}.ecos-pt-btn{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;padding:0;border-radius:50%;border:3px solid #fff;background:${A};color:#fff;font:700 15px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.4);animation:ecos-pulse 2.2s infinite}.ecos-pt-btn:hover,.ecos-pt-btn[aria-expanded="true"]{animation:none;transform:scale(1.12)}.ecos-pt-btn:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 6px ${A}}.ecos-pt-pop{position:absolute;z-index:5;width:max-content;max-width:min(280px,72%);padding:.9rem 1rem;border-radius:12px;background:var(--wp--preset--color--base,#fff);color:var(--wp--preset--color--contrast,#1b1b1b);box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:.95rem;line-height:1.45;transform:translate(-50%,24px)}.ecos-pt-pop.ecos-l{transform:translate(-18px,24px)}.ecos-pt-pop.ecos-r{transform:translate(calc(-100% + 18px),24px)}.ecos-pt-pop[hidden]{display:none}.ecos-pt-pop b{display:block;margin-bottom:.2em}.ecos-pt-x{position:absolute;top:2px;right:4px;border:0;background:none;color:inherit;font-size:20px;line-height:1;cursor:pointer}@keyframes ecos-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,${A} 60%,transparent)}70%{box-shadow:0 0 0 12px transparent}100%{box-shadow:0 0 0 0 transparent}}@media(prefers-reduced-motion:reduce){.ecos-pt-btn{animation:none}}`,
    compare: `.ecos-compare{margin:1.5em 0}.ecos-compare:not(.ecos-cmp-js) .wp-block-image{margin:0 0 .8rem}.ecos-compare .wp-block-image img{display:block;width:100%;height:auto}.ecos-cmp-stage{position:relative;overflow:hidden;border-radius:12px;line-height:0;user-select:none}.ecos-cmp-stage .wp-block-image{margin:0}.ecos-cmp-stage .ecos-cmp-top{position:absolute;inset:0}.ecos-cmp-stage .ecos-cmp-top img{height:100%;object-fit:cover}.ecos-cmp-bar{position:absolute;top:0;bottom:0;width:3px;margin-left:-1.5px;background:#fff;box-shadow:0 0 6px rgba(0,0,0,.5);pointer-events:none}.ecos-cmp-bar::after{content:"\\2194";position:absolute;top:50%;left:50%;width:38px;height:38px;margin:-19px 0 0 -19px;border-radius:50%;background:#fff;color:#222;font:700 18px/38px system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.45)}.ecos-cmp-range{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:ew-resize}.ecos-cmp-stage:focus-within .ecos-cmp-bar::after{outline:3px solid ${A};outline-offset:2px}.ecos-cmp-tag{position:absolute;top:10px;padding:2px 10px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font:600 12px/1.6 system-ui,sans-serif;pointer-events:none}.ecos-cmp-tag.ecos-a{left:10px}.ecos-cmp-tag.ecos-b{right:10px}`,
    faq: `.ecos-faq{margin:1.5em 0}.ecos-faq .wp-block-details{margin:0 0 .6rem;padding:.2rem 1rem;border:1px solid ${LINE};border-radius:12px;background:${SOFT}}.ecos-faq .wp-block-details summary{cursor:pointer;font-weight:600;padding:.7rem 0}.ecos-faq .wp-block-details[open] summary{color:${A}}.ecos-faq .wp-block-details p{margin:.2em 0 .9em}`,
  };

  const api = { ICONS, ICON_MAP, isIconName, iconValue, iconGlyph, safeGlyph, MONTHS, DAYS, parseDT, stamp, fromStamp, whenText, endOf, ics, icsUri, googleUrl, mapLink, hash, TYPE_NAMES, FX, compose, read, DEFAULTS, CSS, ROOT, SAFE_COLOR, clampInt, addClass };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MoreBlocks = api;
})(typeof window !== 'undefined' ? window : globalThis);
