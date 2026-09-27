'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pushHashSample,
  headline,
  sparklinePoints,
  todayTotals,
  tickerRows,
  HASH_CAP,
} = require('../renderer/dash_status');

test('headline names syncing, mining, idle, and isolated', () => {
  assert.equal(headline({ mode: 'syncing', progress: 87.2 }), 'Syncing 87 %');
  assert.equal(headline({ mode: 'mining', hashrateText: '71.30 kH/s' }), 'Mining · 71.30 kH/s');
  assert.equal(headline({ mode: 'idle', reason: 'Node stopped' }), 'Idle — Node stopped');
  assert.match(headline({ mode: 'isolated', reason: 'No live seed connection' }), /^Isolated — /);
});

test('hashrate ring keeps 10 minutes at 5 second samples', () => {
  let buf = [];
  const start = 1_700_000_000_000;
  for (let i = 0; i < 200; i++) {
    buf = pushHashSample(buf, 1000 + i, start + i * 5000);
  }
  assert.ok(buf.length <= HASH_CAP);
  assert.equal(buf.length, 120);
  assert.ok(buf[0].t >= buf[buf.length - 1].t - 10 * 60 * 1000);
  const points = sparklinePoints(buf, 320, 56).split(' ');
  assert.equal(points.length, 120);
});

test('today earnings and gold rows for this node', () => {
  const now = new Date(2026, 8, 28, 15, 0, 0).getTime();
  const start = new Date(2026, 8, 28).getTime() / 1000;
  const totals = todayTotals([
    { ts: start + 10, reward_micro: 1_500_000 },
    { ts: start - 50, reward_micro: 9_000_000 },
  ], now);
  assert.equal(totals.blocks, 1);
  assert.equal(totals.earnedMicro, 1_500_000);
  const rows = tickerRows(
    [
      { height: 10, hash: 'abcdef0123456789', timestamp: start, miner: 'GoMineRewardAddress1' },
      { height: 9, hash: '1111111122222222', timestamp: start - 12, miner: 'GoOtherPersonAddr' },
    ],
    'GoMineRewardAddress1',
    now,
    function (_ts, _now) { return '12s ago'; },
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ours, true);
  assert.equal(rows[0].short, 'abcdef01…');
  assert.equal(rows[1].ours, false);
  assert.equal(rows[0].ago, '12s ago');
});
