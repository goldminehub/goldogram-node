const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('node', {
  start: (opts) => ipcRenderer.invoke('start-node', opts),
  stop: () => ipcRenderer.invoke('stop-node'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  getSysinfo: () => ipcRenderer.invoke('get-sysinfo'),
  onLog: (cb) => ipcRenderer.on('node-log', (_, msg) => cb(msg)),
  onStopped: (cb) => ipcRenderer.on('node-stopped', (_, msg) => cb(msg)),
});
contextBridge.exposeInMainWorld('updater', {
  check: () => ipcRenderer.invoke('check-update'),
  install: () => ipcRenderer.invoke('install-update'),
  onAvailable: (cb) => ipcRenderer.on('update-available', (_, msg) => cb(msg)),
  onDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, msg) => cb(msg)),
  onProgress: (cb) => ipcRenderer.on('update-progress', (_, msg) => cb(msg)),
  onError: (cb) => ipcRenderer.on('update-error', (_, msg) => cb(msg)),
});

contextBridge.exposeInMainWorld('miner', {
  start: (opts) => ipcRenderer.invoke('start-miner', opts),
  stop: () => ipcRenderer.invoke('stop-miner'),
  onLog: (cb) => ipcRenderer.on('miner-log', (_, msg) => cb(msg)),
  onStopped: (cb) => ipcRenderer.on('miner-stopped', (_, msg) => cb(msg)),
});
