const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

let mainWindow;
let nodeProcess = null;

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
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('start-node', (event, { datadir }) => {
  if (nodeProcess) return { error: 'Node already running' };

  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'goldogram-core.exe' : 'goldogram-core';
  const binaryPath = app.isPackaged
    ? path.join(process.resourcesPath, binaryName)
    : path.join(__dirname, '../bin', binaryName);

  const args = ['--fullnode'];
  if (datadir) args.push('--datadir', datadir);
  args.push('--seed-node', '87.255.81.125:8333');
  args.push('--port', '0');

  nodeProcess = spawn(binaryPath, args);

  nodeProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
      mainWindow?.webContents.send('node-log', { type: 'stdout', line });
    });
  });

  nodeProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
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
  if (nodeProcess) {
    nodeProcess.kill();
    nodeProcess = null;
  }
  return { ok: true };
});

ipcMain.handle('get-status', async () => {
  try {
    const res = await fetch('https://goldminequant.org/api/status');
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
