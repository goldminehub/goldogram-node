'use strict';

/**
 * GoGX address checks. Same rules as goldogram-web/lib/gogAddress.mjs and
 * goldogram-protocol/src/crypto/address.rs:
 *   prefix Go|go, Bitcoin Base58, 32-byte payload, checksum =
 *   Blake3(Blake3(payload[0..28]))[0..4].
 *
 * Main-process / Node tests use @noble/hashes blake3 (same digest as blake3-wasm
 * and the Rust blake3 crate). Exposed to the renderer through preload — the
 * renderer never sees a password or seed.
 */

const { blake3 } = require('@noble/hashes/blake3');

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INVALID_GOGX_ADDRESS = 'This is not a valid GoGX address.';
const CANDIDATE = /Go[1-9A-HJ-NP-Za-km-z]{20,90}|go[1-9A-HJ-NP-Za-km-z]{20,90}/g;

function decodeBase58(input) {
  if (input.length === 0) return new Uint8Array();
  const bytes = [0];
  for (let i = 0; i < input.length; i++) {
    const value = ALPHABET.indexOf(input[i]);
    if (value < 0) return null;
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leading = 0;
  while (leading < input.length && input[leading] === '1') leading++;
  let high = bytes.length;
  while (high > 0 && bytes[high - 1] === 0) high--;
  const out = new Uint8Array(leading + high);
  for (let i = 0; i < high; i++) out[leading + i] = bytes[high - 1 - i];
  return out;
}

function blake3Hash(data) {
  return blake3(data);
}

/** 32-byte payload, or null when prefix, charset, or decoded length is wrong. */
function gogAddressPayload(addr) {
  const t = String(addr == null ? '' : addr).trim();
  let body = '';
  if (t.startsWith('Go')) body = t.slice(2);
  else if (t.startsWith('go')) body = t.slice(2);
  else return null;
  if (!body) return null;
  const decoded = decodeBase58(body);
  if (!decoded || decoded.length !== 32) return null;
  return decoded;
}

/**
 * Null when the address is valid. Otherwise the rejection sentence.
 * Never accepts without a successful blake3 checksum.
 */
function validateGogAddress(addr) {
  const payload = gogAddressPayload(addr);
  if (!payload) return INVALID_GOGX_ADDRESS;
  const first = blake3Hash(payload.subarray(0, 28));
  const second = blake3Hash(first);
  for (let i = 0; i < 4; i++) {
    if (second[i] !== payload[28 + i]) return INVALID_GOGX_ADDRESS;
  }
  return null;
}

/** Pull a checksum-valid GoGX address out of a paste or QR payload. */
function extractGogAddress(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return null;
  if (!validateGogAddress(text)) return text.trim();
  const found = text.match(CANDIDATE) || [];
  for (let i = 0; i < found.length; i++) {
    if (!validateGogAddress(found[i])) return found[i];
  }
  return null;
}

module.exports = {
  INVALID_GOGX_ADDRESS,
  gogAddressPayload,
  validateGogAddress,
  extractGogAddress,
};
