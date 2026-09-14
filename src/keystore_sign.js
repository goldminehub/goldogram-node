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

function defaultKeystorePath(datadir) {
  const base = expandHome(datadir || path.join(os.homedir(), '.goldogram'));
  return path.join(base, 'keystore.json');
}

function listKeystoreAddresses(keystorePath) {
  const p = expandHome(keystorePath);
  if (!fs.existsSync(p)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Object.keys(j.validators || {});
  } catch {
    return [];
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
}) {
  const body = {
    keystore_path: expandHome(keystorePath),
    password: password || '',
    address,
    tx_type: txType,
    amount: amountMicro || 0,
    fee: feeMicro || 0,
    nonce: nonce || 1,
    receiver: address,
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
    return { ok: false, error: String(r.error.message || r.error) };
  }
  if (r.status !== 0) {
    return {
      ok: false,
      error: (r.stderr || r.stdout || `sign-tx exit ${r.status}`).trim(),
    };
  }
  try {
    const tx = JSON.parse((r.stdout || '').trim());
    return { ok: true, tx };
  } catch (e) {
    return { ok: false, error: `bad sign-tx output: ${e.message}` };
  }
}

module.exports = {
  defaultKeystorePath,
  listKeystoreAddresses,
  expandHome,
  signValidatorTx,
};
