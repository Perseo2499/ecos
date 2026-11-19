const { contextBridge, ipcRenderer } = require('electron');

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  getConfig: () => call('config:get'),
  setConfig: (c) => call('config:set', c),
  metaLogin: () => call('meta:login'),
  metaAccounts: () => call('meta:accounts'),
  metaPosts: (pageId, sources, cursors) => call('meta:posts', pageId, sources, cursors),
  wpLogin: () => call('wp:login'),
  wpCategories: () => call('wp:categories'),
  buildDraft: (posts) => call('draft:build', posts),
  publish: (d) => call('draft:publish', d),
  open: (url) => call('open', url),
  mergeDuplicates: (list) => call('posts:merge', list),
  forgetExported: (keys) => call('exported:forget', keys),
  blogList: (opts) => call('blog:list', opts),
  blogSetStatus: (id, status) => call('blog:setStatus', id, status),
  blogTrash: (id) => call('blog:trash', id),
  blogEditUrl: (id, type) => call('blog:editUrl', id, type),
  tryNormalMode: () => call('mode:tryNormal'),
  updateStatus: () => call('update:status'),
  checkUpdate: () => call('update:check'),
  installUpdate: () => call('update:install'),
  onToast: (cb) => ipcRenderer.on('toast', (_e, msg) => cb(msg)),
  onConfigChanged: (cb) => ipcRenderer.on('config:changed', (_e, c) => cb(c)),
  onUpdate: (cb) => ipcRenderer.on('update:status', (_e, st) => cb(st)),
  importMetaExport: (kind) => call('import:metaExport', kind),
  pickImages: (withVideo) => call('import:pickImages', withVideo),
  importScreenshots: (paths) => call('import:screenshots', paths),
  manualPost: (data) => call('import:manual', data),
});
