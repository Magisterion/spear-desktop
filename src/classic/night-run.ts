import { audioMotion } from './audio';
// Original procedural track, vehicles and artwork. No borrowed game assets.
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
    background: '#050b19',
  });
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `*{box-sizing:border-box}:host{font:14px system-ui;color:#effcff}section{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto}header,footer{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:12px 24px;background:#0b1426}strong{letter-spacing:3px;color:#79f4ea}#status{flex:1;color:#a9bfd4}button{background:#192c44;color:#fff;border:1px solid #51708e;border-radius:6px;padding:8px 12px;cursor:pointer}canvas{width:100%;height:100%;display:block;min-height:0;touch-action:none}footer{font-size:12px;color:#a9bfd4}#score{margin-left:auto}progress{width:80px;height:8px;accent-color:#79f4ea}`;
  const section = document.createElement('section'),
    header = document.createElement('header'),
    footer = document.createElement('footer');
  const title = document.createElement('strong');
  title.textContent = 'PULSEFLIGHT';
  const status = document.createElement('span');
  status.id = 'status';
  status.setAttribute('role', 'status');
  const button = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
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
    'Pulseflight. Steer with arrows, A/D or mouse. Space to boost. Escape to return.',
  );
  const hint = document.createElement('span');
  hint.textContent =
    'Steer: A/D / arrows / mouse · Boost: Space · Collect cyan · Avoid coral';
  const meter = document.createElement('progress');
  meter.max = 1;
  meter.setAttribute('aria-label', 'Music pulse');
  const score = document.createElement('span');
  score.id = 'score';
  footer.append(hint, meter, score);
  section.append(header, canvas, footer);
  root.append(style, section);
  document.body.append(host);
  canvas.focus();
  const ctx = canvas.getContext('2d')!;
  let w = 960,
    h = 540,
    clock = 0,
    distance = 0,
    lane = 0,
    steer = 0,
    elapsed = 0,
    points = 0,
    combo = 0,
    hits = 0,
    boost = 0,
    cooldown = 0,
    flash = 0,
    seed = 123,
    track = '',
    trackTimer = 0,
    raf = 0,
    last = performance.now(),
    lastBeat = audioMotion.beat,
    spawnTimer = 0;
  let objects: { z: number; lane: number; danger: boolean }[] = [];
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const keys = new Set<string>();
  const resize = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    h = Math.max(250, (960 * rect.height) / Math.max(1, rect.width));
    canvas.width = w;
    canvas.height = h;
  });
  resize.observe(canvas);
  const move = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    steer = Math.max(
      -1,
      Math.min(1, ((event.clientX - rect.left) / rect.width) * 3 - 1.5),
    );
  };
  canvas.addEventListener('pointermove', move);
  const keydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeGame?.();
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D', ' '].includes(e.key)) {
      e.preventDefault();
      keys.add(e.key.toLowerCase());
      if (e.key === ' ' && !cooldown) {
        boost = 1.2;
        cooldown = 4;
      }
    }
  };
  const keyup = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('keyup', keyup, true);
  closeGame = () => {
    cancelAnimationFrame(raf);
    resize.disconnect();
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('keyup', keyup, true);
    host.remove();
    closeGame = null;
    previousFocus?.focus();
    void window.ipcRenderer.invoke('classic:navigate', 'game-exit');
  };
  const project = (z: number, offset = 0) => {
    const p = 1 / (1 + z * 0.055),
      ahead = distance + z;
    const bend = Math.sin(ahead * 0.008) * 0.7 + Math.sin(ahead * 0.021) * 0.24;
    const near =
      Math.sin(distance * 0.008) * 0.7 + Math.sin(distance * 0.021) * 0.24;
    const hill = Math.sin(ahead * 0.014) * 0.13;
    return {
      x: w * 0.5 + (bend - near) * w * 0.48 * (1 - p) + offset * w * 0.31 * p,
      y: h * 0.24 + h * 0.68 * p + hill * h * (1 - p),
      half: w * 0.37 * p,
      p,
    };
  };
  function frame(now: number) {
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    clock += dt;
    const active = audioMotion.active,
      energy = active ? audioMotion.energy : 0,
      bass = active ? audioMotion.bass : 0;
    elapsed += active ? dt : 0;
    boost = Math.max(0, boost - dt);
    cooldown = Math.max(0, cooldown - dt);
    flash = Math.max(0, flash - dt);
    const speed = active ? 28 + energy * 58 + (boost ? 45 : 0) : 8;
    distance += dt * speed;
    if (keys.has('arrowleft') || keys.has('a'))
      steer = Math.max(-1, steer - dt * 4);
    if (keys.has('arrowright') || keys.has('d'))
      steer = Math.min(1, steer + dt * 4);
    if (autopilot) {
      const next = objects
        .filter((o) => !o.danger && o.z < 100)
        .sort((a, b) => a.z - b.z)[0];
      steer = next?.lane ?? Math.sin(clock * 0.5);
    }
    lane += (steer - lane) * Math.min(1, dt * 9);
    trackTimer -= dt;
    if (trackTimer <= 0) {
      trackTimer = 1;
      const name =
        document
          .querySelector('ytmusic-player-bar .title')
          ?.textContent?.trim() ?? '';
      if (name !== track) {
        track = name;
        seed = [...name].reduce(
          (a, c) => Math.imul(a, 31) + c.charCodeAt(0),
          123,
        );
        objects = [];
        combo = 0;
        points = 0;
      }
      status.textContent = active
        ? track || 'Ride the music'
        : 'Play music to bring the track to life';
    }
    spawnTimer -= dt;
    if (active && (audioMotion.beat !== lastBeat || spawnTimer <= 0)) {
      lastBeat = audioMotion.beat;
      spawnTimer = Math.max(0.35, 1.1 - energy * 0.7);
      objects.push({
        z: 190,
        lane: Math.floor(random() * 3) - 1,
        danger: random() < 0.25,
      });
    }
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#050915');
    sky.addColorStop(0.5, `hsl(${230 + bass * 30} 55% 17%)`);
    sky.addColorStop(1, '#07192b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // Distant stars and orbit rings keep the horizon readable during bends.
    for (let i = 0; i < 90; i++) {
      const x = (i * 127.7 + clock * 2) % w,
        y = (i * 43.91) % (h * 0.48);
      ctx.fillStyle = `rgba(180,220,255,${0.2 + (i % 5) * 0.12})`;
      ctx.fillRect(x, y, 1 + (i % 3 === 0 ? 1 : 0), 1);
    }
    ctx.strokeStyle = '#745b9d70';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(
        w * 0.5,
        h * 0.3,
        70 + i * 22 + bass * 12,
        65 + i * 18,
        -0.3,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    // Draw track from horizon towards the ship. The same projection is used for objects.
    for (let z = 240; z > 0; z -= 3) {
      const a = project(z),
        b = project(Math.max(0, z - 3));
      ctx.fillStyle =
        Math.floor((distance + z) / 12) % 2 ? '#12243bd9' : '#182b42e8';
      ctx.beginPath();
      ctx.moveTo(a.x - a.half, a.y);
      ctx.lineTo(a.x + a.half, a.y);
      ctx.lineTo(b.x + b.half, b.y);
      ctx.lineTo(b.x - b.half, b.y);
      ctx.closePath();
      ctx.fill();
      for (const edge of [-1, -1 / 3, 1 / 3, 1]) {
        ctx.strokeStyle =
          Math.abs(edge) === 1
            ? `hsl(${175 + energy * 35} 90% ${55 + bass * 20}%)`
            : '#7b8cb954';
        ctx.lineWidth = Math.abs(edge) === 1 ? 2 + b.p * 3 : 1;
        ctx.beginPath();
        ctx.moveTo(a.x + a.half * edge, a.y);
        ctx.lineTo(b.x + b.half * edge, b.y);
        ctx.stroke();
      }
    }
    for (const object of [...objects].sort((a, b) => b.z - a.z)) {
      object.z -= dt * speed;
      const p = project(Math.max(0, object.z), object.lane * 0.8),
        size = 10 + 32 * p.p;
      ctx.save();
      ctx.translate(p.x, p.y - size * 0.5);
      ctx.fillStyle = object.danger ? '#ff737f' : '#70f6e4';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = object.danger ? 10 : 18;
      ctx.beginPath();
      if (object.danger) {
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.7, size * 0.2);
        ctx.lineTo(-size * 0.7, size * 0.2);
      } else {
        ctx.moveTo(0, -size * 0.6);
        ctx.lineTo(size * 0.6, 0);
        ctx.lineTo(0, size * 0.6);
        ctx.lineTo(-size * 0.6, 0);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (object.z <= 0 && Math.abs(lane - object.lane) < 0.45) {
        if (object.danger && !boost) {
          hits++;
          combo = 0;
          flash = 0.3;
        } else if (!object.danger) {
          combo++;
          points += 10 + Math.min(combo, 50);
        }
      }
    }
    objects = objects.filter((o) => o.z > 0);
    const ship = project(0, lane * 0.8);
    ctx.save();
    ctx.translate(ship.x, ship.y - 12);
    ctx.rotate((steer - lane) * 0.35);
    ctx.shadowColor = '#65fff2';
    ctx.shadowBlur = 20 + bass * 15;
    ctx.fillStyle = '#e0ffff';
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(20, 15);
    ctx.lineTo(0, 8);
    ctx.lineTo(-20, 15);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = boost ? '#ffbe70' : '#61dce7';
    ctx.beginPath();
    ctx.moveTo(-7, 14);
    ctx.lineTo(0, 30 + energy * 30 + (boost ? 30 : 0));
    ctx.lineTo(7, 14);
    ctx.fill();
    ctx.restore();
    if (flash) {
      ctx.fillStyle = `rgba(255,70,100,${flash * 0.4})`;
      ctx.fillRect(0, 0, w, h);
    }
    meter.value = Math.max(bass, energy);
    score.textContent = `${Math.floor(elapsed)} s · ${points} pts · ×${combo} · Hits ${hits} · Boost ${cooldown ? 'charging' : 'ready'}`;
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
