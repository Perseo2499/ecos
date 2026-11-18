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
});
