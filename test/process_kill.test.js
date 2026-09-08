'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const {
  taskkillArgs,
  isAppCorePath,
  isGoldogramCoreName,
  isGoldogramImageName,
  parseWmicProcessCsv,
  parseWmicNamedCsv,
  parseNetstatAno,
  parsePsPidComm,
  parseSsLp,
  orphansFromAppBin,
  selectNamedCoreOrphans,
  selectGoldogramPortOrphans,
  mergeKillTargets,
  killTargetLogLine,
  waitForExit,
  waitPidsGone,
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

test('goldogram-core* matches any path', () => {
  assert.ok(isGoldogramCoreName('goldogram-core.exe'));
  assert.ok(isGoldogramCoreName('goldogram-core'));
  assert.ok(isGoldogramCoreName('C:\\Windows\\goldogram-core.exe'));
  assert.ok(isGoldogramCoreName('goldogram-core-old.exe'));
  assert.ok(!isGoldogramCoreName('notepad.exe'));
  assert.ok(!isGoldogramCoreName('Goldogram Node.exe'));
  assert.ok(isGoldogramImageName('goldogram-core.exe'));
  assert.ok(isGoldogramImageName('Goldogram Node.exe'));
  assert.ok(!isGoldogramImageName('svchost.exe'));
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

test('selectNamedCoreOrphans ignores path', () => {
  const csv = [
    'Node,ExecutablePath,Name,ProcessId',
    'ITALY,C:\\Windows\\System32\\goldogram-core.exe,goldogram-core.exe,99',
    'ITALY,C:\\Users\\x\\AppData\\Local\\Goldogram Node\\resources\\goldogram-core.exe,goldogram-core.exe,8811',
    'ITALY,C:\\Windows\\notepad.exe,notepad.exe,7',
  ].join('\n');
  const rows = parseWmicNamedCsv(csv);
  const orphans = selectNamedCoreOrphans(rows, [8811]);
  assert.deepEqual(orphans.map((p) => p.pid), [99]);
});

test('netstat + port orphans require goldogram in the image name', () => {
  const netstat = [
    '  TCP    0.0.0.0:8333           0.0.0.0:0              LISTENING       99',
    '  TCP    [::]:8335              [::]:0                 LISTENING       100',
    '  TCP    0.0.0.0:8333           0.0.0.0:0              LISTENING       50',
    '  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       9',
  ].join('\n');
  const ports = parseNetstatAno(netstat);
  assert.deepEqual(ports.map((p) => p.pid), [99, 100, 50]);
  const listeners = [
    { pid: 99, port: 8333, name: 'goldogram-core.exe' },
    { pid: 100, port: 8335, name: 'goldogram-core.exe' },
    { pid: 50, port: 8333, name: 'svchost.exe' },
  ];
  const orphans = selectGoldogramPortOrphans(listeners);
  assert.deepEqual(orphans.map((p) => p.pid).sort((a, b) => a - b), [99, 100]);
});

test('ss/ps parsers and kill log line', () => {
  const ss = 'LISTEN 0 128 0.0.0.0:8333 0.0.0.0:* users:(("goldogram-core",pid=4242,fd=8))';
  assert.deepEqual(parseSsLp(ss), [{ port: 8333, pid: 4242, name: 'goldogram-core' }]);
  const ps = ' 4242 goldogram-core\n    7 bash';
  const named = selectNamedCoreOrphans(parsePsPidComm(ps));
  assert.deepEqual(named.map((p) => p.pid), [4242]);
  const merged = mergeKillTargets(named, [{ pid: 4242, port: 8333, name: 'goldogram-core' }]);
  assert.equal(merged.length, 1);
  assert.ok(merged[0].reasons.includes('name'));
  assert.ok(merged[0].reasons.includes('port'));
  assert.match(killTargetLogLine(merged[0]), /\[Node\] killed pid=4242/);
});

test('waitForExit resolves on child exit', async () => {
  const child = new EventEmitter();
  child.pid = 7;
  child.exitCode = null;
  const p = waitForExit(child, 2000);
  child.emit('exit', 1);
  await p;
});

test('waitPidsGone waits until isAlive is false', async () => {
  const alive = new Set([11, 12]);
  const gone = await waitPidsGone([11, 12], (pid) => alive.has(pid), 2000, (ms) => {
    alive.clear();
    return new Promise((r) => setTimeout(r, ms));
  });
  assert.equal(gone, true);
});

test('lock grace is 500ms', () => {
  assert.equal(LOCK_GRACE_MS, 500);
});
