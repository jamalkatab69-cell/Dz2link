/* ==========================================================
   engine.js — منطق اللعبة فقط (بدون رسم وبدون DOM)
   الطريق والمثلثات ثابتة في العالم، والكرة هي التي تجري.
   ========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CFG = {
    DS: 0.5,              // المسافة بين نقاط الطريق
    halfWidth: 1.5,       // نصف عرض الطريق
    ballRadius: 0.4,
    turnRate: 1.7,        // سرعة دوران الكرة (راديان/ثانية) عند اللمس
    turnSmooth: 12,
    speedStart: 9,
    speedMax: 16,
    speedRamp: 220,       // كل كم وحدة تزيد السرعة وحدة واحدة
    safeStart: 60,        // طريق مستقيم بلا عوائق في البداية
    spikeRadius: 0.7,     // نصف قطر المثلث للاصطدام
    spikeHeight: 2.3,
    spikeHalfWidth: 0.75,
    spikeThickness: 0.17,
    edgeTolerance: 0.08,  // سماح بسيط قبل السقوط من الحافة
    lookAhead: 170        // كم نولّد من الطريق أمام الكرة
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const kMax = (s) => 0.028 + 0.062 * Math.min(1, s / 1800);
  const spacing = (s) => Math.max(11, 19 - s / 190);
  const speedAt = (s) => CFG.speedStart + Math.min(CFG.speedMax - CFG.speedStart, s / CFG.speedRamp);

  /* ---------- بناء الطريق (يتولد تدريجيًا وبعدها لا يتغير) ---------- */
  function createWorld(seed) {
    const w = {
      rng: mulberry32(seed || (Math.random() * 1e9) | 0),
      x: [], z: [], th: [],
      obs: [], gems: [],
      len: 0,                 // عدد النقاط
      g: { x: 0, z: 0, th: 0, k: 0, kt: 0, seg: 0, nextObs: CFG.safeStart, side: 0, count: 0 }
    };
    w.g.side = w.rng() < 0.5 ? -1 : 1;
    genTo(w, CFG.lookAhead + 40);
    return w;
  }

  function genTo(w, sTarget) {
    const g = w.g, DS = CFG.DS;
    while (w.len * DS < sTarget) {
      const i = w.len, s = i * DS;
      w.x.push(g.x); w.z.push(g.z); w.th.push(g.th);
      w.len++;

      // مقاطع منحنية متغيرة
      if (s > 40) {
        g.seg -= DS;
        if (g.seg <= 0) {
          g.seg = 14 + w.rng() * 26;
          g.kt = w.rng() < 0.22 ? 0 : (w.rng() * 2 - 1) * kMax(s);
        }
        g.k += (g.kt - g.k) * 0.05;
      }
      g.th += g.k * DS;
      g.x += Math.sin(g.th) * DS;
      g.z += Math.cos(g.th) * DS;

      // مثلث جديد: يمين ثم يسار بالتناوب
      if (s >= g.nextObs) {
        g.side = -g.side;
        g.count++;
        const u = g.side * (0.55 + w.rng() * 0.25);
        const delta = g.side * (0.35 + w.rng() * 0.3);
        const ang = w.th[i] + delta;
        const px = w.x[i] + Math.cos(w.th[i]) * u;
        const pz = w.z[i] - Math.sin(w.th[i]) * u;
        w.obs.push({ n: g.count, s, u, side: g.side, x: px, z: pz, ang, passed: false });

        // جوهرة في الممر الحر بين مثلثين
        const gap = spacing(s);
        if (w.rng() < 0.6) {
          const gs = s + gap * 0.5;
          w.gems.push({ s: gs, u: -g.side * (0.2 + w.rng() * 0.6), got: false, x: 0, z: 0, pending: true });
        }
        g.nextObs = s + gap;
      }
    }
    // احسب مواقع الجواهر بعد توفر نقاط الطريق
    for (const gm of w.gems) {
      if (!gm.pending) continue;
      const j = Math.round(gm.s / DS);
      if (j < w.len) {
        gm.x = w.x[j] + Math.cos(w.th[j]) * gm.u;
        gm.z = w.z[j] - Math.sin(w.th[j]) * gm.u;
        gm.pending = false;
      }
    }
  }

  /* ---------- اللاعب ---------- */
  function createPlayer() {
    return {
      x: 0, z: 0, y: 0, vy: 0, phi: 0, omega: 0, v: CFG.speedStart,
      idx: 0, u: 0, state: 'run', score: 0, gems: 0, time: 0
    };
  }

  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  function step(w, p, dt, steer) {
    const events = [];
    const DS = CFG.DS;

    if (p.state === 'run') {
      p.time += dt;
      const target = steer * CFG.turnRate;
      p.omega += (target - p.omega) * Math.min(1, CFG.turnSmooth * dt);
      p.phi += p.omega * dt;
      p.v = speedAt(p.idx * DS);
      p.x += Math.sin(p.phi) * p.v * dt;
      p.z += Math.cos(p.phi) * p.v * dt;
    } else if (p.state === 'falling') {
      p.vy -= 22 * dt;
      p.y += p.vy * dt;
      p.x += Math.sin(p.phi) * p.v * 0.7 * dt;
      p.z += Math.cos(p.phi) * p.v * 0.7 * dt;
      if (p.y < -9) { p.state = 'dead'; events.push('dead'); }
      return events;
    } else {
      return events;
    }

    // أقرب نقطة على الطريق
    let best = p.idx, bd = Infinity;
    const lo = Math.max(0, p.idx - 6), hi = Math.min(w.len - 1, p.idx + 40);
    for (let i = lo; i <= hi; i++) {
      const dx = p.x - w.x[i], dz = p.z - w.z[i];
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    p.idx = best;
    p.u = (p.x - w.x[best]) * Math.cos(w.th[best]) - (p.z - w.z[best]) * Math.sin(w.th[best]);
    const sBall = p.idx * DS;
    genTo(w, sBall + CFG.lookAhead);

    // سقوط من حافة الطريق
    if (Math.abs(p.u) > CFG.halfWidth + CFG.edgeTolerance) {
      p.state = 'falling';
      p.vy = 0;
      events.push('fall');
      return events;
    }

    // المثلثات
    for (const o of w.obs) {
      if (o.s < sBall - 8) continue;
      if (o.s > sBall + 8) break;
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      if (d < CFG.spikeRadius + CFG.ballRadius * 0.85) {
        p.state = 'crashed';
        events.push('crash');
        return events;
      }
      if (!o.passed && sBall > o.s + 0.6) {
        o.passed = true;
        p.score = o.n;
        events.push('pass');
      }
    }

    // الجواهر
    for (const gm of w.gems) {
      if (gm.got || gm.pending) continue;
      if (gm.s < sBall - 8) continue;
      if (gm.s > sBall + 8) break;
      if (Math.hypot(p.x - gm.x, p.z - gm.z) < 0.85) {
        gm.got = true;
        p.gems++;
        events.push('gem');
      }
    }
    return events;
  }

  /* ---------- لاعب آلي (للعرض في الخلفية وللاختبار) ---------- */
  function botSteer(w, p) {
    const DS = CFG.DS;
    const sBall = p.idx * DS;
    let uT = 0;
    for (const o of w.obs) {
      if (o.s < sBall - 2.5) continue;
      if (o.s - sBall < 20) uT = -o.side * 0.75;
      break;
    }
    const th = w.th[p.idx];
    const rel = wrap(p.phi - th);
    const want = Math.max(-0.4, Math.min(0.4, (uT - p.u) * 0.5));
    // الطريق ينحني: نحتاج أيضًا أن نتبع تغيّر اتجاهه
    const iA = Math.min(p.idx + 6, w.len - 1);
    const follow = wrap(w.th[iA] - th);
    const err = wrap(th + want + follow - p.phi);
    return Math.abs(err) < 0.03 ? 0 : (err > 0 ? 1 : -1);
  }

  return { CFG, createWorld, createPlayer, step, botSteer, genTo };
});
