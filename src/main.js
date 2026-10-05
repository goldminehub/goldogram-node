const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');
const { buildNodeArgs, appVersionEnv } = require('./node_args');
const {
  defaultKeystorePath,
  listKeystoreAddresses,
  signValidatorTx,
  wrapKeystoreFile,
  expandHome,
} = require('./keystore_sign');
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
const { createAutoUpdateController } = require('./auto_update');
const { collectDiskStats, wipeBlocksDir, defaultDatadir } = require('./disk_stats');
const { appendMainLog } = require('./main_log');

let mainWindow;
let nodeProcess = null;
let minerProcess = null;
const pendingDashLogs = [];
/** @type {{ path: string, password: string, unlockedAt: number } | null} */
let unlockedKeystore = null;
/** Last successful start-node options (used to restart after Unlock). */
let lastNodeStartOpts = null;
/** @type {ReturnType<typeof createAutoUpdateController> | null} */
let updateController = null;

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
  appendMainLog(line);
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

/** Soft-stop for auto-update: prefer graceful exit so the current mine attempt can finish. */
async function gracefulStopTrackedNode(deadlineMs) {
  const child = nodeProcess;
  const miner = minerProcess;
  const deadline = Number(deadlineMs) || Date.now() + 60000;
  if (child && child.pid) {
    dashLog('[Update] stopping core cleanly before install…');
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T'], { windowsHide: true });
      } else {
        try { process.kill(child.pid, 'SIGTERM'); } catch (_) { /* gone */ }
      }
    } catch (_) { /* ignore */ }
    while (Date.now() < deadline && isPidAlive(child.pid)) {
      await sleep(500);
    }
    if (isPidAlive(child.pid)) {
      dashLog('[Update] core still alive — force kill');
      await killChild(child);
    } else {
      await waitForExit(child);
    }
  }
  nodeProcess = null;
  if (miner && miner.pid) {
    minerProcess = null;
    await killChild(miner);
  }
  await sleep(LOCK_GRACE_MS);
}

async function waitForQuietMineWindow(deadlineMs) {
  const deadline = Number(deadlineMs) || Date.now() + 90000;
  while (Date.now() < deadline) {
    if (!nodeProcess || !nodeProcess.pid) return;
    try {
      const res = await fetch('http://localhost:8080/api/status');
      const data = await res.json();
      const mining = data && data.mining ? data.mining : {};
      const state = String(mining.state || '');
      // Finish the current attempt: wait until not actively hashing a template.
      if (state !== 'mining' || !mining.active) return;
    } catch (_) {
      return;
    }
    await sleep(1000);
  }
}

