// window.api simulado, compartido por todas las pruebas de interfaz.
//
//   await installMock(page, { theme: 'light', config: {...}, version: '3.5.4', patch: (api, H) => { api.metaPosts = async () => ... } });
//
// - `config` se fusiona sobre la configuración base (prefs se fusiona aparte).
// - `patch(api, H)` se ejecuta DENTRO de la página tras crear el mock (sin acceso a variables externas):
//   sirve para cambiar o añadir métodos. `H` = { pic, cols, now, ok, cfg, media, items, posts }.
// - Cualquier método no definido devuelve {} y los `onXxx` son no-ops (como en preload.js).
// - Dentro de la página quedan: window.__cfg (config viva), window.__calls (registro libre), window.__H.
async function installMock(page, opts = {}) {
  const { theme = 'light', config = {}, version = '3.5.4', lang, patch } = opts;
  await page.addInitScript(({ theme, config, version, lang, patchSrc }) => {
    const ok = async (v) => v;
    const pic = (c, w = 300, h = 200) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${c}"/><circle cx="${w / 2}" cy="${h / 2}" r="${h / 4}" fill="rgba(255,255,255,.35)"/></svg>`);
    const cols = ['#b5541c', '#3b5ba9', '#386a20', '#984061', '#7a6a2b', '#5b3b8c'];
    const now = Date.now();
    const posts = Array.from({ length: 12 }, (_, i) => ({ source: i % 2 ? 'facebook' : 'instagram', id: 'p' + i, text: 'Publicación de ejemplo número ' + i + ' con un texto algo más largo para ver cómo queda.', date: new Date(now - i * 86400000 * 3).toISOString(), permalink: '', media: [{ type: 'image', url: pic(cols[i % 4]) }] }));
    const items = Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, type: 'post', title: 'Entrada de ejemplo ' + i, excerpt: 'Resumen de la entrada', status: ['publish', 'draft', 'future'][i % 3], date: new Date(now - i * 86400000 * 9).toISOString(), modified: '', categories: ['Blog'], image: pic(cols[i % 4]), url: '' }));
    const baseCfg = { wpConnected: true, wpMode: 'selfhosted', wpUrl: 'https://example.org', metaConnected: true, wpSiteLabel: 'example.org', wizardDone: true, aiConfigured: true, format: { status: 'draft' }, templates: [], blockTemplates: [], exported: {}, startMode: { level: 0 }, lastSeenVersion: version, ai: { active: 'gemini', providers: { gemini: { name: 'Google', needsKey: true, hasKey: true, model: 'x' } } } };
    const media = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, date: new Date(now - i * 3600000).toISOString(), url: pic(cols[i % 4]), thumb: pic(cols[i % 4]), type: 'image', alt: '', name: 'foto-' + i, width: 1000, height: 667, size: 70000 }));
    const cfg = window.__cfg = { ...baseCfg, ...config, prefs: { theme, ...(lang ? { lang } : {}), ...(config.prefs || {}) } };
    const merge = (c) => { Object.assign(cfg, c); if (c.prefs) cfg.prefs = { ...cfg.prefs, ...c.prefs }; return JSON.parse(JSON.stringify(cfg)); };
    if (cfg.lastSeenVersion === null) delete cfg.lastSeenVersion;
    window.__calls = {};
    window.__H = { pic, cols, now, ok, cfg, posts, items, media };
    const api = {
      getConfig: () => ok(cfg), setConfig: async (c) => merge(c),
      metaAccounts: () => ok([{ pageId: '1', pageName: 'Página' }]), metaPosts: () => ok({ posts, cursors: {} }), mergeDuplicates: async (l) => l,
      wpCategories: () => ok([{ id: 1, name: 'Blog' }, { id: 2, name: 'Comunicados' }]),
      blogList: async () => ({ found: 20, items }), blogHealth: async () => ({ noCat: [{ id: 101 }], noImg: [{ id: 102, photo: true }], total: 20, at: now }),
      blogDates: async () => items.map((x) => x.date),
      mediaAll: async () => media.map((m) => ({ ...m })),
      mediaUsage: async () => ({}),
      // pagina, filtra por tipo y busca como WordPress; `H.media` se puede cambiar desde un `patch`
      mediaList: async ({ page = 1, perPage = 40, type = 'all', search = '' } = {}) => {
        const l = media.filter((m) => (type === 'all' || m.type === type) && (!search || m.name.includes(search)));
        return { items: l.slice((page - 1) * perPage, page * perPage).map((m) => ({ ...m })), total: l.length, totalPages: Math.max(1, Math.ceil(l.length / perPage)) };
      },
      mediaFeatured: async () => ({}), mediaMissing: async () => [],
      siteStructure: async () => ({ settings: { showOnFront: 'page', pageOnFront: 1, pageForPosts: 3 }, pages: [{ id: 1, title: 'Inicio', status: 'publish', parent: 0, order: 1, link: 'x' }, { id: 2, title: 'Quiénes somos', status: 'publish', parent: 0, order: 2, link: 'x' }, { id: 3, title: 'Blog', status: 'publish', parent: 0, order: 3, link: 'x' }, { id: 4, title: 'Acogida', status: 'publish', parent: 2, order: 1, link: 'x' }], categories: [{ id: 1, name: 'Blog', count: 12, parent: 0 }], menus: [{ id: 9, name: 'Principal', items: [{ id: 50, title: 'Inicio', object: 'page', objectId: 1, parent: 0, order: 1 }, { id: 51, title: 'Quiénes somos', object: 'page', objectId: 2, parent: 0, order: 2 }] }] }),
      sitePages: async () => [], composeDraft: async () => '',
      updateStatus: () => ok({ state: 'latest', version, channel: 'stable' }), appInfo: () => ok({ version }), refreshExported: async () => ({}),
      open: async (u) => { (window.__calls.open = window.__calls.open || []).push(u); },
    };
    window.api = new Proxy(api, { get: (o, k) => (k in o ? o[k] : (typeof k === 'string' && k.startsWith('on') ? () => {} : async () => ({}))) });
    if (patchSrc) (0, eval)('(' + patchSrc + ')')(window.api, window.__H);
  }, { theme, config, version, lang, patchSrc: patch ? patch.toString() : '' });
}

module.exports = { installMock };
