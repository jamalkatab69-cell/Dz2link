/* ==========================================================
   عبور — لعبة الكرة والمثلثات
   - الطريق والمثلثات ثابتة في العالم، والكرة هي التي تجري وتتخطاها.
   - الكاميرا تتبع الكرة فقط، والفيديو ثابت في الخلفية.
   - التحكم: المس يسار الشاشة = يسارًا، المس يمينها = يمينًا.
     (على الكمبيوتر: الأسهم أو A / D)
   ========================================================== */
(() => {
  'use strict';

  // ---------- الإعدادات (عدّلها كما تحب) ----------
  const CFG = {
    roadWidth: 320,        // عرض الطريق (وحدات العالم)
    roadLength: 9000,      // طول الطريق حتى خط النهاية
    ballRadius: 13,
    speedStart: 230,       // سرعة الجري في البداية
    speedEnd: 290,         // سرعة الجري قرب النهاية
    lateralSpeed: 270,     // سرعة الحركة يمينًا ويسارًا
    steerSmoothing: 12,    // نعومة تغيّر الاتجاه
    firstTriangleY: 700,   // موضع أول مثلث
    spacingStart: 380,     // المسافة بين المثلثات في البداية
    spacingEnd: 290,       // المسافة بين المثلثات في النهاية
    triDepthMin: 0.50,     // أقل بروز للمثلث (نسبة من عرض الطريق)
    triDepthMax: 0.64,     // أكبر بروز للمثلث
    triHeightMin: 95,      // أقل ارتفاع للمثلث
    triHeightMax: 125,     // أكبر ارتفاع للمثلث
    hitForgiveness: 0.88,  // تسامح بسيط في الاصطدام
    ballScreenY: 0.72      // موضع الكرة من أعلى الشاشة
  };

  const COLORS = {
    road: 'rgba(8, 10, 22, 0.74)',
    edge: '#3ee6ff',
    center: 'rgba(255, 255, 255, 0.55)',
    tri: '#ff6b35',
    triEdge: '#ffd2b8',
    ball: '#ffffff',
    glow: '#3ee6ff'
  };

  // ---------- عناصر الصفحة ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const video = $('bg');
  const hud = $('hud');
  const barFill = $('barFill');
  const pctEl = $('pct');
  const screens = { start: $('screenStart'), over: $('screenOver'), win: $('screenWin') };

  // ---------- الحالة ----------
  let state = 'ready'; // ready | playing | crashed | won
  let W = 0, H = 0, DPR = 1, S = 1; // أبعاد الشاشة والمقياس
  let triangles = [];
  const ball = { x: 0, y: 0, vx: 0 };
  let trail = [];
  let particles = [];
  let elapsed = 0;
  let flash = 0;
  let lastTime = 0;
  let bestTime = Number(localStorage.getItem('abur-best')) || 0;

  const input = { left: false, right: false, pointers: new Map() };

  // ---------- 3) بناء المثلثات: يمين/يسار بالتناوب وثابتة ----------
  // قيمة شبه عشوائية ثابتة (نفس المثلثات في كل مرة)
  const hash = (n) => {
    const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return v - Math.floor(v);
  };

  function buildLevel() {
    triangles = [];
    let y = CFG.firstTriangleY;
    let side = -1; // -1 يسار، +1 يمين
    let i = 0;
    while (y < CFG.roadLength - 600) {
      const t = y / CFG.roadLength;
      triangles.push({
        side,
        y,
        h: CFG.triHeightMin + (CFG.triHeightMax - CFG.triHeightMin) * hash(i + 1),
        depth: CFG.roadWidth * (CFG.triDepthMin + (CFG.triDepthMax - CFG.triDepthMin) * hash(i + 50))
      });
      side = -side; // لا يكون مثلثان في نفس الجهة متتاليين
      y += CFG.spacingStart + (CFG.spacingEnd - CFG.spacingStart) * t;
      i++;
    }
  }

  // رؤوس المثلث في العالم: قاعدته على حافة الطريق ورأسه إلى الداخل
  function triVerts(tr) {
    const hw = CFG.roadWidth / 2;
    const wallX = tr.side * hw;
    return [
      { x: wallX, y: tr.y },
      { x: wallX, y: tr.y + tr.h },
      { x: wallX - tr.side * tr.depth, y: tr.y + tr.h / 2 }
    ];
  }

  // ---------- الاصطدام: دائرة مع مثلث ----------
  function distToSegment(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  function pointInTriangle(px, py, [a, b, c]) {
    const s1 = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    const s2 = (c.x - b.x) * (py - b.y) - (c.y - b.y) * (px - b.x);
    const s3 = (a.x - c.x) * (py - c.y) - (a.y - c.y) * (px - c.x);
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  }

  function hitsTriangle(tr) {
    const v = triVerts(tr);
    const r = CFG.ballRadius * CFG.hitForgiveness;
    if (pointInTriangle(ball.x, ball.y, v)) return true;
    return (
      distToSegment(ball.x, ball.y, v[0], v[1]) < r ||
      distToSegment(ball.x, ball.y, v[1], v[2]) < r ||
      distToSegment(ball.x, ball.y, v[2], v[0]) < r
    );
  }

  // ---------- المقاسات ----------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    S = Math.min((W * 0.84) / CFG.roadWidth, H / 560, 2.4);
  }

  // العالم -> الشاشة (الكاميرا تتبع الكرة فقط)
  const sx = (wx) => W / 2 + wx * S;
  const sy = (wy) => H * CFG.ballScreenY - (wy - ball.y) * S;

  // ---------- التحكم باللمس ----------
  function updateInputFromPointers() {
    let l = false, r = false;
    input.pointers.forEach((side) => (side < 0 ? (l = true) : (r = true)));
    input.left = l || keys.left;
    input.right = r || keys.right;
  }
  const keys = { left: false, right: false };

  const stage = document.body;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    input.pointers.set(e.pointerId, e.clientX < W / 2 ? -1 : 1);
    updateInputFromPointers();
  });
  stage.addEventListener('pointermove', (e) => {
    if (input.pointers.has(e.pointerId)) {
      input.pointers.set(e.pointerId, e.clientX < W / 2 ? -1 : 1);
      updateInputFromPointers();
    }
  });
  const release = (e) => {
    input.pointers.delete(e.pointerId);
    updateInputFromPointers();
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
    if ((e.key === ' ' || e.key === 'Enter') && state !== 'playing') startGame();
    updateInputFromPointers();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
    updateInputFromPointers();
  });

  // ---------- مجرى اللعبة ----------
  const fmt = (s) => s.toFixed(1) + ' ث';

  function showScreen(name) {
    Object.entries(screens).forEach(([k, el]) => (el.hidden = k !== name));
  }

  function startGame() {
    video.play().catch(() => {}); // بعض المتصفحات تحتاج لمسة لتشغيل الفيديو
    ball.x = 0;
    ball.y = 0;
    ball.vx = 0;
    trail = [];
    particles = [];
    elapsed = 0;
    flash = 0;
    showScreen(null);
    hud.hidden = false;
    state = 'playing';
    lastTime = performance.now();
  }

  function crash() {
    state = 'crashed';
    flash = 1;
    if (navigator.vibrate) navigator.vibrate(120);
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 220;
      particles.push({
        x: ball.x, y: ball.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.7 + Math.random() * 0.5
      });
    }
    const pct = Math.min(100, Math.floor((ball.y / CFG.roadLength) * 100));
    $('overText').textContent = `وصلت إلى ${pct}% من الطريق.`;
    setTimeout(() => {
      if (state === 'crashed') showScreen('over');
    }, 650);
  }

  function win() {
    state = 'won';
    if (!bestTime || elapsed < bestTime) {
      bestTime = elapsed;
      localStorage.setItem('abur-best', String(bestTime));
    }
    $('winText').textContent = `وقتك ${fmt(elapsed)} — أفضل وقت ${fmt(bestTime)}`;
    showScreen('win');
  }

  function update(dt) {
    if (state === 'playing') {
      elapsed += dt;
      const t = Math.min(1, ball.y / CFG.roadLength);
      const speed = CFG.speedStart + (CFG.speedEnd - CFG.speedStart) * t;

      // الكرة تجري للأمام، واللمس يغيّر اتجاهها يمينًا أو يسارًا
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      ball.vx += (dir * CFG.lateralSpeed - ball.vx) * Math.min(1, CFG.steerSmoothing * dt);
      ball.x += ball.vx * dt;
      ball.y += speed * dt;

      // حدود الطريق
      const limit = CFG.roadWidth / 2 - CFG.ballRadius;
      if (ball.x > limit) { ball.x = limit; ball.vx = 0; }
      if (ball.x < -limit) { ball.x = -limit; ball.vx = 0; }

      trail.push({ x: ball.x, y: ball.y });
      if (trail.length > 16) trail.shift();

      for (const tr of triangles) {
        if (Math.abs(tr.y - ball.y) > 220) continue;
        if (hitsTriangle(tr)) { crash(); break; }
      }

      if (state === 'playing' && ball.y >= CFG.roadLength) win();

      const pct = Math.min(100, Math.floor((ball.y / CFG.roadLength) * 100));
      barFill.style.width = pct + '%';
      pctEl.textContent = pct + '%';
    }

    // شظايا الاصطدام
    particles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.life -= dt;
    });
    particles = particles.filter((p) => p.life > 0);
    flash = Math.max(0, flash - dt * 2.2);
  }

  // ---------- الرسم ----------
  function drawRoad() {
    const hw = (CFG.roadWidth / 2) * S;
    const x0 = W / 2 - hw;
    const top = 0, bottom = H;

    // 2) الطريق الطويل
    ctx.fillStyle = COLORS.road;
    ctx.fillRect(x0, top, hw * 2, bottom - top);

    // حافتا الطريق
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 3;
    ctx.shadowColor = COLORS.edge;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(x0, top); ctx.lineTo(x0, bottom);
    ctx.moveTo(x0 + hw * 2, top); ctx.lineTo(x0 + hw * 2, bottom);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // الخط الذي في الوسط (متقطع وثابت في العالم)
    const dash = 46, gap = 34, period = dash + gap;
    const worldTop = ball.y + (H * CFG.ballScreenY) / S;
    const worldBottom = ball.y - (H * (1 - CFG.ballScreenY)) / S;
    const startY = Math.max(0, Math.floor(worldBottom / period) * period);
    ctx.strokeStyle = COLORS.center;
    ctx.lineWidth = Math.max(2, 3 * S);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let wy = startY; wy < Math.min(worldTop, CFG.roadLength); wy += period) {
      ctx.moveTo(sx(0), sy(wy));
      ctx.lineTo(sx(0), sy(Math.min(wy + dash, CFG.roadLength)));
    }
    ctx.stroke();

    // خط البداية وخط النهاية
    drawChecker(0, 0x55ffffff);
    drawChecker(CFG.roadLength);
  }

  function drawChecker(wy, tint) {
    const y = sy(wy);
    if (y < -40 || y > H + 40) return;
    const hw = (CFG.roadWidth / 2) * S;
    const cols = 16, cell = (hw * 2) / cols;
    const rows = 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#ffffff' : '#111111';
        ctx.globalAlpha = tint ? 0.35 : 1;
        ctx.fillRect(W / 2 - hw + c * cell, y - (r + 1) * cell, cell + 0.5, cell + 0.5);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawTriangles() {
    ctx.lineJoin = 'round';
    for (const tr of triangles) {
      const v = triVerts(tr);
      const ys = v.map((p) => sy(p.y));
      if (Math.min(...ys) > H + 20 || Math.max(...ys) < -20) continue;
      ctx.beginPath();
      ctx.moveTo(sx(v[0].x), sy(v[0].y));
      ctx.lineTo(sx(v[1].x), sy(v[1].y));
      ctx.lineTo(sx(v[2].x), sy(v[2].y));
      ctx.closePath();
      ctx.fillStyle = COLORS.tri;
      ctx.shadowColor = COLORS.tri;
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = COLORS.triEdge;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawBall() {
    if (state === 'crashed' || state === 'won') {
      if (state === 'won') return;
    }
    // أثر الكرة
    trail.forEach((p, i) => {
      const k = (i + 1) / trail.length;
      ctx.globalAlpha = k * 0.35;
      ctx.fillStyle = COLORS.glow;
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), CFG.ballRadius * S * k, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (state === 'crashed') return;

    const x = sx(ball.x), y = sy(ball.y), r = CFG.ballRadius * S;
    ctx.shadowColor = COLORS.glow;
    ctx.shadowBlur = 20;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#9fefff');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), 3 * S, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawRoad();
    drawTriangles();
    drawParticles();
    drawBall();
    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 70, 50, ${flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
    lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- الأزرار ----------
  $('btnStart').addEventListener('click', startGame);
  $('btnRetry').addEventListener('click', startGame);
  $('btnAgain').addEventListener('click', startGame);

  // ---------- تشغيل ----------
  buildLevel();
  resize();
  window.addEventListener('resize', resize);
  if (bestTime) $('bestStart').textContent = `أفضل وقت: ${fmt(bestTime)}`;
  lastTime = performance.now();
  requestAnimationFrame(frame);
})();
