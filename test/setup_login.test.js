'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  setElValue,
  applySetupLoginSuccess,
  sessionFromLogin,
  shortGogAddress,
  readLoginSession,
  writeLoginSession,
  clearLoginSession,
  renderAccountHeader,
  SESSION_KEY,
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

test('dashboard header shows username, short address, and Reward address', () => {
  const session = sessionFromLogin(
    { wallet: { gog_address: 'Go1234567890abcdWXYZ' }, user: { username: 'executor' } },
    'executor',
  );
  assert.equal(shortGogAddress(session.address), 'Go1234…WXYZ');
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  assert.equal(writeLoginSession(storage, session), true);
  assert.deepEqual(readLoginSession(storage), session);
  const doc = makeDoc(['dash-account-user', 'dash-account-meta', 'dash-logout', 'dash-switch']);
  assert.equal(renderAccountHeader(doc, readLoginSession(storage)), true);
  assert.equal(doc._el('dash-account-user').textContent, 'executor');
  assert.equal(doc._el('dash-account-meta').textContent, 'Go1234…WXYZ · Reward address');
  assert.equal(doc._el('dash-switch').textContent, 'Switch account');
  clearLoginSession(storage);
  assert.equal(readLoginSession(storage), null);
  assert.equal(storage.getItem(SESSION_KEY), null);
  assert.equal(renderAccountHeader(doc, null), false);
  assert.equal(doc._el('dash-account-user').textContent, 'Not logged in');
  assert.equal(doc._el('dash-logout').style.display, 'none');
});
