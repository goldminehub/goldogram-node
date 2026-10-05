const { contextBridge, ipcRenderer } = require('electron');

function invokeLogged(handler, ...args) {
  return ipcRenderer.invoke(handler, ...args).catch((err) => {
    const message = err && err.message ? err.message : String(err);
    try {
      ipcRenderer.send('renderer-ipc-reject', { handler, message });
    } catch (_) {
      /* ignore */
    }
    throw err;
  });
}

contextBridge.exposeInMainWorld('node', {
  start: (opts) => invokeLogged('start-node', opts),
  stop: () => invokeLogged('stop-node'),
  getStatus: () => invokeLogged('get-status'),
  getSysinfo: () => invokeLogged('get-sysinfo'),
  getAppVersion: () => invokeLogged('get-app-version'),
  getDiskStats: (opts) => invokeLogged('get-disk-stats', opts || {}),
  resyncFromCheckpoint: (opts) => invokeLogged('resync-from-checkpoint', opts || {}),
  onLog: (cb) => ipcRenderer.on('node-log', (_, msg) => cb(msg)),
  onStopped: (cb) => ipcRenderer.on('node-stopped', (_, msg) => cb(msg)),
  keystoreList: (opts) => invokeLogged('keystore-list', opts),
  keystoreEnsure: (opts) => invokeLogged('keystore-ensure', opts),
  keystoreUnlock: (opts) => invokeLogged('keystore-unlock', opts),
  keystoreLock: () => invokeLogged('keystore-lock'),
  signValidatorTx: (opts) => invokeLogged('sign-validator-tx', opts),
  reportError: (payload) => ipcRenderer.send('renderer-error', payload || {}),
});
contextBridge.exposeInMainWorld('updater', {
  check: () => invokeLogged('check-update'),
  install: () => invokeLogged('install-update'),
  getStatus: () => invokeLogged('get-update-status'),
  setAutomatic: (automatic) => invokeLogged('set-auto-update', { automatic }),
  onStatus: (cb) => ipcRenderer.on('update-status', (_, msg) => cb(msg)),
  onAvailable: (cb) => ipcRenderer.on('update-available', (_, msg) => cb(msg)),
  onDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, msg) => cb(msg)),
  onProgress: (cb) => ipcRenderer.on('update-progress', (_, msg) => cb(msg)),
  onError: (cb) => ipcRenderer.on('update-error', (_, msg) => cb(msg)),
});

contextBridge.exposeInMainWorld('miner', {
  start: (opts) => invokeLogged('start-miner', opts),
  stop: () => invokeLogged('stop-miner'),
  onLog: (cb) => ipcRenderer.on('miner-log', (_, msg) => cb(msg)),
  onStopped: (cb) => ipcRenderer.on('miner-stopped', (_, msg) => cb(msg)),
});
