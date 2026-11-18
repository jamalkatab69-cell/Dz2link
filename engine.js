/* ==========================================================
   engine.js — منطق اللعبة فقط (بدون رسم وبدون DOM)
   - الطريق مسارين: أيمن وأيسر. الكرة لا تخرج من الطريق أبدًا.
   - لمسة واحدة تنقل الكرة من مسار إلى الآخر.
   - الطريق والمثلثات ثابتة، والكرة هي التي تجري.
   ========================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CFG = {
    DS: 0.5,              // المسافة بين نقاط الطريق
    halfWidth: 1.5,       // نصف عرض الطريق (كل مسار عرضه 1.5)
    laneOffset: 0.75,     // بعد مركز كل مسار عن منتصف الطريق
    laneSmooth: 13,       // سرعة الانتقال بين المسارين
    ballRadius: 0.75,     // نصف الطريق (عرض الطريق 3) — للرسم
    hitRadius: 0.5,       // نصف قطر الاصطدام
    speedStart: 9,
    speedGrow: 0.2,       // كل دفعة تضاف 0.2× إلى السرعة (تراكميًا، بلا سقف)
    speedEvery: 15,       // الدفعة تتكرر كل 15 مثلثًا
    speedEase: 4,         // نعومة الانتقال إلى السرعة الجديدة
    maxStepDist: 0.35,    // أقصى مسافة تقطعها الكرة في خطوة فحص واحدة (لمنع المرور من خلال المثلثات)
    safeStart: 60,        // طريق بلا مثلثات في البداية
    spikeRadius: 0.7,     // نصف قطر المثلث للاصطدام
    spikeHeight: 2.3,
    spikeHalfWidth: 0.68,
    spikeThickness: 0.17,
    lookAhead: 170,       // كم نولّد من الطريق أمام الكرة
    colorEvery: 15        // يتغير اللون كل 15 مثلثًا
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const kMax = (s) => 0.028 + 0.05 * Math.min(1, s / 1800);
  const spacing = (s) => Math.max(13, 20 - s / 200);
  // السرعة تتضاعف ×1.2 كل 15 مثلثًا إلى ما لا نهاية
  const speedAt = (score) => CFG.speedStart * Math.pow(1 + CFG.speedGrow, Math.floor(score / CFG.speedEvery));

  /* ---------- بناء الطريق (يتولد تدريجيًا وبعدها لا يتغير) ---------- */
  function createWorld(seed) {
    const w = {
      rng: mulberry32(seed || (Math.random() * 1e9) | 0),
      x: [], z: [], th: [],
      obs: [], gems: [],
      len: 0,
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

      // مثلث جديد: يمين ثم يسار بالتناوب (كل مثلث يسد مسارًا واحدًا)
      if (s >= g.nextObs) {
        g.side = -g.side;
        g.count++;
        const u = g.side * CFG.laneOffset;
        const ang = w.th[i] + g.side * (0.3 + w.rng() * 0.3);
        const px = w.x[i] + Math.cos(w.th[i]) * u;
        const pz = w.z[i] - Math.sin(w.th[i]) * u;
        w.obs.push({ n: g.count, s, u, side: g.side, x: px, z: pz, ang, passed: false });

        // جوهرة في المسار الحر بين مثلثين
        const gap = spacing(s);
        if (w.rng() < 0.6) {
          w.gems.push({ s: s + gap * 0.5, u: -g.side * CFG.laneOffset, got: false, x: 0, z: 0, pending: true });
        }
        g.nextObs = s + gap;
      }
    }
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

  /* نقطة على منتصف الطريق عند المسافة s (مع تدرّج بين النقاط) */
  function pointAt(w, s, out) {
    out = out || {};
    if (s <= 0) { out.x = 0; out.z = s; out.th = 0; return out; }
    const f = s / CFG.DS;
    let i = Math.floor(f);
    if (i > w.len - 2) i = w.len - 2;
    const t = Math.min(1, f - i);
    out.x = w.x[i] + (w.x[i + 1] - w.x[i]) * t;
    out.z = w.z[i] + (w.z[i + 1] - w.z[i]) * t;
    out.th = w.th[i] + (w.th[i + 1] - w.th[i]) * t;
    return out;
  }

  /* ---------- اللاعب ---------- */
  function createPlayer() {
    return {
      s: 0, idx: 0, oi: 0, gi: 0,
      lane: 1,                    // المسار المطلوب: +1 أيمن، -1 أيسر
      u: CFG.laneOffset,          // موضع الكرة الفعلي عرضيًا
      x: CFG.laneOffset, z: 0, phi: 0,
      v: CFG.speedStart, state: 'run', score: 0, gems: 0, time: 0
    };
  }

  /* لمسة واحدة: انقل الكرة إلى المسار الآخر (أو إلى مسار محدد) */
  function switchLane(p, lane) {
    if (p.state !== 'run') return;
    p.lane = lane === undefined ? -p.lane : lane;
  }

  /* الإطار الواحد يُقسَّم إلى خطوات صغيرة، حتى لا تخترق الكرة السريعة المثلثات */
  function step(w, p, dt) {
    const events = [];
    if (p.state !== 'run') return events;

    const target = speedAt(p.score);
    p.v += (target - p.v) * Math.min(1, CFG.speedEase * dt);
    genTo(w, p.s + p.v * dt + CFG.lookAhead);

    const n = Math.min(400, Math.max(1, Math.ceil((p.v * dt) / CFG.maxStepDist)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const ev = stepOnce(w, p, h, events);
      if (p.state !== 'run') break;
    }
    return events;
  }

  const _c = {};
  function stepOnce(w, p, dt, events) {
    const DS = CFG.DS;

    p.time += dt;
    p.s += p.v * dt;
    p.idx = Math.floor(p.s / DS);

    // الانتقال بين المسارين بنعومة (يتسارع مع السرعة كي يبقى التحكم ممكنًا)
    const laneK = CFG.laneSmooth * Math.max(1, p.v / CFG.speedStart);
    p.u += (p.lane * CFG.laneOffset - p.u) * Math.min(1, laneK * dt);

    pointAt(w, p.s, _c);
    p.phi = _c.th;
    p.x = _c.x + Math.cos(_c.th) * p.u;
    p.z = _c.z - Math.sin(_c.th) * p.u;

    // المثلثات
    while (p.oi < w.obs.length && w.obs[p.oi].s < p.s - 8) p.oi++;
    for (let i = p.oi; i < w.obs.length; i++) {
      const o = w.obs[i];
      if (o.s > p.s + 8) break;
      if (Math.hypot(p.x - o.x, p.z - o.z) < CFG.spikeRadius + CFG.hitRadius) {
        p.state = 'crashed';
        events.push('crash');
        return;
      }
      if (!o.passed && p.s > o.s + 0.6) {
        o.passed = true;
        p.score = o.n;
        events.push('pass');
        if (o.n % CFG.colorEvery === 0) events.push('newcolor');
      }
    }

    // الجواهر
    while (p.gi < w.gems.length && w.gems[p.gi].s < p.s - 8) p.gi++;
    for (let i = p.gi; i < w.gems.length; i++) {
      const gm = w.gems[i];
      if (gm.got || gm.pending) continue;
      if (gm.s > p.s + 8) break;
      if (Math.hypot(p.x - gm.x, p.z - gm.z) < 1.0) {
        gm.got = true;
        p.gems++;
        events.push('gem');
      }
    }
  }

  /* ---------- لاعب آلي (للعرض في الخلفية وللاختبار) ---------- */
  function botAct(w, p) {
    let prev = null, next = null;
    for (const o of w.obs) {
      if (o.s <= p.s) prev = o; else { next = o; break; }
    }
    if (!next) return;
    if (next.side === p.lane && next.s - p.s < 12 && (!prev || p.s - prev.s > 2.4)) switchLane(p);
  }

  return { CFG, createWorld, createPlayer, step, switchLane, botAct, pointAt, genTo };
});
