/** Native window state is authoritative, including initially hidden windows. */
export const activity = { visible: false, speakers: false };
const listeners = new Set<() => void>();
function update(value: typeof activity) {
  if (!value || typeof value.visible !== 'boolean') return;
  Object.assign(activity, value);
  for (const listener of listeners) listener();
}
// Plugin modules are also imported by the main process to construct menus.
if (typeof window !== 'undefined' && window.ipcRenderer) {
  window.ipcRenderer.on('classic:activity', (_event, value) => update(value));
  void window.ipcRenderer
    .invoke('classic:activity')
    .then(update)
    .catch(() => {});
}
export function onActivityChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** No animation frames are queued while paused or while the surface is hidden. */
export function watchVisualizer(
  canvas: HTMLCanvasElement,
  change: (active: boolean) => void,
) {
  let previous: boolean | undefined;
  const check = () => {
    const video = document.querySelector('video');
    const game = !!document.getElementById('spear-pulsefield');
    const stage = canvas.closest<HTMLElement>('#spear-visualizer-stage');
    const active =
      activity.visible &&
      !!video &&
      !video.paused &&
      !video.ended &&
      (game ||
        (!!stage &&
          !stage.hidden &&
          !stage.classList.contains('media') &&
          !stage.closest('.spear-mini-dismissed') &&
          canvas.getClientRects().length > 0));
    if (active !== previous) {
      previous = active;
      change(active);
    }
  };
  const off = onActivityChange(check);
  const events = [
    'play',
    'playing',
    'pause',
    'ended',
    'emptied',
    'visibilitychange',
    'spear:surface-change',
  ];
  events.forEach((event) => document.addEventListener(event, check, true));
  const observer = new MutationObserver(check);
  const stage = canvas.closest('#spear-visualizer-stage');
  if (stage)
    observer.observe(stage, {
      attributes: true,
      attributeFilter: ['class', 'hidden'],
    });
  const player = canvas.closest('ytmusic-player');
  if (player)
    observer.observe(player, {
      attributes: true,
      attributeFilter: ['class', 'player-ui-state'],
    });
  check();
  return () => {
    off();
    observer.disconnect();
    events.forEach((event) => document.removeEventListener(event, check, true));
    change(false);
  };
}
export function animateVisualizer(
  canvas: HTMLCanvasElement,
  draw: (now: number) => void,
) {
  let frame = 0,
    last = -Infinity;
  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    if (now - last >= 1000 / 30) {
      last = now;
      draw(now);
    }
  };
  const stop = watchVisualizer(canvas, (active) => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (active) {
      last = -Infinity;
      frame = requestAnimationFrame(tick);
    }
  });
  return stop;
}
