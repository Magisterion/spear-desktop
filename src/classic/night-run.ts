import { audioMotion } from './audio';
// Original geometric artwork and mechanics. No borrowed game assets or levels.
let closeGame: (() => void) | null = null;
function openGame() {
  if (closeGame) return;
  const previousFocus = document.activeElement as HTMLElement | null;
  const host = document.createElement('div');
  host.id = 'spear-pulsefield';
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    background: '#07101c',
  });
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `*{box-sizing:border-box}:host{color:#effcff;font:14px system-ui}section{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:#07101c}header,footer{display:flex;align-items:center;gap:16px;padding:14px 24px;flex-wrap:wrap;background:#0c1828}strong{letter-spacing:3px;color:#75f6d4}button{padding:9px 15px;background:#203449;color:#effcff;border:1px solid #4e7188;border-radius:6px;font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #75f6d4}#status{flex:1;color:#b4cbd8}canvas{display:block;width:100%;height:100%;min-height:0;touch-action:none}footer{font-size:12px;color:#b4cbd8}progress{width:100px;height:8px;accent-color:#75f6d4}#score{margin-left:auto}`;
  root.append(style);
  const section = document.createElement('section'),
    header = document.createElement('header'),
    footer = document.createElement('footer');
  const title = document.createElement('strong');
  title.textContent = 'PULSEFIELD';
  const status = document.createElement('span');
  status.id = 'status';
  status.setAttribute('role', 'status');
  const button = (label: string, callback: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = callback;
    return b;
  };
  let autopilot = false;
  const auto = button('Autopilot: off', () => {
    autopilot = !autopilot;
    auto.textContent = `Autopilot: ${autopilot ? 'on' : 'off'}`;
  });
  header.append(
    title,
    status,
    auto,
    button('Close · Esc', () => closeGame?.()),
  );
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    'Pulsefield. Move with WASD, arrows or mouse. Space to dash. Escape to return.',
  );
  const hint = document.createElement('span');
  hint.textContent = 'Move: WASD / arrows / mouse · Dash: Space / click';
  const meter = document.createElement('progress');
  meter.max = 1;
  meter.value = 0;
  meter.setAttribute('aria-label', 'Music pulse');
  const score = document.createElement('span');
  score.id = 'score';
  footer.append(hint, meter, score);
  section.append(header, canvas, footer);
  root.append(section);
  document.body.append(host);
  canvas.focus();
  const ctx = canvas.getContext('2d')!;
  let w = 960,
    h = 540,
    x = 480,
    y = 270,
    targetX = x,
    targetY = y;
  let last = performance.now(),
    clock = 0,
    survived = 0,
    lastBeat = audioMotion.beat,
    pulse = 0,
    spawn = 0.5;
  let dash = 0,
    cooldown = 0,
    shield = 2,
    hits = 0,
    seed = 1,
    track = '',
    titleTimer = 0,
    raf = 0;
  let usePointer = false;
  const keys = new Set<string>();
  type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    age: number;
    size: number;
  };
  type Hazard = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    age: number;
    kind: 'orb' | 'ring' | 'beam';
    angle: number;
  };
  let hazards: Hazard[] = [],
    particles: Particle[] = [];
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const burst = (bx: number, by: number, count = 12) => {
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      particles.push({
        x: bx,
        y: by,
        vx: Math.cos(a) * (40 + random() * 160),
        vy: Math.sin(a) * (40 + random() * 160),
        age: 0,
        size: 2 + random() * 3,
      });
    }
  };
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    w = 960;
    h = Math.max(300, Math.round((w * rect.height) / Math.max(1, rect.width)));
    canvas.width = w;
    canvas.height = h;
    x = Math.min(x, w - 20);
    y = Math.min(y, h - 20);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  const doDash = () => {
    if (cooldown <= 0) {
      dash = 0.22;
      cooldown = 1.2;
      burst(x, y, 18);
    }
  };
  const down = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (
      ![
        'escape',
        ' ',
        'w',
        'a',
        's',
        'd',
        'arrowup',
        'arrowdown',
        'arrowleft',
        'arrowright',
      ].includes(key)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (key === 'escape') closeGame?.();
    else if (key === ' ') {
      if (!event.repeat) doDash();
    } else {
      keys.add(key);
      usePointer = false;
    }
  };
  const up = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
  const blur = () => keys.clear();
  window.addEventListener('keydown', down, true);
  window.addEventListener('keyup', up, true);
  window.addEventListener('blur', blur);
  canvas.onpointermove = (e) => {
    const r = canvas.getBoundingClientRect();
    targetX = ((e.clientX - r.left) / r.width) * w;
    targetY = ((e.clientY - r.top) / r.height) * h;
    usePointer = true;
  };
  canvas.onpointerdown = doDash;
  closeGame = () => {
    cancelAnimationFrame(raf);
    observer.disconnect();
    window.removeEventListener('keydown', down, true);
    window.removeEventListener('keyup', up, true);
    window.removeEventListener('blur', blur);
    host.remove();
    closeGame = null;
    previousFocus?.focus();
    void window.ipcRenderer.invoke('classic:navigate', 'game-exit');
  };
  function spawnWave(beat: boolean) {
    if (hazards.length > 80) return;
    if (beat) {
      pulse = 1;
      const bx = random() * w,
        by = random() * h;
      hazards.push({
        x: bx,
        y: by,
        vx: 0,
        vy: 0,
        r: 4,
        age: -0.55,
        kind: 'ring',
        angle: random() * Math.PI * 2,
      });
      burst(bx, by, 16);
    } else {
      const left = random() < 0.5,
        bx = left ? -15 : w + 15,
        by = random() * h;
      const angle = Math.atan2(y - by, x - bx);
      hazards.push({
        x: bx,
        y: by,
        vx: Math.cos(angle) * (110 + audioMotion.energy * 130),
        vy: Math.sin(angle) * (110 + audioMotion.energy * 130),
        r: 8 + random() * 7,
        age: -0.5,
        kind: 'orb',
        angle: 0,
      });
      if (random() < 0.22)
        hazards.push({
          x: 40 + random() * (w - 80),
          y: 0,
          vx: 0,
          vy: 0,
          r: 14,
          age: -1.15,
          kind: 'beam',
          angle: 0,
        });
    }
  }
  function frame(now: number) {
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    if (document.hidden) {
      raf = requestAnimationFrame(frame);
      return;
    }
    clock += dt;
    titleTimer -= dt;
    const active = audioMotion.active,
      energy = active ? audioMotion.energy : 0,
      bass = active ? audioMotion.bass : 0;
    if (titleTimer <= 0) {
      titleTimer = 0.5;
      const name =
        document
          .querySelector('ytmusic-player-bar .title')
          ?.textContent?.trim() || '';
      if (name !== track) {
        track = name;
        seed = 2166136261;
        for (const c of track)
          seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
        hazards = [];
        survived = 0;
        shield = 2;
      }
      status.textContent = active
        ? name || 'Follow the music. Dodge the shapes.'
        : 'Play music to bring the arena to life';
    }
    if (active) {
      survived += dt;
      spawn -= dt;
      if (audioMotion.beat !== lastBeat) {
        lastBeat = audioMotion.beat;
        spawnWave(true);
      }
      if (spawn <= 0) {
        spawnWave(false);
        spawn = 0.85 - energy * 0.45;
      }
    }
    pulse = Math.max(0, pulse - dt * 2.8);
    dash = Math.max(0, dash - dt);
    cooldown = Math.max(0, cooldown - dt);
    shield = Math.max(0, shield - dt);
    let dx =
      Number(keys.has('d') || keys.has('arrowright')) -
      Number(keys.has('a') || keys.has('arrowleft'));
    let dy =
      Number(keys.has('s') || keys.has('arrowdown')) -
      Number(keys.has('w') || keys.has('arrowup'));
    if (autopilot) {
      targetX = w * (0.5 + 0.32 * Math.sin(clock * 0.7));
      targetY = h * (0.5 + 0.3 * Math.cos(clock * 0.9));
    }
    if (autopilot || usePointer) {
      dx = targetX - x;
      dy = targetY - y;
    }
    const length = Math.hypot(dx, dy),
      speed = dash ? 880 : 280;
    if (length > 0) {
      const step = Math.min(length, speed * dt);
      if (autopilot || usePointer) {
        x += (dx / length) * step;
        y += (dy / length) * step;
      } else {
        x += (dx / length) * speed * dt;
        y += (dy / length) * speed * dt;
      }
    }
    x = Math.max(12, Math.min(w - 12, x));
    y = Math.max(12, Math.min(h - 12, y));
    ctx.fillStyle = `rgb(${7 + pulse * 8},${16 + bass * 12},${28 + bass * 22})`;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = `rgba(70,150,180,${0.08 + energy * 0.1})`;
    ctx.lineWidth = 1;
    for (let gx = -40 + ((clock * (10 + energy * 25)) % 40); gx < w; gx += 40) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 0; gy < h; gy += 40) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }
    // A wide edge spectrum makes quiet/loud changes immediately readable.
    for (let i = 0; i < 32; i++) {
      const size =
        (10 + bass * 70) * (0.3 + Math.abs(Math.sin(i * 0.4 + clock)) * 0.7);
      ctx.fillStyle = `hsla(${165 + i * 3},80%,65%,${0.12 + energy * 0.3})`;
      ctx.fillRect((i * w) / 32, h - size, w / 32 - 4, size);
    }
    let collision = false;
    for (const o of hazards) {
      o.age += dt * (active ? 1 : 0.2);
      const warning = o.age < 0;
      ctx.strokeStyle = warning ? '#ffd99677' : '#ffac62';
      ctx.fillStyle = warning ? '#ffd99633' : '#ffac62';
      ctx.lineWidth = warning ? 2 : 5;
      if (o.kind === 'orb') {
        if (!warning && active) {
          o.x += o.vx * dt;
          o.y += o.vy * dt;
        }
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r * (1 + bass * 0.2), 0, Math.PI * 2);
        warning ? ctx.stroke() : ctx.fill();
        collision ||= !warning && Math.hypot(o.x - x, o.y - y) < o.r + 9;
      } else if (o.kind === 'ring') {
        if (!warning && active) o.r += dt * (85 + energy * 75);
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, o.angle + 0.55, o.angle + Math.PI * 2 - 0.55);
        ctx.stroke();
        let angle = Math.atan2(y - o.y, x - o.x) - o.angle;
        angle = Math.atan2(Math.sin(angle), Math.cos(angle));
        collision ||=
          !warning &&
          Math.abs(angle) > 0.55 &&
          Math.abs(Math.hypot(x - o.x, y - o.y) - o.r) < 11;
      } else {
        ctx.fillRect(o.x - (warning ? 1 : o.r), 0, warning ? 2 : o.r * 2, h);
        collision ||= !warning && Math.abs(x - o.x) < o.r + 8;
      }
    }
    hazards = hazards.filter((o) =>
      o.kind === 'beam'
        ? o.age < 0.22
        : o.age < 8 && o.x > -80 && o.x < w + 80 && o.y > -80 && o.y < h + 80,
    );
    if (collision && !shield && !dash && active) {
      hits++;
      shield = 1.4;
      burst(x, y, 26);
    }
    for (const p of particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.fillStyle = `rgba(117,246,212,${Math.max(0, 1 - p.age)})`;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    particles = particles.filter((p) => p.age < 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4 + clock * 0.25);
    ctx.shadowColor = '#75f6d4';
    ctx.shadowBlur = dash ? 28 : 12;
    ctx.fillStyle =
      shield && Math.floor(clock * 12) % 2 ? '#d7fff2' : '#75f6d4';
    ctx.fillRect(-9, -9, 18, 18);
    ctx.restore();
    meter.value = Math.max(bass, energy);
    score.textContent = `${Math.floor(survived)} s · Hits ${hits} · Dash ${cooldown ? 'charging' : 'ready'}`;
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
}
window.ipcRenderer.on('classic:game', openGame);
window.addEventListener('spear:fullscreen-visualizer', () => {
  closeGame?.();
  const canvas = document.querySelector<HTMLCanvasElement>('#visualizer');
  if (canvas) canvas.click();
  else {
    const notice = document.createElement('div');
    notice.textContent = 'Play a track to start the visualizer.';
    notice.setAttribute('role', 'status');
    Object.assign(notice.style, {
      position: 'fixed',
      top: '55px',
      right: '20px',
      padding: '16px',
      background: '#262635',
      color: '#fff',
      zIndex: '2147483647',
    });
    document.body.append(notice);
    setTimeout(() => notice.remove(), 4000);
  }
});
