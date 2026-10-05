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

test('createAutoUpdateController wires silent install', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-upd-'));
  const events = {};
  const calls = { quit: null, prepare: 0, sent: [] };
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
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
  events['update-downloaded']({ version: '1.2.41' });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(calls.prepare, 1);
  assert.deepEqual(calls.quit, { silent: true, runAfter: true });
});
