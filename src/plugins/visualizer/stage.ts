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
  // Music handles clicks on its entire media surface as play/pause.
  for (const type of [
    'click',
    'dblclick',
    'pointerdown',
    'pointerup',
    'keydown',
    'contextmenu',
  ])
    container.addEventListener(type, (event) => event.stopPropagation());
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
    if (player instanceof HTMLElement) {
      player.style.setProperty(
        '--spear-artwork',
        src ? `url(${JSON.stringify(src)})` : 'none',
      );
      player.classList.toggle('spear-media-backdrop', media && !!src);
      if (playerState !== 'MINIPLAYER')
        player.classList.remove('spear-mini-dismissed');
    }
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
    dismissMini() {
      if (mountedPlayer?.getAttribute('player-ui-state') === 'MINIPLAYER')
        mountedPlayer.classList.add('spear-mini-dismissed');
    },
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
      mountedPlayer?.classList.remove('spear-mini-dismissed');
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
      mountedPlayer?.classList.remove(
        'spear-visualizer-active',
        'spear-media-backdrop',
        'spear-mini-dismissed',
      );
      container.remove();
      document.documentElement.classList.remove(
        'spear-has-visualizer',
        'spear-show-media',
      );
    },
  };
}
