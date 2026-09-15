'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCliJsonStdout } = require('../src/keystore_sign');

test('parseCliJsonStdout takes last { line and ignores log noise', () => {
  const noisy =
    '[BFT] Loaded 1 validator signing key(s) from keystore\n' +
    '{"tx_id":"abc","signature":"00"}\n';
  const j = parseCliJsonStdout(noisy);
  assert.equal(j.tx_id, 'abc');
});

test('parseCliJsonStdout accepts single-line JSON', () => {
  const j = parseCliJsonStdout('{"ok":true,"path":"/tmp/ks.json"}');
  assert.equal(j.ok, true);
});

test('parseCliJsonStdout throws when no JSON object', () => {
  assert.throws(() => parseCliJsonStdout('[BFT] Loaded 1\n'), /no JSON/);
});
