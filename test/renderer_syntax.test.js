'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'renderer', 'index.html');

function extractInlineScript(html) {
  let idx = 0;
  let body = null;
  while (true) {
    const a = html.indexOf('<script', idx);
    if (a < 0) break;
    const gt = html.indexOf('>', a);
    const close = html.indexOf('</script>', gt);
    const tag = html.slice(a, gt + 1);
    if (!/\bsrc\s*=/.test(tag)) {
      body = html.slice(gt + 1, close);
    }
    idx = close + 9;
  }
  return body;
}

test('renderer inline script parses (no SyntaxError)', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  const body = extractInlineScript(html);
  assert.ok(body && body.length > 1000, 'inline script missing');
  // The 1.2.41 regression: real newline inside a single-quoted bootstrap string.
  assert.equal(
    /cfg-bootstrap'\)\.value = '[^']*\n[^']*'/.test(body),
    false,
    'cfg-bootstrap assignment must not contain a raw newline inside quotes',
  );
  const tmp = path.join(ROOT, 'test', '.inline_renderer_check.js');
  fs.writeFileSync(tmp, body);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  try { fs.unlinkSync(tmp); } catch (_) {}
  assert.equal(r.status, 0, r.stderr || r.stdout || 'node --check failed');
});

test('login UI has eye toggles type=button and fatal overlay', () => {
  const html = fs.readFileSync(HTML, 'utf8');
  assert.match(html, /id="fatal-error-overlay"/);
  assert.match(html, /class="pw-eye"[^>]*data-target="setup-password"/);
  assert.match(html, /class="pw-eye"[^>]*data-target="ks-modal-password"/);
  assert.match(html, /class="pw-eye"[^>]*data-target="ks-modal-pin"/);
  assert.match(html, /boot_guard\.js/);
  // All eye buttons must declare type=button in markup
  const eyes = html.match(/<button\b[^>]*class="pw-eye"[^>]*>/g) || [];
  assert.ok(eyes.length >= 3, 'expected >=3 eye buttons, got ' + eyes.length);
  for (const tag of eyes) {
    assert.match(tag, /\btype="button"/);
  }
});
