'use strict';

/**
 * Electron smoke: Login + password eye on the real renderer HTML (packaged path
 * equivalent). Exit 0 on success. No network — fetch is mocked.
 *
 * Run: npx electron scripts/login_smoke.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const RENDERER = path.join(__dirname, '../renderer/index.html');

function fail(msg) {
  console.error('LOGIN_SMOKE FAIL:', msg);
  app.exit(1);
}

app.whenReady().then(async () => {
  // Minimal IPC so preload invokeLogged does not hang.
  const handlers = [
    'start-node', 'stop-node', 'get-status', 'get-sysinfo', 'get-app-version',
    'get-disk-stats', 'resync-from-checkpoint', 'keystore-list', 'keystore-ensure',
    'keystore-unlock', 'keystore-lock', 'sign-validator-tx', 'check-update',
    'install-update', 'get-update-status', 'set-auto-update', 'start-miner', 'stop-miner',
  ];
  for (const h of handlers) {
    ipcMain.handle(h, async () => {
      if (h === 'keystore-list') return { addresses: [], exists: false, path: '' };
      if (h === 'get-app-version') return '1.2.42-smoke';
      if (h === 'get-sysinfo') {
        return { platform: process.platform, arch: process.arch, cpus: 1, totalMem: 1, freeMem: 1, appVersion: '1.2.42-smoke' };
      }
      if (h === 'get-disk-stats') {
        return { ok: true, dbText: '0 B', freeText: '1 GB', dbBytes: 0, freeBytes: 1e9 };
      }
      if (h === 'get-update-status') return { automatic: true, lastCheckedAt: 0, currentVersion: '1.2.42-smoke' };
      return { ok: true };
    });
  }
  ipcMain.on('renderer-ipc-reject', () => {});
  ipcMain.on('renderer-error', () => {});

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../src/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const consoleErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });

  await win.loadFile(RENDERER);
  await new Promise((r) => setTimeout(r, 400));

  // 1) Syntax / handler presence
  const presence = await win.webContents.executeJavaScript(`({
    setupLogin: typeof setupLogin,
    wirePasswordEyes: typeof wirePasswordEyes,
    eyeButtons: document.querySelectorAll('.pw-eye').length,
    overlay: !!document.getElementById('setup-overlay'),
    fatal: !!document.getElementById('fatal-error-overlay'),
  })`);
  console.log('presence', presence);
  if (presence.setupLogin !== 'function') return fail('setupLogin not defined — script parse failed?');
  if (presence.eyeButtons < 1) return fail('no eye buttons');

  // 2) Eye toggle keeps value
  const eye = await win.webContents.executeJavaScript(`
    (function () {
      const input = document.getElementById('setup-password');
      const btn = document.querySelector('.pw-eye[data-target="setup-password"]');
      input.value = 'SecretPass1';
      const beforeType = input.type;
      btn.click();
      const mid = { type: input.type, value: input.value, label: btn.textContent };
      btn.click();
      const after = { type: input.type, value: input.value, label: btn.textContent };
      return { beforeType, mid, after, btnType: btn.getAttribute('type') };
    })()
  `);
  console.log('eye', eye);
  if (eye.btnType !== 'button') return fail('eye button type is not button');
  if (eye.mid.type !== 'text' || eye.mid.value !== 'SecretPass1') return fail('eye show failed');
  if (eye.after.type !== 'password' || eye.after.value !== 'SecretPass1') return fail('eye hide failed');

  // 3) Wrong password → visible error
  const wrong = await win.webContents.executeJavaScript(`
    (async function () {
      window.fetch = async function () {
        return { ok: false, status: 401, json: async () => ({ error: 'Invalid credentials' }) };
      };
      document.getElementById('setup-username').value = 'nobody';
      document.getElementById('setup-password').value = 'wrong';
      await setupLogin();
      return document.getElementById('setup-msg').textContent;
    })()
  `);
  console.log('wrong-password msg:', wrong);
  if (!/Invalid credentials|Login failed/i.test(String(wrong))) {
    return fail('wrong password did not show error: ' + wrong);
  }

  // 4) Successful login → keystore step (dashboard path)
  const ok = await win.webContents.executeJavaScript(`
    (async function () {
      window.openKeystoreModal = async function () {
        const ks = document.getElementById('setup-step-keystore');
        const login = document.getElementById('setup-step-login');
        if (login) login.style.display = 'none';
        if (ks) ks.style.display = 'block';
        return { skipped: true };
      };
      window.fetch = async function () {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            token: 'smoke-token',
            user: { username: 'smoke' },
            wallet: { gog_address: 'GoSmokeAddress0001' },
          }),
        };
      };
      document.getElementById('setup-username').value = 'smoke';
      document.getElementById('setup-password').value = 'ok-password';
      await setupLogin();
      return {
        msg: document.getElementById('setup-msg').textContent,
        loginStep: document.getElementById('setup-step-login').style.display,
        ksStep: document.getElementById('setup-step-keystore').style.display,
        overlay: document.getElementById('setup-overlay').style.display,
        fatalDisplay: document.getElementById('fatal-error-overlay').style.display,
      };
    })()
  `);
  console.log('login-ok', ok);
  const fatalText = await win.webContents.executeJavaScript(
    `(document.getElementById('fatal-error-text') || {}).textContent || ''`
  );
  console.log('fatal-text:', fatalText);
  // Ignore GPU/ozone noise; fail only on real renderer/script failures.
  const fatalBad = /SyntaxError|setupLogin|ReferenceError|TypeError|is not defined/i.test(fatalText);
  if (fatalBad) return fail('fatal overlay: ' + fatalText);
  if (!/keystore|logged in/i.test(String(ok.msg)) && ok.ksStep === 'none') {
    return fail('expected keystore step after login: ' + JSON.stringify(ok));
  }

  if (consoleErrors.some((m) => /SyntaxError/i.test(m))) {
    return fail('SyntaxError in console: ' + consoleErrors.join(' | '));
  }

  console.log('LOGIN_SMOKE OK');
  app.exit(0);
}).catch((e) => {
  console.error(e);
  app.exit(1);
});
