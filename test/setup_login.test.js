'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  setElValue,
  applySetupLoginSuccess,
} = require('../renderer/setup_login');

function makeDoc(idsWithValue) {
  const map = new Map();
  for (const id of idsWithValue) {
    map.set(id, { value: '', textContent: '', style: { display: '' } });
  }
  return {
    getElementById(id) {
      return map.get(id) || null;
    },
    _el(id) {
      return map.get(id);
    },
  };
}

test('setElValue does not throw when element is missing', () => {
  const doc = makeDoc([]);
  assert.equal(setElValue(doc, 'validator-token', 'tok'), false);
  assert.equal(setElValue(null, 'x', 'y'), false);
});

test('login success closes overlay and shows dashboard hint (no welcome step)', () => {
  const doc = makeDoc([
    'setup-username-display',
    'setup-address-display',
    'setup-step-login',
    'setup-step-welcome',
    'setup-overlay',
    'dash-validator-hint',
    'v1-jwt',
    'v1-address',
    'miner-address',
    'cfg-validator',
  ]);
  const out = applySetupLoginSuccess(
    doc,
    {
      token: 'jwt-abc',
      wallet: { gog_address: 'GoExecutorAddr' },
      user: { username: 'executor' },
    },
    'executor',
  );
  assert.equal(out.token, 'jwt-abc');
  assert.equal(out.address, 'GoExecutorAddr');
  assert.equal(out.goDashboard, true);
  assert.equal(doc._el('v1-jwt').value, 'jwt-abc');
  assert.equal(doc._el('miner-address').value, 'GoExecutorAddr');
  assert.equal(doc._el('setup-step-login').style.display, 'none');
  assert.equal(doc._el('setup-step-welcome').style.display, 'none');
  assert.equal(doc._el('setup-overlay').style.display, 'none');
  assert.equal(doc._el('dash-validator-hint').style.display, 'block');
  assert.match(
    doc._el('dash-validator-hint').textContent,
    /Validator tab \(min 1,000 GoGX\)/,
  );
});

test('login success keepOverlay leaves overlay visible for keystore step', () => {
  const doc = makeDoc([
    'setup-step-login',
    'setup-overlay',
    'dash-validator-hint',
    'v1-jwt',
  ]);
  const out = applySetupLoginSuccess(
    doc,
    { token: 't', wallet: { gog_address: 'GoX' }, user: { username: 'u' } },
    'u',
    { keepOverlay: true },
  );
  assert.equal(out.keepOverlay, true);
  assert.equal(out.goDashboard, false);
  assert.equal(doc._el('setup-overlay').style.display, '');
  assert.equal(doc._el('setup-step-login').style.display, 'none');
});
