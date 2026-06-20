const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

let mainWindow;
let nodeProcess = null;
let minerProcess = null;

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (nodeProcess) nodeProcess.kill();
  if (minerProcess) minerProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('start-node', (event, { datadir }) => {
  if (nodeProcess) return { error: 'Node already running' };
  const binaryPath = getBinaryPath('goldogram-core');
  const args = ['node', '--fullnode'];
  if (datadir) args.push('--datadir', datadir);
  nodeProcess = spawn(binaryPath, args, {
    env: { ...process.env, SEED_NODES: '87.255.81.125:8333', API_NODE: 'http://goldminequant.org' }
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
    env: { ...process.env, MINER_ADDRESS: address, API_NODE: apiNode || 'http://goldminequant.org', SEED_NODES: '87.255.81.125:8333' }
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

ipcMain.handle('get-sysinfo', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
  };
});
