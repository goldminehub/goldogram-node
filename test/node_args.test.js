'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNodeArgs, appVersionEnv } = require('../src/node_args');

test('mine-on-this-node argv is --fullnode then --mine (never miner-only)', () => {
  const args = buildNodeArgs({
    datadir: '/home/goldogram/.goldogram',
    mine: true,
    rewardAddress: 'Go8c5p5yTestRewardAddress000',
  });
  assert.deepEqual(args, [
    '--fullnode',
    '--datadir',
    '/home/goldogram/.goldogram',
    '--mine',
    '--reward-address',
    'Go8c5p5yTestRewardAddress000',
  ]);
  assert.equal(args[0], '--fullnode');
  assert.ok(!args.includes('node'));
  assert.ok(args.indexOf('--fullnode') < args.indexOf('--mine'));
});

test('without mine flag there is no --mine', () => {
  const args = buildNodeArgs({ datadir: 'C:\\Users\\x\\.goldogram' });
  assert.deepEqual(args, ['--fullnode', '--datadir', 'C:\\Users\\x\\.goldogram']);
});

test('mine without reward address does not add --mine', () => {
  const args = buildNodeArgs({ datadir: '/data', mine: true, rewardAddress: '  ' });
  assert.ok(!args.includes('--mine'));
});

test('address alone does not add --validator without keystore', () => {
  const args = buildNodeArgs({
    datadir: '/data',
    enableValidator: true,
    validatorAddress: 'GoValAddr',
    hasKeystore: false,
  });
  assert.ok(!args.includes('--validator'));
  assert.ok(!args.includes('--validator-address'));
});

test('keystore + address adds --validator without --stake', () => {
  const args = buildNodeArgs({
    datadir: '/data',
    enableValidator: true,
    validatorAddress: 'GoValAddr',
    hasKeystore: true,
  });
  assert.ok(args.includes('--validator'));
  assert.ok(args.includes('--validator-address'));
  assert.equal(args[args.indexOf('--validator-address') + 1], 'GoValAddr');
  assert.ok(!args.includes('--stake'));
});

test('app version env is the desktop version the Hello advertises', () => {
  assert.deepEqual(appVersionEnv('1.2.35'), { GOGOGRAM_APP_VERSION: '1.2.35' });
  assert.deepEqual(appVersionEnv('  '), {});
});
