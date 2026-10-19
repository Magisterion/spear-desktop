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
  let mountedPlayer: Element | null = null;
  let media = false;
  const cover = document.createElement('img');
  cover.className = 'spear-visualizer-cover';
  cover.alt = '';
  container.prepend(cover);
  const layout = () => {
    const image = document.querySelector<HTMLImageElement>(
      'ytmusic-player-bar img.image, ytmusic-player-bar img',
    );
    const src = image?.currentSrc || image?.src || '';
    if (src && cover.src !== src) cover.src = src;
    cover.hidden = !src;
    if (document.fullscreenElement === container) return;
    const player = document.querySelector('ytmusic-player');
    const playerState = player?.getAttribute('player-ui-state');
    // Use Music's actual media box, including its native mini-player geometry.
    // The overlay never participates in page layout or moves the media node.
    if (mountedPlayer !== player) {
      mountedPlayer?.classList.remove('spear-visualizer-active');
      mountedPlayer = player;
      if (player) player.append(container);
    }
    container.hidden =
      !player ||
      playerState === 'INACTIVE' ||
      playerState === 'PLAYER_BAR_ONLY';
    const expanded = playerState !== 'MINIPLAYER';
    container.classList.toggle('mini', !expanded);
    player?.classList.toggle('spear-visualizer-active', !media);
    const action = container.querySelector<HTMLButtonElement>('.player-action');
    if (action) {
      action.title = expanded ? 'Minimize player' : 'Open player';
      action.setAttribute('aria-label', action.title);
      action
        .querySelector('path')
        ?.setAttribute('d', expanded ? 'M4 9l8 7 8-7' : 'M4 15l8-7 8 7');
    }
    document.documentElement.classList.add('spear-has-visualizer');
    document.documentElement.classList.toggle('spear-show-media', media);
  };
  layout();
  const timer = setInterval(layout, 250);
  return {
    container,
    toggleMedia() {
      media = !media;
      container.classList.toggle('media', media);
      if (media && document.fullscreenElement === container)
        void document
          .exitFullscreen()
          .then(layout)
          .catch(() => {});
      layout();
      return !media;
    },
    showVisualizer() {
      media = false;
      container.classList.remove('media');
      container
        .querySelector('button[aria-pressed]')
        ?.setAttribute('aria-pressed', 'true');
      document.documentElement.classList.remove('spear-show-media');
      mountedPlayer?.classList.add('spear-visualizer-active');
    },
    dispose() {
      clearInterval(timer);
      mountedPlayer?.classList.remove('spear-visualizer-active');
      container.remove();
      document.documentElement.classList.remove(
        'spear-has-visualizer',
        'spear-show-media',
      );
    },
  };
}
