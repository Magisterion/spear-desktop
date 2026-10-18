import { audioMotion } from './audio';
import { createDrive } from './drive';

// Original artwork and straight-road driving game. No camera roll or borrowed assets.
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
  style.textContent =
    ':host{font:14px system-ui;color:white}*{box-sizing:border-box}canvas{position:absolute;inset:0;width:100%;height:100%;cursor:none;touch-action:none}#status{position:absolute;left:20px;top:18px;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#score{position:absolute;right:20px;top:18px;max-width:52%;text-align:right}#status,#score{pointer-events:none;background:#071020d9;padding:10px 12px;border-radius:8px}footer{position:absolute;bottom:14px;left:12px;right:12px;text-align:center;pointer-events:none;color:#d2e3f3;text-shadow:0 1px 4px #000}progress{width:60px;height:6px;accent-color:#70f6e4}';
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    'Pulseflight. Steer with arrows, A/D or mouse. Collect colored crystals and avoid red barriers. R restarts; Escape returns.',
  );
  const status = document.createElement('span');
  status.id = 'status';
  status.setAttribute('role', 'status');
  const score = document.createElement('span');
  score.id = 'score';
  const footer = document.createElement('footer');
  footer.textContent =
    '← → / A D / mouse: steer · Collect crystals · Avoid red barriers · R: restart · Esc: return ';
  const meter = document.createElement('progress');
  meter.max = 1;
  meter.setAttribute('aria-label', 'Music pulse');
  footer.append(meter);
  root.append(style, canvas, status, score, footer);
  document.body.append(host);
  const ctx = canvas.getContext('2d')!;
  const drive = createDrive(),
    run = drive.run;
  const keys = new Set<string>();
  const colors = ['#64ebd5', '#ffc964', '#bb8bff', '#70bcff'];
  let width = 960,
    height = 600,
    raf = 0,
    lastTime = performance.now(),
    lastBeat = audioMotion.beat,
    lastTrack = '',
    lastMediaTime = 0,
    pulse = 0;
  const resize = new ResizeObserver(() => {
    const rect = host.getBoundingClientRect();
    width = Math.max(320, rect.width);
    height = Math.max(240, rect.height);
    canvas.width = Math.round(width * Math.min(2, devicePixelRatio));
    canvas.height = Math.round(height * Math.min(2, devicePixelRatio));
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  });
  resize.observe(host);
  const keydown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (!['escape', 'r', 'a', 'd', 'arrowleft', 'arrowright'].includes(key))
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (key === 'escape') closeGame?.();
    else if (key === 'r') {
      drive.reset();
      lastBeat = audioMotion.beat;
    } else keys.add(key);
  };
  const keyup = (event: KeyboardEvent) => {
    keys.delete(event.key.toLowerCase());
  };
  const blur = () => keys.clear();
  canvas.onpointermove = (event) => {
    run.target =
      document.pointerLockElement === canvas ||
      root.pointerLockElement === canvas
        ? Math.max(
            -0.9,
            Math.min(
              0.9,
              run.target + event.movementX / Math.max(200, width * 0.35),
            ),
          )
        : Math.max(-0.9, Math.min(0.9, (event.clientX / width - 0.5) * 2.6));
  };
  canvas.onpointerdown = (event) => {
    if (event.pointerType !== 'touch')
      void canvas.requestPointerLock()?.catch(() => {});
  };
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('keyup', keyup, true);
  window.addEventListener('blur', blur);
  canvas.focus();
  void canvas.requestPointerLock()?.catch(() => {});
  closeGame = () => {
    cancelAnimationFrame(raf);
    resize.disconnect();
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('keyup', keyup, true);
    window.removeEventListener('blur', blur);
    if (
      document.pointerLockElement === host ||
      root.pointerLockElement === canvas
    )
      document.exitPointerLock();
    host.remove();
    closeGame = null;
    previousFocus?.focus();
    void window.ipcRenderer.invoke('classic:navigate', 'game-exit');
  };
  const project = (x: number, z: number) => {
    const depth = 0.04 + 0.96 * z * z;
    return {
      x: width / 2 + x * width * 0.42 * depth,
      y: height * (0.24 + 0.65 * depth),
      scale: depth,
    };
  };
  const polygon = (
    points: { x: number; y: number }[],
    fill: string,
    stroke?: string,
  ) => {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  };
  function frame(time: number) {
    const dt = Math.min(0.05, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;
    const video = document.querySelector('video');
    const track =
      document
        .querySelector('ytmusic-player-bar .title')
        ?.textContent?.trim() ?? '';
    if (
      track !== lastTrack ||
      (video && Math.abs(video.currentTime - lastMediaTime) > 2)
    ) {
      drive.reset();
      lastTrack = track;
      lastBeat = audioMotion.beat;
    }
    lastMediaTime = video?.currentTime ?? 0;
    if (keys.has('arrowleft') || keys.has('a'))
      run.target = Math.max(-0.9, run.target - dt * 2.4);
    if (keys.has('arrowright') || keys.has('d'))
      run.target = Math.min(0.9, run.target + dt * 2.4);
    if (audioMotion.active && audioMotion.beat !== lastBeat) {
      drive.beat(audioMotion.band);
      lastBeat = audioMotion.beat;
      pulse = 1;
    }
    drive.step(dt, audioMotion.active, audioMotion.bpm);
    pulse = Math.max(0, pulse - dt * 3);
    ctx.fillStyle = '#060d1b';
    ctx.fillRect(0, 0, width, height);
    const visualizer = document.querySelector<HTMLCanvasElement>('#visualizer');
    let hasBackground = false;
    if (visualizer && visualizer.width && visualizer.height) {
      try {
        ctx.globalAlpha = 0.4;
        ctx.drawImage(visualizer, 0, 0, width, height);
        hasBackground = true;
      } catch {
      } finally {
        ctx.globalAlpha = 1;
      }
    }
    if (!hasBackground) {
      for (let i = 0; i < 24; i++) {
        ctx.strokeStyle = `hsla(${185 + i * 6},85%,65%,${0.08 + audioMotion.energy * 0.18})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(
          width / 2,
          height * 0.24,
          30 + i * 22 + pulse * 10,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
    }
    // A fixed horizon and fixed camera keep steering free from camera sway.
    polygon(
      [
        project(-1.12, 0),
        project(1.12, 0),
        project(1.12, 1),
        project(-1.12, 1),
      ],
      '#040d1ae8',
      '#51879f',
    );
    for (const x of [-1, -0.33, 0.33, 1]) {
      const a = project(x, 0),
        b = project(x, 1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = x === -1 || x === 1 ? '#68d4e9' : '#315269';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    for (let i = 0; i < 18; i++) {
      const z = (i / 18 + run.distance) % 1,
        a = project(-1, z),
        b = project(1, z);
      ctx.strokeStyle = `rgba(92,180,210,${0.12 + z * 0.24})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      for (const side of [-1, 1]) {
        const p = project(side * 1.22, z),
          h = (12 + audioMotion.bass * 60 + pulse * 20) * p.scale;
        ctx.fillStyle = colors[i % 4] + '99';
        ctx.fillRect(p.x - 3 * p.scale, p.y - h, 6 * p.scale, h);
      }
    }
    for (const object of [...run.objects].sort((a, b) => a.z - b.z)) {
      const p = project(object.x, object.z),
        size = Math.max(3, width * 0.027 * p.scale);
      const color = object.hazard ? '#ff526c' : colors[object.color];
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      if (object.hazard) {
        polygon(
          [
            { x: p.x - size, y: p.y },
            { x: p.x - size, y: p.y - size * 1.4 },
            { x: p.x + size, y: p.y - size * 1.4 },
            { x: p.x + size, y: p.y },
          ],
          '#531527',
          color,
        );
        ctx.strokeStyle = '#ffbac6';
        ctx.beginPath();
        ctx.moveTo(p.x - size * 0.5, p.y - size * 0.25);
        ctx.lineTo(p.x + size * 0.5, p.y - size * 1.1);
        ctx.moveTo(p.x + size * 0.5, p.y - size * 0.25);
        ctx.lineTo(p.x - size * 0.5, p.y - size * 1.1);
        ctx.stroke();
      } else
        polygon(
          [
            { x: p.x, y: p.y - size * 1.8 },
            { x: p.x + size * 0.7, y: p.y - size * 0.9 },
            { x: p.x, y: p.y },
            { x: p.x - size * 0.7, y: p.y - size * 0.9 },
          ],
          color,
          '#e5ffff',
        );
      ctx.shadowBlur = 0;
    }
    const car = project(run.x, 0.88),
      size = Math.max(15, width * 0.032);
    if (run.shield > 0) {
      ctx.globalAlpha =
        run.invulnerable > 0 ? 0.6 + Math.sin(time * 0.03) * 0.3 : 1;
      polygon(
        [
          { x: car.x - size * 0.45, y: car.y + size * 0.1 },
          { x: car.x + size * 0.45, y: car.y + size * 0.1 },
          {
            x: car.x + size * 0.2,
            y: car.y + size * (0.9 + audioMotion.bass * 0.7),
          },
          {
            x: car.x - size * 0.2,
            y: car.y + size * (0.9 + audioMotion.bass * 0.7),
          },
        ],
        '#58dfff88',
      );
      polygon(
        [
          { x: car.x, y: car.y - size * 1.5 },
          { x: car.x + size, y: car.y + size * 0.3 },
          { x: car.x, y: car.y },
          { x: car.x - size, y: car.y + size * 0.3 },
        ],
        '#8ddfee',
        '#efffff',
      );
      polygon(
        [
          { x: car.x, y: car.y - size },
          { x: car.x + size * 0.3, y: car.y - size * 0.2 },
          { x: car.x - size * 0.3, y: car.y - size * 0.2 },
        ],
        '#19315f',
      );
      ctx.globalAlpha = 1;
    }
    for (const burst of run.bursts) {
      const p = project(burst.x, 0.88);
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8,
          d = burst.age * (burst.hazard ? 180 : 100);
        ctx.globalAlpha = 1 - burst.age / 0.8;
        ctx.fillStyle = burst.hazard ? '#ff7759' : '#b9ffff';
        ctx.fillRect(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 5, 5);
      }
      ctx.globalAlpha = 1;
    }
    if (run.shield <= 0) {
      ctx.fillStyle = '#071020d9';
      ctx.fillRect(width * 0.15, height * 0.4, width * 0.7, 100);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('SHIP DESTROYED', width / 2, height * 0.4 + 38);
      ctx.font = '16px system-ui';
      ctx.fillText(
        'Press R to restart · Esc to return',
        width / 2,
        height * 0.4 + 72,
      );
    }
    status.textContent = audioMotion.active
      ? track || 'Pulseflight'
      : 'Play music to bring the track to life';
    score.textContent = `${run.score} pts · ×${Math.min(4, 1 + Math.floor(run.combo / 10))} · ${run.combo} streak · Shield ${run.shield} · Level ${1 + Math.floor(run.score / 1500)}`;
    meter.value = Math.max(audioMotion.bass, audioMotion.energy);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
}
window.ipcRenderer.on('classic:game', openGame);
window.ipcRenderer.on('classic:game-close', () => closeGame?.());
window.addEventListener('spear:fullscreen-visualizer', () => {
  closeGame?.();
  document.querySelector<HTMLCanvasElement>('#visualizer')?.click();
});
