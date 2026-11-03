'use strict';

/**
 * Inspect the Windows asar, then run the packaged app with --smoke for 20s.
 * Exit 0 only when the asar preload is electron-only AND the packaged process
 * prints PACKAGED_SMOKE OK. Release must not publish if this fails.
 *
 * Run: node scripts/packaged_smoke.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WIN_ASAR = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar');
const MAC_BIN = path.join(
  ROOT,
  'dist',
  'mac-arm64',
  'Goldogram Node.app',
  'Contents',
  'MacOS',
  'Goldogram Node',
);
const WIN_EXE = path.join(ROOT, 'dist', 'win-unpacked', 'Goldogram Node.exe');

function fail(msg) {
  console.error('PACKAGED_SMOKE FAIL:', msg);
  process.exit(1);
}

function inspectAsar(asarPath, label) {
  if (!fs.existsSync(asarPath)) fail('missing ' + label + ' asar: ' + asarPath);
  const dest = path.join(os.tmpdir(), 'goldogram-asar-smoke-' + process.pid + '-' + label);
  fs.rmSync(dest, { recursive: true, force: true });
  const extracted = spawnSync('npx', ['--yes', 'asar', 'extract', asarPath, dest], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  if (extracted.status !== 0) {
    fail('asar extract failed for ' + label + ': ' + (extracted.stderr || extracted.stdout));
  }
  const preload = fs.readFileSync(path.join(dest, 'src', 'preload.js'), 'utf8');
  const requires = [...preload.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  console.log('[packaged-smoke] ' + label + ' preload requires:', JSON.stringify(requires));
  if (requires.length !== 1 || requires[0] !== 'electron') {
    fail(label + ' packaged preload must only require("electron"), got ' + JSON.stringify(requires));
  }
  if (/gog_address/.test(preload)) {
    fail(label + ' packaged preload still loads gog_address — sandboxed require will abort the bridge');
  }
  const gog = path.join(dest, 'src', 'gog_address.js');
  if (!fs.existsSync(gog)) fail(label + ' asar missing src/gog_address.js (main process)');
  const html = fs.readFileSync(path.join(dest, 'renderer', 'index.html'), 'utf8');
  if (!/function requirePreloadBridges\(/.test(html)) {
    fail(label + ' renderer missing requirePreloadBridges guard');
  }
  if (!/exposeInMainWorld\('miner'/.test(preload)) {
    fail(label + ' preload does not expose miner');
  }
  console.log('[packaged-smoke] ' + label + ' asar preload ok (electron-only, miner+node+gogAddress via IPC)');
  fs.rmSync(dest, { recursive: true, force: true });
}

function packagedBinary() {
  if (process.platform === 'darwin') {
    if (!fs.existsSync(MAC_BIN)) fail('missing mac packaged binary: ' + MAC_BIN);
    return MAC_BIN;
  }
  if (process.platform === 'win32') {
    if (!fs.existsSync(WIN_EXE)) fail('missing win packaged binary: ' + WIN_EXE);
    return WIN_EXE;
  }
  fail('packaged smoke runs on darwin or win32, got ' + process.platform);
}

function runPackagedApp(bin) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['--smoke'], {
      env: { ...process.env, GOLDOGRAM_SMOKE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (buf) => {
      const text = buf.toString();
      out += text;
      process.stdout.write(text);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('packaged app timed out after 50s\n' + out));
    }, 50000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

async function main() {
  inspectAsar(WIN_ASAR, 'windows');
  const macAsar = path.join(
    ROOT,
    'dist',
    'mac-arm64',
    'Goldogram Node.app',
    'Contents',
    'Resources',
    'app.asar',
  );
  if (fs.existsSync(macAsar)) inspectAsar(macAsar, 'mac-arm64');

  const bin = packagedBinary();
  console.log('[packaged-smoke] launching', bin, '--smoke (20s renderer)');
  const { code, out } = await runPackagedApp(bin);
  if (!/PACKAGED_SMOKE OK/.test(out)) {
    fail('packaged app did not print PACKAGED_SMOKE OK (exit ' + code + ')');
  }
  if (/PACKAGED_SMOKE FAIL/.test(out)) {
    fail('packaged app printed PACKAGED_SMOKE FAIL');
  }
  if (code !== 0) fail('packaged app exit ' + code);
  console.log('PACKAGED_SMOKE WRAPPER OK');
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
