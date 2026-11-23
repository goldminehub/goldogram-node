'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSeedText, readSeedList, CANONICAL_P2P_PORT } = require('../src/seeds');

test('canonical port and no duplicate machine', () => {
  assert.equal(CANONICAL_P2P_PORT, 18333);
  const got = parseSeedText('a.example\na.example:18333\nb.example:28334\n# c\n');
  assert.deepEqual(got, ['a.example:18333', 'b.example:28334']);
});

test('shipped config does not name one machine twice', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'config', 'seeds.txt'), 'utf8');
  assert.equal(text.includes('87.255.81.125'), false);
  assert.equal(text.includes(':8333'), false);
  assert.equal(text.includes('goldminequant.org'), false);
  const parsed = parseSeedText(text);
  const hosts = parsed.map((s) => s.slice(0, s.lastIndexOf(':')));
  assert.equal(new Set(hosts).size, hosts.length);
});

test('readSeedList reads SEED_FILE', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gog-seeds-'));
  const file = path.join(dir, 'seeds.txt');
  fs.writeFileSync(file, 'one.example:18333\ntwo.example\n');
  const list = readSeedList(dir, { SEED_FILE: file });
  assert.equal(list, 'one.example:18333,two.example:18333');
});
