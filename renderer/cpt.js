// Ecos · lógica pura de tipos de contenido propios, campos personalizados (ACF, Meta Box y metas) e idiomas (Polylang y WPML).
// Sin acceso a red ni a la interfaz: la usan src/wpself.js, main.js, el editor y las pruebas (node --test).
(function (root) {
  // ---------------------------------------------------------------- Tipos de contenido
  // Tipos que nunca se ofrecen: los de Ecos (entradas y páginas), los internos de WordPress y los de tiendas
  const INTERNAL = new Set(['post', 'page', 'attachment', 'wp_block', 'wp_template', 'wp_template_part', 'wp_navigation', 'nav_menu_item',
    'wp_global_styles', 'wp_font_family', 'wp_font_face', 'wp_pattern_category', 'revision', 'customize_changeset', 'oembed_cache', 'user_request',
    'custom_css', 'product', 'product_variation', 'shop_order', 'shop_coupon', 'shop_order_refund', 'acf-field-group', 'acf-field', 'acf-post-type', 'acf-taxonomy']);
  const isInternalType = (slug) => INTERNAL.has(slug) || /^wp_font_|^acf-|^wc_|^shop_/.test(String(slug || ''));
  // /wp/v2/types → [{ slug, name, singular, restBase, editor, excerpt, thumbnail, hierarchical, taxonomies }]
  function mapTypes(raw) {
    const list = Array.isArray(raw) ? raw : Object.values(raw || {});
    const out = [];
    for (const ty of list) {
      const slug = String(ty?.slug || '');
      if (!slug || isInternalType(slug)) continue;
      if (ty.rest_namespace && ty.rest_namespace !== 'wp/v2') continue; // las que viven en otra API no se editan aquí
      const sup = ty.supports || {};
      out.push({
        slug, name: String(ty.name || slug), singular: String(ty.labels?.singular_name || ty.name || slug), restBase: String(ty.rest_base || slug),
        editor: sup.editor !== false, excerpt: !!sup.excerpt, thumbnail: !!sup.thumbnail, hierarchical: !!ty.hierarchical,
        taxonomies: Array.isArray(ty.taxonomies) ? ty.taxonomies.map(String) : [],
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  // Colección REST de un tipo ('post'→posts, 'page'→pages, otro → su rest_base; si no se conoce, el propio nombre)
  function collOf(type, types) {
    if (!type || type === 'post') return 'posts';
    if (type === 'page') return 'pages';
    return (types || []).find((x) => x.slug === type)?.restBase || String(type);
  }
  // /wp/v2/taxonomies?type=X → { category: {slug, restBase, name}|null, tag: …|null, all: [...] }. La «categoría» del tipo es su
  // taxonomía jerárquica (mejor «category») y la «etiqueta» la no jerárquica (mejor «post_tag»).
  function mapTaxonomies(raw) {
    const list = (Array.isArray(raw) ? raw : Object.values(raw || {})).filter((x) => x && x.slug && x.rest_base !== undefined && !/^(nav_menu|link_category|wp_|post_format)/.test(x.slug))
      .map((x) => ({ slug: String(x.slug), restBase: String(x.rest_base || x.slug), name: String(x.name || x.slug), hierarchical: !!x.hierarchical }));
    const pick = (arr, pref) => arr.find((x) => x.slug === pref) || arr[0] || null;
    return { category: pick(list.filter((x) => x.hierarchical), 'category'), tag: pick(list.filter((x) => !x.hierarchical), 'post_tag'), all: list };
  }

  // ---------------------------------------------------------------- Campos personalizados
  const SEO_META = /^(_?yoast|_yoast|rank_math|_rank_math|ast-|site-(?:post|sidebar|content)|theme-transparent|footnotes|_edit_|_wp_|_thumbnail_id|spectra|_uag|_uagb|ecos_|_ecos)/i;
  const EDITABLE = new Set(['text', 'textarea', 'number', 'email', 'url', 'date', 'datetime', 'time', 'bool', 'select', 'radio', 'checkbox', 'image', 'link']);
  const toOptions = (choices) => {
    if (Array.isArray(choices)) return choices.map((c) => (c && typeof c === 'object' ? { value: String(c.value ?? c.id ?? ''), label: String(c.label ?? c.name ?? c.value ?? '') } : { value: String(c), label: String(c) }));
    if (choices && typeof choices === 'object') return Object.entries(choices).map(([value, label]) => ({ value: String(value), label: String(label) }));
    return [];
  };
  const base = (source, f) => ({
    id: `${source}:${f.name}`, source, name: String(f.name), label: String(f.label || f.name), kind: 'readonly', required: !!f.required,
    help: String(f.instructions || f.desc || f.description || '').replace(/<[^>]+>/g, '').trim(), group: String(f.group || ''), options: [], multiple: false, def: f.default_value ?? f.std ?? f.default,
  });
  // Un campo de ACF tal como lo da acf_get_fields()
  const ACF_KIND = { text: 'text', textarea: 'textarea', wysiwyg: 'textarea', number: 'number', range: 'number', email: 'email', url: 'url', password: 'text', color_picker: 'text',
    date_picker: 'date', date_time_picker: 'datetime', time_picker: 'time', true_false: 'bool', select: 'select', radio: 'radio', button_group: 'radio', checkbox: 'checkbox', image: 'image', link: 'link' };
  function normalizeAcfField(f, group = '') {
    if (!f || !f.name) return null;
    const o = base('acf', { ...f, group });
    const kind = ACF_KIND[f.type];
    if (!kind) return { ...o, kind: 'readonly', type: String(f.type || '') };
    o.kind = kind; o.type = f.type;
    if (f.type === 'range' || kind === 'number') Object.assign(o, { min: numOrU(f.min), max: numOrU(f.max), step: numOrU(f.step) });
    if (['select', 'radio', 'button_group', 'checkbox'].includes(f.type)) o.options = toOptions(f.choices);
    if (f.type === 'select') o.multiple = !!Number(f.multiple);
    if (f.type === 'checkbox') o.multiple = true;
    if (f.type === 'wysiwyg') o.html = true;
    if (f.type === 'image' && f.return_format === 'array') o.imageRaw = 'array';
    return o;
  }
  const numOrU = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? undefined : Number(v));
  // Grupos de ACF: acf_get_field_groups() + acf_get_fields() → campos planos con su grupo
  function normalizeAcf(groups) {
    const out = [];
    for (const g of groups || []) for (const f of g.fields || []) { const n = normalizeAcfField(f, g.title || ''); if (n) out.push(n); }
    return out;
  }
  // Meta Box: campos como los da rwmb_get_registry('meta_box')
  const MB_KIND = { text: 'text', textarea: 'textarea', wysiwyg: 'textarea', number: 'number', range: 'number', email: 'email', url: 'url', date: 'date', datetime: 'datetime', time: 'time',
    checkbox: 'bool', switch: 'bool', select: 'select', radio: 'radio', checkbox_list: 'checkbox', button_group: 'radio', single_image: 'image', color: 'text' };
  function normalizeMetaBoxField(f, group = '') {
    const id = f?.id || f?.field_name;
    if (!id) return null;
    const o = base('metabox', { ...f, name: id, label: f.name || id, instructions: f.desc, group, required: f.required });
    const kind = MB_KIND[f.type];
    if (!kind || f.clone || (f.multiple && f.type !== 'select') || f.type === 'group') return { ...o, kind: 'readonly', type: String(f.type || '') };
    o.kind = kind; o.type = f.type;
    if (['select', 'radio', 'checkbox_list', 'button_group'].includes(f.type)) o.options = toOptions(f.options);
    if (f.type === 'checkbox_list' || (f.type === 'select' && f.multiple)) o.multiple = true;
    if (kind === 'number') Object.assign(o, { min: numOrU(f.min), max: numOrU(f.max), step: numOrU(f.step) });
    return o;
  }
  function normalizeMetaBox(boxes) {
    const out = [];
    for (const b of boxes || []) for (const f of b.fields || []) { const n = normalizeMetaBoxField(f, b.title || ''); if (n) out.push(n); }
    return out;
  }
  // Metas registradas con register_post_meta(show_in_rest): [{ key, type, description, single }]
  function normalizeMetas(metas) {
    const out = [];
    for (const m of metas || []) {
      const key = String(m?.key || '');
      if (!key || SEO_META.test(key)) continue;
      const o = base('meta', { name: key, label: m.title || key, instructions: m.description });
      const kind = { string: 'text', integer: 'number', number: 'number', boolean: 'bool' }[m.type];
      out.push(m.single === false || !kind ? { ...o, kind: 'readonly', type: String(m.type || '') } : { ...o, kind, type: m.type, ...(m.type === 'integer' ? { step: 1 } : {}) });
    }
    return out;
  }
  // Sin complemento: campos deducidos de los valores que trae la propia entrada (`acf` y `meta` de la API)
  function inferFields(acf, meta) {
    const out = [];
    const kindOf = (v) => (typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'number' : typeof v === 'string' ? 'text' : 'readonly');
    for (const [k, v] of Object.entries(acf && !Array.isArray(acf) ? acf : {})) out.push({ ...base('acf', { name: k, label: k }), kind: kindOf(v), inferred: true });
    for (const [k, v] of Object.entries(meta && !Array.isArray(meta) ? meta : {})) if (!SEO_META.test(k)) out.push({ ...base('meta', { name: k, label: k }), kind: kindOf(v), inferred: true });
    return out;
  }
  // Respuesta de ecos/v1/fields → campos normalizados y valores iniciales por id de campo
  function fromHelper(d) {
    const fields = [...normalizeAcf(d?.acf?.groups), ...normalizeMetaBox(d?.metabox?.boxes), ...normalizeMetas(d?.meta?.keys)];
    const vals = {};
    for (const f of fields) {
      const src = f.source === 'acf' ? d?.acf?.values : f.source === 'metabox' ? d?.metabox?.values : d?.meta?.values;
      if (src && f.name in src) vals[f.id] = src[f.name];
    }
    return { fields, values: vals, acfRest: !!d?.acf?.rest, plugins: { acf: !!d?.acf, metabox: !!d?.metabox } };
  }

  // Conversión entre el valor guardado y el de los controles (<input type=date> etc.)
  const pad = (n) => String(n).padStart(2, '0');
  function toInput(f, v) {
    if (v === null || v === undefined) return f.kind === 'checkbox' || (f.kind === 'select' && f.multiple) ? [] : f.kind === 'bool' ? false : f.kind === 'image' ? 0 : f.kind === 'link' ? { title: '', url: '', target: '' } : '';
    switch (f.kind) {
      case 'bool': return v === true || v === 1 || v === '1' || v === 'true';
      case 'checkbox': return Array.isArray(v) ? v.map(String) : v === '' ? [] : [String(v)];
      case 'date': { const s = String(v); return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s.slice(0, 10); }
      case 'datetime': return String(v).replace(' ', 'T').slice(0, 16);
      case 'time': return String(v).slice(0, 5);
      case 'select': return f.multiple ? (Array.isArray(v) ? v.map(String) : v === '' ? [] : [String(v)]) : String(v);
      case 'image': return typeof v === 'object' ? Number(v.ID || v.id) || 0 : Number(v) || 0;
      case 'link': return v && typeof v === 'object' ? { title: String(v.title || ''), url: String(v.url || ''), target: String(v.target || '') } : { title: '', url: '', target: '' };
      case 'number': return v === '' ? '' : String(v);
      default: return String(v);
    }
  }
  function fromInput(f, v) {
    switch (f.kind) {
      case 'bool': return f.source === 'acf' ? (v ? 1 : 0) : !!v;
      case 'number': return v === '' || v === null ? '' : Number(v);
      case 'date': return f.source === 'acf' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.replace(/-/g, '') : String(v || '');
      case 'datetime': return f.source === 'acf' && v ? String(v).replace('T', ' ') + ':00' : String(v || '');
      case 'time': return f.source === 'acf' && v ? v + ':00' : String(v || '');
      case 'image': return Number(v) || 0;
      default: return v;
    }
  }
  const empty = (f, v) => (typeof v === 'string' && !v.trim()) || v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length) || (f.kind === 'image' && !Number(v)) || (f.kind === 'link' && !v?.url);
  // Valida el valor de un control (formato de toInput). → { ok, error }
  function validateValue(f, v) {
    if (f.readOnly || f.kind === 'readonly') return { ok: true };
    if (empty(f, v)) return f.required && f.kind !== 'bool' ? { ok: false, error: 'required' } : { ok: true };
    const s = typeof v === 'string' ? v.trim() : v;
    switch (f.kind) {
      case 'number': {
        const n = Number(s);
        if (!Number.isFinite(n)) return { ok: false, error: 'number' };
        if (f.min !== undefined && n < f.min) return { ok: false, error: 'min' };
        if (f.max !== undefined && n > f.max) return { ok: false, error: 'max' };
        return { ok: true };
      }
      case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? { ok: true } : { ok: false, error: 'email' };
      case 'url': return /^https?:\/\/[^\s]+\.[^\s]+$/i.test(s) || /^https?:\/\/localhost(?::\d+)?(\/\S*)?$/i.test(s) ? { ok: true } : { ok: false, error: 'url' };
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00')) ? { ok: true } : { ok: false, error: 'date' };
      case 'datetime': return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !isNaN(new Date(s)) ? { ok: true } : { ok: false, error: 'date' };
      case 'time': return /^([01]\d|2[0-3]):[0-5]\d/.test(s) ? { ok: true } : { ok: false, error: 'time' };
      case 'select': case 'radio': case 'checkbox': {
        if (!f.options.length) return { ok: true };
        const allowed = new Set(f.options.map((o) => o.value));
        return [].concat(s).every((x) => allowed.has(String(x))) ? { ok: true } : { ok: false, error: 'option' };
      }
      case 'link': return /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(v.url) ? { ok: true } : { ok: false, error: 'url' };
      default: return { ok: true };
    }
  }
  // Mensajes de error (en español; la interfaz los traduce)
  const ERRORS = { required: 'Este campo es obligatorio', number: 'Escribe un número', min: 'El valor es demasiado pequeño', max: 'El valor es demasiado grande', email: 'Escribe un correo válido',
    url: 'Escribe una dirección que empiece por http:// o https://', date: 'Escribe una fecha válida', time: 'Escribe una hora válida', option: 'Elige una de las opciones' };
  // Valida todos los campos editables → { ok, errors: { id: código } }
  function validateAll(fields, values) {
    const errors = {};
    for (const f of fields || []) { const r = validateValue(f, values[f.id]); if (!r.ok) errors[f.id] = r.error; }
    return { ok: !Object.keys(errors).length, errors };
  }
  // Lo que hay que enviar: solo los campos editables que cambiaron respecto a `initial` (valores en formato de control).
  //   · ACF con «Show in REST» → `acf` en el POST; sin él, por el complemento (`helper.acf`)
  //   · metas registradas → `meta` en el POST · Meta Box → por el complemento (`helper.metabox`)
  function buildFieldsPost(fields, values, initial = {}, { acfRest = false } = {}) {
    const out = { acf: {}, meta: {}, helper: { acf: {}, metabox: {} } };
    for (const f of fields || []) {
      if (f.kind === 'readonly' || f.readOnly || !(f.id in values)) continue;
      if (JSON.stringify(values[f.id]) === JSON.stringify(initial[f.id])) continue;
      const v = fromInput(f, values[f.id]);
      if (f.source === 'acf') (acfRest ? out.acf : out.helper.acf)[f.name] = v;
      else if (f.source === 'meta') out.meta[f.name] = v;
      else out.helper.metabox[f.name] = v;
    }
    const post = {};
    if (Object.keys(out.acf).length) post.acf = out.acf;
    if (Object.keys(out.meta).length) post.meta = out.meta;
    const helper = {};
    if (Object.keys(out.helper.acf).length) helper.acf = out.helper.acf;
    if (Object.keys(out.helper.metabox).length) helper.metabox = out.helper.metabox;
    return { post, helper, empty: !Object.keys(post).length && !Object.keys(helper).length };
  }

  // ---------------------------------------------------------------- Idiomas (Polylang y WPML)
  // Plugin de idiomas por los espacios de nombres de /wp-json (o lo que diga el complemento)
  function detectLangPlugin(namespaces = [], helperInfo = null) {
    if (helperInfo?.plugin === 'polylang' || helperInfo?.plugin === 'wpml') return helperInfo.plugin;
    if (namespaces.includes('pll/v1')) return 'polylang';
    if (namespaces.includes('wpml/v1') || namespaces.includes('wpml/st/v1') || namespaces.includes('wpml/tm/v1')) return 'wpml';
    return null;
  }
  // ecos/v1/lang → { plugin, languages:[{code,name,locale,flag,default}], current }
  function normalizeLangs(d) {
    const languages = (d?.languages || []).filter((l) => l && l.code).map((l) => ({ code: String(l.code), name: String(l.name || l.native_name || l.code), locale: String(l.locale || ''), flag: String(l.flag || ''), default: !!l.default }));
    return { plugin: d?.plugin === 'polylang' || d?.plugin === 'wpml' ? d.plugin : null, languages, default: (languages.find((l) => l.default) || languages[0] || {}).code || '' };
  }
  // ecos/v1/lang?post=ID → { lang, translations:{ code: id } } (sin la propia entrada marcada aparte)
  function normalizePostLang(d, postId) {
    const tr = {};
    for (const [k, v] of Object.entries(d?.translations || {})) if (Number(v) > 0) tr[k] = Number(v);
    const lang = String(d?.lang || '');
    if (lang && postId && !tr[lang]) tr[lang] = Number(postId);
    return { lang, translations: tr };
  }
  // Idiomas en los que aún falta la entrada
  const missingLangs = (langs, postLang) => (langs.languages || []).filter((l) => !(l.code in (postLang.translations || {})));
  // Idioma por entrada para la lista del Blog: { id: code } → etiqueta corta
  const langChip = (langs, code) => { const l = (langs.languages || []).find((x) => x.code === code); return l ? { code: l.code, label: String(l.code).toUpperCase().slice(0, 3), name: l.name } : null; };
  // Campos de la nueva traducción: mismo contenido y estructura, en borrador y enlazada a la original
  function translationDraft(orig, lang, { suffix = true } = {}) {
    return {
      type: orig.type, title: suffix ? `${orig.title} (${String(lang).toUpperCase()})` : orig.title, content: orig.content, excerpt: orig.excerpt || '', status: 'draft',
      ...(orig.featured ? { featured_image: orig.featured } : {}), lang, translationOf: orig.id,
    };
  }
  // Para traducir con la IA: textos de los bloques sin tocar estructura ni fotos. `blocks` es el árbol del editor;
  // `kids(b)` devuelve las listas hijas. → [{ id, kind:'html'|'items', index?, html }] y `apply(map)` los sustituye.
  const TEXT_TYPES = ['paragraph', 'heading', 'quote', 'list'];
  function collectTexts(blocks, kids = () => []) {
    const items = [], refs = [];
    const walk = (arr) => {
      for (const b of arr) {
        if (TEXT_TYPES.includes(b.type)) {
          if (b.type === 'list') (b.items || []).forEach((h, i) => { if (String(h).trim()) { refs.push({ b, i }); items.push({ id: 'T' + refs.length, html: String(h) }); } });
          else if (String(b.html || '').trim()) { refs.push({ b }); items.push({ id: 'T' + refs.length, html: String(b.html) }); }
        }
        for (const k of kids(b) || []) walk(k);
      }
    };
    walk(blocks);
    return { items, apply(map) { let n = 0; refs.forEach((r, k) => { const v = map[items[k].id]; if (typeof v !== 'string' || !v.trim()) return; n++; if (r.i !== undefined) r.b.items[r.i] = v; else r.b.html = v; }); return n; } };
  }

  const api = { INTERNAL, isInternalType, mapTypes, collOf, mapTaxonomies, normalizeAcf, normalizeAcfField, normalizeMetaBox, normalizeMetaBoxField, normalizeMetas, inferFields, fromHelper, toInput, fromInput,
    validateValue, validateAll, ERRORS, buildFieldsPost, EDITABLE, detectLangPlugin, normalizeLangs, normalizePostLang, missingLangs, langChip, translationDraft, collectTexts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Cpt = api;
})(typeof window !== 'undefined' ? window : globalThis);
