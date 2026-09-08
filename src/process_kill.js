'use strict';

const path = require('path');

const LOCK_GRACE_MS = 500;
const CORE_NAME_WIN = 'goldogram-core.exe';
const CORE_NAME_NIX = 'goldogram-core';
const LISTEN_PORTS = [8333, 8335];

function taskkillArgs(pid) {
  return ['/PID', String(pid), '/T', '/F'];
}

function normalizePath(p) {
  return path.normalize(String(p || '')).replace(/\\/g, '/').toLowerCase();
}

function processBaseName(nameOrPath) {
  const raw = String(nameOrPath || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  return path.posix.basename(raw).toLowerCase();
}

/** Image name is goldogram-core or goldogram-core* (any path). */
function isGoldogramCoreName(nameOrPath) {
  const base = processBaseName(nameOrPath);
  return base === CORE_NAME_NIX || base.startsWith('goldogram-core');
}

function isGoldogramImageName(nameOrPath) {
  return processBaseName(nameOrPath).includes('goldogram');
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
    out.push({ pid, exePath: exe.trim(), name: processBaseName(exe) });
  }
  return out;
}

/** Parse wmic CSV whose header includes Name and ProcessId (column order from header). */
function parseWmicNamedCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headerIdx = lines.findIndex((l) => /processid/i.test(l) && /name/i.test(l));
  if (headerIdx < 0) return parseWmicProcessCsv(text);
  const header = lines[headerIdx].split(',').map((h) => h.trim().toLowerCase());
  const pidI = header.lastIndexOf('processid');
  const nameI = header.findIndex((h) => h === 'name');
  const pathI = header.findIndex((h) => h === 'executablepath');
  const out = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const parts = line.split(',');
    if (pidI < 0 || pidI >= parts.length) continue;
    const pid = parseInt(parts[pidI], 10);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const name = nameI >= 0 && nameI < parts.length ? parts[nameI].trim() : '';
    const exePath = pathI >= 0 && pathI < parts.length ? parts[pathI].trim() : '';
    out.push({
      pid,
      name: name || processBaseName(exePath),
      exePath,
    });
  }
  return out;
}

function parseTasklistCsv(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^"?([^"]+)"?,"?(\d+)"?/);
    if (!m) continue;
    const pid = parseInt(m[2], 10);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    out.push({ pid, name: m[1].trim() });
  }
  return out;
}

function parseNetstatAno(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!/LISTENING/i.test(raw)) continue;
    const m = raw.match(/^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (!m) continue;
    const local = m[1];
    const colon = local.lastIndexOf(':');
    const port = parseInt(colon >= 0 ? local.slice(colon + 1) : '', 10);
    const pid = parseInt(m[2], 10);
    if (!LISTEN_PORTS.includes(port) || !Number.isFinite(pid) || pid <= 0) continue;
    out.push({ port, pid });
  }
  return out;
}

function parsePsPidComm(text) {
  const out = [];
  for (const raw of String(text || '').split(/\n/)) {
    const m = raw.trim().match(/^(\d+)\s+(\S+)/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    out.push({ pid, name: m[2] });
  }
  return out;
}

function parseSsLp(text) {
  const out = [];
  for (const raw of String(text || '').split(/\n/)) {
    if (!/LISTEN/i.test(raw)) continue;
    const pidM = raw.match(/pid=(\d+)/);
    if (!pidM) continue;
    const pid = parseInt(pidM[1], 10);
    const nameM = raw.match(/users:\(\("([^"]+)"/);
    const portMatches = [...raw.matchAll(/:(\d+)\s/g)].map((x) => parseInt(x[1], 10));
    const port = portMatches.find((p) => LISTEN_PORTS.includes(p));
    if (!port || !Number.isFinite(pid) || pid <= 0) continue;
    out.push({ port, pid, name: nameM ? nameM[1] : '' });
  }
  return out;
}

function orphansFromAppBin(processes, binDir) {
  return processes.filter((p) => isAppCorePath(p.exePath, binDir));
}

/** Any goldogram-core* image, regardless of ExecutablePath. */
function selectNamedCoreOrphans(processes, skipPids = []) {
  const skip = new Set((skipPids || []).filter(Boolean));
  return processes.filter((p) => {
    if (skip.has(p.pid)) return false;
    const label = p.name || p.exePath || '';
    return isGoldogramCoreName(label);
  });
}

/** Listeners on 8333/8335 whose image name contains "goldogram". */
function selectGoldogramPortOrphans(listeners, skipPids = []) {
  const skip = new Set((skipPids || []).filter(Boolean));
  return (listeners || []).filter((p) => {
    if (skip.has(p.pid)) return false;
    if (!LISTEN_PORTS.includes(p.port)) return false;
    return isGoldogramImageName(p.name || p.exePath || '');
  });
}

function mergeKillTargets(named, listeners) {
  const byPid = new Map();
  for (const p of named || []) {
    byPid.set(p.pid, {
      pid: p.pid,
      name: p.name || processBaseName(p.exePath),
      exePath: p.exePath || '',
      ports: [],
      reasons: ['name'],
    });
  }
  for (const p of listeners || []) {
    const cur = byPid.get(p.pid);
    if (cur) {
      if (!cur.reasons.includes('port')) cur.reasons.push('port');
      if (p.port && !cur.ports.includes(p.port)) cur.ports.push(p.port);
      if (!cur.name && p.name) cur.name = p.name;
    } else {
      byPid.set(p.pid, {
        pid: p.pid,
        name: p.name || '',
        exePath: p.exePath || '',
        ports: p.port ? [p.port] : [],
        reasons: ['port'],
      });
    }
  }
  return [...byPid.values()];
}

function killTargetLogLine(t) {
  const name = t.name || 'unknown';
  const bits = [`pid=${t.pid}`, `name=${name}`];
  if (t.exePath) bits.push(`path=${t.exePath}`);
  if (t.ports && t.ports.length) bits.push(`ports=${t.ports.join(',')}`);
  return `[Node] killed ${bits.join(' ')}`;
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

async function waitPidsGone(pids, isAlive, timeoutMs = 8000, sleeper = sleep) {
  const unique = [...new Set((pids || []).filter(Boolean))];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (unique.every((pid) => !isAlive(pid))) return true;
    await sleeper(50);
  }
  return unique.every((pid) => !isAlive(pid));
}

module.exports = {
  LOCK_GRACE_MS,
  CORE_NAME_WIN,
  CORE_NAME_NIX,
  LISTEN_PORTS,
  taskkillArgs,
  isGoldogramCoreName,
  isGoldogramImageName,
  isAppCorePath,
  parseWmicProcessCsv,
  parseWmicNamedCsv,
  parseTasklistCsv,
  parseNetstatAno,
  parsePsPidComm,
  parseSsLp,
  orphansFromAppBin,
  selectNamedCoreOrphans,
  selectGoldogramPortOrphans,
  mergeKillTargets,
  killTargetLogLine,
  waitForExit,
  waitPidsGone,
  sleep,
};
