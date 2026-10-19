import { audioMotion } from './audio';
import { createDrive } from './drive';

// Prism Run: fixed perspective, an unmarked surface, and the live player backdrop.
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
    ':host{font:14px system-ui;color:white}*{box-sizing:border-box}canvas{position:absolute;inset:0;width:100%;height:100%;cursor:none;touch-action:none}#status{position:absolute;left:24px;top:22px;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#score{position:absolute;right:24px;top:22px;max-width:56%;text-align:right}#status,#score{pointer-events:none;background:#090b17bb;padding:12px 16px;border-radius:10px;line-height:1.5;letter-spacing:.3px}footer{position:absolute;bottom:14px;left:12px;right:12px;text-align:center;pointer-events:none;color:#d2e3f3;text-shadow:0 1px 4px #000}progress{width:60px;height:6px;accent-color:#70f6e4}';
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    'Prism Run. Steer with arrows, A/D or mouse. Collect colored crystals and avoid red barriers. R restarts; Escape returns.',
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
  const cover = new Image();
  let coverUrl = '';
  let nextArtworkCheck = 0;
  const colors = ['#91ffe3', '#b6a0ff', '#ffd18c', '#70bcff'];
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
    } else if (!event.repeat) {
      const direction = key === 'a' || key === 'arrowleft' ? -1 : 1;
      run.target =
        Math.max(-1, Math.min(1, Math.round(run.target / 0.66) + direction)) *
        0.66;
    }
  };
  let pointerPosition = 0;
  canvas.onpointermove = (event) => {
    const position =
      document.pointerLockElement === canvas ||
      root.pointerLockElement === canvas
        ? pointerPosition + event.movementX / Math.max(200, width * 0.35)
        : (event.clientX / width - 0.5) * 2.6;
    pointerPosition = Math.max(-0.99, Math.min(0.99, position));
    run.target =
      Math.max(-1, Math.min(1, Math.round(pointerPosition / 0.66))) * 0.66;
  };
  canvas.onpointerdown = (event) => {
    if (event.pointerType !== 'touch')
      void canvas.requestPointerLock()?.catch(() => {});
  };
  let hadPointerLock = false;
  const pointerLockChanged = () => {
    const locked = root.pointerLockElement === canvas;
    if (hadPointerLock && !locked && document.hasFocus()) closeGame?.();
    hadPointerLock = locked;
  };
  document.addEventListener('pointerlockchange', pointerLockChanged);
  document.addEventListener('keydown', keydown, true);
  canvas.focus();
  void canvas.requestPointerLock()?.catch(() => {});
  closeGame = () => {
    cancelAnimationFrame(raf);
    resize.disconnect();
    document.removeEventListener('pointerlockchange', pointerLockChanged);
    document.removeEventListener('keydown', keydown, true);
    if (
      document.pointerLockElement === host ||
      root.pointerLockElement === canvas
    )
      document.exitPointerLock();
    cover.onload = null;
    cover.removeAttribute('src');
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
    if (audioMotion.active && audioMotion.beat !== lastBeat) {
      drive.beat(audioMotion.band);
      lastBeat = audioMotion.beat;
      pulse = 1;
    }
    drive.step(dt, audioMotion.active, audioMotion.bpm);
    pulse = Math.max(0, pulse - dt * 3);
    ctx.fillStyle = '#090b17';
    ctx.fillRect(0, 0, width, height);
    // Artwork is independent from the visualizer canvas; a track change must
    // replace it even when the same visualizer continues rendering.
    if (time >= nextArtworkCheck) {
      nextArtworkCheck = time + 250;
      const image = document.querySelector<HTMLImageElement>(
        'ytmusic-player-bar img.image, ytmusic-player-bar img',
      );
      const url = image?.currentSrc || image?.src || '';
      if (url !== coverUrl) {
        coverUrl = url;
        if (url) cover.src = url;
        else cover.removeAttribute('src');
      }
      host.dataset.cover = url ? 'available' : 'none';
    }
    if (coverUrl && cover.complete && cover.naturalWidth) {
      const scale = Math.max(
        width / cover.naturalWidth,
        height / cover.naturalHeight,
      );
      const w = cover.naturalWidth * scale,
        h = cover.naturalHeight * scale;
      ctx.globalAlpha = 0.28;
      ctx.drawImage(cover, (width - w) / 2, (height - h) / 2, w, h);
      ctx.globalAlpha = 1;
    }
    const visualizer = document.querySelector<HTMLCanvasElement>('#visualizer');
    let hasBackground = false;
    if (visualizer && visualizer.width && visualizer.height) {
      try {
        ctx.globalAlpha = 0.45;
        ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(visualizer, 0, 0, width, height);
        hasBackground = true;
      } catch {
      } finally {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
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
    // No lane markings, scrolling grid, roadside posts, camera sway, or zoom.
    // Depth comes only from approaching objects and these stationary edges.
    polygon(
      [
        project(-1.12, 0),
        project(1.12, 0),
        project(1.12, 1.13),
        project(-1.12, 1.13),
      ],
      '#0a1024c9',
    );
    for (const x of [-1.12, 1.12]) {
      const a = project(x, 0),
        b = project(x, 1.13);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = '#ac9aff50';
      ctx.lineWidth = 1.5;
      ctx.stroke();
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
    const prism = project(run.x, 0.88),
      size = Math.max(18, Math.min(34, width * 0.027)),
      prismColor =
        colors[Math.max(0, Math.min(2, Math.round(run.target / 0.66) + 1))];
    if (run.shield > 0) {
      ctx.globalAlpha =
        run.invulnerable > 0 ? 0.6 + Math.sin(time * 0.03) * 0.3 : 1;
      const tail = size + audioMotion.energy * 25 + Math.min(40, run.combo);
      polygon(
        [
          { x: prism.x - 8, y: prism.y },
          { x: prism.x, y: prism.y + tail },
          { x: prism.x + 8, y: prism.y },
        ],
        prismColor + '40',
      );
      ctx.shadowColor = prismColor;
      ctx.shadowBlur = 22;
      polygon(
        [
          { x: prism.x, y: prism.y - size },
          { x: prism.x + size * 0.63, y: prism.y },
          { x: prism.x, y: prism.y + size },
          { x: prism.x - size * 0.63, y: prism.y },
        ],
        prismColor,
      );
      ctx.shadowBlur = 0;
      polygon(
        [
          { x: prism.x, y: prism.y - size },
          { x: prism.x, y: prism.y + size },
          { x: prism.x - size * 0.63, y: prism.y },
        ],
        '#ffffff55',
      );
      polygon(
        [
          { x: prism.x, y: prism.y - size },
          { x: prism.x + size * 0.63, y: prism.y },
          { x: prism.x, y: prism.y },
        ],
        '#ffffffaa',
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
      ctx.fillText('SHIELD DEPLETED', width / 2, height * 0.4 + 38);
      ctx.font = '16px system-ui';
      ctx.fillText(
        'Press R to restart · Esc to return',
        width / 2,
        height * 0.4 + 72,
      );
    }
    status.textContent = audioMotion.active
      ? track || 'Prism Run'
      : 'Play music to bring the track to life';
    score.textContent = `${run.score} pts · ×${Math.min(5, 1 + Math.floor(run.combo / 10))} · ${run.combo} streak · Shield ${'◆'.repeat(Math.ceil(run.shield / 35))}${'◇'.repeat(3 - Math.ceil(run.shield / 35))}`;
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
