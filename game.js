/*!
 * 龙炉 · 铸剑纳贡
 * 灵感来自 ForgeTax 的核心循环：敲击升值 / 过载碎裂 / 入神 / 遗物 / 巨龙贡品。
 * 纯原生 JS，无依赖，可直接部署到 GitHub Pages。
 */
(() => {
  'use strict';

  /* ================= 数值 ================= */
  const MAX_ANGER = 3;

  const BASE_VALUE = 18;        // 第一锤的基础价值
  const VALUE_GROWTH = 0.16;    // 每锤的增值系数（越敲越值钱，这是诱惑所在）
  const CHARGE_MAX = 100;
  const TRANCE_LEN = 6;         // 入神持续锤数
  const TRANCE_VALUE = 2.5;     // 入神期间价值倍率
  const TRANCE_LOAD = 0.45;     // 入神期间过载倍率
  const TRANCE_SPEED = 0.72;    // 入神期间光标变慢

  // 命中精度 → 价值倍率 / 过载增量 / 入神充能
  const ACC = {
    perfect: { gain: 3.0, load: 5, charge: 34, label: '完美！' },
    good: { gain: 1.5, load: 9, charge: 17, label: '不错' },
    miss: { gain: 0.6, load: 16, charge: -20, label: '偏了' },
  };

  const ZONE_GOOD = 0.30;
  const ZONE_PERFECT = 0.088;
  const STRIKE_CD = 130;
  const RISK_EXP = 2.2;
  const RISK_CAP = 0.95;
  const RISK_CAP_ANVIL = 0.60;

  const QUOTA_BASE = 250;
  const QUOTA_GROWTH = 1.62;

  const STORE_BEST = 'forge.best';
  const STORE_SOUND = 'forge.sound';

  const RELICS = [
    { id: 'wrist', icon: '🧤', name: '铁匠护腕', cost: 300, desc: '判定区加宽 35%，更容易打准' },
    { id: 'hammer', icon: '🔨', name: '龙鳞重锤', cost: 450, desc: '敲击基础价值 +30%' },
    { id: 'oil', icon: '💧', name: '淬火油', cost: 400, desc: '过载增长 −25%，能多敲几锤' },
    { id: 'charm', icon: '📜', name: '定神符', cost: 500, desc: '入神持续 +3 锤' },
    { id: 'anvil', icon: '⚒️', name: '秘银砧', cost: 700, desc: '碎裂风险上限降至 60%，永不必然碎裂' },
    { id: 'greed', icon: '👁️', name: '贪婪之眼', cost: 650, desc: '价值 +60%，但过载增长 +30%' },
    { id: 'revive', icon: '🔥', name: '复燃符', cost: 800, desc: '每轮首次碎裂时保住 40% 价值' },
    { id: 'spice', icon: '🕯️', name: '巨龙香料', cost: 550, desc: '贡品要求 −12%' },
  ];

  /* ================= DOM ================= */
  const wrap = document.querySelector('.forge');
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const roundEl = document.getElementById('round');
  const goldEl = document.getElementById('gold');
  const dragonEl = document.getElementById('dragon');
  const pipsEl = document.getElementById('pips');
  const valueEl = document.getElementById('value');
  const quotaEl = document.getElementById('quota');
  const quotaFill = document.getElementById('quotaFill');
  const loadTxt = document.getElementById('loadTxt');
  const loadFill = document.getElementById('loadFill');
  const chargeTxt = document.getElementById('chargeTxt');
  const chargeFill = document.getElementById('chargeFill');
  const riskTxt = document.getElementById('riskTxt');
  const riskBox = document.getElementById('riskBox');
  const timingEl = document.getElementById('timing');
  const zoneGood = document.getElementById('zoneGood');
  const zonePerfect = document.getElementById('zonePerfect');
  const cursorEl = document.getElementById('cursor');
  const hintEl = document.getElementById('hint');
  const btnStrike = document.getElementById('btnStrike');
  const btnSubmit = document.getElementById('btnSubmit');
  const btnSound = document.getElementById('btnSound');
  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ovTitle');
  const ovText = document.getElementById('ovText');
  const ovBtn = document.getElementById('ovBtn');
  const relicsEl = document.getElementById('relics');

  /* ================= 状态 ================= */
  let round = 1;
  let gold = 0;
  let anger = 0;
  let best = Number(readStore(STORE_BEST, 0)) || 0;
  const owned = new Set();
  let shopBought = new Set();   // 本次商店里刚买下的，用于保留卡片显示「已拥有」

  let phase = 'idle';        // idle | forge | shop | over
  let value = 0;
  let load = 0;
  let strikes = 0;
  let charge = 0;
  let tranceLeft = 0;
  let usedRevive = false;

  let cursor = 0.5;
  let cursorDir = 1;
  let cooldown = 0;
  let hintTimer = 0;
  let bestSword = 0;

  let W = 300;
  let H = 220;
  let trackW = 200;      // 计时条像素宽，缓存下来避免每帧读 DOM
  let embers = [];
  let sparks = [];
  let floaters = [];
  let cracks = [];
  let hammerT = 0;      // 0 = 抬起, 1 = 砸下
  let shake = 0;
  let clock = 0;

  let audioCtx = null;
  let soundOn = readStore(STORE_SOUND, 'on') !== 'off';
  let lastTs = 0;

  /* ================= 工具 ================= */
  function readStore(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (err) {
      return fallback;
    }
  }

  function save(key, val) {
    try {
      localStorage.setItem(key, String(val));
    } catch (err) { /* 隐私模式忽略 */ }
  }

  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  function has(id) {
    return owned.has(id);
  }

  /* ================= 音效 ================= */
  function ensureAudio() {
    if (!soundOn) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, dur, type, vol, delay) {
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime + (delay || 0);
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol === undefined ? 0.05 : vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function sweep(f1, f2, dur, type, vol) {
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type || 'sawtooth';
    osc.frequency.setValueAtTime(f1, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol === undefined ? 0.06 : vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noise(dur, vol, cutoff) {
    const ac = ensureAudio();
    if (!ac) return;
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff || 1400;
    const g = ac.createGain();
    g.gain.value = vol === undefined ? 0.18 : vol;
    src.connect(f).connect(g).connect(ac.destination);
    src.start();
  }

  function sfxStrike(acc) {
    noise(0.09, 0.16, acc === 'miss' ? 700 : 2200);
    tone(acc === 'perfect' ? 1180 : acc === 'good' ? 880 : 260, 0.09, 'triangle', 0.05);
    if (acc === 'perfect') tone(1760, 0.12, 'triangle', 0.035, 0.04);
  }

  function sfxShatter() {
    noise(0.5, 0.3, 900);
    sweep(420, 60, 0.5, 'sawtooth', 0.08);
  }

  function sfxRoar() {
    sweep(120, 42, 0.9, 'sawtooth', 0.1);
    sweep(90, 34, 1.0, 'square', 0.05, 0);
  }

  function sfxCoin() {
    tone(880, 0.08, 'triangle', 0.05);
    tone(1320, 0.12, 'triangle', 0.045, 0.07);
  }

  function buzz(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (err) { /* 忽略 */ }
    }
  }

  /* ================= 数值计算 ================= */
  function quotaFor(r) {
    const raw = QUOTA_BASE * Math.pow(QUOTA_GROWTH, r - 1);
    const mod = has('spice') ? 0.88 : 1;
    return Math.max(60, Math.round((raw * mod) / 10) * 10);
  }

  function riskCap() {
    return has('anvil') ? RISK_CAP_ANVIL : RISK_CAP;
  }

  function riskNow() {
    return Math.min(riskCap(), Math.pow(clamp(load, 0, 100) / 100, RISK_EXP));
  }

  function loadGain(acc) {
    let g = ACC[acc].load;
    if (has('oil')) g *= 0.75;
    if (has('greed')) g *= 1.3;
    if (tranceLeft > 0) g *= TRANCE_LOAD;
    return g;
  }

  function valueGain(acc, index) {
    let v = BASE_VALUE * (1 + index * VALUE_GROWTH);
    v *= ACC[acc].gain;
    if (has('hammer')) v *= 1.3;
    if (has('greed')) v *= 1.6;
    if (tranceLeft > 0) v *= TRANCE_VALUE;
    return Math.max(1, Math.round(v));
  }

  function cursorSpeed() {
    let s = 0.78 + Math.min(round, 12) * 0.055 + strikes * 0.055;
    s = Math.min(s, 2.15);
    if (tranceLeft > 0) s *= TRANCE_SPEED;
    return s;
  }

  function zones() {
    const wide = has('wrist') ? 1.35 : 1;
    return { good: ZONE_GOOD * wide, perfect: ZONE_PERFECT * wide };
  }

  function accuracyOf(p) {
    const z = zones();
    const d = Math.abs(p - 0.5);
    if (d <= z.perfect / 2) return 'perfect';
    if (d <= z.good / 2) return 'good';
    return 'miss';
  }

  /* ================= 场景几何 ================= */
  function layout() {
    const bladeW = clamp(W * 0.10, 16, 40);
    return {
      cx: W / 2,
      bladeTop: Math.max(58, H * 0.20),
      guardY: H - Math.max(84, H * 0.26),
      gripEnd: H - 44,
      bladeW: bladeW,
    };
  }

  // 热度色阶：冷 → 暗红 → 橙 → 金黄 → 白热
  const HEAT_STOPS = [
    [0.00, [58, 20, 16]],
    [0.22, [122, 32, 16]],
    [0.45, [214, 74, 26]],
    [0.68, [255, 152, 52]],
    [0.86, [255, 206, 108]],
    [1.00, [255, 244, 206]],
  ];

  function heatColor(t) {
    const v = clamp(t, 0, 1);
    for (let i = 1; i < HEAT_STOPS.length; i++) {
      if (v <= HEAT_STOPS[i][0]) {
        const a = HEAT_STOPS[i - 1];
        const b = HEAT_STOPS[i];
        const k = (v - a[0]) / (b[0] - a[0] || 1);
        const c = [0, 1, 2].map((j) => Math.round(a[1][j] + (b[1][j] - a[1][j]) * k));
        return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      }
    }
    return 'rgb(255,244,206)';
  }

  function heat() {
    return clamp((load / 100) * 1.12 + strikes * 0.012, 0, 1);
  }

  /* ================= 尺寸 ================= */
  function resize() {
    const r = wrap.getBoundingClientRect();
    W = Math.max(120, r.width);
    H = Math.max(110, r.height);
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const track = timingEl.querySelector('.timing__track');
    trackW = Math.max(1, track ? track.clientWidth : W - 20);
    cursorEl.style.transform = 'translateX(' + (cursor * trackW).toFixed(1) + 'px)';
    rebuildEmbers();
  }

  function rebuildEmbers() {
    embers = [];
    const n = Math.round(clamp(W * H / 9000, 12, 40));
    for (let i = 0; i < n; i++) {
      embers.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vy: -(8 + Math.random() * 22),
        r: 0.7 + Math.random() * 1.8,
        a: 0.15 + Math.random() * 0.45,
        sway: Math.random() * Math.PI * 2,
      });
    }
  }

  /* ================= 粒子 ================= */
  function spawnSparks(x, y, n, acc) {
    const power = acc === 'perfect' ? 1.5 : acc === 'good' ? 1 : 0.7;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
      const sp = (60 + Math.random() * 190) * power;
      sparks.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        size: 1 + Math.random() * 1.6,
      });
    }
  }

  function spawnFloat(x, y, text, color) {
    floaters.push({ x: x, y: y, text: text, color: color, life: 1 });
  }

  /* ================= 裂纹 ================= */
  function rebuildCracks() {
    cracks = [];
    const g = layout();
    for (let i = 0; i < 5; i++) {
      const pts = [];
      let y = g.bladeTop + (g.guardY - g.bladeTop) * (0.15 + Math.random() * 0.7);
      const dir = Math.random() < 0.5 ? -1 : 1;
      let x = g.cx + (Math.random() - 0.5) * g.bladeW * 0.5;
      const steps = 3 + Math.floor(Math.random() * 3);
      for (let s = 0; s < steps; s++) {
        pts.push([x, y]);
        x += dir * (3 + Math.random() * 6) * (s % 2 ? 1 : -1);
        y += 6 + Math.random() * 10;
      }
      cracks.push(pts);
    }
  }

  /* ================= 渲染 ================= */
  function drawSword(g, heatV, time) {
    const col = heatColor(heatV);
    const pulse = 0.72 + Math.sin(time / 260) * 0.28;
    const bladeTop = g.bladeTop;
    const guardY = g.guardY;
    const bw = g.bladeW;

    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 14 + heatV * 46 * pulse;

    // 剑身
    const grad = ctx.createLinearGradient(g.cx - bw / 2, 0, g.cx + bw / 2, 0);
    grad.addColorStop(0, col);
    grad.addColorStop(0.42, heatColor(Math.min(1, heatV + 0.22)));
    grad.addColorStop(0.5, heatColor(Math.min(1, heatV + 0.34)));
    grad.addColorStop(0.58, heatColor(Math.min(1, heatV + 0.22)));
    grad.addColorStop(1, col);
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(g.cx, bladeTop);
    ctx.lineTo(g.cx + bw * 0.5, bladeTop + bw * 1.5);
    ctx.lineTo(g.cx + bw * 0.5, guardY);
    ctx.lineTo(g.cx - bw * 0.5, guardY);
    ctx.lineTo(g.cx - bw * 0.5, bladeTop + bw * 1.5);
    ctx.closePath();
    ctx.fill();

    // 剑格
    ctx.fillStyle = heatColor(Math.min(1, heatV * 0.7 + 0.08));
    const gw = bw * 2.5;
    const gh = Math.max(6, bw * 0.4);
    ctx.beginPath();
    ctx.moveTo(g.cx - gw / 2, guardY);
    ctx.lineTo(g.cx + gw / 2, guardY);
    ctx.lineTo(g.cx + gw / 2 - 4, guardY + gh);
    ctx.lineTo(g.cx - gw / 2 + 4, guardY + gh);
    ctx.closePath();
    ctx.fill();

    // 剑柄
    const hw = bw * 0.62;
    ctx.fillStyle = 'rgba(52, 30, 20, .96)';
    ctx.fillRect(g.cx - hw / 2, guardY + gh, hw, g.gripEnd - guardY - gh);
    ctx.strokeStyle = 'rgba(255, 190, 120, .35)';
    ctx.lineWidth = 1;
    for (let y = guardY + gh + 5; y < g.gripEnd - 3; y += 6) {
      ctx.beginPath();
      ctx.moveTo(g.cx - hw / 2, y);
      ctx.lineTo(g.cx + hw / 2, y);
      ctx.stroke();
    }

    // 剑首
    ctx.fillStyle = heatColor(Math.min(1, heatV * 0.6 + 0.1));
    ctx.beginPath();
    ctx.arc(g.cx, g.gripEnd, Math.max(4, bw * 0.34), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 高过载时浮现裂纹，作为危险预告
    if (load > 62) {
      const a = clamp((load - 62) / 38, 0, 1) * 0.85;
      ctx.save();
      ctx.strokeStyle = 'rgba(30, 8, 4, ' + a.toFixed(3) + ')';
      ctx.lineWidth = 1.6;
      for (const pts of cracks) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawHammer(g, time) {
    // hammerT: 0 = 高举, 1 = 砸在剑上
    // 抬起 -2.45rad（指向右上），砸下 +0.72rad（指向左下），锤头正好落在剑身中上部，
    // 且两个极端都留在画布内（之前的写法会把锤子甩出右边缘，看着像根悬空的棍子）
    const eased = hammerT * hammerT;
    const angle = -2.45 + eased * 3.17;
    const bw = g.bladeW;
    const px = g.cx + bw * 1.5;
    const py = g.bladeTop + 8;
    const len = clamp(bw * 1.9, 40, 74);

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    // 柄
    ctx.fillStyle = 'rgba(74, 45, 26, .98)';
    ctx.fillRect(-3, 0, 6, len);
    // 锤头
    const hh = Math.max(14, bw * 0.8);
    const hw2 = Math.max(24, bw * 1.5);
    ctx.fillStyle = 'rgba(58, 60, 66, .98)';
    ctx.beginPath();
    ctx.moveTo(-hw2 / 2, len);
    ctx.lineTo(hw2 / 2, len);
    ctx.lineTo(hw2 / 2 - 3, len + hh);
    ctx.lineTo(-hw2 / 2 + 3, len + hh);
    ctx.closePath();
    ctx.fill();
    // 锤面余温
    ctx.fillStyle = heatColor(clamp(0.35 + heat() * 0.6, 0, 1));
    ctx.fillRect(-hw2 / 2 + 3, len + hh - 4, hw2 - 6, 3);
    ctx.restore();
  }

  function render(dt) {
    ctx.clearRect(0, 0, W, H);
    const g = layout();
    const time = clock;

    // 炉火底色
    const bg = ctx.createRadialGradient(g.cx, H * 0.82, 6, g.cx, H * 0.82, Math.max(W, H) * 0.78);
    const glow = 0.10 + heat() * 0.34;
    bg.addColorStop(0, 'rgba(255, 130, 40, ' + glow.toFixed(3) + ')');
    bg.addColorStop(0.5, 'rgba(150, 50, 12, ' + (glow * 0.4).toFixed(3) + ')');
    bg.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 火星
    ctx.save();
    for (const e of embers) {
      e.y += e.vy * dt;
      e.sway += dt * 1.6;
      if (e.y < -6) {
        e.y = H + 6;
        e.x = Math.random() * W;
      }
      const x = e.x + Math.sin(e.sway) * 5;
      ctx.globalAlpha = e.a * (0.5 + heat() * 0.6);
      ctx.fillStyle = '#ffab52';
      ctx.beginPath();
      ctx.arc(x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    if (shake > 0.001) {
      const s = shake * 7;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    drawSword(g, heat(), time);
    drawHammer(g, time);

    // 火花
    for (const p of sparks) {
      p.vy += 520 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt * 1.7;
    }
    sparks = sparks.filter((p) => p.life > 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of sparks) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.life > 0.6 ? '#fff3d0' : '#ff9b3d';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + p.life * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 飘字
    for (const f of floaters) {
      f.y -= 34 * dt;
      f.life -= dt * 1.15;
    }
    floaters = floaters.filter((f) => f.life > 0);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.font = '700 17px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = f.color;
      ctx.shadowColor = 'rgba(0,0,0,.85)';
      ctx.shadowBlur = 6;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();

    ctx.restore();
  }

  /* ================= HUD ================= */
  function renderPips() {
    let html = '';
    for (let i = 0; i < MAX_ANGER; i++) {
      html += '<i class="' + (i < anger ? 'on' : '') + '"></i>';
    }
    pipsEl.innerHTML = html;
    dragonEl.dataset.anger = String(anger);
  }

  function fmt(n) {
    return String(Math.round(n));
  }

  function updateHud() {
    roundEl.textContent = String(round);
    goldEl.textContent = fmt(gold);
    valueEl.textContent = fmt(value);
    const q = quotaFor(round);
    quotaEl.textContent = fmt(q);
    quotaFill.style.width = clamp((value / q) * 100, 0, 100).toFixed(1) + '%';
    quotaFill.style.background = value >= q
      ? 'linear-gradient(90deg,#7dffc0,#38ffaa)'
      : 'linear-gradient(90deg,#ff8a3d,#ffc957)';

    loadTxt.textContent = Math.round(load) + '%';
    loadFill.style.width = clamp(load, 0, 100).toFixed(1) + '%';
    loadFill.parentElement.classList.toggle('is-hot', load >= 70);

    const risk = riskNow();
    riskTxt.textContent = Math.round(risk * 100) + '%';
    riskBox.dataset.level = risk >= 0.55 ? 'danger' : risk >= 0.22 ? 'warn' : 'none';

    chargeTxt.textContent = tranceLeft > 0 ? '入神 ' + tranceLeft : Math.round(charge) + '%';
    chargeFill.style.width = (tranceLeft > 0 ? 100 : clamp(charge, 0, 100)).toFixed(1) + '%';

    timingEl.classList.toggle('is-trance', tranceLeft > 0);
    wrap.style.setProperty('--forge-glow', (0.25 + heat() * 0.75).toFixed(2));
  }

  function setHint(text, isFeedback) {
    if (isFeedback) {
      hintEl.textContent = text;
      hintTimer = 620;
    } else {
      hintEl.textContent = text;
    }
  }

  function previewHint() {
    if (phase !== 'forge') return;
    const p = valueGain('perfect', strikes);
    const g = valueGain('good', strikes);
    setHint('完美 +' + p + ' · 良好 +' + g, false);
  }

  function layoutZones() {
    const z = zones();
    const gw = z.good * 100;
    const pw = z.perfect * 100;
    zoneGood.style.left = (50 - gw / 2) + '%';
    zoneGood.style.width = gw + '%';
    zonePerfect.style.left = (50 - pw / 2) + '%';
    zonePerfect.style.width = pw + '%';
  }

  /* ================= 流程 ================= */
  function newBillet() {
    value = 0;
    load = 0;
    strikes = 0;
    charge = 0;
    tranceLeft = 0;
    usedRevive = false;
    cursor = 0.5;
    cursorDir = 1;
    cooldown = 0;
    sparks = [];
    floaters = [];
    rebuildCracks();
    phase = 'forge';
    layoutZones();
    previewHint();
    updateHud();
  }

  function startRun() {
    round = 1;
    gold = 0;
    anger = 0;
    owned.clear();
    bestSword = 0;
    renderPips();
    newBillet();
    hideOverlay();
    ensureAudio();
  }

  function strike() {
    if (phase !== 'forge' || cooldown > 0) return;
    cooldown = STRIKE_CD;
    hammerT = 1;
    shake = 1;

    const acc = accuracyOf(cursor);
    const g = layout();
    const hitY = g.bladeTop + (g.guardY - g.bladeTop) * (0.25 + Math.random() * 0.5);
    spawnSparks(g.cx, hitY, acc === 'perfect' ? 26 : acc === 'good' ? 16 : 9, acc);
    sfxStrike(acc);
    buzz(acc === 'perfect' ? [16, 30, 16] : 12);

    // 先加过载，再按新过载判定碎裂 —— 界面上显示的「碎裂风险」就是你此刻下手会承担的概率
    load = Math.min(100, load + loadGain(acc));
    const risk = riskNow();

    if (Math.random() < risk) {
      shatter(acc);
      return;
    }

    const gain = valueGain(acc, strikes);
    value += gain;
    strikes += 1;
    if (value > bestSword) bestSword = value;

    spawnFloat(g.cx + (Math.random() - 0.5) * 40, hitY - 12, '+' + gain,
      acc === 'perfect' ? '#fff0b8' : acc === 'good' ? '#ffc957' : '#c9a98e');

    if (tranceLeft > 0) {
      tranceLeft -= 1;
      if (tranceLeft === 0) {
        charge = 0;
        setHint('入神结束', false);
      } else {
        setHint(ACC[acc].label + ' · 入神 ' + tranceLeft, false);
      }
    } else {
      charge = clamp(charge + ACC[acc].charge, 0, CHARGE_MAX);
      if (charge >= CHARGE_MAX) {
        tranceLeft = TRANCE_LEN + (has('charm') ? 3 : 0);
        sfxCoin();
        setHint('入神！', false);
      } else {
        setHint(ACC[acc].label, false);
      }
    }

    valueEl.classList.remove('bump');
    void valueEl.offsetWidth;
    valueEl.classList.add('bump');
    hintTimer = 620;
    updateHud();
  }

  function shatter(acc) {
    const g = layout();
    shake = 1.8;
    sfxShatter();
    buzz([40, 60, 90]);
    spawnSparks(g.cx, (g.bladeTop + g.guardY) / 2, 40, 'perfect');
    spawnFloat(g.cx, (g.bladeTop + g.guardY) / 2, '碎裂', '#ff5a45');

    if (has('revive') && !usedRevive) {
      usedRevive = true;
      const kept = Math.round(value * 0.4);
      value = kept;
      load = Math.max(0, load - 28);
      phase = 'idle';                 // 先停住光标，避免遮罩后面还在跑
      updateHud();
      showOverlay({
        title: '复燃符生效',
        bad: true,
        text: '剑身碎裂的瞬间，符纸燃起护住了剑心。<br>保留价值 <b>' + kept + '</b>，过载回落',
        btn: '继续锻打',
        onBtn: () => { phase = 'forge'; hideOverlay(); previewHint(); },
      });
      return;
    }

    phase = 'idle';
    anger = Math.min(MAX_ANGER, anger + 1);
    renderPips();
    sfxRoar();
    updateHud();

    if (anger >= MAX_ANGER) {
      gameOver('剑坯在你手中崩裂，巨龙失去了耐心。');
      return;
    }

    showOverlay({
      title: '剑坯碎裂',
      bad: true,
      text: '过载到 <b>' + Math.round(load) + '%</b>，整块剑坯炸成了碎片。<br>价值 <b>' + fmt(value) + '</b> 归零，巨龙记下了这一次。<br><em>龙怒 ' + anger + ' / ' + MAX_ANGER + '</em>',
      btn: '重新取坯',
      onBtn: () => {
        newBillet();
        hideOverlay();
      },
    });
  }

  function submit() {
    if (phase !== 'forge') return;
    const q = quotaFor(round);
    const ok = value >= q;

    if (ok) {
      gold += value;
      updateHud();               // 必须刷新：否则交贡后金币数字不更新，要等下一次操作才跳变
      sfxCoin();
      buzz(20);
      phase = 'shop';
      showOverlay({
        title: '贡品达成',
        text: '上交价值 <b>' + fmt(value) + '</b> 的长剑，巨龙满意地收下了。<br>获得金币 <b>' + fmt(value) + '</b>',
        btn: '继续',
        onBtn: () => openShop(),
      });
    } else {
      gold += Math.floor(value * 0.4);
      anger = Math.min(MAX_ANGER, anger + 1);
      renderPips();
      sfxRoar();
      phase = 'idle';
      updateHud();
      if (anger >= MAX_ANGER) {
        gameOver('连续拿不出像样的贡品，巨龙不再给你机会。');
        return;
      }
      showOverlay({
        title: '巨龙不悦',
        bad: true,
        text: '这把剑只值 <b>' + fmt(value) + '</b>，远低于要求的 <b>' + fmt(q) + '</b>。<br>巨龙收走了残次品，只留下 <b>' + fmt(Math.floor(value * 0.4)) + '</b> 金币。<br><em>龙怒 ' + anger + ' / ' + MAX_ANGER + '</em>',
        btn: '继续',
        onBtn: () => openShop(),
      });
    }
  }

  function openShop() {
    shopBought = new Set();
    if (!RELICS.some((r) => !owned.has(r.id))) {
      nextRound();
      return;
    }
    phase = 'shop';
    renderShop();
    showOverlay({
      title: '遗物',
      text: '金币 <b id="shopGold">' + fmt(gold) + '</b> · 挑选一件带走，或直接进入下一轮',
      btn: '进入第 ' + (round + 1) + ' 轮',
      relics: true,
      onBtn: () => nextRound(),
    });
  }

  // 已买下的留在列表里显示「已拥有」，而不是直接消失——否则玩家看不到购买确认
  function renderShop() {
    relicsEl.innerHTML = '';
    RELICS
      .filter((r) => !owned.has(r.id) || shopBought.has(r.id))
      .slice(0, 4)
      .forEach((r) => {
        const isOwned = owned.has(r.id);
        const affordable = !isOwned && gold >= r.cost;
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'relic' + (isOwned ? ' is-owned' : affordable ? '' : ' is-poor');
        el.innerHTML =
          '<span class="relic__icon">' + r.icon + '</span>' +
          '<span class="relic__body">' +
          '<span class="relic__name">' + r.name + '</span>' +
          '<span class="relic__desc">' + r.desc + '</span>' +
          '</span>' +
          '<span class="relic__cost">' + (isOwned ? '已拥有' : r.cost) + '</span>';
        if (!isOwned) {
          el.addEventListener('click', () => {
            if (gold < r.cost) return;
            gold -= r.cost;
            owned.add(r.id);
            shopBought.add(r.id);
            sfxCoin();
            buzz(14);
            updateHud();
            const gEl = document.getElementById('shopGold');
            if (gEl) gEl.textContent = fmt(gold);
            renderShop();
          });
        }
        relicsEl.appendChild(el);
      });
  }

  function nextRound() {
    round += 1;
    newBillet();
    hideOverlay();
    updateHud();
  }

  function gameOver(reason) {
    phase = 'over';
    if (round > best) {
      best = round;
      save(STORE_BEST, best);
    }
    showOverlay({
      title: '巨龙之怒',
      bad: true,
      text: reason + '<br><br>坚持到第 <b>' + round + '</b> 轮<br>最贵的一把剑价值 <b>' + fmt(bestSword) + '</b><br>历史最远回合 <b>' + best + '</b>',
      btn: '重新开始',
      onBtn: () => {
        startRun();
      },
    });
  }

  /* ================= 遮罩 ================= */
  function showOverlay(opt) {
    ovTitle.textContent = opt.title || '';
    ovTitle.classList.toggle('is-bad', !!opt.bad);
    ovText.innerHTML = opt.text || '';
    ovBtn.textContent = opt.btn || '继续';
    relicsEl.hidden = !opt.relics;
    if (!opt.relics) relicsEl.innerHTML = '';
    overlay.hidden = false;
    ovBtn.onclick = () => { if (opt.onBtn) opt.onBtn(); };
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  /* ================= 主循环 ================= */
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    clock += dt * 1000;

    if (cooldown > 0) cooldown -= dt * 1000;
    if (hintTimer > 0) {
      hintTimer -= dt * 1000;
      if (hintTimer <= 0) previewHint();
    }
    shake = Math.max(0, shake - dt * 6);

    // 锤子回落
    if (hammerT > 0) {
      hammerT -= dt * 6.5;
      if (hammerT < 0) hammerT = 0;
    }

    if (phase === 'forge') {
      cursor += cursorDir * cursorSpeed() * dt;
      if (cursor >= 1) { cursor = 1; cursorDir = -1; }
      if (cursor <= 0) { cursor = 0; cursorDir = 1; }
      cursorEl.style.transform = 'translateX(' + (cursor * trackW).toFixed(1) + 'px)';
    }

    render(dt);
  }

  /* ================= 输入 ================= */
  function strikeHandler(e) {
    if (e) e.preventDefault();
    strike();
  }

  function bindInput() {
    btnStrike.addEventListener('pointerdown', strikeHandler);
    timingEl.addEventListener('pointerdown', strikeHandler);
    btnSubmit.addEventListener('click', (e) => {
      e.preventDefault();
      submit();
    });
    btnSound.addEventListener('click', () => {
      soundOn = !soundOn;
      save(STORE_SOUND, soundOn ? 'on' : 'off');
      syncSound();
      if (soundOn) { ensureAudio(); tone(720, 0.09, 'triangle', 0.05); }
    });
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (overlay.hidden) strike();
        else ovBtn.click();
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        submit();
      }
    });
    document.addEventListener('visibilitychange', () => {
      lastTs = 0;
    });
  }

  function syncSound() {
    btnSound.textContent = soundOn ? '🔊' : '🔇';
    btnSound.dataset.off = soundOn ? 'false' : 'true';
    btnSound.setAttribute('aria-label', soundOn ? '关闭音效' : '开启音效');
  }

  /* ================= 启动 ================= */
  function init() {
    renderPips();
    updateHud();
    layoutZones();
    syncSound();
    bindInput();

    if ('ResizeObserver' in window) {
      new ResizeObserver(resize).observe(wrap);
    } else {
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', resize);
    }
    resize();
    rebuildCracks();
    previewHint();
    requestAnimationFrame(loop);

    showOverlay({
      title: '龙炉 · 铸剑纳贡',
      text: '巨龙把你锁在炉边，要你按时交出够值钱的长剑。<br>'
        + '光标进入 <em>亮区</em> 时敲击，越准越值钱；<br>'
        + '但每敲一锤都会抬高 <em>过载</em>，剑坯碎裂就一无所有。<br>'
        + '见好就收，还是再来一锤？',
      btn: '开始锻造',
      onBtn: () => startRun(),
    });

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => { /* 离线能力可选 */ });
      });
    }
  }

  init();
})();
