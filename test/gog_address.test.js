'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractGogAddress,
  gogAddressPayload,
  validateGogAddress,
  INVALID_GOGX_ADDRESS,
} = require('../src/gog_address');

// Same vectors as goldogram-web/test/gogAddress.test.mjs and
// goldogram-protocol/src/crypto/address.rs::truncated_gog_address_fails_checksum.
const TRUNCATED = 'GoDTSy9XUGYu2v2ggUdt4y8RKN6kmSz26kjNWnU4qnYRN';
const FULL = 'GoDTSy9XUGYu2v2ggUdt4y8RKN6kmSz26kjNWnU4qnYRNT';

test('truncated address decodes but fails the checksum', () => {
  assert.equal(TRUNCATED.length, 45);
  assert.ok(gogAddressPayload(TRUNCATED), 'length alone must not reject a 32-byte decode');
  assert.equal(validateGogAddress(TRUNCATED), INVALID_GOGX_ADDRESS);
});

test('the full address and a fresh truncation are judged correctly', () => {
  assert.equal(validateGogAddress(FULL), null);
  assert.equal(validateGogAddress(FULL.slice(0, -1)), INVALID_GOGX_ADDRESS);
  assert.equal(validateGogAddress('Bx' + FULL.slice(2)), INVALID_GOGX_ADDRESS);
  assert.equal(validateGogAddress(FULL.slice(0, 2) + '0' + FULL.slice(3)), INVALID_GOGX_ADDRESS);
  assert.equal(validateGogAddress(''), INVALID_GOGX_ADDRESS);
  assert.equal(validateGogAddress('not-an-address'), INVALID_GOGX_ADDRESS);
});

test('QR and paste extraction refuses the truncated address', () => {
  assert.equal(extractGogAddress('pay ' + TRUNCATED + ' thanks'), null);
  assert.equal(extractGogAddress('https://goldminequant.org/pay/' + FULL), FULL);
  assert.equal(extractGogAddress(FULL), FULL);
  assert.equal(extractGogAddress('  ' + FULL + '  '), FULL);
});
