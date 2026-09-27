'use strict';

/**
 * Dashboard stand-in for the web Mine tab's Apple-silicon hash visual.
 * Syncing draws a progress ring. Mining animates rings, waves, and particles
 * with the local hashrate in the core. Idle and isolated stay dim.
 */
function startMineVisual(canvas, getState) {
  if (!canvas || typeof canvas.getContext !== 'function') return function () {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return function () {};

  const CHARS = '01Ψ∇⊗⟨⟩ℏΩ∑Φ√±∞';
  const rings = [0, 1, 2, 3].map(function (i) {
    return {
      angle: Math.random() * Math.PI * 2,
      speed: (i % 2 === 0 ? 1 : -1) * (0.008 + i * 0.004),
      nodes: 3 + i,
      phase: Math.random() * Math.PI * 2,
    };
  });
  let particles = [];
  let columns = [];
  let t = 0;
  let stopped = false;
  let raf = 0;

  function gold(a) { return 'rgba(212,175,55,' + a + ')'; }
  function cyan(a) { return 'rgba(96,200,220,' + a + ')'; }
  function purple(a) { return 'rgba(160,100,255,' + a + ')'; }

  function size() {
    const w = canvas.clientWidth || canvas.width || 640;
    const h = canvas.clientHeight || canvas.height || 220;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (columns.length === 0 || Math.abs(columns.length - Math.floor(w / 14)) > 2) {
      columns = [];
      const count = Math.max(8, Math.floor(w / 14));
      for (let i = 0; i < count; i++) {
        columns.push({
          x: i * 14 + 7,
          y: Math.random() * h,
          speed: 0.4 + Math.random() * 0.8,
          char: CHARS[Math.floor(Math.random() * CHARS.length)],
          alpha: 0.05 + Math.random() * 0.06,
          timer: Math.random() * 30,
        });
      }
    }
    return { w: w, h: h };
  }

  function drawRing(cx, cy, radius, angle, nodes, alpha, dim) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = gold(alpha);
    ctx.lineWidth = dim ? 0.6 : 0.8;
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let n = 0; n < nodes; n++) {
      const a = angle + (n / nodes) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + radius * Math.cos(a), cy + radius * Math.sin(a), dim ? 2 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = n % 2 === 0 ? gold(dim ? 0.35 : 0.9) : purple(dim ? 0.3 : 0.8);
      ctx.fill();
    }
  }

  function draw() {
    if (stopped) return;
    const st = (typeof getState === 'function' ? getState() : null) || { mode: 'idle' };
    const mode = st.mode || 'idle';
    const dim = mode === 'idle' || mode === 'isolated';
    const box = size();
    const w = box.w;
    const h = box.h;
    const cx = w / 2;
    const cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    t++;

    if (mode === 'mining') {
      columns.forEach(function (col) {
        col.y += col.speed;
        col.timer -= 1;
        if (col.timer <= 0) {
          col.char = CHARS[Math.floor(Math.random() * CHARS.length)];
          col.timer = 15 + Math.random() * 30;
        }
        if (col.y > h) col.y = -10;
        ctx.fillStyle = gold(col.alpha);
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(col.char, col.x, col.y);
      });
      if (t % 20 === 0) {
        particles.push({
          x: cx, y: cy,
          vx: (Math.random() - 0.5) * 3.2,
          vy: (Math.random() - 0.5) * 3.2,
          life: 1,
        });
      }
    }

    rings.forEach(function (ring, i) {
      if (mode === 'mining') {
        ring.angle += ring.speed;
        ring.phase += 0.02;
      }
      const radius = 28 + i * 18;
      const pulse = mode === 'mining' ? (0.6 + 0.4 * Math.sin(ring.phase)) : 0.55;
      const alpha = dim ? 0.12 : (0.12 + i * 0.04) * pulse;
      drawRing(cx, cy, radius, ring.angle, ring.nodes, alpha, dim);
    });

    if (mode === 'syncing') {
      const pct = Math.max(0, Math.min(100, Number(st.progress) || 0));
      ctx.beginPath();
      ctx.arc(cx, cy, 46, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * pct) / 100);
      ctx.strokeStyle = gold(0.95);
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#e8e0cc';
      ctx.font = '600 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pct.toFixed(0) + '%', cx, cy);
      ctx.textBaseline = 'alphabetic';
    } else if (mode === 'mining') {
      particles = particles.filter(function (p) { return p.life > 0; });
      particles.forEach(function (p) {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = cyan(Math.max(0, p.life) * 0.85);
        ctx.fill();
      });
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,10,10,0.72)';
      ctx.fill();
      ctx.strokeStyle = gold(0.9);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#D4AF37';
      ctx.font = '600 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(st.hashrateText || '0 H/s', cx, cy);
      ctx.textBaseline = 'alphabetic';
    } else {
      ctx.fillStyle = 'rgba(232,224,204,0.7)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = mode === 'isolated' ? 'Isolated' : 'Idle';
      ctx.fillText(label, cx, cy - 8);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgba(232,224,204,0.45)';
      const reason = String(st.reason || '');
      ctx.fillText(reason.length > 64 ? reason.slice(0, 61) + '…' : reason, cx, cy + 12);
      ctx.textBaseline = 'alphabetic';
    }

    raf = (typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(draw)
      : setTimeout(draw, 32));
  }

  draw();
  return function stop() {
    stopped = true;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
  };
}

const api = { startMineVisual };
if (typeof module === 'object' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.MineVisual = api;
