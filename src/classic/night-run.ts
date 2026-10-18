// Original procedural artwork. Audio analysis is a silent branch of the existing graph.
let analyser: AnalyserNode | null = null;
let source: MediaElementAudioSourceNode | null = null;
let bins = new Uint8Array(128);
let bass = 0;
let energy = 0;
let lastSample = 0;
let closeGame: (() => void) | null = null;

document.addEventListener('peard:audio-can-play', ({ detail }) => {
  if (source === detail.audioSource) return;
  if (source && analyser) source.disconnect(analyser);
  analyser?.disconnect();
  source = detail.audioSource;
  analyser = detail.audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.65;
  bins = new Uint8Array(analyser.frequencyBinCount);
  source.connect(analyser);
});
setInterval(() => {
  const video = document.querySelector('video');
  bass = energy = 0;
  if (analyser && video && !video.paused && !video.ended) {
    analyser.getByteFrequencyData(bins);
    bass = bins.slice(1, 6).reduce((a, b) => a + b, 0) / (5 * 255);
    energy = bins.reduce((a, b) => a + b, 0) / (bins.length * 255);
  }
  lastSample = performance.now();
  window.ipcRenderer.send('classic:audio-level', bass);
}, 80);

function openGame() {
  if (closeGame) return;
  const host = document.createElement('div');
  host.id = 'spear-night-run';
  Object.assign(host.style, {
    position: 'fixed',
    inset: '40px 0 0',
    zIndex: '9999999',
    background: '#101021',
  });
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `:host{color:#eee;font:14px Consolas,monospace}*{box-sizing:border-box}section{height:100%;display:flex;flex-direction:column;background:#101021}header,footer{display:flex;align-items:center;gap:10px;padding:12px;flex-wrap:wrap}strong{color:#a8f7df}button{font:inherit;color:#eee;background:#282841;border:1px solid #7167ac;padding:9px 12px;cursor:pointer}button:focus-visible{outline:2px solid #a8f7df}canvas{width:100%;min-height:0;flex:1;object-fit:contain;image-rendering:pixelated;touch-action:none}#status{flex:1;min-width:160px;font-size:12px;color:#c5bfdc}footer{font-size:12px;color:#c5bfdc}#score{margin-left:auto}`;
  root.append(style);
  const section = document.createElement('section');
  const header = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = 'NIGHT RUN';
  const status = document.createElement('span');
  status.id = 'status';
  status.setAttribute('role', 'status');
  const button = (label: string, action: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = action;
    return b;
  };
  let autopilot = false;
  const auto = button('Autopilot: off', () => {
    autopilot = !autopilot;
    auto.textContent = `Autopilot: ${autopilot ? 'on' : 'off'}`;
  });
  const exit = button('Close · Esc', () => closeGame?.());
  header.append(title, status, auto, exit);
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    'Night Run. Space to jump, arrow keys to switch lanes, Escape to close.',
  );
  const footer = document.createElement('footer');
  const score = document.createElement('span');
  score.id = 'score';
  footer.append(
    button('Jump · Space', () => jump()),
    button('Switch lane · ↑ / ↓', () => {
      lane = 1 - lane;
    }),
    score,
  );
  section.append(header, canvas, footer);
  root.append(section);
  document.body.append(host);
  const ctx = canvas.getContext('2d')!;
  const previousFocus = document.activeElement as HTMLElement | null;
  canvas.focus();
  let lane = 1,
    height = 0,
    velocity = 0,
    distance = 0,
    combo = 1,
    flash = 0;
  let clock = 0,
    spawn = 1.5,
    last = performance.now(),
    raf = 0,
    seed = 1,
    hue = 240,
    scene = 0;
  let track = '',
    titlePoll = 0;
  let obstacles: { x: number; lane: number; hit: boolean }[] = [];
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  function jump() {
    if (height === 0) velocity = 260;
  }
  const key = (event: KeyboardEvent) => {
    if (
      ![
        'Escape',
        ' ',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (event.key === 'Escape') closeGame?.();
    else if (event.key === ' ') jump();
    else lane = 1 - lane;
  };
  window.addEventListener('keydown', key, true);
  canvas.onpointerdown = jump;
  closeGame = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', key, true);
    host.remove();
    closeGame = null;
    previousFocus?.focus();
  };
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.04);
    last = now;
    if (document.hidden) {
      raf = requestAnimationFrame(frame);
      return;
    }
    clock += dt;
    titlePoll -= dt;
    const video = document.querySelector('video');
    const active = !!video && !video.paused && !video.ended;
    const low = active && now - lastSample < 500 ? bass : 0;
    const power = active ? energy : 0;
    if (titlePoll <= 0) {
      titlePoll = 1;
      const name =
        document
          .querySelector('ytmusic-player-bar .title')
          ?.textContent?.trim() || 'Night Run';
      const artist =
        document
          .querySelector('ytmusic-player-bar .byline')
          ?.textContent?.trim() || '';
      const identity = name + artist;
      if (track !== identity) {
        track = identity;
        seed = 2166136261;
        for (const c of track)
          seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
        hue = seed % 360;
        scene = seed % 3;
        obstacles = [];
        spawn = 1.5;
        combo = 1;
      }
      status.textContent = active
        ? name
        : 'Play music to bring the world to life';
    }
    const speed = 115 + power * 110;
    distance += speed * dt;
    spawn -= dt;
    flash = Math.max(0, flash - dt);
    if (spawn <= 0) {
      obstacles.push({ x: 660, lane: random() < 0.5 ? 0 : 1, hit: false });
      spawn = 1.25 + random() * 0.9 - power * 0.3;
    }
    if (
      autopilot &&
      obstacles.some((o) => !o.hit && o.lane === lane && o.x > 105 && o.x < 155)
    )
      jump();
    velocity -= 650 * dt;
    height = Math.max(0, height + velocity * dt);
    if (!height) velocity = 0;
    rect(0, 0, 640, 360, `hsl(${hue} 35% ${9 + low * 5}%)`);
    for (let i = 0; i < 45; i++)
      rect(
        (i * 137 + 640 - ((distance * 0.08) % 640)) % 640,
        (i * 47) % 160,
        2,
        2,
        `hsl(${hue} 40% ${45 + low * 35}%)`,
      );
    rect(500, 35, 32, 32, `hsl(${(hue + 50) % 360} 45% 78%)`);
    for (let i = 0; i < 15; i++) {
      const x = i * 55 - ((distance * 0.22) % 55);
      const h = 25 + ((i * 37) % 85);
      const color = `hsl(${hue} 25% ${18 + low * 5}%)`;
      if (scene === 1) {
        rect(x + 20, 205 - h, 7, h, color);
        rect(x + 4, 205 - h, 39, 30, color);
        rect(x + 12, 185 - h, 23, 22, color);
      } else {
        rect(x, 205 - h, 42, h, color);
        for (let y = 215 - h; y < 195; y += 16)
          rect(
            x + 10,
            y,
            scene === 2 ? 25 : 5,
            4,
            `hsl(${hue + 90} 55% ${25 + low * 35}%)`,
          );
      }
    }
    for (let row = 0; row < 2; row++) {
      const ground = 255 + row * 72;
      rect(0, ground, 640, 3, `hsl(${hue + 100} 65% ${40 + low * 30}%)`);
      for (let i = 0; i < 22; i++)
        rect(i * 32 - (distance % 32), ground + 12, 14, 2, '#35364f');
      for (const o of obstacles.filter((o) => o.lane === row)) {
        o.x -= speed * dt;
        rect(o.x, ground - 22, 20, 22, o.hit ? '#695e7c' : '#ed9d83');
        rect(o.x + 4, ground - 18, 12, 4, '#ffe3ae');
        if (
          !o.hit &&
          row === lane &&
          o.x < 112 &&
          o.x + 20 > 92 &&
          height < 23
        ) {
          o.hit = true;
          combo = 1;
          flash = 0.3;
        }
        if (!o.hit && o.x < 70) {
          o.hit = true;
          combo = Math.min(99, combo + 1);
        }
      }
      if (row === lane) {
        const y = ground - 28 - height;
        rect(94, y, 16, 14, flash ? '#ed9d83' : '#a8f7df');
        rect(105, y + 4, 4, 4, '#182733');
        rect(92, y + 14, 16, 9, '#8a81d7');
        const step = height ? 0 : (Math.floor(clock * 12) % 2) * 5;
        rect(92 + step, y + 23, 6, 5, '#a8f7df');
        rect(105 - step, y + 23, 6, 5, '#a8f7df');
        rect(75 - low * 10, y + 15, 18 + low * 10, 4, '#dc88b5');
      }
    }
    obstacles = obstacles.filter((o) => o.x > -30);
    score.textContent = `${Math.floor(distance / 10)} m · ×${combo}${autopilot ? ' · AUTO' : ''}`;
    raf = requestAnimationFrame(frame);
  };
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
