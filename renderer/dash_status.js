'use strict';

/**
 * Dashboard status panel. Plain DOM + one static SVG polyline.
 * No canvas, no animation frame. The caller redraws on a new tip and every 5s.
 */
var HASH_WINDOW_MS = 10 * 60 * 1000;
var HASH_CAP = 120;

function pushHashSample(buf, hs, nowMs) {
  var t = Number(nowMs) || 0;
  var next = (Array.isArray(buf) ? buf.slice() : []);
  next.push({ t: t, hs: Math.max(0, Number(hs) || 0) });
  var cutoff = t - HASH_WINDOW_MS;
  var kept = [];
  for (var i = 0; i < next.length; i++) {
    if (next[i].t >= cutoff) kept.push(next[i]);
  }
  if (kept.length > HASH_CAP) kept = kept.slice(kept.length - HASH_CAP);
  return kept;
}

function headline(state) {
  var mode = state && state.mode;
  if (mode === 'syncing') return 'Syncing…';
  if (mode === 'synced-mining' || mode === 'mining') return 'Synced — mining';
  if (mode === 'synced-off') return 'Synced — mining off';
  if (mode === 'stopped' || (mode === 'idle' && state && state.reason === 'Node stopped')) {
    return 'Node stopped';
  }
  if (mode === 'isolated') return 'Synced — mining off';
  return 'Node stopped';
}

function shortHash(hash) {
  var h = String(hash || '');
  if (!h) return '—';
  if (h.length <= 12) return h;
  return h.slice(0, 8) + '…';
}

function shortMiner(addr) {
  var a = String(addr || '').trim();
  if (!a) return '—';
  if (a.length <= 14) return a;
  return a.slice(0, 6) + '…' + a.slice(-4);
}

function sparklinePoints(samples, width, height) {
  var w = width || 320;
  var h = height || 56;
  var pts = [];
  var list = samples || [];
  var i;
  var max = 0;
  for (i = 0; i < list.length; i++) {
    var v = Number(list[i].hs) || 0;
    pts.push(v);
    if (v > max) max = v;
  }
  if (!pts.length) return '';
  if (max <= 0) max = 1;
  var n = pts.length;
  var out = [];
  for (i = 0; i < n; i++) {
    var x = n === 1 ? w / 2 : (i / (n - 1)) * w;
    var y = h - (pts[i] / max) * (h - 4) - 2;
    out.push(x.toFixed(1) + ',' + y.toFixed(1));
  }
  return out.join(' ');
}

function earnedTodayForAccount(report, account) {
  var who = String(account || '').trim();
  var list = (report && report.producers) || [];
  var hit = null;
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].producer || '') === who) hit = list[i];
  }
  return {
    blocks: hit ? Number(hit.blocks) || 0 : 0,
    earnedMicro: hit ? Number(hit.earned_micro) || 0 : 0,
    perBlockMicro: Number(report && report.per_block_micro) || 0,
  };
}

function todayTotals(recent, nowMs) {
  var now = new Date(Number(nowMs) || Date.now());
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  var blocks = 0;
  var micro = 0;
  var list = recent || [];
  for (var i = 0; i < list.length; i++) {
    if (Number(list[i].ts) >= start) {
      blocks += 1;
      micro += Number(list[i].reward_micro) || 0;
    }
  }
  return { blocks: blocks, earnedMicro: micro };
}

function tickerRows(tips, rewardAddress, nowMs, formatAgo) {
  var reward = String(rewardAddress || '').trim();
  var agoFn = typeof formatAgo === 'function' ? formatAgo : function () { return '—'; };
  return (tips || []).slice(0, 5).map(function (b) {
    var miner = String(b.miner || '');
    return {
      height: Number(b.height) || 0,
      short: shortHash(b.hash),
      ago: agoFn(b.timestamp, nowMs),
      miner: shortMiner(miner),
      ours: !!(reward && miner === reward),
    };
  });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderDashPanel(el, model) {
  if (!el) return;
  var m = model || {};
  var state = m.state || { mode: 'idle', reason: 'Node stopped', progress: 0 };
  var title = headline(state);
  var syncing = state.mode === 'syncing';
  var pct = Math.max(0, Math.min(100, Number(state.progress) || 0));
  var points = sparklinePoints(m.samples, 320, 56);
  var current = m.currentText || state.hashrateText || '0 H/s';
  var net = m.networkText || '—';
  var rows = m.rows || [];
  var today = m.today || { blocks: 0, earnedText: '0.0', perBlockText: '' };
  var bar = syncing
    ? '<div class="dash-bar"><div class="dash-bar-fill" style="width:' + pct.toFixed(1) + '%"></div></div>'
    : '';
  var rowHtml = rows.length
    ? rows.map(function (r) {
      return '<div class="dash-tip' + (r.ours ? ' is-ours' : '') + '">' +
        '<span>' + esc(Number(r.height).toLocaleString()) + '</span>' +
        '<span class="mono">' + esc(r.short) + '</span>' +
        '<span>' + esc(r.ago) + '</span>' +
        '<span class="mono">' + esc(r.miner) + '</span>' +
        '</div>';
    }).join('')
    : '<div class="dash-tip dim">No blocks yet</div>';
  el.innerHTML =
    '<div class="dash-head ' + esc(state.mode) + '">' + esc(title) + '</div>' +
    bar +
    '<div class="dash-spark">' +
      '<svg viewBox="0 0 320 56" preserveAspectRatio="none" aria-hidden="true">' +
        '<polyline points="' + points + '" fill="none" stroke="#D4AF37" stroke-width="1.5"></polyline>' +
      '</svg>' +
      '<div class="dash-spark-now">' + esc(current) + '</div>' +
    '</div>' +
    '<div class="dash-net">Network ' + esc(net) + '</div>' +
    '<div class="dash-tips">' + rowHtml + '</div>' +
    '<div class="dash-today">Blocks found today: ' + Number(today.blocks) + ' · Earned today: ' + esc(today.earnedText) + ' GoGX' +
      (today.perBlockText ? ' (' + esc(today.perBlockText) + ' GoGX/block)' : '') + '</div>';
}

var dashStatusApi = {
  HASH_CAP: HASH_CAP,
  pushHashSample: pushHashSample,
  headline: headline,
  shortHash: shortHash,
  sparklinePoints: sparklinePoints,
  todayTotals: todayTotals,
  earnedTodayForAccount: earnedTodayForAccount,
  tickerRows: tickerRows,
  renderDashPanel: renderDashPanel,
};
if (typeof module === 'object' && module.exports) module.exports = dashStatusApi;
if (typeof window !== 'undefined') window.DashStatus = dashStatusApi;
