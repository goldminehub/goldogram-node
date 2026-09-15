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

module.exports = { buildNodeArgs };
