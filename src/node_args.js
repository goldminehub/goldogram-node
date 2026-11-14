'use strict';

/**
 * Exact argv passed to goldogram-core for the desktop full node.
 * Always --fullnode first. --mine only with --reward-address.
 * `--validator` is only added when a keystore exists on disk — never from
 * a bare address field (that triggered legacy PoS join with fake 10k stake).
 */
function buildNodeArgs({
  datadir,
  validatorAddress,
  mine,
  rewardAddress,
  enableValidator,
  hasKeystore,
} = {}) {
  const args = ['--fullnode'];
  if (datadir) args.push('--datadir', String(datadir));
  const vAddr = validatorAddress && String(validatorAddress).trim();
  const ksOk = !!hasKeystore;
  // Attestation only with keystore + address; never pass --validator alone.
  if (ksOk && (enableValidator || vAddr)) {
    args.push('--validator');
    if (vAddr) args.push('--validator-address', vAddr);
  }
  const reward = rewardAddress && String(rewardAddress).trim();
  if (mine && reward) {
    args.push('--mine', '--reward-address', reward);
  }
  return args;
}

/** Env the core reads when building the P2P Hello user-agent. */
function appVersionEnv(version) {
  const v = String(version || '').trim();
  if (!v) return {};
  return { GOGOGRAM_APP_VERSION: v };
}

/**
 * Env for a desktop full node or the in-app miner.
 * Never sets GOLDOGRAM_MINT_TEST_JWT, and strips it if the parent process had it.
 */
function coreLaunchEnv(base, extras) {
  const env = Object.assign({}, base || {}, extras || {});
  delete env.GOLDOGRAM_MINT_TEST_JWT;
  return env;
}

module.exports = { buildNodeArgs, appVersionEnv, coreLaunchEnv };
