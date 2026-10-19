import { audioMotion, getAudioGraph } from './audio';
import { activity, onActivityChange } from './activity';
import { createCollector } from './collector';

// Stardrift: vertical flight with the current artwork and live visualizer.
let closeGame: ((notifyMain?: boolean) => void) | null = null;
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
    ':host{font:14px system-ui;color:white}*{box-sizing:border-box}canvas{position:absolute;inset:0;width:100%;height:100%;cursor:none;touch-action:none}#status{position:absolute;left:24px;top:22px;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#score{position:absolute;right:24px;top:22px;max-width:56%;text-align:right}#status,#score{z-index:2;display:block;pointer-events:none;background:#090b17bb;padding:12px 16px;border-radius:10px;line-height:1.5;letter-spacing:.3px}footer{position:absolute;bottom:14px;left:12px;right:12px;text-align:center;pointer-events:none;color:#d2e3f3;text-shadow:0 1px 4px #000}progress{width:60px;height:6px;accent-color:#70f6e4}';
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    'Stardrift. Collect shapes with your core and trail. Avoid red mines. Hold left mouse or Space and release for a pulse. Escape returns.',
  );
  const status = document.createElement('span');
  status.id = 'status';
  status.setAttribute('role', 'status');
  const score = document.createElement('span');
  score.id = 'score';
  const footer = document.createElement('footer');
  footer.textContent =
    'Mouse / arrows: move · Hold LMB / Space, release: pulse · Core hits explode; trails clear mines · R: restart · Esc: return ';
  const meter = document.createElement('progress');
  meter.max = 1;
  meter.setAttribute('aria-label', 'Music pulse');
  footer.append(meter);
  root.append(style, canvas, status, score, footer);
  document.body.append(host);
  document.dispatchEvent(new Event('spear:surface-change'));
  const ctx = canvas.getContext('2d')!;
  const effects = new Set<OscillatorNode>();
  const drive = createCollector(() => {
      const graph = getAudioGraph();
      if (!graph || graph.audioContext.state !== 'running') return;
      const audio = graph.audioContext,
        oscillator = audio.createOscillator(),
        gain = audio.createGain();
      const video = document.querySelector('video');
      oscillator.frequency.setValueAtTime(220, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        440,
        audio.currentTime + 0.5,
      );
      gain.gain.setValueAtTime(
        video?.muted ? 0 : 0.035 * (video?.volume ?? 1),
        audio.currentTime,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.5);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      effects.add(oscillator);
      oscillator.onended = () => {
        effects.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.55);
    }),
    run = drive.run;
  const cover = new Image();
  let coverUrl = '';
  let nextArtworkCheck = 0;
  let width = 960,
    height = 600,
    raf = 0,
    lastTime = performance.now(),
    lastBeat = audioMotion.beat,
    lastTrack = '',
    lastMediaTime = 0,
    pulse = 0,
    lastSpawnTime = -1,
    spawnClock = 0;
  const resize = new ResizeObserver(() => {
    const rect = host.getBoundingClientRect();
    width = Math.max(320, rect.width);
    height = Math.max(240, rect.height);
    canvas.width = Math.round(width * Math.min(2, devicePixelRatio));
    canvas.height = Math.round(height * Math.min(2, devicePixelRatio));
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  });
  resize.observe(host);
  const held = new Set<string>();
  let charging = false;
  const keyup = (event: KeyboardEvent) => {
    held.delete(event.key.toLowerCase());
    if (event.key === ' ') charging = false;
  };
  const clearKeys = () => {
    held.clear();
    charging = false;
    run.held = false;
    run.charge = 0;
  };
  const keydown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (
      ![
        'escape',
        'r',
        'a',
        'd',
        'w',
        's',
        'arrowleft',
        'arrowright',
        'arrowup',
        'arrowdown',
        ' ',
      ].includes(key)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (key === 'escape') closeGame?.();
    else if (key === 'r') {
      drive.reset();
      lastBeat = audioMotion.beat;
    } else {
      held.add(key);
      if (key === ' ') charging = true;
    }
  };
  canvas.onpointermove = (event) => {
    const locked = root.pointerLockElement === canvas;
    run.targetX = Math.max(
      0.035,
      Math.min(
        0.965,
        locked ? run.targetX + event.movementX / width : event.clientX / width,
      ),
    );
    run.targetY = Math.max(
      0.15,
      Math.min(
        0.9,
        locked
          ? run.targetY + event.movementY / height
          : event.clientY / height,
      ),
    );
  };
  canvas.onpointerdown = (event) => {
    if (event.button !== 0) return;
    charging = true;
    if (event.pointerType !== 'touch')
      void canvas.requestPointerLock()?.catch(() => {});
    else canvas.setPointerCapture(event.pointerId);
  };
  const pointerUp = () => {
    charging = false;
  };
  window.addEventListener('pointerup', pointerUp);
  canvas.onpointercancel = clearKeys;
  let hadPointerLock = false;
  const pointerLockChanged = () => {
    const locked = root.pointerLockElement === canvas;
    if (hadPointerLock && !locked) closeGame?.();
    hadPointerLock = locked;
  };
  document.addEventListener('pointerlockchange', pointerLockChanged);
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('keyup', keyup, true);
  window.addEventListener('blur', clearKeys);
  canvas.focus();
  void canvas.requestPointerLock()?.catch(() => {});
  closeGame = (notifyMain = true) => {
    cancelAnimationFrame(raf);
    stopActivity();
    artworkObserver.disconnect();
    document.removeEventListener('play', wake, true);
    document.removeEventListener('pause', wake, true);
    document.removeEventListener('ended', wake, true);
    for (const event of ['playing', 'loadeddata', 'timeupdate', 'emptied'])
      document.removeEventListener(event, mediaWake, true);
    resize.disconnect();
    window.removeEventListener('pointerup', pointerUp);
    for (const oscillator of effects) {
      try {
        oscillator.stop();
      } catch {}
    }
    document.removeEventListener('pointerlockchange', pointerLockChanged);
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('keyup', keyup, true);
    window.removeEventListener('blur', clearKeys);
    if (
      document.pointerLockElement === host ||
      root.pointerLockElement === canvas
    )
      document.exitPointerLock();
    cover.onload = null;
    cover.removeAttribute('src');
    host.remove();
    document.dispatchEvent(new Event('spear:surface-change'));
    closeGame = null;
    previousFocus?.focus();
    if (notifyMain)
      void window.ipcRenderer.invoke('classic:navigate', 'game-exit');
  };
  function frame(time: number) {
    // Keep the loop alive even if a transient artwork/video frame cannot render.
    raf = 0;
    const media = document.querySelector('video');
    if (activity.visible && media && !media.paused && !media.ended)
      raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (time - lastTime) / 1000));
    lastTime = time;
    const steering =
      Number(held.has('d') || held.has('arrowright')) -
      Number(held.has('a') || held.has('arrowleft'));
    run.targetX = Math.max(
      0.035,
      Math.min(0.965, run.targetX + steering * dt * 0.7),
    );
    const vertical =
      Number(held.has('s') || held.has('arrowdown')) -
      Number(held.has('w') || held.has('arrowup'));
    run.targetY = Math.max(
      0.15,
      Math.min(0.9, run.targetY + vertical * dt * 0.7),
    );
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
      ((lastSpawnTime = -1), (spawnClock = 0));
    }
    lastMediaTime = video?.currentTime ?? 0;
    const active =
      activity.visible &&
      (audioMotion.active ||
        !!(video && !video.paused && !video.ended && video.readyState >= 2));
    const beatInterval = 60 / Math.max(60, Math.min(180, audioMotion.bpm));
    // A track starts at media time zero while the AudioContext clock keeps running.
    // Never mix those clocks: doing so stalls spawning until the song catches up.
    if (active) spawnClock += dt;
    const musicTime = spawnClock;
    const onset = audioMotion.beat !== lastBeat;
    // Sustained music may have no bass onsets. Continue the last detected tempo
    // on the media clock, with colors from the live spectrum, instead of an empty road.
    if (
      active &&
      ((onset && musicTime - lastSpawnTime >= 0.16) ||
        lastSpawnTime < 0 ||
        musicTime - lastSpawnTime >=
          beatInterval * (audioMotion.energy > 0.18 ? 0.5 : 1))
    ) {
      drive.beat(audioMotion.band, audioMotion.energy);
      lastSpawnTime = musicTime;
      pulse = 1;
    }
    lastBeat = audioMotion.beat;
    drive.step(dt, active, audioMotion.bpm, audioMotion.energy, charging);
    status.textContent = active
      ? track || 'Stardrift'
      : 'Play music to bring the track to life';
    score.textContent = `${run.score} pts · ×${Math.min(5, 1 + Math.floor(run.combo / 15))} · ${run.respawn > 0 ? 'Reforming…' : 'Trails ' + drive.trailCount()} · ${run.cooldown > 0 ? 'Pulse ' + run.cooldown.toFixed(1) + 's' : 'Charge ' + Math.round(run.charge * 100) + '%'}`;
    meter.value = Math.max(audioMotion.bass, audioMotion.energy);
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
        ctx.globalAlpha = 0.25;
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
    drive.draw(ctx, width, height);
  }

  const wake = () => {
    cancelAnimationFrame(raf);
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const mediaWake = () => {
    if (!raf) wake();
  };
  cover.onload = wake;
  const artworkObserver = new MutationObserver(() => {
    nextArtworkCheck = 0;
    wake();
  });
  artworkObserver.observe(
    document.querySelector('ytmusic-player-bar') ?? document.body,
    {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset'],
    },
  );
  const stopActivity = onActivityChange(wake);
  document.addEventListener('play', wake, true);
  document.addEventListener('pause', wake, true);
  document.addEventListener('ended', wake, true);
  for (const event of ['playing', 'loadeddata', 'timeupdate', 'emptied'])
    document.addEventListener(event, mediaWake, true);
  wake();
}
window.ipcRenderer.on('classic:game', openGame);
// Main already restored the window. Do not echo an exit into a newer session.
window.ipcRenderer.on('classic:game-close', () => closeGame?.(false));
window.addEventListener('spear:fullscreen-visualizer', () => {
  closeGame?.();
  document.querySelector<HTMLCanvasElement>('#visualizer')?.click();
});
