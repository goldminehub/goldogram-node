const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

let mainWindow;
let nodeProcess = null;
let minerProcess = null;

// Multiple seeds: DNS name first (survives IP changes), raw IP as fallback.
// The node also remembers good peers in peers.dat and retries them at startup,
// so the network heals even when every seed here is unreachable.
const DEFAULT_SEEDS = 'goldminequant.org:8333,87.255.81.125:8333';
// Ordered API endpoints for chain sync (first healthy wins). Add api2/api3 when Phase-1 HA servers exist.
const DEFAULT_API_NODES = 'https://goldminequant.org,http://87.255.81.125:8080';

function getBinaryPath(name) {
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? `${name}.exe` : name;
  return app.isPackaged
    ? path.join(process.resourcesPath, binaryName)
    : path.join(__dirname, '../bin', binaryName);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: process.platform === 'win32' ? 'default' : 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../assets/icon.png'),
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  createWindow();
  // Check for updates after 3 seconds
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 3000);
});

// macOS: re-create the window when the dock icon is clicked and no window is open.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('update-available', { version: info.version });
});

autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send('update-downloaded', { version: info.version });
});

autoUpdater.on('download-progress', (progress) => {
  mainWindow?.webContents.send('update-progress', { percent: progress.percent });
});

autoUpdater.on('error', (err) => {
  mainWindow?.webContents.send('update-error', { message: err.message });
});

app.on('window-all-closed', () => {
  if (nodeProcess) nodeProcess.kill();
  if (minerProcess) minerProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('start-node', (event, { datadir, seeds, validatorAddress, validatorStake }) => {
  if (nodeProcess) return { error: 'Node already running' };
  const binaryPath = getBinaryPath('goldogram-core');
  const args = ['node', '--fullnode'];
  if (datadir) args.push('--datadir', datadir);
  if (validatorAddress && String(validatorAddress).trim()) {
    args.push('--validator-address', String(validatorAddress).trim());
    const stake = parseInt(validatorStake, 10);
    if (Number.isFinite(stake) && stake > 0) args.push('--stake', String(stake));
  }
  const seedList = seeds && String(seeds).trim()
    ? String(seeds).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).join(',')
    : DEFAULT_SEEDS;
  nodeProcess = spawn(binaryPath, args, {
    env: {
      ...process.env,
      SEED_NODES: seedList,
      API_NODE: DEFAULT_API_NODES.split(',')[0],
      API_NODES: DEFAULT_API_NODES,
      ...(datadir ? { GOLDOGRAM_DATADIR: datadir } : {}),
    }
  });
  nodeProcess.stdout.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach(line => {
      mainWindow?.webContents.send('node-log', { type: 'stdout', line });
    });
  });
  nodeProcess.stderr.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach(line => {
      mainWindow?.webContents.send('node-log', { type: 'stderr', line });
    });
  });
  nodeProcess.on('exit', (code) => {
    nodeProcess = null;
    mainWindow?.webContents.send('node-stopped', { code });
  });
  return { ok: true };
});

ipcMain.handle('stop-node', () => {
  if (nodeProcess) { nodeProcess.kill(); nodeProcess = null; }
  return { ok: true };
});

ipcMain.handle('start-miner', (event, { address, apiNode }) => {
  if (minerProcess) return { error: 'Miner already running' };
  const binaryPath = getBinaryPath('goldogram-core');
  minerProcess = spawn(binaryPath, ['node', '--mine'], {
    env: { ...process.env, MINER_ADDRESS: address, API_NODE: apiNode || 'http://goldminequant.org', SEED_NODES: DEFAULT_SEEDS }
  });
  minerProcess.stdout.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach(line => {
      mainWindow?.webContents.send('miner-log', { type: 'stdout', line });
    });
  });
  minerProcess.stderr.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach(line => {
      mainWindow?.webContents.send('miner-log', { type: 'stderr', line });
    });
  });
  minerProcess.on('exit', (code) => {
    minerProcess = null;
    mainWindow?.webContents.send('miner-stopped', { code });
  });
  return { ok: true };
});

ipcMain.handle('stop-miner', () => {
  if (minerProcess) { minerProcess.kill(); minerProcess = null; }
  return { ok: true };
});

ipcMain.handle('get-status', async () => {
  try {
    const res = await fetch('http://localhost:8080/api/status');
    const data = await res.json();
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('check-update', () => {
  autoUpdater.checkForUpdates();
  return { ok: true };
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
  return { ok: true };
});

ipcMain.handle('get-sysinfo', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
  };
});
