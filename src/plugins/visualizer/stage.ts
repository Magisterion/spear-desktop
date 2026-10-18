/** A single visual surface layered over the site's media without moving its video node. */
export function createVisualizerStage() {
  let stage = document.querySelector<HTMLElement>('#spear-visualizer-stage');
  if (!stage) {
    stage = document.createElement('section');
    stage.id = 'spear-visualizer-stage';
    stage.setAttribute('aria-label', 'Music visualizer');
    document.body.append(stage);
  }
  const container = stage;
  let media = false;
  const cover = document.createElement('img');
  cover.className = 'spear-visualizer-cover';
  cover.alt = '';
  container.prepend(cover);
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
    document.documentElement.classList.toggle('spear-show-media', media);
    const image = document.querySelector<HTMLImageElement>(
      'ytmusic-player-bar img.image, ytmusic-player-bar img',
    );
    const src = image?.currentSrc || image?.src || '';
    if (src && cover.src !== src) cover.src = src;
    cover.hidden = !src;
  };
  layout();
  const timer = setInterval(layout, 250);
  return {
    container,
    toggleMedia() {
      media = !media;
      container.classList.toggle('media', media);
      layout();
      return !media;
    },
    showVisualizer() {
      media = false;
      container.classList.remove('media');
      document.documentElement.classList.remove('spear-show-media');
    },
    dispose() {
      clearInterval(timer);
      container.remove();
      document.documentElement.classList.remove(
        'spear-has-visualizer',
        'spear-show-media',
      );
    },
  };
}
