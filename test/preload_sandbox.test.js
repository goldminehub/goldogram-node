'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('sandboxed preload may only require electron', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
  const requires = [...src.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(requires, ['electron'], 'preload require() list: ' + requires.join(', '));
  assert.equal(/gog_address/.test(src), false, 'preload must not load gog_address (asar + sandbox)');
  assert.match(src, /exposeInMainWorld\('miner'/);
  assert.match(src, /exposeInMainWorld\('node'/);
  assert.match(src, /exposeInMainWorld\('gogAddress'/);
  assert.match(src, /gog-address-validate/);
  assert.match(src, /gog-address-extract/);
});

test('main process owns blake3 address checks and the packaged smoke flag', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  assert.match(main, /require\('\.\/gog_address'\)/);
  assert.match(main, /gog-address-validate/);
  assert.match(main, /gog-address-extract/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /--smoke/);
  assert.match(main, /PACKAGED_SMOKE OK/);
  assert.match(main, /runPackagedSmoke/);
});

test('boot_guard paints a readable error when the desktop bridge is missing', () => {
  const src = fs.readFileSync(path.join(ROOT, 'renderer', 'boot_guard.js'), 'utf8');
  assert.match(src, /Desktop bridge missing/);
  assert.match(src, /window\.miner/);
  assert.match(src, /window\.gogAddress/);
});

test('packaged smoke runs 30s sidebar view cycle and asserts zero unhandled rejections', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  assert.match(main, /30000/);
  assert.match(main, /unhandledrejection/);
  assert.match(main, /showPanel\(/);
  assert.match(main, /'dashboard'/);
  assert.match(main, /'logs'/);
  assert.match(main, /'peers'/);
  assert.match(main, /'mining'/);
  assert.match(main, /'validator'/);
  assert.match(main, /'info'/);
  assert.match(main, /'config'/);
  assert.match(main, /window\.__smokeRejections/);
  const wrapper = fs.readFileSync(path.join(ROOT, 'scripts', 'packaged_smoke.js'), 'utf8');
  assert.match(wrapper, /30s/);
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8');
  assert.match(html, /if \(!banner \|\| !bar \|\| !text\) return/);
});
