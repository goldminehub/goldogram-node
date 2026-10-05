/**
 * Silent auto-update for the Electron desktop node.
 *
 * Checks GitHub latest.yml via electron-updater. When a build is downloaded,
 * waits for a quiet mining window (or a short timeout), stops the core, then
 * quitAndInstall(isSilent=true, isForceRunAfter=true).
 */

const fs = require('fs');
const path = require('path');

const CHECK_DELAY_MS = 60 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INSTALL_WAIT_MS = 90 * 1000;

function prefsPath(userData) {
  return path.join(userData, 'update-prefs.json');
}

function loadPrefs(userData) {
  const defaults = { automatic: true, lastCheckedAt: 0, lastVersion: '' };
  try {
    const raw = fs.readFileSync(prefsPath(userData), 'utf8');
    const j = JSON.parse(raw);
    return {
      automatic: j.automatic !== false,
      lastCheckedAt: Number(j.lastCheckedAt) || 0,
      lastVersion: String(j.lastVersion || ''),
    };
  } catch (_) {
    return defaults;
  }
}

function savePrefs(userData, prefs) {
  try {
    fs.writeFileSync(prefsPath(userData), JSON.stringify(prefs, null, 2));
  } catch (e) {
    console.error('[Update] save prefs failed:', e.message);
  }
}

/**
 * @param {object} opts
 * @param {import('electron-updater').AppUpdater} opts.autoUpdater
 * @param {() => string} opts.userData
 * @param {(line: string) => void} opts.log
 * @param {(channel: string, payload: object) => void} opts.send
 * @param {() => Promise<void>} opts.prepareForInstall  stop core / finish mine
 * @param {() => string} [opts.getVersion]
 */
function createAutoUpdateController(opts) {
  const { autoUpdater, userData, log, send, prepareForInstall } = opts;
  const getVersion = opts.getVersion || (() => {
    try { return require('electron').app.getVersion(); } catch (_) { return '0.0.0'; }
  });
  let prefs = loadPrefs(userData());
  let state = {
    checking: false,
    downloading: false,
    percent: 0,
    availableVersion: '',
    downloadedVersion: '',
    lastError: '',
    installing: false,
  };
  let checkTimer = null;
  let intervalTimer = null;
  let installScheduled = false;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Keep SHA512 verification from latest.yml (default).
  autoUpdater.allowDowngrade = false;

  function snapshot() {
    return {
      ...state,
      automatic: prefs.automatic,
      lastCheckedAt: prefs.lastCheckedAt,
      currentVersion: getVersion(),
    };
  }

  function emit() {
    send('update-status', snapshot());
  }

  function setPrefs( partial) {
    prefs = { ...prefs, ...partial };
    savePrefs(userData(), prefs);
    emit();
  }

  async function checkNow(reason) {
    if (!prefs.automatic && reason !== 'manual') {
      log(`[Update] skip check (${reason}) — automatic updates off`);
      return { ok: true, skipped: true };
    }
    if (state.checking || state.downloading || state.installing) {
      return { ok: true, busy: true };
    }
    state.checking = true;
    state.lastError = '';
    emit();
    log(`[Update] checking for updates (${reason})…`);
    try {
      const result = await autoUpdater.checkForUpdates();
      prefs.lastCheckedAt = Math.floor(Date.now() / 1000);
      savePrefs(userData(), prefs);
      state.checking = false;
      emit();
      return { ok: true, updateInfo: result && result.updateInfo };
    } catch (e) {
      state.checking = false;
      state.lastError = e.message || String(e);
      prefs.lastCheckedAt = Math.floor(Date.now() / 1000);
      savePrefs(userData(), prefs);
      emit();
      log(`[Update] check failed: ${state.lastError}`);
      return { ok: false, error: state.lastError };
    }
  }

  async function scheduleInstall(version) {
    if (installScheduled || state.installing) return;
    installScheduled = true;
    state.downloadedVersion = version;
    emit();
    log(`[Update] ${version} downloaded — preparing silent install`);
    const deadline = Date.now() + INSTALL_WAIT_MS;
    try {
      await prepareForInstall(deadline);
    } catch (e) {
      log(`[Update] prepareForInstall: ${e.message || e}`);
    }
    state.installing = true;
    emit();
    log(`[Update] installing ${version} (silent, relaunch)`);
    // isSilent=true, isForceRunAfter=true — no UI, relaunch after install.
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(true, true);
      } catch (e) {
        state.installing = false;
        installScheduled = false;
        state.lastError = e.message || String(e);
        emit();
        log(`[Update] quitAndInstall failed: ${state.lastError}`);
      }
    }, 500);
  }

  autoUpdater.on('checking-for-update', () => {
    state.checking = true;
    emit();
  });

  autoUpdater.on('update-available', (info) => {
    state.checking = false;
    state.availableVersion = info.version;
    state.downloading = true;
    state.percent = 0;
    prefs.lastVersion = info.version;
    savePrefs(userData(), prefs);
    emit();
    send('update-available', { version: info.version });
    log(`[Update] available: v${info.version} — downloading`);
  });

  autoUpdater.on('update-not-available', (info) => {
    state.checking = false;
    state.downloading = false;
    state.availableVersion = '';
    prefs.lastCheckedAt = Math.floor(Date.now() / 1000);
    if (info && info.version) prefs.lastVersion = info.version;
    savePrefs(userData(), prefs);
    emit();
    log(`[Update] up to date (v${(info && info.version) || 'current'})`);
  });

  autoUpdater.on('download-progress', (progress) => {
    state.downloading = true;
    state.percent = Number(progress.percent) || 0;
    emit();
    send('update-progress', { percent: state.percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    state.downloading = false;
    state.percent = 100;
    state.downloadedVersion = info.version;
    emit();
    send('update-downloaded', { version: info.version });
    if (prefs.automatic) {
      scheduleInstall(info.version);
    } else {
      log(`[Update] downloaded v${info.version} — automatic off; waiting`);
    }
  });

  autoUpdater.on('error', (err) => {
    state.checking = false;
    state.downloading = false;
    state.lastError = err.message || String(err);
    emit();
    send('update-error', { message: state.lastError });
    log(`[Update] error: ${state.lastError}`);
  });

  function start() {
    if (checkTimer) clearTimeout(checkTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    checkTimer = setTimeout(() => {
      checkNow('startup');
    }, CHECK_DELAY_MS);
    intervalTimer = setInterval(() => {
      checkNow('interval');
    }, CHECK_INTERVAL_MS);
    log(`[Update] scheduler armed (first check in ${CHECK_DELAY_MS / 1000}s, then every 6h)`);
  }

  function stop() {
    if (checkTimer) clearTimeout(checkTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    checkTimer = null;
    intervalTimer = null;
  }

  return {
    start,
    stop,
    checkNow,
    getStatus: snapshot,
    setAutomatic(on) {
      setPrefs({ automatic: !!on });
      log(`[Update] automatic updates ${on ? 'ON' : 'OFF'}`);
      if (on) checkNow('enabled');
    },
    isAutomatic: () => prefs.automatic,
    // test helpers
    _loadPrefs: () => loadPrefs(userData()),
    _savePrefs: (p) => savePrefs(userData(), p),
  };
}

module.exports = {
  createAutoUpdateController,
  loadPrefs,
  savePrefs,
  prefsPath,
  CHECK_DELAY_MS,
  CHECK_INTERVAL_MS,
};
