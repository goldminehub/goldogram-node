'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadPrefs, savePrefs, prefsPath, createAutoUpdateController } = require('../src/auto_update');

test('prefs default automatic ON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-upd-'));
  const p = loadPrefs(dir);
  assert.equal(p.automatic, true);
  assert.equal(p.lastCheckedAt, 0);
});

test('prefs round-trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-upd-'));
  savePrefs(dir, { automatic: false, lastCheckedAt: 123, lastVersion: '1.2.41' });
  const p = loadPrefs(dir);
  assert.equal(p.automatic, false);
  assert.equal(p.lastCheckedAt, 123);
  assert.equal(p.lastVersion, '1.2.41');
  assert.ok(fs.existsSync(prefsPath(dir)));
});

test('createAutoUpdateController is notify-only (DESK-01)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-upd-'));
  const events = {};
  const calls = { quit: null, prepare: 0, sent: [] };
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    on(ev, fn) { events[ev] = fn; },
    async checkForUpdates() {
      return { updateInfo: { version: '1.2.41' } };
    },
    quitAndInstall(silent, runAfter) {
      calls.quit = { silent, runAfter };
    },
  };
  const ctl = createAutoUpdateController({
    autoUpdater,
    userData: () => dir,
    log: () => {},
    send: (ch, payload) => calls.sent.push([ch, payload]),
    prepareForInstall: async () => { calls.prepare += 1; },
    getVersion: () => '1.2.40',
  });
  assert.equal(ctl.isAutomatic(), true);
  assert.equal(autoUpdater.autoDownload, false);
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);
  assert.equal(autoUpdater.allowDowngrade, false);
  events['update-available']({ version: '1.2.41' });
  events['update-downloaded']({ version: '1.2.41' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(calls.prepare, 0);
  assert.equal(calls.quit, null);
  assert.ok(calls.sent.some(([ch, p]) => ch === 'update-available' && p.notifyOnly === true));
  assert.ok(calls.sent.some(([ch, p]) => ch === 'update-downloaded' && p.notifyOnly === true));
});
