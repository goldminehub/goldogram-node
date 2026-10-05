'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logPath = null;

function ensureLogPath() {
  if (logPath) return logPath;
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, 'main.log');
  } catch (_) {
    logPath = null;
  }
  return logPath;
}

function appendMainLog(line) {
  const p = ensureLogPath();
  const row = `[${new Date().toISOString()}] ${String(line)}\n`;
  if (!p) {
    console.log(row.trimEnd());
    return;
  }
  try {
    fs.appendFileSync(p, row);
  } catch (_) {
    console.log(row.trimEnd());
  }
  console.log(String(line));
}

module.exports = { appendMainLog, ensureLogPath };
