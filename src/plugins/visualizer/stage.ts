/** Kept outside YouTube's video surface: audio-only and mini-player styles hide that surface. */
export function createVisualizerStage() {
  let stage = document.querySelector<HTMLElement>('#spear-visualizer-stage');
  if (!stage) {
    stage = document.createElement('section');
    stage.id = 'spear-visualizer-stage';
    stage.setAttribute('aria-label', 'Music visualizer');
    document.body.append(stage);
  }
  const container = stage;
  const layout = () => {
    if (document.fullscreenElement === container) return;
    const player = document.querySelector('ytmusic-player');
    const panel = document.querySelector<HTMLElement>(
      'ytmusic-player-page #main-panel',
    );
    const page = document.querySelector<HTMLElement>('ytmusic-player-page');
    const expanded =
      player?.getAttribute('player-ui-state') !== 'MINIPLAYER' &&
      !!panel &&
      !!page &&
      page.getBoundingClientRect().width > 0 &&
      panel.getBoundingClientRect().width > 0;
    const parent = expanded ? panel! : document.body;
    if (container.parentElement !== parent) parent.prepend(container);
    container.classList.toggle('mini', !expanded);
    document.documentElement.classList.add('spear-has-visualizer');
  };
  layout();
  const timer = setInterval(layout, 250);
  return {
    container,
    dispose() {
      clearInterval(timer);
      container.remove();
      document.documentElement.classList.remove('spear-has-visualizer');
    },
  };
}
