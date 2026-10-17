'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Resolve GoGX receive aliases via goldmine API before signing.
 * Returns { ok, receiver, is_alias, canonical, error }.
 */
async function resolveReceiverAddress(apiBase, address) {
  const addr = String(address || '').trim();
  if (!addr) return { ok: false, error: 'receiver required' };
  const base = String(apiBase || 'https://goldminequant.org').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/wallet/resolve/${encodeURIComponent(addr)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body.error || `resolve HTTP ${res.status}` };
    }
    const canonical = String(body.canonical || addr).trim();
    const isAlias = Boolean(body.is_alias);
    return { ok: true, receiver: addr, is_alias: isAlias, canonical };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** Sync wrapper for signValidatorTx (uses deasync-free: blocking via child not needed — call async path from main). */
function resolveReceiverAddressSync(apiBase, address) {
  // Prefer undici/sync unavailable — use spawn curl for Electron main sync IPC.
  const addr = String(address || '').trim();
  if (!addr) return { ok: false, error: 'receiver required' };
  const base = String(apiBase || 'https://goldminequant.org').replace(/\/$/, '');
  const url = `${base}/api/wallet/resolve/${encodeURIComponent(addr)}`;
  const r = spawnSync('curl', ['-fsS', '--max-time', '15', url], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  });
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || 'resolve failed').trim() };
  }
  try {
    const body = JSON.parse(String(r.stdout || '').trim());
    return {
      ok: true,
      receiver: addr,
      is_alias: Boolean(body.is_alias),
      canonical: String(body.canonical || addr).trim(),
    };
  } catch (e) {
    return { ok: false, error: `bad resolve JSON: ${e.message}` };
  }
}

function defaultKeystorePath(datadir) {
  const base = expandHome(datadir || path.join(os.homedir(), '.goldogram'));
  return path.join(base, 'keystore.json');
}

function listKeystoreAddresses(keystorePath) {
  const p = expandHome(keystorePath);
  if (!fs.existsSync(p)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (j && j.kdf === 'argon2id' && j.address) {
      return [String(j.address)];
    }
    return Object.keys(j.validators || {});
  } catch {
    return [];
  }
}

/**
 * Core `--sign-tx` / `--wrap-keystore` may still leak log lines to stdout on
 * older binaries. Take the last line that starts with `{` and parse it.
 */
function parseCliJsonStdout(stdout) {
  const text = String(stdout == null ? '' : stdout);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('{')) {
      return JSON.parse(lines[i]);
    }
  }
  // Whole buffer might be one JSON object (no trailing newline).
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }
  throw new Error('no JSON object in stdout');
}

/**
 * Create Argon2id keystore via goldogram-core --wrap-keystore (never logs SK).
 */
function wrapKeystoreFile({
  binaryPath,
  keystorePath,
  address,
  pkHex,
  skHex,
  password,
}) {
  const outPath = expandHome(keystorePath);
  const body = JSON.stringify({
    address,
    pk_hex: pkHex,
    sk_hex: skHex,
    password,
  });
  const r = spawnSync(binaryPath, ['--wrap-keystore', outPath], {
    input: body,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000,
  });
  if (r.error) {
    return { ok: false, error: String(r.error.message || r.error) };
  }
  if (r.status !== 0) {
    return {
      ok: false,
      error: (r.stderr || r.stdout || `wrap-keystore exit ${r.status}`).trim(),
      stderr: (r.stderr || '').trim(),
    };
  }
  try {
    const out = parseCliJsonStdout(r.stdout);
    return { ok: true, path: out.path || outPath, address: out.address || address };
  } catch {
    return { ok: true, path: outPath, address };
  }
}

/**
 * Sign a Validators v1 tx via goldogram-core --sign-tx.
 */
function signValidatorTx({
  binaryPath,
  keystorePath,
  password,
  address,
  txType,
  amountMicro,
  feeMicro,
  nonce,
  payload,
  receiver,
  apiBase,
  confirmCanonicalSubstitute,
}) {
  let resolvedReceiver = receiver || address;
  // Transfers (and any non-self receiver): refuse legacy aliases unless user confirmed substitute.
  const wantsExternal =
    String(txType || '') === 'Transfer' &&
    String(resolvedReceiver || '').trim() &&
    String(resolvedReceiver).trim() !== String(address || '').trim();
  if (wantsExternal || (String(txType || '') === 'Transfer' && receiver)) {
    const resolved = resolveReceiverAddressSync(apiBase, resolvedReceiver);
    if (!resolved.ok) {
      return { ok: false, error: `alias resolve failed: ${resolved.error}`, stderr: '' };
    }
    if (resolved.is_alias) {
      if (confirmCanonicalSubstitute) {
        resolvedReceiver = resolved.canonical;
      } else {
        return {
          ok: false,
          error:
            `receiver is a legacy alias (${resolved.receiver}). ` +
            `Use the canonical address ${resolved.canonical}, or confirm substitute. ` +
            `Do not submit alias receivers via /api/submit_tx / P2P.`,
          is_alias: true,
          alias: resolved.receiver,
          canonical: resolved.canonical,
          stderr: '',
        };
      }
    }
  }
  const body = {
    keystore_path: expandHome(keystorePath),
    password: password || '',
    address,
    tx_type: txType,
    amount: amountMicro || 0,
    fee: feeMicro || 0,
    nonce: nonce || 1,
    receiver: resolvedReceiver,
    payload: payload || undefined,
  };
  const r = spawnSync(binaryPath, ['--sign-tx'], {
    input: JSON.stringify(body),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    env: {
      ...process.env,
      VALIDATOR_KEYSTORE_PATH: expandHome(keystorePath),
      ...(password ? { DILITHIUM5_KEY_ENCRYPTION_KEY: password } : {}),
    },
  });
  if (r.error) {
    return { ok: false, error: String(r.error.message || r.error), stderr: '' };
  }
  const stderr = String(r.stderr || '').trim();
  if (r.status !== 0) {
    return {
      ok: false,
      error: (stderr || r.stdout || `sign-tx exit ${r.status}`).trim(),
      stderr,
    };
  }
  try {
    const tx = parseCliJsonStdout(r.stdout);
    return { ok: true, tx, stderr };
  } catch (e) {
    return {
      ok: false,
      error: `bad sign-tx output: ${e.message}`,
      stderr,
      stdout: String(r.stdout || '').slice(0, 500),
    };
  }
}

module.exports = {
  defaultKeystorePath,
  listKeystoreAddresses,
  expandHome,
  parseCliJsonStdout,
  resolveReceiverAddress,
  resolveReceiverAddressSync,
  signValidatorTx,
  wrapKeystoreFile,
};
