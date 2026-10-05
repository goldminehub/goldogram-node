'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function expandHome(p) {
  const s = String(p || '').trim();
  if (!s || s === '~') return path.join(os.homedir(), '.goldogram');
  if (s.startsWith('~/') || s.startsWith('~\\')) {
    return path.join(os.homedir(), s.slice(2));
  }
  return s;
}

function defaultDatadir(configured) {
  const c = String(configured || '').trim();
  if (c) return expandHome(c);
  return path.join(os.homedir(), '.goldogram');
}

function dirSizeBytes(root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      try {
        if (ent.isDirectory()) stack.push(full);
        else if (ent.isFile() || ent.isSymbolicLink()) {
          total += fs.statSync(full).size;
        }
      } catch (_) {
        /* skip unreadable */
      }
    }
  }
  return total;
}

function freeDiskBytes(dir) {
  try {
    if (typeof fs.statfsSync === 'function') {
      const s = fs.statfsSync(dir);
      const bsize = Number(s.bsize) || Number(s.frsize) || 0;
      const bavail = Number(s.bavail);
      if (bsize > 0 && Number.isFinite(bavail)) return bsize * bavail;
    }
  } catch (_) {
    /* fall through */
  }
  return null;
}

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '—';
  if (v < 1024) return `${Math.round(v)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  return `${x.toFixed(x >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * @param {string} [configuredDatadir]
 */
function collectDiskStats(configuredDatadir) {
  const datadir = defaultDatadir(configuredDatadir);
  const blocksDir = path.join(datadir, 'blocks');
  let dbBytes = 0;
  let dbExists = false;
  try {
    if (fs.existsSync(blocksDir)) {
      dbExists = true;
      dbBytes = dirSizeBytes(blocksDir);
    }
  } catch (_) {
    dbBytes = 0;
  }
  let freeBytes = freeDiskBytes(fs.existsSync(datadir) ? datadir : os.homedir());
  return {
    datadir,
    blocksDir,
    dbExists,
    dbBytes,
    dbText: formatBytes(dbBytes),
    freeBytes,
    freeText: freeBytes == null ? '—' : formatBytes(freeBytes),
  };
}

/**
 * Wipe sled block store after stopping the core. Keeps keystore, peers, node_id.
 * Sync will rebuild from trusted checkpoint + seed.
 */
function wipeBlocksDir(configuredDatadir) {
  const datadir = defaultDatadir(configuredDatadir);
  const blocksDir = path.join(datadir, 'blocks');
  if (!fs.existsSync(blocksDir)) {
    return { ok: true, wiped: false, path: blocksDir };
  }
  fs.rmSync(blocksDir, { recursive: true, force: true });
  return { ok: true, wiped: true, path: blocksDir };
}

module.exports = {
  expandHome,
  defaultDatadir,
  dirSizeBytes,
  freeDiskBytes,
  formatBytes,
  collectDiskStats,
  wipeBlocksDir,
};
