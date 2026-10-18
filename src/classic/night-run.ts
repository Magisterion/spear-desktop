import { audioMotion, setGameAudioDelay } from './audio';
// Original four-lane rhythm game. Notes are detected before delayed audible playback.
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
    ':host{font:16px system-ui;color:white}*{box-sizing:border-box}canvas{position:absolute;inset:0;width:100%;height:100%;cursor:none;touch-action:none}#status{max-width:35%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;position:absolute;left:24px;top:20px;pointer-events:none;color:#fff;background:#071020bb;padding:8px 12px;border-radius:8px}#score{max-width:55%;text-align:right;font-size:14px;position:absolute;right:24px;top:20px;pointer-events:none;color:white;background:#071020bb;padding:8px 12px;border-radius:8px}footer{position:absolute;bottom:12px;left:0;right:0;text-align:center;pointer-events:none;font:14px system-ui;color:#eee}progress{width:70px;height:6px;accent-color:#70f6e4}';
  const surface = document.createElement('canvas');
  surface.tabIndex = 0;
  surface.setAttribute(
    'aria-label',
    'Pulseflight rhythm game. D F J K to hit notes. R to restart. Escape to close.',
  );
  const stateLabel = document.createElement('span');
  stateLabel.id = 'status';
  stateLabel.setAttribute('role', 'status');
  const scoreLabel = document.createElement('span');
  scoreLabel.id = 'score';
  const footer = document.createElement('footer');
  footer.textContent =
    'D F J K · Hit every note on the line · R: restart · Esc: return ';
  const progress = document.createElement('progress');
  progress.max = 1;
  progress.setAttribute('aria-label', 'Music pulse');
  footer.append(progress);
  root.append(style, surface, stateLabel, scoreLabel, footer);
  document.body.append(host);
  const canvas = root.querySelector('canvas')!;
  const ctx = canvas.getContext('2d')!;
  const status = root.querySelector<HTMLElement>('#status')!;
  const score = root.querySelector<HTMLElement>('#score')!;
  const meter = root.querySelector('progress')!;
  const colors = ['#6eec88', '#ffca59', '#fc718e', '#70bcff'];
  const keys = ['d', 'f', 'j', 'k'];
  const delay = 1.6;
  setGameAudioDelay(delay);
  let width = 960,
    height = 600,
    raf = 0,
    lastBeat = audioMotion.beat;
  let points = 0,
    combo = 0,
    health = 100,
    hit = 0,
    missed = 0,
    sequence = 0;
  let previousTime = audioMotion.time;
  let lastTrack = '',
    lastMediaTime = 0,
    feedback = '',
    feedbackUntil = 0;
  let notes: { lane: number; at: number }[] = [];
  const pressed = [0, 0, 0, 0];
  let flashes: { lane: number; at: number; good: boolean }[] = [];
  const reset = () => {
    notes = [];
    points = combo = hit = missed = sequence = 0;
    health = 100;
    feedback = '';
    lastBeat = audioMotion.beat;
  };
  const resize = new ResizeObserver(() => {
    const rect = host.getBoundingClientRect();
    width = Math.max(320, rect.width);
    height = Math.max(240, rect.height);
    canvas.width = Math.round(width * Math.min(2, devicePixelRatio));
    canvas.height = Math.round(height * Math.min(2, devicePixelRatio));
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  });
  resize.observe(host);
  const strike = (lane: number) => {
    if (!audioMotion.active || health <= 0) return;
    const now = audioMotion.time;
    pressed[lane] = now + 0.12;
    const note = notes
      .filter((n) => n.lane === lane)
      .sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now))[0];
    const error = note ? Math.abs(note.at - now) : Infinity;
    if (note && error <= 0.18) {
      notes.splice(notes.indexOf(note), 1);
      combo++;
      hit++;
      points +=
        (error < 0.075 ? 100 : 60) * Math.min(4, 1 + Math.floor(combo / 12));
      health = Math.min(100, health + 2);
      feedback = error < 0.075 ? 'PERFECT' : 'GOOD';
      flashes.push({ lane, at: now, good: true });
    } else {
      combo = 0;
      missed++;
      health = Math.max(0, health - 5);
      feedback = 'EARLY / LATE';
      flashes.push({ lane, at: now, good: false });
    }
    feedbackUntil = now + 0.45;
  };
  const keydown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      event.preventDefault();
      closeGame?.();
      return;
    }
    if (key === 'r') {
      event.preventDefault();
      reset();
      return;
    }
    const lane = keys.indexOf(key);
    if (lane >= 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) strike(lane);
    }
  };
  canvas.onpointerdown = (event) => {
    if (event.pointerType === 'touch') {
      const lane = Math.floor(
        (event.clientX - width * 0.25) / ((width * 0.5) / 4),
      );
      if (lane >= 0 && lane < 4) strike(lane);
    } else void canvas.requestPointerLock()?.catch(() => {});
  };
  document.addEventListener('keydown', keydown, true);
  canvas.focus();
  void canvas.requestPointerLock()?.catch(() => {});
  closeGame = () => {
    cancelAnimationFrame(raf);
    resize.disconnect();
    document.removeEventListener('keydown', keydown, true);
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    setGameAudioDelay(0);
    host.remove();
    closeGame = null;
    previousFocus?.focus();
    void window.ipcRenderer.invoke('classic:navigate', 'game-exit');
  };
  function frame() {
    const now = audioMotion.time;
    const video = document.querySelector('video');
    const track =
      document
        .querySelector('ytmusic-player-bar .title')
        ?.textContent?.trim() ?? '';
    if (
      track !== lastTrack ||
      (video && Math.abs(video.currentTime - lastMediaTime) > 2)
    ) {
      reset();
      lastTrack = track;
    }
    lastMediaTime = video?.currentTime ?? 0;
    const active = audioMotion.active;
    if (!active)
      notes.forEach((n) => (n.at += Math.max(0, now - previousTime)));
    previousTime = now;
    status.textContent = active
      ? track || 'Pulseflight'
      : 'Play music to bring the track to life';
    const level = 1 + Math.floor(points / 2000);
    if (active && health > 0 && audioMotion.beat !== lastBeat) {
      lastBeat = audioMotion.beat;
      const lane = (audioMotion.band + sequence++) % 4;
      notes.push({ lane, at: now + delay });
      if (level >= 3 && sequence % 4 === 0)
        notes.push({ lane: (lane + 2) % 4, at: now + delay });
    }
    if (active && health > 0) {
      for (const note of notes.filter((n) => now - n.at > 0.18)) {
        missed++;
        combo = 0;
        health = Math.max(0, health - 8);
        flashes.push({ lane: note.lane, at: now, good: false });
        feedback = 'MISS';
        feedbackUntil = now + 0.45;
      }
      notes = notes.filter((n) => now - n.at <= 0.18);
    }
    ctx.fillStyle = '#060d1b';
    ctx.fillRect(0, 0, width, height);
    const visualizer = document.querySelector<HTMLCanvasElement>('#visualizer');
    let background = false;
    if (visualizer && visualizer.width > 0 && visualizer.height > 0) {
      try {
        ctx.globalAlpha = 0.36;
        ctx.drawImage(visualizer, 0, 0, width, height);
        background = true;
      } catch {
      } finally {
        ctx.globalAlpha = 1;
      }
    }
    if (!background) {
      for (let i = 0; i < 32; i++) {
        ctx.strokeStyle = `hsla(${190 + i * 6},75%,65%,${0.1 + audioMotion.energy * 0.2})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(
          width / 2,
          height / 2,
          30 + i * 18 + Math.sin(now + i) * audioMotion.energy * 24,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
    }
    const left = width * 0.25,
      laneWidth = (width * 0.5) / 4,
      top = height * 0.16,
      line = height * 0.82;
    ctx.fillStyle = '#050a18cc';
    ctx.fillRect(left - 10, top - 12, laneWidth * 4 + 20, line - top + 66);
    for (let i = 0; i < 4; i++) {
      const x = left + i * laneWidth;
      ctx.fillStyle = colors[i] + '16';
      ctx.fillRect(x + 3, top, laneWidth - 6, line - top);
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 6, line);
      ctx.lineTo(x + laneWidth - 6, line);
      ctx.stroke();
      ctx.fillStyle = pressed[i] > now ? colors[i] : '#182333';
      ctx.fillRect(x + 6, line + 8, laneWidth - 12, 34);
      ctx.fillStyle = pressed[i] > now ? '#08101b' : colors[i];
      ctx.font = 'bold 20px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(keys[i].toUpperCase(), x + laneWidth / 2, line + 32);
    }
    const travel = Math.max(
      0.85,
      Math.min(
        delay,
        180 / Math.max(80, Math.min(180, audioMotion.bpm)) -
          (level - 1) * 0.025,
      ),
    );
    for (const note of notes) {
      const progress = 1 - (note.at - now) / travel;
      if (progress < 0) continue;
      const x = left + note.lane * laneWidth + laneWidth / 2,
        y = top + (line - top) * progress;
      ctx.shadowColor = colors[note.lane];
      ctx.shadowBlur = 14;
      ctx.fillStyle = colors[note.lane];
      ctx.fillRect(x - laneWidth * 0.34, y - 7, laneWidth * 0.68, 14);
      ctx.shadowBlur = 0;
    }
    flashes = flashes.filter((f) => now - f.at < 0.3);
    for (const flash of flashes) {
      const p = (now - flash.at) / 0.3;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = flash.good ? colors[flash.lane] : '#ff526c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(
        left + (flash.lane + 0.5) * laneWidth,
        line,
        15 + p * 50,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'center';
    ctx.font = 'bold 25px system-ui';
    ctx.fillStyle = '#fff';
    if (health <= 0)
      ctx.fillText('RUN OVER · Press R to restart', width / 2, height * 0.46);
    else if (feedbackUntil > now)
      ctx.fillText(feedback, width / 2, height * 0.12);
    const accuracy =
      hit + missed ? Math.round((hit / (hit + missed)) * 100) : 100;
    score.textContent = `${points} pts · ×${Math.min(4, 1 + Math.floor(combo / 12))} · ${combo} streak · ${accuracy}% · Level ${level} · Energy ${health}`;
    meter.value = Math.max(audioMotion.bass, audioMotion.energy);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
}
window.ipcRenderer.on('classic:game', openGame);
window.addEventListener('spear:fullscreen-visualizer', () => {
  closeGame?.();
  document.querySelector<HTMLCanvasElement>('#visualizer')?.click();
});
