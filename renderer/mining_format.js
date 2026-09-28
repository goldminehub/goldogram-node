'use strict';

function formatHashrate(hs) {
  const n = Number(hs) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GH/s';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' MH/s';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' kH/s';
  return Math.round(n) + ' H/s';
}

/** Network tile: always MH/s or GH/s, two decimals. Sub-MH stays in MH/s (0.28 MH/s). */
function formatNetworkHashrate(hs) {
  const n = Number(hs);
  const v = Number.isFinite(n) && n > 0 ? n : 0;
  if (v >= 1e9) return (v / 1e9).toFixed(2) + ' GH/s';
  return (v / 1e6).toFixed(2) + ' MH/s';
}

/**
 * Chain hashrate (H/s) ≈ mean(2^difficulty) × blocks_per_second
 * over the last window (up to 120 blocks). blocks_per_second uses the
 * intervals between the oldest and newest timestamp.
 * samples: [{ difficulty, timestamp }] oldest → newest.
 */
function networkHashrateHs(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const first = Number(samples[0].timestamp);
  const last = Number(samples[samples.length - 1].timestamp);
  const elapsed = last - first;
  if (!(elapsed > 0)) return null;
  const intervals = samples.length - 1;
  const bps = intervals / elapsed;
  let work = 0;
  for (let i = 0; i < samples.length; i++) {
    const d = Math.min(53, Math.max(0, Number(samples[i].difficulty) || 0));
    work += Math.pow(2, d);
  }
  const hs = (work / samples.length) * bps;
  if (!Number.isFinite(hs) || hs < 0) return null;
  return hs;
}

/**
 * Dashboard mining visual. Syncing shows a ring; mining is live;
 * idle and isolated stay dim with a reason.
 */
function dashboardVisualState(input) {
  const mining = (input && input.mining) || {};
  const childRunning = !!(input && input.childRunning);
  if (!childRunning) {
    return { mode: 'stopped', reason: 'Node stopped', progress: 0, hashrateText: '' };
  }
  const syncing = (input && input.syncState) === 'syncing' || mining.state === 'syncing';
  if (syncing) {
    const total = Number(input && input.networkHeight) || 0;
    const cur = Number(input && input.height) || 0;
    const progress = total > 0 ? Math.min(100, (cur / total) * 100) : 0;
    return { mode: 'syncing', reason: '', progress, hashrateText: '' };
  }
  const miningOn = mining.state === 'mining' || !!mining.active;
  if (miningOn) {
    return {
      mode: 'synced-mining',
      reason: '',
      progress: 100,
      hashrateText: formatHashrate(mining.hashrate),
    };
  }
  return { mode: 'synced-off', reason: '', progress: 100, hashrateText: '' };
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
  if (state === 'isolated' || (mining && mining.isolated)) return 'Isolated — not mining';
  if (state === 'mining' || (mining && mining.active)) return 'Mining';
  if (state === 'syncing') return 'Syncing';
  if (state === 'paused') return 'Paused';
  return 'Idle';
}

const api = {
  formatHashrate,
  formatNetworkHashrate,
  networkHashrateHs,
  dashboardVisualState,
  formatRelativeTime,
  formatGoGX,
  isMinerLogLine,
  miningStatusLabel,
};
if (typeof module === 'object' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.MiningFormat = api;
}
