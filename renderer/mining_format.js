'use strict';

function formatHashrate(hs) {
  const n = Number(hs) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MH/s';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' kH/s';
  return Math.round(n) + ' H/s';
}

function formatRelativeTime(unixSecs, nowMs) {
  const ts = Number(unixSecs) || 0;
  if (ts <= 0) return '—';
  const now = (nowMs != null ? nowMs : Date.now()) / 1000;
  const ago = Math.max(0, Math.floor(now - ts));
  if (ago < 60) return ago + 's ago';
  if (ago < 3600) return Math.floor(ago / 60) + 'm ago';
  return Math.floor(ago / 3600) + 'h ago';
}

function formatGoGX(micro) {
  return ((Number(micro) || 0) / 1e6).toFixed(1);
}

function isMinerLogLine(line) {
  const s = String(line || '');
  return s.includes('[Miner]') || s.includes('[Sovereign]') || s.includes('[Reorg]');
}

function miningStatusLabel(childRunning, mining) {
  if (!childRunning) return 'Stopped';
  const state = (mining && mining.state) || '';
  if (state === 'mining' || (mining && mining.active)) return 'Mining';
  if (state === 'syncing') return 'Syncing';
  if (state === 'paused') return 'Paused';
  return 'Idle';
}

const api = { formatHashrate, formatRelativeTime, formatGoGX, isMinerLogLine, miningStatusLabel };
if (typeof module === 'object' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.MiningFormat = api;
}
