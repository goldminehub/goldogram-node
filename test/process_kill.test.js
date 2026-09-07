'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const {
  taskkillArgs,
  isAppCorePath,
  parseWmicProcessCsv,
  orphansFromAppBin,
  waitForExit,
  LOCK_GRACE_MS,
} = require('../src/process_kill');

test('taskkill uses /PID /T /F', () => {
  assert.deepEqual(taskkillArgs(4242), ['/PID', '4242', '/T', '/F']);
});

test('isAppCorePath only matches the app bin goldogram-core', () => {
  const bin = 'C:\\Program Files\\Goldogram Node\\resources';
  assert.ok(isAppCorePath('C:\\Program Files\\Goldogram Node\\resources\\goldogram-core.exe', bin));
  assert.ok(!isAppCorePath('C:\\Windows\\goldogram-core.exe', bin));
  assert.ok(!isAppCorePath('C:\\Program Files\\Goldogram Node\\resources\\notepad.exe', bin));
});

test('parseWmic + orphansFromAppBin selects only our binary', () => {
  const csv = [
    'Node,ExecutablePath,ProcessId',
    'ITALY,C:\\Users\\x\\AppData\\Local\\Goldogram Node\\resources\\goldogram-core.exe,8811',
    'ITALY,C:\\Windows\\System32\\goldogram-core.exe,99',
  ].join('\n');
  const rows = parseWmicProcessCsv(csv);
  assert.equal(rows.length, 2);
  const orphans = orphansFromAppBin(
    rows,
    'C:\\Users\\x\\AppData\\Local\\Goldogram Node\\resources'
  );
  assert.deepEqual(orphans.map((p) => p.pid), [8811]);
});

test('waitForExit resolves on child exit', async () => {
  const child = new EventEmitter();
  child.pid = 7;
  child.exitCode = null;
  const p = waitForExit(child, 2000);
  child.emit('exit', 1);
  await p;
});

test('lock grace is 500ms', () => {
  assert.equal(LOCK_GRACE_MS, 500);
});
