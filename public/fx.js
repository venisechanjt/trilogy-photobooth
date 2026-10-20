/*
 * Background animation + small interactive touches.
 *   - polaroids, coffee beans, sparkles and hearts wander around behind the page and dodge the pointer
 *   - tapping anywhere sends out a little burst of sparkles
 *   - confetti on the "done" screen, tilting layout cards, bouncing logo
 */
(() => {
  const COLORS = ['#c8b89f', '#b5885e', '#727c57', '#273f2d', '#734121'];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const bg = document.createElement('canvas');
  const top = document.createElement('canvas');
  bg.className = 'fx-canvas fx-bg';
  top.className = 'fx-canvas fx-top';
  document.body.prepend(bg);
  document.body.append(top);
  const bctx = bg.getContext('2d');
  const tctx = top.getContext('2d');

  let W = 0;
  let H = 0;
  let dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    for (const c of [bg, top]) {
      c.width = W * dpr;
      c.height = H * dpr;
    }
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ---------- shapes ----------
  function sparkle(ctx, s) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 ? s * 0.22 : s;
      const a = (Math.PI / 4) * i;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  }
  function heart(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.35);
    ctx.bezierCurveTo(-s * 1.1, -s * 0.3, -s * 0.45, -s * 1.05, 0, -s * 0.45);
    ctx.bezierCurveTo(s * 0.45, -s * 1.05, s * 1.1, -s * 0.3, 0, s * 0.35);
    ctx.fill();
  }
  function polaroid(ctx, s) {
    ctx.lineWidth = Math.max(1.5, s * 0.09);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-s * 0.8, -s, s * 1.6, s * 2, s * 0.12) : ctx.rect(-s * 0.8, -s, s * 1.6, s * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(-s * 0.6, -s * 0.8, s * 1.2, s * 1.2);
    ctx.stroke();
  }
  function bean(ctx, s) {
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.6, s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,250,243,0.7)';
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.85);
    ctx.bezierCurveTo(s * 0.35, -s * 0.3, -s * 0.35, s * 0.3, 0, s * 0.85);
    ctx.stroke();
  }
  function ring(ctx, s) {
    ctx.lineWidth = Math.max(1.5, s * 0.12);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.7, 0, Math.PI * 2);
    ctx.stroke();
  }
  const SHAPES = [polaroid, polaroid, bean, bean, sparkle, sparkle, heart, ring];

  function drawShape(ctx, p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.strokeStyle = p.color;
    p.shape(ctx, p.size);
    ctx.restore();
  }

  // ---------- floating background items ----------
  const floaters = [];
  // each item wanders: it keeps a heading that slowly turns, so paths curve around the screen
  function makeFloater() {
    return {
      x: rand(0, W),
      y: rand(0, H),
      size: rand(8, 22),
      shape: pick(SHAPES),
      color: pick(COLORS),
      alpha: rand(0.2, 0.42),
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.01, 0.01),
      heading: rand(0, Math.PI * 2),
      turn: rand(-0.01, 0.01),
      speed: rand(0.35, 1.1),
      vx: 0,
      vy: 0,
    };
  }
  const count = Math.round(Math.min(40, Math.max(16, (W * H) / 40000)));
  for (let i = 0; i < count; i++) floaters.push(makeFloater());

  const pointer = { x: -9999, y: -9999 };
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  });
  document.addEventListener('pointerleave', () => {
    pointer.x = pointer.y = -9999;
  });

  // ---------- bursts + confetti (drawn above the page) ----------
  const particles = [];
  function burst(x, y, n = 14) {
    if (reduceMotion) return;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const speed = rand(2, 6);
      particles.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 1.5,
        g: 0.12,
        size: rand(4, 9),
        shape: pick([sparkle, sparkle, heart]),
        color: pick(COLORS),
        alpha: 1,
        fade: rand(0.015, 0.03),
        rot: rand(0, Math.PI * 2),
        vr: rand(-0.2, 0.2),
      });
    }
  }

  let confettiEnd = 0;
  function confetti(duration = 2500) {
    if (reduceMotion) return;
    confettiEnd = performance.now() + duration;
    (function rain() {
      for (let i = 0; i < 4; i++) {
        particles.push({
          x: rand(0, W),
          y: -20,
          vx: rand(-1, 1),
          vy: rand(2, 4),
          g: 0.03,
          size: rand(5, 10),
          shape: pick([sparkle, heart, (ctx, s) => ctx.fillRect(-s / 2, -s / 4, s, s / 2)]),
          color: pick(COLORS),
          alpha: 1,
          fade: 0.004,
          rot: rand(0, Math.PI * 2),
          vr: rand(-0.15, 0.15),
        });
      }
      if (performance.now() < confettiEnd) requestAnimationFrame(rain);
    })();
  }

  document.addEventListener('pointerdown', (e) => {
    // skip form fields so typing an email doesn't feel noisy
    if (e.target.closest('input, select, textarea, dialog')) return;
    burst(e.clientX, e.clientY);
  });

  // ---------- main loop ----------
  let t = 0;
  function frame() {
    t += 1;
    bctx.clearRect(0, 0, W, H);
    for (let i = 0; i < floaters.length; i++) {
      const p = floaters[i];
      if (!reduceMotion) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 140 && dist > 0) {
          const force = (140 - dist) / 140;
          p.vx += (dx / dist) * force * 0.6;
          p.vy += (dy / dist) * force * 0.6;
          p.vr += force * 0.002 * Math.sign(dx);
        }
        p.vx *= 0.94;
        p.vy *= 0.94;
        // gently change how sharply each item turns, so it meanders instead of circling
        p.turn += rand(-0.0015, 0.0015);
        p.turn = Math.max(-0.02, Math.min(0.02, p.turn));
        p.heading += p.turn;
        p.x += Math.cos(p.heading) * p.speed + p.vx;
        p.y += Math.sin(p.heading) * p.speed + p.vy;
        p.vr = Math.max(-0.03, Math.min(0.03, p.vr));
        p.rot += p.vr;
        // wrap around the edges
        const m = 40;
        if (p.x < -m) p.x = W + m;
        else if (p.x > W + m) p.x = -m;
        if (p.y < -m) p.y = H + m;
        else if (p.y > H + m) p.y = -m;
      }
      drawShape(bctx, p);
    }

    tctx.clearRect(0, 0, W, H);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.alpha -= p.fade;
      if (p.alpha <= 0 || p.y > H + 40) {
        particles.splice(i, 1);
        continue;
      }
      drawShape(tctx, p);
    }
    if (!reduceMotion) requestAnimationFrame(frame);
  }
  frame();
  // with reduced motion the floaters are drawn once; particles are disabled anyway
  if (reduceMotion) window.addEventListener('resize', frame);

  // ---------- tilting cards ----------
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.layout-card');
    document.querySelectorAll('.layout-card.tilt').forEach((c) => {
      if (c !== card) {
        c.classList.remove('tilt');
        c.style.transform = '';
      }
    });
    if (!card || reduceMotion || e.pointerType !== 'mouse') return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    card.classList.add('tilt');
    card.style.transform = `perspective(900px) rotateY(${px * 10}deg) rotateX(${-py * 10}deg) translateY(-6px)`;
  });

  // ---------- bouncing logo ----------
  const logo = document.querySelector('.brand-logo');
  if (logo) {
    logo.addEventListener('click', () => {
      logo.classList.remove('bounce');
      void logo.offsetWidth;
      logo.classList.add('bounce');
    });
  }

  function clear() {
    confettiEnd = 0;
    particles.length = 0;
  }

  window.FX = { burst, confetti, clear };
})();
