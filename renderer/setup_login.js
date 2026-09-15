'use strict';

/**
 * Safe DOM helpers for the desktop renderer login / validator wiring.
 * Missing elements (renamed or tab-only) must never throw.
 *
 * UMD: works in Electron renderer (script tag) and in Node tests (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.GoldogramSetupLogin = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function setElValue(doc, id, value) {
    const el = doc && doc.getElementById ? doc.getElementById(id) : null;
    if (!el) return false;
    try {
      el.value = value == null ? '' : String(value);
      return true;
    } catch {
      return false;
    }
  }

  function setElText(doc, id, text) {
    const el = doc && doc.getElementById ? doc.getElementById(id) : null;
    if (!el) return false;
    el.textContent = text == null ? '' : String(text);
    return true;
  }

  function setElDisplay(doc, id, display) {
    const el = doc && doc.getElementById ? doc.getElementById(id) : null;
    if (!el || !el.style) return false;
    el.style.display = display;
    return true;
  }

  /**
   * Apply a successful /api/auth/login payload: wire wallet fields, hide setup
   * overlay, show dashboard. Never throws on missing DOM ids.
   * Legacy "Become Validator" welcome step is skipped.
   */
  function applySetupLoginSuccess(doc, data, username) {
    const token = data && data.token ? String(data.token) : '';
    const address =
      data && data.wallet && data.wallet.gog_address
        ? String(data.wallet.gog_address)
        : '';
    const displayName =
      data && data.user && data.user.username
        ? String(data.user.username)
        : String(username || '');

    setElValue(doc, 'v1-jwt', token);
    // Legacy ids from older layouts — optional (were the v1.2.17 crash).
    setElValue(doc, 'validator-token', token);
    setElValue(doc, 'validator-address', address);
    setElValue(doc, 'login-username', username || displayName);
    setElValue(doc, 'v1-address', address);
    setElValue(doc, 'cfg-validator', address);
    setElValue(doc, 'miner-address', address);

    setElText(doc, 'setup-username-display', displayName);
    setElText(doc, 'setup-address-display', address);
    setElDisplay(doc, 'setup-step-login', 'none');
    setElDisplay(doc, 'setup-step-welcome', 'none');
    setElDisplay(doc, 'setup-overlay', 'none');
    setElDisplay(doc, 'dash-validator-hint', 'block');
    setElText(
      doc,
      'dash-validator-hint',
      'To become a validator, open the Validator tab (min 1,000 GoGX).',
    );

    return { token, address, username: displayName, goDashboard: true };
  }

  return {
    setElValue,
    setElText,
    setElDisplay,
    applySetupLoginSuccess,
  };
});
