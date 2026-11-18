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
  metaPosts: (pageId, sources) => call('meta:posts', pageId, sources),
  wpLogin: () => call('wp:login'),
  wpCategories: () => call('wp:categories'),
  buildDraft: (posts) => call('draft:build', posts),
  publish: (d) => call('draft:publish', d),
  open: (url) => call('open', url),
  importMetaExport: (kind) => call('import:metaExport', kind),
  pickImages: (withVideo) => call('import:pickImages', withVideo),
  importScreenshots: (paths) => call('import:screenshots', paths),
  manualPost: (data) => call('import:manual', data),
});
