'use strict';

/**
 * Inspect the Windows (and mac, if present) asar, then run --smoke for 30s
 * while cycling every sidebar view with status polling. Exit 0 only when the
 * asar preload is electron-only AND the process prints PACKAGED_SMOKE OK with
 * zero unhandled rejections. Release must not publish if this fails.
 *
 * Run: node scripts/packaged_smoke.js
 * On Linux the packaged .exe/.app cannot launch; after asar inspect we run
 * `electron . --smoke` against this tree (same renderer that was packed).
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
  if (!/if \(!banner \|\| !bar \|\| !text\) return/.test(html)) {
    fail(label + ' showMinerSyncBanner must return if banner/bar/text are missing');
  }
  if (!/async function fetchStatusTick\(/.test(html)) {
    fail(label + ' fetchStatus must swallow UI misses via fetchStatusTick try/catch');
  }
  if (/getElementById\('mining-sync-banner'\)[\s\S]{0,500}banner\.innerHTML\s*=/.test(html)) {
    fail(label + ' mining-sync-banner innerHTML overwrite would destroy #mining-sync-bar');
  }
  if (!/exposeInMainWorld\('miner'/.test(preload)) {
    fail(label + ' preload does not expose miner');
  }
  const main = fs.readFileSync(path.join(dest, 'src', 'main.js'), 'utf8');
  if (!/30000/.test(main) || !/unhandledrejection/.test(main)) {
    fail(label + ' packaged smoke must run 30s and assert zero unhandled rejections');
  }
  if (!/coreLaunchEnv/.test(main)) {
    fail(label + ' packaged main must launch the core through coreLaunchEnv');
  }
  const args = fs.readFileSync(path.join(dest, 'src', 'node_args.js'), 'utf8');
  if (!/env\.GOLDOGRAM_MINT_TEST_JWT = '0'/.test(args)) {
    fail(label + ' packaged node_args must set GOLDOGRAM_MINT_TEST_JWT=0');
  }
  console.log('[packaged-smoke] ' + label + ' asar ok (electron-only preload, banner null-safe, 30s view cycle)');
  fs.rmSync(dest, { recursive: true, force: true });
}

function mintPortCount() {
  const r = spawnSync('ss', ['-ltn'], { encoding: 'utf8' });
  const blob = (r.stdout || '') + '\n' + (r.stderr || '');
  return (blob.match(/:8099\b/g) || []).length;
}

function launchSpec() {
  if (process.platform === 'darwin') {
    if (!fs.existsSync(MAC_BIN)) fail('missing mac packaged binary: ' + MAC_BIN);
    return { bin: MAC_BIN, args: ['--smoke'], cwd: ROOT };
  }
  if (process.platform === 'win32') {
    if (!fs.existsSync(WIN_EXE)) fail('missing win packaged binary: ' + WIN_EXE);
    return { bin: WIN_EXE, args: ['--smoke'], cwd: ROOT };
  }
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron');
  if (!fs.existsSync(electron)) fail('missing electron binary for linux smoke: ' + electron);
  return { bin: electron, args: ['.', '--smoke'], cwd: ROOT };
}

function runPackagedApp(spec) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.bin, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, GOLDOGRAM_SMOKE: '1', DISPLAY: process.env.DISPLAY || ':99' },
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
      reject(new Error('packaged app timed out after 90s\n' + out));
    }, 90000);
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
  if (fs.existsSync(WIN_ASAR)) inspectAsar(WIN_ASAR, 'windows');
  else console.log('[packaged-smoke] windows asar not built yet — skipping asar inspect');
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

  const mintBefore = mintPortCount();
  const spec = launchSpec();
  console.log('[packaged-smoke] launching', spec.bin, spec.args.join(' '), '(30s view cycle)');
  const { code, out } = await runPackagedApp(spec);
  if (!/PACKAGED_SMOKE OK/.test(out)) {
    fail('packaged app did not print PACKAGED_SMOKE OK (exit ' + code + ')');
  }
  if (/PACKAGED_SMOKE FAIL/.test(out)) {
    fail('packaged app printed PACKAGED_SMOKE FAIL');
  }
  if (/unhandledrejection/i.test(out) && /PACKAGED_SMOKE FAIL/.test(out)) {
    fail('unhandledrejection during view-cycle smoke');
  }
  if (code !== 0) fail('packaged app exit ' + code);
  const mintAfter = mintPortCount();
  if (mintAfter > mintBefore) {
    fail('packaged node opened 8099 (listeners ' + mintBefore + ' -> ' + mintAfter + ')');
  }
  console.log('[packaged-smoke] 8099 listeners unchanged (' + mintAfter + ')');
  console.log('PACKAGED_SMOKE WRAPPER OK');
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
