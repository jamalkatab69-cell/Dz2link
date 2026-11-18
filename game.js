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
  // فيزياء الكرة (بصرية): قفزة بجاذبية حقيقية + ارتداد + انضغاط، ودوران كامل أثناء الجري
  const ball = { y: 0, vy: 0, sq: 0, sqv: 0, roll: 0, tilt: 0, lastU: 0 };
  let lastLane = 1;
  let clock = 0;
  const cam = { x: 0, y: CAM.height, z: -CAM.back, psi: 0 };
  const save = (k, v) => localStorage.setItem('abur-' + k, typeof v === 'string' ? v : JSON.stringify(v));
  const load = (k, d) => { try { const v = localStorage.getItem('abur-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const store = {
    best: Number(localStorage.getItem('abur-best')) || 0,
    gems: Number(localStorage.getItem('abur-gems')) || 0,
    skin: localStorage.getItem('abur-skin') || 'neon',   // neon = الكرة الأصلية
    vib: load('vib', true),
    top: load('top', [])
  };

  // روابط مواقع التواصل — غيّر الروابط هنا (أضف أي موقع آخر بنفس الشكل)
  const LINKS = [
    { name: 'تيليغرام', url: 'https://t.me/', icon: 'tg' }
  ];

  // ---------- شخصيات الكرات (من skins.js) ----------
  // كل صورة تُلفّ حول كرة وتدور 360° أثناء الجري
  const SKINS = (window.CHAR_SKINS || []).map((k) => {
    const img = new Image();
    img.src = k.src;
    return { ...k, img, tex: null };
  });
  const skinById = (id) => SKINS.find((k) => k.id === id) || null;

  // ---------- التحكم: لمسة واحدة تنقل الكرة إلى المسار الآخر ----------
  const debug = { auto: false };
  function tapLane() {
    if (mode === 'play') E.switchLane(player);
  }
  window.addEventListener('pointerdown', () => tapLane());
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (!$('modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
    if ((e.key === ' ' || e.key === 'Enter') && mode !== 'play') { pressStart(); return; }
    if (mode !== 'play') return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') E.switchLane(player, -1);
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') E.switchLane(player, 1);
    else if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') E.switchLane(player);
  });

  // لمس الشاشات يبدأ اللعب
  $('screenStart').addEventListener('pointerdown', (e) => { e.stopPropagation(); pressStart(); });
  $('screenOver').addEventListener('pointerdown', (e) => { e.stopPropagation(); pressStart(); });

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
    lastLane = player.lane;
    ball.y = 0; ball.vy = 0; ball.sq = 0; ball.sqv = 0; ball.roll = 0; ball.tilt = 0; ball.lastU = player.u;
    updateCamera(1, true);
  }

  function startGame() {
    newRun();
    mode = 'play';
    $('screenStart').hidden = true;
    $('screenOver').hidden = true;
    scoreEl.hidden = false;
    gemsEl.hidden = false;
    scoreEl.textContent = '0';
    gemsEl.textContent = String(store.gems);
    $('dock').hidden = true;
    closeModal();
  }

  function showMenu() {
    newRun();
    mode = 'menu';
    menuReset = 0;
    scoreEl.hidden = true;
    gemsEl.hidden = true;
    $('screenOver').hidden = true;
    $('screenStart').hidden = false;
    $('dock').hidden = false;
    refreshBest();
  }

  function refreshBest() {
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
    if (n > 0) { store.top.push(n); store.top.sort((a, b) => b - a); store.top = store.top.slice(0, 10); save('top', store.top); }
    $('dock').hidden = false;
    $('verdict').textContent = isBest && n > 0 ? 'رقم قياسي جديد!' : verdictFor(n);
    $('final').textContent = String(n);
    $('bestOver').textContent = `الأفضل: ${store.best}`;
    $('gemsOver').textContent = `الجواهر: ${store.gems}`;
    scoreEl.hidden = true;
    gemsEl.hidden = true;
    $('screenOver').hidden = false;
    overReadyAt = clock + 0.7;
  }

  // ---------- الأزرار السفلية واللوحات ----------
  const ICONS = {
    tg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#2AABEE"/><path fill="#fff" d="M5.43 11.87c3.5-1.52 5.83-2.53 7-3.02 3.33-1.39 4.02-1.63 4.47-1.64.1 0 .32.02.46.14.12.1.16.23.17.33.02.1.04.31.02.48-.18 1.9-.96 6.5-1.36 8.62-.17.9-.5 1.2-.82 1.23-.7.06-1.23-.46-1.9-.9-1.06-.69-1.65-1.12-2.68-1.8-1.19-.78-.42-1.21.26-1.91.18-.18 3.25-2.98 3.31-3.23.01-.03.01-.15-.06-.21-.07-.06-.17-.04-.25-.02-.11.02-1.8 1.14-5.09 3.36-.48.33-.92.49-1.31.48-.43-.01-1.26-.24-1.88-.44-.76-.25-1.36-.38-1.31-.8.03-.22.33-.45.9-.69z"/></svg>'
  };
  document.querySelectorAll('#dock [data-icon="tg"]').forEach((el) => { el.innerHTML = ICONS.tg; });

  const modal = $('modal');
  const mBody = $('mBody');
  function closeModal() { modal.hidden = true; }
  modal.addEventListener('pointerdown', (e) => e.stopPropagation());
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  $('mClose').addEventListener('click', closeModal);
  $('dock').addEventListener('pointerdown', (e) => e.stopPropagation());

  function h(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function renderSkins(box) {
    const grid = h('div', 'skins');
    const list = [{ id: 'neon', name: 'الأصلية', src: null }, ...SKINS];
    const cards = [];
    for (const k of list) {
      const b = h('button', 'skin');
      b.type = 'button';
      b.innerHTML = (k.src ? `<img src="${k.src}" alt="">` : '<i class="neon-ball"></i>') + `<span>${k.name}</span>`;
      b.addEventListener('click', () => {
        store.skin = k.id; localStorage.setItem('abur-skin', k.id);
        cards.forEach((c) => c[0].classList.toggle('on', c[1] === k.id));
      });
      cards.push([b, k.id]);
      b.classList.toggle('on', store.skin === k.id);
      grid.appendChild(b);
    }
    box.appendChild(grid);
  }

  const PANELS = {
    account: { title: 'الحساب', render(box) {
      box.appendChild(h('div', 'stats', `<div><b>${store.best}</b><span>أفضل نتيجة</span></div><div><b>${store.gems}</b><span>الجواهر</span></div>`));
      const b = h('button', 'btn', '<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>تسجيل الدخول بحساب Google</span>');
      const note = h('p', 'note');
      b.addEventListener('click', () => { note.textContent = 'تسجيل الدخول غير مفعّل بعد: يحتاج ربطه بمعرّف عميل (Client ID) من Google Cloud.'; });
      box.appendChild(b); box.appendChild(note);
    } },
    top: { title: 'المتصدرون', render(box) {
      if (!store.top.length) { box.appendChild(h('p', 'note', 'لا توجد نتائج بعد. العب جولة لتظهر هنا.')); return; }
      const ol = h('ol', 'board');
      store.top.forEach((n) => ol.appendChild(h('li', '', `<b>${n}</b><span>مثلثًا</span>`)));
      box.appendChild(ol);
      box.appendChild(h('p', 'note', 'هذه أفضل نتائجك على هذا الجهاز. الترتيب العالمي يحتاج خادمًا.'));
    } },
    balls: { title: 'الكرات', render(box) { renderSkins(box); } },
    social: { title: 'مواقع التواصل', render(box) {
      for (const l of LINKS) {
        const a = h('a', 'btn', `${ICONS[l.icon] || ''}<span>${l.name}</span>`);
        a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        box.appendChild(a);
      }
    } },
    settings: { title: 'الإعدادات', render(box) {
      box.appendChild(h('h3', '', 'شكل الكرة'));
      renderSkins(box);
      const row = h('label', 'row', '<span>الاهتزاز عند الاصطدام</span><input type="checkbox" class="sw">');
      const cb = row.querySelector('input'); cb.checked = !!store.vib;
      cb.addEventListener('change', () => { store.vib = cb.checked; save('vib', cb.checked); });
      box.appendChild(row);
      const rs = h('button', 'btn danger', 'مسح النتائج والجواهر');
      let armed = false;
      rs.addEventListener('click', () => {
        if (!armed) { armed = true; rs.textContent = 'اضغط مرة أخرى للتأكيد'; return; }
        store.best = 0; store.gems = 0; store.top = [];
        ['best', 'gems', 'top'].forEach((k) => localStorage.removeItem('abur-' + k));
        refreshBest(); armed = false; rs.textContent = 'تم المسح';
      });
      box.appendChild(rs);
    } }
  };

  document.querySelectorAll('#dock [data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pn = PANELS[btn.dataset.panel];
      $('mTitle').textContent = pn.title;
      mBody.innerHTML = '';
      pn.render(mBody);
      modal.hidden = false;
    });
  });

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
      proj(player.x, 0, player.z);
      const gx = pX, gy = pY;
      proj(player.x, CFG.ballRadius + ball.y, player.z);
      drawList.push({ z: pZ, x: pX, y: pY, t: 'ball', gx, gy });
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

  // ---------- الكرة: فيزياء + كرة مغلّفة بصورة ----------
  const BALL = { g: 28, bounce: 0.35 };

  function updateBall(dt) {
    const f = Math.max(1, player.v / CFG.speedStart);   // عامل السرعة
    const g = BALL.g * f;
    if (player.lane !== lastLane) {
      lastLane = player.lane;
      // قفزة زمنها = زمن عبور المسار، فالارتفاع g·T²/8 يبقى ثابتًا مهما زادت السرعة
      ball.vy = (g * (0.42 / Math.sqrt(f))) / 2;
      ball.sq = -0.14; ball.sqv = 0;                    // تمدّد لحظة الانطلاق
    }
    const n = 4, hh = dt / n;
    for (let i = 0; i < n; i++) {
      ball.vy -= g * hh;
      ball.y += ball.vy * hh;
      if (ball.y <= 0) {
        ball.y = 0;
        const impact = -ball.vy / Math.sqrt(f);
        if (impact > 0.7) {
          ball.sq = Math.min(0.3, impact * 0.05); ball.sqv = 0;   // انضغاط عند الهبوط
          ball.vy = -ball.vy * BALL.bounce;                          // ارتداد
        } else ball.vy = 0;
      }
      ball.sqv += (-260 * ball.sq - 14 * ball.sqv) * hh;           // نابض الانضغاط
      ball.sq += ball.sqv * hh;
    }
    // الدوران: دورة كاملة تقريبًا كل ثانية، وميل خفيف مع الحركة الجانبية
    ball.roll += Math.min(16, 6.5 * Math.sqrt(f)) * dt;
    const lv = (player.u - ball.lastU) / Math.max(dt, 1e-4) / f;
    ball.lastU = player.u;
    const tgt = -Math.max(-0.5, Math.min(0.5, lv * 0.1));
    ball.tilt += (tgt - ball.tilt) * Math.min(1, 12 * dt);
  }

  // مجسّم كرة بالبكسل: لكل بكسل نحسب موضعه على الكرة بعد الدوران ثم نأخذ لون الصورة
  const SN = 144, TEX = 256, INV_PI = 1 / Math.PI;
  const sph = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = SN;
    const c = cv.getContext('2d');
    const img = c.createImageData(SN, SN);
    const pix = [], nx = [], ny = [], nz = [], al = [];
    for (let y = 0; y < SN; y++) {
      for (let x = 0; x < SN; x++) {
        const px = ((x + 0.5) / SN) * 2 - 1, py = 1 - ((y + 0.5) / SN) * 2;
        const d2 = px * px + py * py, d = Math.sqrt(d2);
        if (d > 1.03) continue;
        pix.push(y * SN + x);
        if (d >= 1) { nx.push(px / d); ny.push(py / d); nz.push(0); }
        else { nx.push(px); ny.push(py); nz.push(Math.sqrt(1 - d2)); }
        al.push(Math.round(255 * Math.max(0, Math.min(1, (1 - d) * (SN / 2) + 0.5))));
      }
    }
    return { cv, c, img, u32: new Uint32Array(img.data.buffer), pix: Int32Array.from(pix),
             nx: Float32Array.from(nx), ny: Float32Array.from(ny), nz: Float32Array.from(nz), al: Uint8Array.from(al) };
  })();

  function getTex(skin) {
    if (skin.tex) return skin.tex;
    const im = skin.img;
    if (!(im.complete && im.naturalWidth)) return null;
    const c = document.createElement('canvas');
    c.width = c.height = TEX;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0, TEX, TEX);
    skin.tex = new Uint32Array(x.getImageData(0, 0, TEX, TEX).data.buffer);
    return skin.tex;
  }

  function renderSphere(tex, roll, tilt) {
    const { u32, pix, nx, ny, nz, al } = sph;
    const cT = Math.cos(roll), sT = Math.sin(roll), cF = Math.cos(tilt), sF = Math.sin(tilt);
    for (let k = 0; k < pix.length; k++) {
      const X = nx[k], Y = ny[k], Z = nz[k];
      const y1 = Y * cT - Z * sT, z1 = Y * sT + Z * cT;          // عكس دوران الجري
      const lx = X * cF + y1 * sF, ly = -X * sF + y1 * cF;        // عكس الميل
      const lon = Math.atan2(lx, z1);
      const lat = Math.asin(ly > 1 ? 1 : ly < -1 ? -1 : ly);
      let u = 0.5 + lon * INV_PI;
      if (u < 0) u = -u; else if (u > 1) u = 2 - u;                // الوجه الخلفي نسخة معكوسة، فلا تظهر درزة
      const v = 0.5 - lat * INV_PI;
      const c = tex[((v * (TEX - 1) + 0.5) | 0) * TEX + ((u * (TEX - 1) + 0.5) | 0)];
      u32[pix[k]] = (c & 0x00ffffff) | (al[k] << 24);
    }
    sph.c.putImageData(sph.img, 0, 0);
  }

  function drawBall(d, h) {
    const bx = d.x, by = d.y, bz = d.z;
    if (!(bz > 0.3)) return;
    const r = (CFG.ballRadius * F) / bz;
    ctx.globalAlpha = 1;

    // ظل متوهج على الأرض يصغر ويخفت كلما ارتفعت الكرة
    const lift = Math.min(1, ball.y / 0.8);
    ctx.fillStyle = hsl(h, 100, 60, 0.38 * (1 - lift * 0.7));
    ctx.beginPath();
    ctx.ellipse(d.gx, d.gy, r * (1 - lift * 0.35), r * 0.34 * (1 - lift * 0.35), 0, 0, Math.PI * 2);
    ctx.fill();

    // انضغاط/تمدّد حول نقطة التماس مع الأرض
    ctx.save();
    ctx.translate(bx, by + r);
    ctx.scale(1 + ball.sq * 0.6, 1 - ball.sq);
    ctx.translate(-bx, -(by + r));

    const skin = skinById(store.skin);
    const tex = skin && getTex(skin);
    if (tex) {
      renderSphere(tex, ball.roll, ball.tilt);
      ctx.shadowColor = hsl(h, 100, 58);
      ctx.shadowBlur = 28 * DPR;
      ctx.drawImage(sph.cv, bx - r, by - r, r * 2, r * 2);
      ctx.shadowBlur = 0;
      // إضاءة ثابتة فوق الصورة تعطي إحساس الكرة
      const g = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.4, r * 0.1, bx, by, r);
      g.addColorStop(0, 'rgba(255,255,255,0.30)');
      g.addColorStop(0.4, 'rgba(255,255,255,0)');
      g.addColorStop(0.8, 'rgba(0,0,0,0.16)');
      g.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.ellipse(bx - r * 0.4, by - r * 0.45, r * 0.17, r * 0.1, -0.7, 0, Math.PI * 2); ctx.fill();
    } else {
      // الكرة الأصلية (النيون)
      ctx.shadowColor = hsl(h, 100, 55);
      ctx.shadowBlur = 34 * DPR;
      ctx.fillStyle = hsl(h, 100, 56);
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      const g = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.4, r * 0.1, bx, by, r);
      g.addColorStop(0, hsl(h, 100, 82, 0.55));
      g.addColorStop(1, hsl(h, 100, 50, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
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

  // الكاميرا تتبع منتصف الطريق خلف الكرة، فتظهر الكرة وهي تنتقل بين المسارين
  const _a = {}, _b = {};
  function updateCamera(dt, snap) {
    E.pointAt(world, player.s, _a);
    E.pointAt(world, player.s - CAM.back, _b);
    if (snap) cam.psi = _a.th;
    else cam.psi += (_a.th - cam.psi) * Math.min(1, CAM.follow * dt);
    const lat = player.u * 0.3;
    cam.x = _b.x + Math.cos(_b.th) * lat;
    cam.z = _b.z - Math.sin(_b.th) * lat;
    cam.y = CAM.height;
    cP = Math.cos(cam.psi);
    sP = Math.sin(cam.psi);
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
        if (store.vib && navigator.vibrate) navigator.vibrate(90);
        overTimer = 0.65;
      }
    }
  }

  function update(dt) {
    clock += dt;

    if (mode === 'play') {
      if (debug.auto) E.botAct(world, player);
      handleEvents(E.step(world, player, dt));
      if (player.state === 'crashed' && overTimer > 0) {
        overTimer -= dt;
        if (overTimer <= 0) finish();
      }
    } else if (mode === 'menu') {
      // لاعب آلي يعرض اللعبة خلف شاشة البداية
      E.botAct(world, player);
      E.step(world, player, dt);
      if (player.state !== 'run') {
        menuReset += dt;
        if (menuReset > 1.1) { newRun(); menuReset = 0; }
      }
    }

    if (player.state === 'run') updateBall(dt);

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

    // لون جديد كل 15 مثلثًا (خطوة 45 درجة على دائرة الألوان)
    const level = Math.floor(player.score / CFG.colorEvery);
    const hueT = 185 + level * 45;
    hueC += (hueT - hueC) * Math.min(1, dt * 2.4);
    rootStyle.setProperty('--c', hsl(hueC, 100, 58));
    rootStyle.setProperty('--cs', hsl(hueC, 100, 58, 0.55));

    if (player.state === 'run') updateCamera(dt, false);

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
    requestAnimationFrame(frame); // الحلقة لا تتوقف حتى لو حدث خطأ في إطار واحد
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    update(dt);
    draw();
  }

  // ---------- تشغيل ----------
  resize();
  window.addEventListener('resize', resize);
  showMenu();
  requestAnimationFrame(frame);

  // للاختبار اليدوي من وحدة التحكم
  window.__abur = { get player() { return player; }, get world() { return world; }, startGame, debug };
})();
