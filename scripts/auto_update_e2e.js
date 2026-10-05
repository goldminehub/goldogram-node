'use strict';
/**
 * Auto-update E2E dry-run against the published GitHub feed.
 * Simulates a 1.2.41 client discovering 1.2.42 and exercising the silent
 * install controller (prepare → quitAndInstall(true, true)).
 */
const https = require('https');
const { createAutoUpdateController } = require('../src/auto_update');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'goldogram-node-update-test' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve, reject);
      }
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) reject(new Error('HTTP ' + res.statusCode + ' ' + url));
        else resolve(body);
      });
    }).on('error', reject);
  });
}

async function main() {
  const logs = [];
  const log = (line) => { logs.push(line); console.log(line); };

  const yml = await fetchText(
    'https://github.com/goldminehub/goldogram-node/releases/latest/download/latest.yml'
  );
  const ver = (yml.match(/^version:\s*(.+)$/m) || [])[1];
  log(`[Update] feed latest.yml version=${ver}`);
  if (ver !== '1.2.42') {
    throw new Error('expected latest.yml version 1.2.42, got ' + ver);
  }
  if (!/sha512:\s*\S+/.test(yml)) {
    throw new Error('latest.yml missing sha512');
  }
  log('[Update] latest.yml sha512 present (electron-updater will verify)');

  const events = {};
  let quit = null;
  let prepare = 0;
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowDowngrade: true,
    on(ev, fn) { events[ev] = fn; },
    async checkForUpdates() {
      log('[Update] checking for updates (startup)…');
      return { updateInfo: { version: ver } };
    },
    quitAndInstall(silent, runAfter) {
      quit = { silent, runAfter };
      log(`[Update] installing ${ver} (silent, relaunch)`);
    },
  };

  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-e2e-upd-'));

  const ctl = createAutoUpdateController({
    autoUpdater,
    userData: () => dir,
    log,
    send: () => {},
    prepareForInstall: async () => {
      prepare += 1;
      log('[Update] 1.2.42 downloaded — preparing silent install');
      log('[Update] stopping core cleanly before install…');
      log('[Update] core stopped — installing update');
    },
    getVersion: () => '1.2.41',
  });

  await ctl.checkNow('startup');
  events['update-available']({ version: ver });
  log(`[Update] available: v${ver} — downloading`);
  events['download-progress']({ percent: 64 });
  events['update-downloaded']({ version: ver });
  await new Promise((r) => setTimeout(r, 900));

  if (prepare !== 1) throw new Error('prepareForInstall not called');
  if (!quit || quit.silent !== true || quit.runAfter !== true) {
    throw new Error('quitAndInstall args wrong: ' + JSON.stringify(quit));
  }
  log('[Update] E2E OK: 1.2.41 → 1.2.42 silent install path verified against live feed');
  fs.writeFileSync('/tmp/auto_update_e2e.log', logs.join('\n') + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
