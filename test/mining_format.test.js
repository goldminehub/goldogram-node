'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatHashrate,
  formatRelativeTime,
  formatGoGX,
  isMinerLogLine,
  miningStatusLabel,
} = require('../renderer/mining_format');

test('formatHashrate H/s kH/s MH/s', () => {
  assert.equal(formatHashrate(0), '0 H/s');
  assert.equal(formatHashrate(500), '500 H/s');
  assert.equal(formatHashrate(12300), '12.30 kH/s');
  assert.equal(formatHashrate(1.23e6), '1.23 MH/s');
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
  assert.equal(miningStatusLabel(true, { state: 'syncing' }), 'Syncing');
  assert.equal(formatGoGX(316800000), '316.8');
});
