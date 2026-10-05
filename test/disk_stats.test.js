'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  collectDiskStats,
  wipeBlocksDir,
  formatBytes,
  defaultDatadir,
} = require('../src/disk_stats');

test('formatBytes', () => {
  assert.equal(formatBytes(500), '500 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.ok(formatBytes(5 * 1024 * 1024).includes('MB'));
});

test('defaultDatadir expands home', () => {
  const d = defaultDatadir('');
  assert.ok(d.includes('.goldogram'));
});

test('collectDiskStats + wipeBlocksDir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-disk-'));
  const blocks = path.join(root, 'blocks');
  fs.mkdirSync(blocks, { recursive: true });
  fs.writeFileSync(path.join(blocks, 'a'), 'hello-world-data');
  fs.writeFileSync(path.join(root, 'keystore.json'), '{}');
  const stats = collectDiskStats(root);
  assert.equal(stats.dbExists, true);
  assert.ok(stats.dbBytes >= 15);
  const wipe = wipeBlocksDir(root);
  assert.equal(wipe.wiped, true);
  assert.ok(!fs.existsSync(blocks));
  assert.ok(fs.existsSync(path.join(root, 'keystore.json')));
});
