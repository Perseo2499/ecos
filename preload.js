const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};
const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, v) => cb(v));

contextBridge.exposeInMainWorld('api', {
  // Configuración y conexiones
  getConfig: () => call('config:get'),
  setConfig: (c) => call('config:set', c),
  metaLogin: () => call('meta:login'),
  metaAccounts: () => call('meta:accounts'),
  metaPosts: (pageId, sources, cursors) => call('meta:posts', pageId, sources, cursors),
  wpLogin: () => call('wp:login'),
  wpCategories: () => call('wp:categories'),

  // Publicaciones → entrada
  mergeDuplicates: (list) => call('posts:merge', list),
  buildDraft: (posts) => call('draft:build', posts),
  publish: (d) => call('draft:publish', d),
  previewDraft: (d) => call('draft:preview', d),
  composeDraft: (sections) => call('draft:compose', sections),
  forgetExported: (keys) => call('exported:forget', keys),
  clearExported: () => call('exported:clear'),

  // Importaciones
  importMetaExport: (kind) => call('import:metaExport', kind),
  importMetaPath: (p) => call('import:metaPath', p),
  pickImages: (withVideo) => call('import:pickImages', withVideo),
  importScreenshots: (paths) => call('import:screenshots', paths),
  manualPost: (data) => call('import:manual', data),
  pathForFile: (file) => webUtils.getPathForFile(file), // arrastrar y soltar

  // IA
  aiArticle: (input) => call('ai:article', input),
  aiAlts: (urls, context) => call('ai:alts', urls, context),
  aiSetActive: (id) => call('ai:setActive', id),
  aiSave: (id, data) => call('ai:save', id, data),
  aiRemove: (id) => call('ai:remove', id),
  aiModels: (id, key, url) => call('ai:models', id, key, url),
  aiTest: () => call('ai:test'),

  // Blog
  blogList: (opts) => call('blog:list', opts),
  blogSetStatus: (id, status) => call('blog:setStatus', id, status),
  blogTrash: (id) => call('blog:trash', id),
  blogEditUrl: (id, type) => call('blog:editUrl', id, type),

  // Ajustes
  exportConfig: (withSecrets) => call('config:export', withSecrets),
  importConfig: () => call('config:import'),
  appInfo: () => call('app:info'),
  openData: () => call('app:openData'),
  resetAll: () => call('app:resetAll'),
  tryNormalMode: () => call('mode:tryNormal'),
  setZoom: (f) => webFrame.setZoomFactor(f),
  open: (url) => call('open', url),

  // Actualizaciones y avisos
  updateStatus: () => call('update:status'),
  checkUpdate: () => call('update:check'),
  installUpdate: () => call('update:install'),
  onUpdate: on('update:status'),
  onToast: on('toast'),
  onConfigChanged: on('config:changed'),
});
