const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('node', {
  start: (opts) => ipcRenderer.invoke('start-node', opts),
  stop: () => ipcRenderer.invoke('stop-node'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  getSysinfo: () => ipcRenderer.invoke('get-sysinfo'),
  onLog: (cb) => ipcRenderer.on('node-log', (_, msg) => cb(msg)),
  onStopped: (cb) => ipcRenderer.on('node-stopped', (_, msg) => cb(msg)),
});
