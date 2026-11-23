'use strict';

const fs = require('fs');
const path = require('path');

/** Same port the full node listens on. */
const CANONICAL_P2P_PORT = 18333;

function normalizeSeed(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('[')) {
    const m = s.match(/^\[(.+)\]:(\d+)$/);
    if (!m) return '';
    return '[' + m[1] + ']:' + m[2];
  }
  const idx = s.lastIndexOf(':');
  if (idx > 0 && /^\d+$/.test(s.slice(idx + 1))) {
    return s.slice(0, idx) + ':' + s.slice(idx + 1);
  }
  return s + ':' + CANONICAL_P2P_PORT;
}

/** One host:port per line. `#` comments. Duplicates drop. */
function parseSeedText(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((line) => {
    const bare = line.split('#')[0].trim();
    if (!bare) return;
    bare.split(',').forEach((part) => {
      const n = normalizeSeed(part);
      if (n && out.indexOf(n) === -1) out.push(n);
    });
  });
  return out;
}

/**
 * The node app and the binary read the same file.
 * `SEED_FILE` wins. Otherwise `config/seeds.txt` under `appRoot`.
 */
function readSeedList(appRoot, env) {
  const e = env || process.env;
  const explicit = e.SEED_FILE && String(e.SEED_FILE).trim();
  const file = explicit || path.join(appRoot || process.cwd(), 'config', 'seeds.txt');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_) {
    text = '';
  }
  return parseSeedText(text).join(',');
}

module.exports = {
  CANONICAL_P2P_PORT,
  normalizeSeed,
  parseSeedText,
  readSeedList,
};
