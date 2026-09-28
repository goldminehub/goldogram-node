'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatHashrate,
  formatNetworkHashrate,
  networkHashrateHs,
  dashboardVisualState,
  formatRelativeTime,
  formatGoGX,
  isMinerLogLine,
  miningStatusLabel,
} = require('../renderer/mining_format');

test('formatHashrate H/s kH/s MH/s GH/s', () => {
  assert.equal(formatHashrate(0), '0 H/s');
  assert.equal(formatHashrate(500), '500 H/s');
  assert.equal(formatHashrate(12300), '12.30 kH/s');
  assert.equal(formatHashrate(1.23e6), '1.23 MH/s');
  assert.equal(formatHashrate(2.5e9), '2.50 GH/s');
});

test('network hashrate from last 120 blocks is MH/s, never n/a', () => {
  const samples = [];
  for (let i = 0; i < 120; i++) {
    samples.push({ difficulty: 24, timestamp: 1_000_000 + i * 10 });
  }
  const hs = networkHashrateHs(samples);
  assert.ok(hs > 1.6e6 && hs < 1.7e6);
  assert.equal(formatNetworkHashrate(hs), '1.68 MH/s');
  assert.equal(formatNetworkHashrate(0), '0.00 MH/s');
  assert.equal(formatNetworkHashrate(1.07e9), '1.07 GH/s');
  assert.equal(networkHashrateHs([{ difficulty: 24, timestamp: 1 }]), null);
});

test('dashboard visual follows sync, mine, and a stopped process', () => {
  assert.equal(dashboardVisualState({ childRunning: false }).mode, 'stopped');
  const sync = dashboardVisualState({
    childRunning: true,
    syncState: 'syncing',
    height: 50,
    networkHeight: 200,
    mining: { state: 'syncing' },
  });
  assert.equal(sync.mode, 'syncing');
  assert.equal(sync.progress, 25);
  const mining = dashboardVisualState({
    childRunning: true,
    syncState: 'synced',
    mining: { state: 'mining', active: true, hashrate: 2e6 },
  });
  assert.equal(mining.mode, 'synced-mining');
  assert.equal(mining.hashrateText, '2.00 MH/s');
  const off = dashboardVisualState({
    childRunning: true,
    syncState: 'synced',
    mining: { state: 'idle', active: false },
  });
  assert.equal(off.mode, 'synced-off');
});

test('formatRelativeTime', () => {
  const now = 1_700_000_032_000;
  const nowSec = now / 1000;
  assert.equal(formatRelativeTime(0, now), '—');
  assert.equal(formatRelativeTime(nowSec - 32, now), '32s ago');
  assert.equal(formatRelativeTime(nowSec - 17 * 60, now), '17m ago');
  assert.equal(formatRelativeTime(nowSec - 3600, now), '1h ago');
});

test('miner log filter and status', () => {
  assert.ok(isMinerLogLine('[Miner] Block #1 mined hash=aa reward=316.8 GoGX'));
  assert.ok(isMinerLogLine('[Reorg] fork@1 depth=2'));
  assert.ok(isMinerLogLine('[Sovereign] x'));
  assert.equal(isMinerLogLine('[P2P] peer connected'), false);
  assert.equal(miningStatusLabel(false, { state: 'mining', active: true }), 'Stopped');
  assert.equal(miningStatusLabel(true, { state: 'mining', active: true }), 'Mining');
  assert.equal(miningStatusLabel(true, { state: 'paused' }), 'Paused');
  assert.equal(miningStatusLabel(true, { state: 'isolated' }), 'Isolated — not mining');
  assert.equal(miningStatusLabel(true, { state: 'syncing' }), 'Syncing');
  assert.equal(formatGoGX(316800000), '316.8');
});
