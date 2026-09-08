const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const { buildNodeArgs } = require('./node_args');
const {
  LOCK_GRACE_MS,
  taskkillArgs,
  parseWmicNamedCsv,
  parseTasklistCsv,
  parseNetstatAno,
  parsePsPidComm,
  parseSsLp,
  selectNamedCoreOrphans,
  selectGoldogramPortOrphans,
  mergeKillTargets,
  killTargetLogLine,
  waitForExit,
  waitPidsGone,
  sleep,
} = require('./process_kill');

let mainWindow;
let nodeProcess = null;
let minerProcess = null;
const pendingDashLogs = [];

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

function dashLog(line) {
  const payload = { type: 'stdout', line: String(line) };
  console.log(line);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('node-log', payload);
  } else {
    pendingDashLogs.push(payload);
  }
}

function flushDashLogs() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  while (pendingDashLogs.length) {
    mainWindow.webContents.send('node-log', pendingDashLogs.shift());
  }
}

function skipSweepPids() {
  const pids = [process.pid];
  if (nodeProcess && nodeProcess.pid) pids.push(nodeProcess.pid);
  if (minerProcess && minerProcess.pid) pids.push(minerProcess.pid);
  return pids;
}

function listAllProcesses() {
  if (process.platform === 'win32') {
    const r = spawnSync(
      'wmic',
      ['process', 'get', 'ProcessId,Name,ExecutablePath', '/FORMAT:CSV'],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 }
    );
    const rows = parseWmicNamedCsv(r.stdout || '');
    if (rows.length) return rows;
    const t = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
    return parseTasklistCsv(t.stdout || '');
  }
  const r = spawnSync('ps', ['-eo', 'pid=,comm='], { encoding: 'utf8', timeout: 8000 });
  return parsePsPidComm(r.stdout || '');
}

function listPortListeners(procs) {
  const byPid = new Map((procs || []).map((p) => [p.pid, p]));
  if (process.platform === 'win32') {
    const r = spawnSync('netstat', ['-ano', '-p', 'TCP'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
    return parseNetstatAno(r.stdout || '').map((p) => {
      const proc = byPid.get(p.pid) || {};
      return { ...p, name: proc.name || proc.exePath || '', exePath: proc.exePath || '' };
    });
  }
  const r = spawnSync('ss', ['-lptn'], { encoding: 'utf8', timeout: 8000 });
  return parseSsLp(r.stdout || '').map((p) => {
    if (p.name) return p;
    const proc = byPid.get(p.pid) || {};
    return { ...p, name: proc.name || '' };
  });
}

function isPidAlive(pid) {
  if (!pid) return false;
  if (process.platform === 'win32') {
    const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    return String(r.stdout || '').includes(String(pid));
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceKillPid(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', taskkillArgs(pid), { windowsHide: true });
  } else {
    try { process.kill(pid, 'SIGKILL'); } catch (_) { /* already gone */ }
  }
}

async function killChild(child) {
  if (!child || !child.pid) return;
  const pid = child.pid;
  forceKillPid(pid);
  await waitForExit(child);
}

async function killGoldogramOrphans() {
  const skip = skipSweepPids();
  const procs = listAllProcesses();
  const named = selectNamedCoreOrphans(procs, skip);
  const listeners = selectGoldogramPortOrphans(listPortListeners(procs), skip);
  const targets = mergeKillTargets(named, listeners);
  for (const t of targets) {
    forceKillPid(t.pid);
    dashLog(killTargetLogLine(t));
  }
  if (targets.length) {
    await waitPidsGone(targets.map((t) => t.pid), isPidAlive);
    dashLog('[Node] orphan sweep: killed ' + targets.length + ' process(es)');
  }
  await sleep(LOCK_GRACE_MS);
}

async function stopTrackedNode() {
  const child = nodeProcess;
  nodeProcess = null;
  await killChild(child);
  if (minerProcess) {
    const m = minerProcess;
    minerProcess = null;
    await killChild(m);
  }
  await sleep(LOCK_GRACE_MS);
}

function emitNodeStopped(code, error) {
  mainWindow?.webContents.send('node-stopped', { code, error: error || null });
  if (error) {
    mainWindow?.webContents.send('node-log', { type: 'stderr', line: error });
  }
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
  mainWindow.webContents.once('did-finish-load', flushDashLogs);
}

app.whenReady().then(async () => {
  await killGoldogramOrphans();
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
  stopTrackedNode();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('start-node', async (event, { datadir, seeds, validatorAddress, validatorStake, mine, rewardAddress }) => {
  await stopTrackedNode();
  await killGoldogramOrphans();
  const binaryPath = getBinaryPath('goldogram-core');
  const args = buildNodeArgs({ datadir, validatorAddress, validatorStake, mine, rewardAddress });
  const reward = rewardAddress && String(rewardAddress).trim();
  console.log('[Node] spawn argv:', binaryPath, args.join(' '));
  mainWindow?.webContents.send('node-log', { type: 'stdout', line: '[Node] spawn argv: ' + args.join(' ') });
  const seedList = seeds && String(seeds).trim()
    ? String(seeds).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).join(',')
    : DEFAULT_SEEDS;
  const env = {
    ...process.env,
    SEED_NODES: seedList,
    API_NODES: DEFAULT_API_NODES,
    ...(datadir ? { GOLDOGRAM_DATADIR: datadir } : {}),
  };
  // Sovereign mine never reads API_NODE. Keep API_NODES for fullnode HTTP fallback sync only.
  if (mine && reward) {
    env.MINING_REWARD_ADDRESS = reward;
    delete env.API_NODE;
  } else {
    env.API_NODE = DEFAULT_API_NODES.split(',')[0];
  }
  let child;
  try {
    child = spawn(binaryPath, args, { env });
  } catch (e) {
    const error = 'spawn failed: ' + (e && e.message ? e.message : String(e));
    emitNodeStopped(1, error);
    return { error };
  }
  nodeProcess = child;
  child.stdout.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach(line => {
      mainWindow?.webContents.send('node-log', { type: 'stdout', line });
      if (/could not acquire lock|os error 33/i.test(line)) {
        emitNodeStopped(1, line);
      }
    });
  });
  child.stderr.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach(line => {
      mainWindow?.webContents.send('node-log', { type: 'stderr', line });
      if (/could not acquire lock|os error 33/i.test(line)) {
        emitNodeStopped(1, line);
      }
    });
  });
  child.on('error', (err) => {
    if (nodeProcess === child) nodeProcess = null;
    emitNodeStopped(1, 'spawn failed: ' + err.message);
  });
  child.on('exit', (code) => {
    if (nodeProcess === child) nodeProcess = null;
    const failed = code !== 0 && code != null;
    emitNodeStopped(code, failed ? `goldogram-core exited (code ${code})` : null);
  });
  return { ok: true };
});

ipcMain.handle('stop-node', async () => {
  await stopTrackedNode();
  return { ok: true };
});

ipcMain.handle('start-miner', async (event, { address, apiNode }) => {
  if (minerProcess) return { error: 'Miner already running' };
  await killGoldogramOrphans();
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
  const running = !!(nodeProcess && nodeProcess.pid);
  if (!running) return { ok: false, running: false };
  try {
    const res = await fetch('http://localhost:8080/api/status');
    const data = await res.json();
    return { ok: true, running: true, data };
  } catch {
    return { ok: false, running: true };
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
