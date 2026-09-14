'use strict';

/**
 * Exact argv passed to goldogram-core for the desktop full node.
 * Always --fullnode first (no dummy `node` subcommand). --mine is only
 * added together with --reward-address so the child cannot be Miner-without-sled.
 * `--validator` enables the attestation loop when a keystore + address exist.
 */
function buildNodeArgs({
  datadir,
  validatorAddress,
  validatorStake,
  mine,
  rewardAddress,
  enableValidator,
} = {}) {
  const args = ['--fullnode'];
  if (datadir) args.push('--datadir', String(datadir));
  const vAddr = validatorAddress && String(validatorAddress).trim();
  if (enableValidator || vAddr) {
    args.push('--validator');
  }
  if (vAddr) {
    args.push('--validator-address', vAddr);
    const stake = parseInt(validatorStake, 10);
    if (Number.isFinite(stake) && stake > 0) args.push('--stake', String(stake));
  }
  const reward = rewardAddress && String(rewardAddress).trim();
  if (mine && reward) {
    args.push('--mine', '--reward-address', reward);
  }
  return args;
}

module.exports = { buildNodeArgs };
