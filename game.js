/* ==========================================================
   game.js — الرسم ثلاثي الأبعاد + اللمس + الواجهة
   (المنطق في engine.js، والرسم هنا على canvas بدون مكتبات)
   ========================================================== */
(() => {
  'use strict';

  const E = Engine;
  const CFG = E.CFG;
  const DS = CFG.DS;

  // ---------- عناصر الصفحة ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = $('score');
  const gemsEl = $('gems');
  const rootStyle = document.documentElement.style;

  // ---------- إعدادات الكاميرا ----------
  const CAM = { back: 5.0, height: 3.0, pitch: 0.55, follow: 4.5, cy: 0.78 };
  const cosT = Math.cos(CAM.pitch), sinT = Math.sin(CAM.pitch);

  // ---------- الحالة ----------
  let W = 0, H = 0, DPR = 1, F = 1;
  let mode = 'menu';            // menu | play | over
  let world, player;
  let particles = [];
  let hueC = 185;               // لون النيون الحالي (يتغير مع التقدم)
  let shake = 0;
  let overTimer = 0;            // مؤقت ظهور شاشة الخسارة
  let overReadyAt = 0;
  let menuReset = 0;
  let sparkT = 0;
  let clock = 0;
  const cam = { x: 0, y: CAM.height, z: -CAM.back, psi: 0 };
  const store = {
    best: Number(localStorage.getItem('abur-best')) || 0,
    gems: Number(localStorage.getItem('abur-gems')) || 0
  };

  // ---------- التحكم ----------
  const debug = { auto: false };
  const pointers = new Map();
  const keys = { left: false, right: false };
  function steerInput() {
    let l = keys.left, r = keys.right;
    pointers.forEach((side) => (side < 0 ? (l = true) : (r = true)));
    return (r ? 1 : 0) - (l ? 1 : 0);
  }
  window.addEventListener('pointerdown', (e) => {
    if (mode === 'play') pointers.set(e.pointerId, e.clientX < W / 2 ? -1 : 1);
  });
  window.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e.clientX < W / 2 ? -1 : 1);
  });
  const lift = (e) => pointers.delete(e.pointerId);
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
    if ((e.key === ' ' || e.key === 'Enter') && mode !== 'play') pressStart();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
  });

  // لمس الشاشات يبدأ اللعب
  $('screenStart').addEventListener('pointerdown', () => pressStart());
  $('screenOver').addEventListener('pointerdown', () => pressStart());

  function pressStart() {
    if (mode === 'over' && clock < overReadyAt) return; // منع الضغط بالخطأ
    startGame();
  }

  // ---------- بدء الألعاب ----------
  function newRun() {
    world = E.createWorld();
    player = E.createPlayer();
    particles = [];
    hueC = 185;
    shake = 0;
    cam.psi = 0;
    cam.x = -Math.sin(0) * CAM.back;
    cam.z = -CAM.back;
  }

  function startGame() {
    newRun();
    mode = 'play';
    pointers.clear();
    $('screenStart').hidden = true;
    $('screenOver').hidden = true;
    scoreEl.hidden = false;
    gemsEl.hidden = false;
    scoreEl.textContent = '0';
    gemsEl.textContent = String(store.gems);
  }

  function showMenu() {
    newRun();
    mode = 'menu';
    menuReset = 0;
    scoreEl.hidden = true;
    gemsEl.hidden = true;
    $('screenOver').hidden = true;
    $('screenStart').hidden = false;
    $('bestStart').textContent = store.best ? `أفضل نتيجة: ${store.best}` : '';
  }

  function verdictFor(n) {
    if (n < 5) return 'حاول مجددًا';
    if (n < 15) return 'بداية جيدة';
    if (n < 30) return 'ليس سيئًا!';
    if (n < 50) return 'فوق المتوسط!';
    if (n < 80) return 'أداء رائع!';
    return 'أسطوري!';
  }

  function finish() {
    if (mode !== 'play') return;
    mode = 'over';
    const n = player.score;
    const isBest = n > store.best;
    if (isBest) { store.best = n; localStorage.setItem('abur-best', String(n)); }
    localStorage.setItem('abur-gems', String(store.gems));
    $('verdict').textContent = isBest && n > 0 ? 'رقم قياسي جديد!' : verdictFor(n);
    $('final').textContent = String(n);
    $('bestOver').textContent = `الأفضل: ${store.best}`;
    $('gemsOver').textContent = `الجواهر: ${store.gems}`;
    scoreEl.hidden = true;
    gemsEl.hidden = true;
    $('screenOver').hidden = false;
    overReadyAt = clock + 0.7;
  }

  // ---------- المقاسات ----------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    F = Math.min(H * 0.9, W * 1.7);
  }

  // ---------- الإسقاط ثلاثي الأبعاد ----------
  let pX = 0, pY = 0, pZ = 0;
  let shX = 0, shY = 0;
  let cP = 1, sP = 0;
  function proj(wx, wy, wz) {
    const rx = wx - cam.x, ry = wy - cam.y, rz = wz - cam.z;
    const xc = rx * cP - rz * sP;
    const zc = rx * sP + rz * cP;
    const yp = ry * cosT + zc * sinT;
    pZ = zc * cosT - ry * sinT;
    const k = F / (pZ > 0.05 ? pZ : 0.05);
    pX = W / 2 + xc * k + shX;
    pY = H * CAM.cy - yp * k + shY;
  }

  // ---------- ألوان النيون ----------
  const hsl = (h, s, l, a) => `hsl(${h % 360} ${s}% ${l}%${a === undefined ? '' : ' / ' + a})`;

  // ---------- رسم الطريق ----------
  const MAXS = 320;
  const SX = new Float32Array(MAXS * 10);
  const SY = new Float32Array(MAXS * 10);
  const SD = new Float32Array(MAXS);
  const OFF = [-1.5 - 0.9, -1.5 - 0.35, -1.5, -1.5 + 0.38, -0.05, 0.05, 1.5 - 0.38, 1.5, 1.5 + 0.35, 1.5 + 0.9];

  function drawTrack(h) {
    const i0 = Math.max(0, player.idx - 16);
    const i1 = Math.min(world.len - 1, player.idx + 236);
    let n = 0;
    for (let i = i0; i <= i1 && n < MAXS; i++) {
      const th = world.th[i];
      const nx = Math.cos(th), nz = -Math.sin(th);
      const cx = world.x[i], cz = world.z[i];
      proj(cx, 0, cz);
      if (pZ < 0.6) continue;
      for (let k = 0; k < 10; k++) {
        proj(cx + nx * OFF[k], 0, cz + nz * OFF[k]);
        SX[n * 10 + k] = pX;
        SY[n * 10 + k] = pY;
      }
      SD[n] = (i - player.idx) * DS;
      n++;
    }
    if (n < 2) return;

    const BAND = 6;
    const bandStarts = [];
    for (let a = 0; a < n - 1; a += BAND) bandStarts.push(a);

    // من الأبعد إلى الأقرب
    for (let bi = bandStarts.length - 1; bi >= 0; bi--) {
      const a = bandStarts[bi];
      const b = Math.min(n - 1, a + BAND);
      const dist = Math.max(0, SD[a]);
      const fog = Math.pow(Math.max(0.03, Math.min(1, 1 - dist / 125)), 1.35);

      fillStrips(a, b, [[0, 2], [7, 9]], hsl(h, 100, 9 * fog));       // توهج واسع
      fillStrips(a, b, [[1, 2], [7, 8]], hsl(h, 100, 24 * fog));      // توهج قريب
      fillStrips(a, b, [[2, 7]], hsl(h, 70, 3.2 * fog));              // سطح الطريق
      fillStrips(a, b, [[2, 3], [6, 7]], hsl(h, 100, 58 * fog));      // حافتا الطريق
      fillStrips(a, b, [[4, 5]], hsl(h, 100, 72 * fog));              // الخط في الوسط
    }
  }

  function fillStrips(a, b, pairs, color) {
    ctx.beginPath();
    for (const [k1, k2] of pairs) {
      ctx.moveTo(SX[a * 10 + k1], SY[a * 10 + k1]);
      for (let j = a + 1; j <= b; j++) ctx.lineTo(SX[j * 10 + k1], SY[j * 10 + k1]);
      for (let j = b; j >= a; j--) ctx.lineTo(SX[j * 10 + k2], SY[j * 10 + k2]);
      ctx.closePath();
    }
    ctx.fillStyle = color;
    ctx.fill();
  }

  // ---------- رسم الكائنات (المثلثات والجواهر والكرة) ----------
  const drawList = [];

  function collectObjects() {
    drawList.length = 0;
    const sBall = player.idx * DS;

    for (const o of world.obs) {
      if (o.s < sBall - 10) continue;
      if (o.s > sBall + 118) break;
      proj(o.x, 0.8, o.z);
      if (pZ < 0.9) continue;
      drawList.push({ z: pZ, x: pX, y: pY, t: 'spike', o });
    }
    for (const g of world.gems) {
      if (g.got || g.pending) continue;
      if (g.s < sBall - 10) continue;
      if (g.s > sBall + 90) break;
      proj(g.x, 0.7, g.z);
      if (pZ < 0.9) continue;
      drawList.push({ z: pZ, x: pX, y: pY, t: 'gem', g });
    }
    for (const p of particles) {
      proj(p.x, p.y, p.z);
      if (pZ < 0.9) continue;
      drawList.push({ z: pZ, x: pX, y: pY, t: 'part', p });
    }
    if (player.state !== 'crashed') {
      proj(player.x, CFG.ballRadius + player.y, player.z);
      drawList.push({ z: pZ, x: pX, y: pY, t: 'ball' });
    }
    drawList.sort((a, b) => b.z - a.z);
  }

  function drawObjects(h) {
    collectObjects();
    for (const d of drawList) {
      if (d.t === 'spike') drawSpike(d.o, h);
      else if (d.t === 'gem') drawGem(d, d.g);
      else if (d.t === 'part') drawParticle(d, d.p);
      else drawBall(d, h);
    }
    ctx.globalAlpha = 1;
  }

  const fogAt = (z) => Math.max(0.05, Math.min(1, 1 - (z - 8) / 115));

  function drawSpike(o, h) {
    const hw = CFG.spikeHalfWidth, th = CFG.spikeThickness, hh = CFG.spikeHeight;
    const xa = Math.cos(o.ang), xz = -Math.sin(o.ang);   // محور العرض
    const za = Math.sin(o.ang), zz = Math.cos(o.ang);    // محور السماكة (اتجاه الطريق)
    const cx = o.x, cz = o.z;
    const V = (sx, sz, y) => {
      proj(cx + xa * hw * sx + za * th * sz, y, cz + xz * hw * sx + zz * th * sz);
      return [pX, pY, pZ];
    };
    const b0 = V(-1, -1, 0), b1 = V(1, -1, 0), b2 = V(1, 1, 0), b3 = V(-1, 1, 0);
    const aF = V(0, -1, hh), aB = V(0, 1, hh);
    const faces = [
      { p: [b0, b1, aF], l: 56, front: true },
      { p: [b3, b2, aB], l: 28 },
      { p: [b0, b3, aB, aF], l: 40 },
      { p: [b1, b2, aB, aF], l: 34 }
    ];
    for (const f of faces) f.z = f.p.reduce((s, q) => s + q[2], 0) / f.p.length;
    faces.sort((a, b) => b.z - a.z);

    const fog = fogAt(faces[faces.length - 1].z);
    ctx.globalAlpha = fog;
    ctx.lineJoin = 'round';
    ctx.shadowColor = hsl(h, 100, 55);
    ctx.shadowBlur = 14 * DPR * fog;
    for (const f of faces) {
      ctx.beginPath();
      ctx.moveTo(f.p[0][0], f.p[0][1]);
      for (let i = 1; i < f.p.length; i++) ctx.lineTo(f.p[i][0], f.p[i][1]);
      ctx.closePath();
      ctx.fillStyle = hsl(h, 100, f.l);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hsl(h, 100, 78, 0.8);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (f.front) {
        // الرقم على وجه المثلث
        const tx = (b0[0] + b1[0] + aF[0]) / 3, ty = (b0[1] + b1[1] + aF[1]) / 3 + 4;
        const size = Math.max(8, (0.5 * F) / f.z);
        ctx.fillStyle = 'rgba(0, 0, 30, 0.38)';
        ctx.font = `700 ${size}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(o.n), tx, ty);
      }
    }
    ctx.shadowBlur = 0;
  }

  function drawGem(d, g) {
    const bob = (Math.sin(clock * 3 + g.s) * 0.08 * F) / d.z;
    const gx = d.x, gy = d.y + bob;
    const r = (0.3 * F) / d.z;
    const squash = 0.25 + 0.75 * Math.abs(Math.cos(clock * 2.4 + g.s));
    ctx.globalAlpha = fogAt(d.z);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      const x = gx + Math.cos(a) * r * squash, y = gy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawParticle(d, p) {
    const pX = d.x, pY = d.y, pZ = d.z;
    const r = Math.max(1, (p.size * F) / pZ);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(pX, pY - r);
    ctx.lineTo(pX + r, pY);
    ctx.lineTo(pX, pY + r);
    ctx.lineTo(pX - r, pY);
    ctx.closePath();
    ctx.fill();
  }

  function drawBall(d, h) {
    const pX = d.x, pY = d.y, pZ = d.z;
    const r = (CFG.ballRadius * F) / pZ;
    ctx.globalAlpha = 1;
    ctx.shadowColor = hsl(h, 100, 55);
    ctx.shadowBlur = 34 * DPR;
    ctx.fillStyle = hsl(h, 100, 56);
    ctx.beginPath();
    ctx.arc(pX, pY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    const g = ctx.createRadialGradient(pX - r * 0.35, pY - r * 0.4, r * 0.1, pX, pY, r);
    g.addColorStop(0, hsl(h, 100, 82, 0.55));
    g.addColorStop(1, hsl(h, 100, 50, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pX, pY, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------- جسيمات ----------
  function burst(x, y, z, count, h, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.6;
      const sp = speed * (0.3 + Math.random());
      particles.push({
        x, y, z,
        vx: Math.cos(a) * sp, vy: 1 + Math.random() * sp * e, vz: Math.sin(a) * sp,
        life: 0.6 + Math.random() * 0.7,
        size: 0.05 + Math.random() * 0.07,
        color: Math.random() < 0.7 ? '#ffffff' : hsl(h, 100, 65)
      });
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vy -= 9 * dt;
      p.life -= dt;
      if (p.y < 0) { p.y = 0; p.vy *= -0.3; }
    }
    particles = particles.filter((p) => p.life > 0);
  }

  // ---------- تحديث ----------
  function handleEvents(events) {
    for (const ev of events) {
      if (ev === 'pass') {
        scoreEl.textContent = String(player.score);
      } else if (ev === 'gem') {
        store.gems++;
        gemsEl.textContent = String(store.gems);
        burst(player.x, 0.6, player.z, 14, hueC, 3);
      } else if (ev === 'crash') {
        burst(player.x, 0.5, player.z, 46, hueC, 7);
        shake = 0.5;
        if (navigator.vibrate) navigator.vibrate(90);
        overTimer = 0.65;
      } else if (ev === 'fall') {
        if (navigator.vibrate) navigator.vibrate(40);
      } else if (ev === 'dead') {
        finish();
      }
    }
  }

  function update(dt) {
    clock += dt;

    if (mode === 'play') {
      handleEvents(E.step(world, player, dt, debug.auto ? E.botSteer(world, player) : steerInput()));
      if (player.state === 'crashed' && overTimer > 0) {
        overTimer -= dt;
        if (overTimer <= 0) finish();
      }
    } else if (mode === 'menu') {
      // لاعب آلي يعرض اللعبة خلف شاشة البداية
      E.step(world, player, dt, E.botSteer(world, player));
      if (player.state !== 'run') {
        menuReset += dt;
        if (menuReset > 1.1) { newRun(); menuReset = 0; }
      }
    } else {
      E.step(world, player, dt, 0); // استمرار السقوط
    }

    // ظهور جسيمات خلف الكرة أثناء الجري
    if (player.state === 'run') {
      sparkT -= dt;
      if (sparkT <= 0) {
        sparkT = 0.07;
        particles.push({
          x: player.x + (Math.random() - 0.5) * 0.4, y: 0.2, z: player.z,
          vx: (Math.random() - 0.5) * 1.5 - Math.sin(player.phi) * 3, vy: 1 + Math.random() * 1.5,
          vz: (Math.random() - 0.5) * 1.5 - Math.cos(player.phi) * 3,
          life: 0.5, size: 0.035, color: '#ffffff'
        });
      }
    }
    updateParticles(dt);

    // لون النيون يتبع التقدم
    const hueT = 185 + player.score * 3.5;
    hueC += (hueT - hueC) * Math.min(1, dt * 1.6);
    rootStyle.setProperty('--c', hsl(hueC, 100, 58));
    rootStyle.setProperty('--cs', hsl(hueC, 100, 58, 0.55));

    // الكاميرا تلحق بالكرة
    if (player.state === 'run') {
      cam.psi += (player.phi - cam.psi) * Math.min(1, CAM.follow * dt);
      cam.x = player.x - Math.sin(cam.psi) * CAM.back;
      cam.z = player.z - Math.cos(cam.psi) * CAM.back;
    }
    cam.y = CAM.height;
    cP = Math.cos(cam.psi);
    sP = Math.sin(cam.psi);

    shake = Math.max(0, shake - dt * 1.6);
    shX = (Math.random() - 0.5) * shake * 26;
    shY = (Math.random() - 0.5) * shake * 26;
  }

  // ---------- الرسم ----------
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const h = hueC % 360;
    drawTrack(h);
    drawObjects(h);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- تشغيل ----------
  resize();
  window.addEventListener('resize', resize);
  showMenu();
  requestAnimationFrame(frame);

  // للاختبار اليدوي من وحدة التحكم
  window.__abur = { get player() { return player; }, get world() { return world; }, startGame, debug };
})();
