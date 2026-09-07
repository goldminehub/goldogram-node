'use strict';

const path = require('path');

const LOCK_GRACE_MS = 500;
const CORE_NAME_WIN = 'goldogram-core.exe';
const CORE_NAME_NIX = 'goldogram-core';

function taskkillArgs(pid) {
  return ['/PID', String(pid), '/T', '/F'];
}

function normalizePath(p) {
  return path.normalize(String(p || '')).replace(/\\/g, '/').toLowerCase();
}

function isAppCorePath(exePath, binDir) {
  if (!exePath || !binDir) return false;
  const exe = normalizePath(exePath);
  const dir = normalizePath(binDir).replace(/\/+$/, '');
  const base = path.posix.basename(exe);
  if (base !== CORE_NAME_WIN && base !== CORE_NAME_NIX) return false;
  return exe === dir || exe.startsWith(dir + '/');
}

/** Parse `wmic process ... get ProcessId,ExecutablePath /FORMAT:CSV` stdout. */
function parseWmicProcessCsv(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /executablepath/i.test(line) && /processid/i.test(line)) continue;
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const pid = parseInt(parts[parts.length - 1], 10);
    const exe = parts.slice(1, -1).join(',');
    if (!Number.isFinite(pid) || pid <= 0) continue;
    out.push({ pid, exePath: exe.trim() });
  }
  return out;
}

function orphansFromAppBin(processes, binDir) {
  return processes.filter((p) => isAppCorePath(p.exePath, binDir));
}

function waitForExit(child, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!child) {
      resolve();
      return;
    }
    if (child.exitCode != null || child.killed && !child.pid) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once('exit', finish);
    child.once('close', finish);
    const t = setTimeout(finish, timeoutMs);
    if (t.unref) t.unref();
  });
}

function sleep(ms, clock = setTimeout) {
  return new Promise((resolve) => clock(resolve, ms));
}

module.exports = {
  LOCK_GRACE_MS,
  CORE_NAME_WIN,
  CORE_NAME_NIX,
  taskkillArgs,
  isAppCorePath,
  parseWmicProcessCsv,
  orphansFromAppBin,
  waitForExit,
  sleep,
};
