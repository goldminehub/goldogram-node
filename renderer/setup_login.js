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
   * Apply a successful /api/auth/login payload: wire wallet fields.
   * By default hides the setup overlay. Pass { keepOverlay: true } to stay on
   * the overlay for the keystore step (Electron has no window.prompt).
   * Legacy "Become Validator" welcome step is skipped.
   */
  function applySetupLoginSuccess(doc, data, username, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    const keepOverlay = !!options.keepOverlay;
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
    if (!keepOverlay) {
      setElDisplay(doc, 'setup-overlay', 'none');
    }
    setElDisplay(doc, 'dash-validator-hint', 'block');
    setElText(
      doc,
      'dash-validator-hint',
      'To become a validator, open the Validator tab (min 1,000 GoGX).',
    );

    return { token, address, username: displayName, goDashboard: !keepOverlay, keepOverlay };
  }

  const SESSION_KEY = 'goldogram_login_session';

  function sessionFromLogin(data, username) {
    const address =
      data && data.wallet && data.wallet.gog_address
        ? String(data.wallet.gog_address).trim()
        : '';
    const name =
      data && data.user && data.user.username
        ? String(data.user.username).trim()
        : String(username || '').trim();
    if (!name && !address) return null;
    return { username: name, address };
  }

  function shortGogAddress(address) {
    const a = String(address || '').trim();
    if (!a) return '';
    if (a.length <= 14) return a;
    return a.slice(0, 6) + '…' + a.slice(-4);
  }

  function readLoginSession(storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      const raw = storage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const username = parsed && parsed.username ? String(parsed.username).trim() : '';
      const address = parsed && parsed.address ? String(parsed.address).trim() : '';
      if (!username && !address) return null;
      return { username, address };
    } catch {
      return null;
    }
  }

  function writeLoginSession(storage, session) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    if (!session || (!session.username && !session.address)) {
      try { storage.removeItem(SESSION_KEY); } catch { /* ignore */ }
      return false;
    }
    try {
      storage.setItem(SESSION_KEY, JSON.stringify({
        username: String(session.username || ''),
        address: String(session.address || ''),
      }));
      return true;
    } catch {
      return false;
    }
  }

  function clearLoginSession(storage) {
    if (!storage || typeof storage.removeItem !== 'function') return;
    try { storage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  /** Username, short GoGX address, and the Reward address label. */
  function renderAccountHeader(doc, session) {
    const userEl = doc && doc.getElementById ? doc.getElementById('dash-account-user') : null;
    const metaEl = doc && doc.getElementById ? doc.getElementById('dash-account-meta') : null;
    const logout = doc && doc.getElementById ? doc.getElementById('dash-logout') : null;
    const sw = doc && doc.getElementById ? doc.getElementById('dash-switch') : null;
    const loggedIn = !!(session && (session.username || session.address));
    if (userEl) userEl.textContent = loggedIn ? (session.username || 'Account') : 'Not logged in';
    if (metaEl) {
      if (loggedIn && session.address) {
        metaEl.textContent = shortGogAddress(session.address) + ' · Reward address';
      } else {
        metaEl.textContent = '';
      }
    }
    if (logout && logout.style) logout.style.display = loggedIn ? '' : 'none';
    if (sw) sw.textContent = loggedIn ? 'Switch account' : 'Log in';
    return loggedIn;
  }

  return {
    setElValue,
    setElText,
    setElDisplay,
    applySetupLoginSuccess,
    SESSION_KEY,
    sessionFromLogin,
    shortGogAddress,
    readLoginSession,
    writeLoginSession,
    clearLoginSession,
    renderAccountHeader,
  };
});