async function prepareForSilentInstall(deadlineMs) {
  await waitForQuietMineWindow(deadlineMs);
  await gracefulStopTrackedNode(deadlineMs);
  dashLog('[Update] core stopped — installing update');
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
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    appendMainLog(`[Renderer console L${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    appendMainLog(`[Renderer] did-fail-load ${code} ${desc} ${url}`);
  });
}

app.whenReady().then(async () => {
  await killGoldogramOrphans();
  createWindow();
  updateController = createAutoUpdateController({
    autoUpdater,
    userData: () => app.getPath('userData'),
    log: (line) => dashLog(line),
    send: (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    },
    prepareForInstall: prepareForSilentInstall,
    getVersion: () => app.getVersion(),
  });
  updateController.start();
});

// macOS: re-create the window when the dock icon is clicked and no window is open.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (updateController) updateController.stop();
  stopTrackedNode();
  if (process.platform !== 'darwin') app.quit();
});

async function startFullNode(opts = {}) {
  const {
    datadir,
    seeds,
    validatorAddress,
    mine,
    rewardAddress,
    enableValidator,
  } = opts;
  lastNodeStartOpts = { datadir, seeds, validatorAddress, mine, rewardAddress, enableValidator };
  await stopTrackedNode();
  await killGoldogramOrphans();
  const binaryPath = getBinaryPath('goldogram-core');
  const ksPath = defaultKeystorePath(datadir);
  const ksAddrs = listKeystoreAddresses(ksPath);
  const hasKeystore = ksAddrs.length > 0;
  const vAddr = (validatorAddress && String(validatorAddress).trim())
    || (ksAddrs[0] ? String(ksAddrs[0]) : '')
    || '';
  const args = buildNodeArgs({
    datadir,
    validatorAddress: vAddr,
    mine,
    rewardAddress,
    enableValidator: !!enableValidator || !!vAddr,
    hasKeystore,
  });
  const reward = rewardAddress && String(rewardAddress).trim();
  console.log('[Node] spawn argv:', binaryPath, args.join(' '));
  mainWindow?.webContents.send('node-log', { type: 'stdout', line: '[Node] spawn argv: ' + args.join(' ') });
  if (hasKeystore && args.includes('--validator')) {
    mainWindow?.webContents.send('node-log', {
      type: 'stdout',
      line: `[Validator] keystore loaded (${ksPath})`,
    });
  }
  const seedList = seeds && String(seeds).trim()
    ? String(seeds).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).join(',')
    : DEFAULT_SEEDS;
  const env = {
    ...process.env,
    ...appVersionEnv(app.getVersion()),
    SEED_NODES: seedList,
    API_NODES: DEFAULT_API_NODES,
    ...(datadir ? { GOLDOGRAM_DATADIR: datadir } : {}),
    VALIDATOR_KEYSTORE_PATH: ksPath,
  };
  if (unlockedKeystore && unlockedKeystore.password) {
    env.DILITHIUM5_KEY_ENCRYPTION_KEY = unlockedKeystore.password;
  }
  const claimAddr = vAddr || reward;
  if (claimAddr) {
    env.VALIDATOR_ADDRESS = claimAddr;
  }
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
}

async function restartNodeAfterKeystoreUnlock() {
  if (!nodeProcess || !nodeProcess.pid || !lastNodeStartOpts) return false;
  mainWindow?.webContents.send('node-log', {
    type: 'stdout',
    line: '[Validator] restarting node with unlocked keystore so attest loop can sign',
  });
  const res = await startFullNode(lastNodeStartOpts);
  return !!(res && res.ok);
}

ipcMain.handle('start-node', async (_event, opts) => startFullNode(opts || {}));

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

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('keystore-list', async (_event, { datadir } = {}) => {
  const ksPath = defaultKeystorePath(datadir);
  const addrs = listKeystoreAddresses(ksPath);
  return {
    path: ksPath,
    addresses: addrs,
    unlocked: !!(unlockedKeystore && unlockedKeystore.path === ksPath),
    exists: addrs.length > 0 || require('fs').existsSync(ksPath),
  };
});

ipcMain.handle('keystore-ensure', async (_event, { datadir, token, password, pin, apiBase, replace } = {}) => {
  const ksPath = defaultKeystorePath(datadir);
  const existing = listKeystoreAddresses(ksPath);
  const forceReplace = !!replace;
  if (existing.length && !forceReplace) {
    return { ok: true, created: false, path: ksPath, addresses: existing };
  }
  if (!token || !password) {
    return { ok: false, error: 'token and password required to create keystore' };
  }
  const base = (apiBase && String(apiBase).trim()) || 'https://goldminequant.org';
  const body = { password };
  if (pin) body.pin = String(pin);
  let exported;
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/wallet/export-signing-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    exported = await res.json();
    if (!res.ok || !exported?.ok) {
      return {
        ok: false,
        error: exported?.error || `export-signing-key HTTP ${res.status}`,
        needs_pin: /pin/i.test(String(exported?.error || '')),
      };
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  if (forceReplace && require('fs').existsSync(ksPath)) {
    try {
      require('fs').unlinkSync(ksPath);
    } catch (e) {
      return { ok: false, error: 'failed to remove old keystore: ' + (e.message || e) };
    }
  }
  const binaryPath = getBinaryPath('goldogram-core');
  const wrap = wrapKeystoreFile({
    binaryPath,
    keystorePath: ksPath,
    address: exported.address,
    pkHex: exported.pk_hex,
    skHex: exported.sk_hex,
    password,
  });
  // Drop SK from memory as soon as wrap returns.
  exported.sk_hex = undefined;
  if (!wrap.ok) return wrap;
  unlockedKeystore = { path: ksPath, password, addresses: [exported.address] };
  mainWindow?.webContents.send('node-log', {
    type: 'stdout',
    line: `[Keystore] written ${ksPath}`,
  });
  mainWindow?.webContents.send('node-log', {
    type: 'stdout',
    line: `[Validator] keystore loaded (address ${exported.address})`,
  });
  const restarted = await restartNodeAfterKeystoreUnlock();
  return {
    ok: true,
    created: !forceReplace,
    replaced: forceReplace,
    path: ksPath,
    addresses: [exported.address],
    restarted,
  };
});

ipcMain.handle('keystore-unlock', async (_event, { datadir, password } = {}) => {
  const ksPath = defaultKeystorePath(datadir);
  const addrs = listKeystoreAddresses(ksPath);
  if (!addrs.length) {
    return { ok: false, error: `No validators in keystore ${ksPath}` };
  }
  const pw = password == null ? '' : String(password);
  // Verify by attempting a dry Transfer sign (nonce/amount irrelevant for decrypt).
  const binaryPath = getBinaryPath('goldogram-core');
  const probe = signValidatorTx({
    binaryPath,
    keystorePath: ksPath,
    password: pw,
    address: addrs[0],
    txType: 'Transfer',
    amountMicro: 0,
    feeMicro: 1000,
    nonce: 1,
  });
  if (!probe.ok) {
    return { ok: false, error: probe.error || 'Unlock failed (wrong password?)' };
  }
  unlockedKeystore = { path: ksPath, password: pw, unlockedAt: Date.now() };
  mainWindow?.webContents.send('node-log', {
    type: 'stdout',
    line: `[Validator] keystore loaded (address ${addrs[0]})`,
  });
  const restarted = await restartNodeAfterKeystoreUnlock();
  return { ok: true, path: ksPath, addresses: addrs, restarted };
});

ipcMain.handle('keystore-lock', async () => {
  unlockedKeystore = null;
  return { ok: true };
});

ipcMain.handle('sign-validator-tx', async (_event, opts = {}) => {
  const datadir = opts.datadir;
  const ksPath = defaultKeystorePath(datadir);
  const pw = (unlockedKeystore && unlockedKeystore.path === ksPath)
    ? unlockedKeystore.password
    : (opts.password || '');
  if (!pw && unlockedKeystore?.path !== ksPath) {
    return { ok: false, error: 'Keystore locked — unlock first' };
  }
  const binaryPath = getBinaryPath('goldogram-core');
  return signValidatorTx({
    binaryPath,
    keystorePath: ksPath,
    password: pw,
    address: opts.address,
    txType: opts.txType,
    amountMicro: opts.amountMicro,
    feeMicro: opts.feeMicro != null ? opts.feeMicro : 1000,
    nonce: opts.nonce,
    payload: opts.payload,
  });
});

ipcMain.handle('check-update', async () => {
  if (!updateController) return { ok: false, error: 'updater not ready' };
  return updateController.checkNow('manual');
});

ipcMain.handle('install-update', () => {
  // Kept for API compatibility; silent path uses quitAndInstall(true, true).
  try {
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('get-update-status', () => {
  return updateController ? updateController.getStatus() : { automatic: true };
});

ipcMain.handle('set-auto-update', (_event, { automatic } = {}) => {
  if (!updateController) return { ok: false };
  updateController.setAutomatic(!!automatic);
  return { ok: true, automatic: updateController.isAutomatic() };
});

ipcMain.handle('get-disk-stats', (_event, { datadir } = {}) => {
  return { ok: true, ...collectDiskStats(datadir) };
});

ipcMain.handle('resync-from-checkpoint', async (_event, { datadir } = {}) => {
  dashLog('[Resync] stopping node and wiping local blocks (checkpoint resync)…');
  await stopTrackedNode();
  const wipe = wipeBlocksDir(datadir || (lastNodeStartOpts && lastNodeStartOpts.datadir));
  dashLog(`[Resync] ${wipe.wiped ? 'wiped' : 'no'} blocks at ${wipe.path}`);
  const opts = lastNodeStartOpts
    ? { ...lastNodeStartOpts, datadir: datadir || lastNodeStartOpts.datadir }
    : {
        datadir: defaultDatadir(datadir),
        seeds: DEFAULT_SEEDS,
        mine: false,
      };
  const started = await startFullNode(opts);
  return { ok: !!started?.ok, wipe, started };
});

ipcMain.handle('get-sysinfo', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    totalMem: os.totalmem(),
    freeMem: os.freemem(),
    appVersion: app.getVersion(),
  };
});

ipcMain.on('renderer-ipc-reject', (_event, payload = {}) => {
  appendMainLog(`[IPC reject] ${payload.handler || '?'}: ${payload.message || 'unknown'}`);
});

ipcMain.on('renderer-error', (_event, payload = {}) => {
  appendMainLog(`[Renderer error] ${payload.source || 'unknown'}: ${payload.message || ''}`);
  if (payload.stack) appendMainLog(payload.stack);
});
