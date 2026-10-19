import './classic/night-run';
import { initializeAudio, setEqualizer } from './classic/audio';
import { presetConfigs, type Preset } from './plugins/equalizer/presets';
import i18next from 'i18next';
import { setTheme } from 'mdui/functions/setTheme.js';
import 'mdui/mdui.css';
import 'mdui';

import { loadI18n, setLanguage, t as i18t } from '@/i18n';
import {
  defaultTrustedTypePolicy,
  registerWindowDefaultTrustedTypePolicy,
} from '@/utils/trusted-types';

import {
  createContext,
  forceLoadRendererPlugin,
  forceUnloadRendererPlugin,
  getAllLoadedRendererPlugins,
  getLoadedRendererPlugin,
  loadAllRendererPlugins,
} from './loader/renderer';
import { startingPages } from './providers/extracted-data';
import { setupSongInfo } from './providers/song-info-front';

import type { MusicPlayer } from '@/types/music-player';
import type { MusicPlayerAppElement } from '@/types/music-player-app-element';
import type { QueueResponse } from '@/types/music-player-desktop-internal';
import type { PluginConfig } from '@/types/plugins';
import type { QueueElement } from '@/types/queue';
import type { SearchBoxElement } from '@/types/search-box-element';

setTheme('dark');
window.ipcRenderer.on('classic:language', (_event, language: string) => {
  void setLanguage(language);
});

let api: (Element & MusicPlayer) | null = null;
let isPluginLoaded = false;
let isApiLoaded = false;
let firstDataLoaded = false;

// Use the site's own library navigation and play control for an empty queue.
// Keep this listener available even before the player API has initialized.
window.ipcRenderer.on('classic:browse', (_, action: string) => {
  const destination =
    action === 'home'
      ? startingPages.Home
      : action === 'library'
        ? startingPages.Library
        : null;
  if (destination)
    document
      .querySelector<MusicPlayerAppElement>('ytmusic-app')
      ?.navigate(destination);
});
let trayStartPending = false;
window.ipcRenderer.on('classic:tray-play', async () => {
  if (trayStartPending) return;
  const player = document.querySelector<Element & MusicPlayer>('#movie_player');
  if (player?.getVideoData()?.video_id) {
    if (player.getPlayerState() === 1) player.pauseVideo();
    else player.playVideo();
    return;
  }
  trayStartPending = true;
  try {
    const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
    app?.navigate(startingPages.Songs);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      // Only search the liked-songs page, never a recommendation elsewhere.
      const page = document.querySelector(
        'ytmusic-browse-response[browse-id="FEmusic_liked_videos"]',
      );
      const play = page?.querySelector<HTMLElement>(
        'ytmusic-responsive-list-item-renderer ytmusic-play-button-renderer',
      );
      if (play) {
        play.click();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    // A signed-out account or empty library needs the user's attention.
    await window.ipcRenderer.invoke('classic:navigate', 'show');
  } finally {
    trayStartPending = false;
  }
});

registerWindowDefaultTrustedTypePolicy();

async function listenForApiLoad() {
  if (!isApiLoaded) {
    api = document.querySelector('#movie_player');
    if (api) {
      await onApiLoaded();

      return;
    }
  }
}

async function onApiLoaded() {
  // Workaround for macOS traffic lights
  {
    let osType = 'Unknown';
    if (window.electronIs.osx()) {
      osType = 'Macintosh';
    } else if (window.electronIs.windows()) {
      osType = 'Windows';
    } else if (window.electronIs.linux()) {
      osType = 'Linux';
    }
    document.documentElement.setAttribute('data-os', osType);
  }

  // Workaround for #2459
  document
    .querySelector('button.video-button.ytmusic-av-toggle')
    ?.addEventListener('click', () =>
      window.dispatchEvent(new Event('resize')),
    );

  window.ipcRenderer.on('peard:previous-video', () => {
    document
      .querySelector<HTMLElement>('.previous-button.ytmusic-player-bar')
      ?.click();
  });
  window.ipcRenderer.on('peard:next-video', () => {
    document
      .querySelector<HTMLElement>('.next-button.ytmusic-player-bar')
      ?.click();
  });
  window.ipcRenderer.on('peard:play', (_) => {
    api?.playVideo();
  });
  window.ipcRenderer.on('peard:pause', (_) => {
    api?.pauseVideo();
  });
  window.ipcRenderer.on('peard:toggle-play', (_) => {
    if (api?.getPlayerState() === 2) api?.playVideo();
    else api?.pauseVideo();
  });
  window.ipcRenderer.on('peard:seek-to', (_, t: number) => api!.seekTo(t));
  window.ipcRenderer.on('peard:seek-by', (_, t: number) => api!.seekBy(t));
  window.ipcRenderer.on('peard:shuffle', () => {
    document
      .querySelector<HTMLElement & { queue: { shuffle: () => void } }>(
        'ytmusic-player-bar',
      )
      ?.queue.shuffle();
  });

  const isShuffled = () => {
    const isShuffled =
      document
        .querySelector<HTMLElement>('ytmusic-player-bar')
        ?.attributes.getNamedItem('shuffle-on') ?? null;

    return isShuffled !== null;
  };

  window.ipcRenderer.on('peard:get-shuffle', () => {
    window.ipcRenderer.send('peard:get-shuffle-response', isShuffled());
  });

  window.ipcRenderer.on(
    'peard:update-like',
    (_, status: 'LIKE' | 'DISLIKE' = 'LIKE') => {
      document
        .querySelector<
          HTMLElement & { updateLikeStatus: (status: string) => void }
        >('#like-button-renderer')
        ?.updateLikeStatus(status);
    },
  );
  window.ipcRenderer.on('peard:switch-repeat', (_, repeat = 1) => {
    for (let i = 0; i < repeat; i++) {
      document
        .querySelector<HTMLElement & { onRepeatButtonClick: () => void }>(
          'ytmusic-player-bar',
        )
        ?.onRepeatButtonClick();
    }
  });
  window.ipcRenderer.on('peard:update-volume', (_, volume: number) => {
    document
      .querySelector<HTMLElement & { updateVolume: (volume: number) => void }>(
        'ytmusic-player-bar',
      )
      ?.updateVolume(volume);
  });

  const isFullscreen = () => {
    const isFullscreen =
      document
        .querySelector<HTMLElement>('ytmusic-player-bar')
        ?.attributes.getNamedItem('player-fullscreened') ?? null;

    return isFullscreen !== null;
  };

  const clickFullscreenButton = (isFullscreenValue: boolean) => {
    const fullscreen = isFullscreen();
    if (isFullscreenValue === fullscreen) {
      return;
    }

    if (fullscreen) {
      document.querySelector<HTMLElement>('.exit-fullscreen-button')?.click();
    } else {
      document.querySelector<HTMLElement>('.fullscreen-button')?.click();
    }
  };

  window.ipcRenderer.on('peard:get-fullscreen', () => {
    window.ipcRenderer.send('peard:set-fullscreen', isFullscreen());
  });

  window.ipcRenderer.on(
    'peard:click-fullscreen-button',
    (_, fullscreen: boolean | undefined) => {
      clickFullscreenButton(fullscreen ?? false);
    },
  );

  window.ipcRenderer.on('peard:toggle-mute', (_) => {
    document
      .querySelector<HTMLElement & { onVolumeClick: () => void }>(
        'ytmusic-player-bar',
      )
      ?.onVolumeClick();
  });

  window.ipcRenderer.on('peard:get-queue', () => {
    const queue = document.querySelector<QueueElement>('#queue');
    window.ipcRenderer.send('peard:get-queue-response', {
      items: queue?.queue.getItems(),
      autoPlaying: queue?.queue.autoPlaying,
      continuation: queue?.queue.continuation,
    } satisfies QueueResponse);
  });

  window.ipcRenderer.on(
    'peard:add-to-queue',
    (_, videoId: string, queueInsertPosition: string) => {
      const queue = document.querySelector<QueueElement>('#queue');
      const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
      if (!app) return;

      const store = queue?.queue.store.store;
      if (!store) return;

      app.networkManager
        .fetch('/music/get_queue', {
          queueContextParams: store.getState().queue.queueContextParams,
          queueInsertPosition,
          videoIds: [videoId],
        })
        .then((result) => {
          if (
            result &&
            typeof result === 'object' &&
            'queueDatas' in result &&
            Array.isArray(result.queueDatas)
          ) {
            const queueItems = store.getState().queue.items;
            const queueItemsLength = queueItems.length ?? 0;
            queue?.dispatch({
              type: 'ADD_ITEMS',
              payload: {
                nextQueueItemId: store.getState().queue.nextQueueItemId,
                index:
                  queueInsertPosition === 'INSERT_AFTER_CURRENT_VIDEO'
                    ? queueItems.findIndex(
                        (it) =>
                          (
                            it.playlistPanelVideoRenderer ||
                            it.playlistPanelVideoWrapperRenderer
                              ?.primaryRenderer.playlistPanelVideoRenderer
                          )?.selected,
                      ) + 1 || queueItemsLength
                    : queueItemsLength,
                items: result.queueDatas
                  .map((it) =>
                    typeof it === 'object' && it && 'content' in it
                      ? it.content
                      : null,
                  )
                  .filter(Boolean),
                shuffleEnabled: false,
                shouldAssignIds: true,
              },
            });
          }
        });
    },
  );
  window.ipcRenderer.on(
    'peard:move-in-queue',
    (_, fromIndex: number, toIndex: number) => {
      const queue = document.querySelector<QueueElement>('#queue');
      queue?.dispatch({
        type: 'MOVE_ITEM',
        payload: {
          fromIndex,
          toIndex,
        },
      });
    },
  );
  window.ipcRenderer.on('peard:remove-from-queue', (_, index: number) => {
    const queue = document.querySelector<QueueElement>('#queue');
    queue?.dispatch({
      type: 'REMOVE_ITEM',
      payload: index,
    });
  });
  window.ipcRenderer.on('peard:set-queue-index', (_, index: number) => {
    const queue = document.querySelector<QueueElement>('#queue');
    queue?.dispatch({
      type: 'SET_INDEX',
      payload: index,
    });
  });
  window.ipcRenderer.on('peard:clear-queue', () => {
    const queue = document.querySelector<QueueElement>('#queue');
    queue?.queue.store.store.dispatch({
      type: 'SET_PLAYER_PAGE_INFO',
      payload: { open: false },
    });
    queue?.dispatch({
      type: 'CLEAR',
    });
  });

  window.ipcRenderer.on(
    'peard:search',
    async (_, query: string, params?: string, continuation?: string) => {
      const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
      const searchBox =
        document.querySelector<SearchBoxElement>('ytmusic-search-box');

      if (!app || !searchBox) return;

      const result = await app.networkManager.fetch<
        unknown,
        {
          query: string;
          params?: string;
          continuation?: string;
          suggestStats?: unknown;
        }
      >('/search', {
        query,
        params,
        continuation,
        suggestStats: searchBox.getSearchboxStats(),
      });

      window.ipcRenderer.send('peard:search-results', result);
    },
  );

  let video = document.querySelector('video')!;
  const audioContext = new AudioContext();
  const sources = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>();
  let audioSource = audioContext.createMediaElementSource(video);
  sources.set(video, audioSource);
  let audioOutput = initializeAudio(audioContext, audioSource, video);
  const applyEqualizer = (config: {
    enabled?: boolean;
    preset?: string;
    gains?: number[];
  }) => {
    setEqualizer(
      config.preset === 'custom'
        ? (config.gains ?? [])
        : [...(presetConfigs[config.preset as Preset] ?? presetConfigs.flat)],
      config.enabled !== false,
    );
  };
  applyEqualizer(
    (await window.ipcRenderer.invoke('peard:get-config', 'equalizer')) as {
      enabled?: boolean;
      preset?: string;
      gains?: number[];
    },
  );
  window.ipcRenderer.on(
    'config-changed',
    (
      _event,
      id: string,
      config: { enabled?: boolean; preset?: string; gains?: number[] },
    ) => {
      if (id === 'equalizer') applyEqualizer(config);
    },
  );

  for (const [id, plugin] of Object.entries(getAllLoadedRendererPlugins())) {
    if (typeof plugin.renderer !== 'function') {
      await plugin.renderer?.onPlayerApiReady?.call(
        plugin.renderer,
        api!,
        createContext(id),
      );
    }
  }

  if (firstDataLoaded) {
    document.dispatchEvent(
      new CustomEvent('videodatachange', { detail: { name: 'dataloaded' } }),
    );
  }

  const audioCanPlayEventDispatcher = () => {
    document.dispatchEvent(
      new CustomEvent('peard:audio-can-play', {
        detail: {
          audioContext,
          audioSource,
          audioOutput,
        },
      }),
    );
  };

  const loadstartListener = () => {
    // Emit "audioCanPlay" for each video
    video.addEventListener('canplaythrough', audioCanPlayEventDispatcher, {
      once: true,
    });
  };

  audioCanPlayEventDispatcher();
  video.addEventListener('playing', audioCanPlayEventDispatcher, {
    passive: true,
  });

  video.addEventListener('loadstart', loadstartListener, { passive: true });

  new MutationObserver(() => {
    const next = document.querySelector('video');
    if (!next || next === video) return;
    video.removeEventListener('playing', audioCanPlayEventDispatcher);
    video.removeEventListener('loadstart', loadstartListener);
    audioSource.disconnect();
    video = next;
    audioSource =
      sources.get(video) ?? audioContext.createMediaElementSource(video);
    sources.set(video, audioSource);
    audioOutput = initializeAudio(audioContext, audioSource, video);
    video.addEventListener('playing', audioCanPlayEventDispatcher, {
      passive: true,
    });
    video.addEventListener('loadstart', loadstartListener, { passive: true });
    audioCanPlayEventDispatcher();
  }).observe(document.body, { childList: true, subtree: true });
  window.ipcRenderer.send('peard:player-api-loaded');

  // Navigate to "Starting page"
  const startingPage: string = window.mainConfig.get('options.startingPage');
  if (startingPage && startingPages[startingPage]) {
    document
      .querySelector<MusicPlayerAppElement>('ytmusic-app')
      ?.navigate(startingPages[startingPage]);
  }

  applyAppearanceOptions();
}

function applyAppearanceOptions() {
  for (const id of [
    'spear-upgrade-style',
    'spear-like-style',
    'spear-like-order-style',
  ])
    document.getElementById(id)?.remove();
  // Remove upgrade button
  if (window.mainConfig.get('options.removeUpgradeButton')) {
    const itemsSelector = 'ytmusic-guide-section-renderer #items';
    // Never guess by position: Library may be the last item.
    let selector =
      'ytmusic-guide-entry-renderer:has(a[href*="/music_premium"])';

    const upgradeBtnIcon = document.querySelector<SVGGElement>(
      'iron-iconset-svg[name="yt-sys-icons"] #\u0079\u006f\u0075\u0074\u0075\u0062\u0065_music_monochrome',
    );
    if (upgradeBtnIcon) {
      const path = upgradeBtnIcon.firstChild as SVGPathElement;
      const data = path.getAttribute('d')!.substring(0, 15);
      selector = `ytmusic-guide-entry-renderer:has(> tp-yt-paper-item > yt-icon path[d^="${data}"])`;
    }

    const styles = document.createElement('style');
    styles.id = 'spear-upgrade-style';
    styles.textContent = `${itemsSelector} ${selector} { display: none; }`;

    document.head.appendChild(styles);
  }

  // Hide / Force show like buttons
  const likeButtonsOptions: string = window.mainConfig.get(
    'options.likeButtons',
  );
  if (likeButtonsOptions) {
    const style = document.createElement('style');
    style.id = 'spear-like-style';
    style.textContent = `
      ytmusic-player-bar[is-mweb-player-bar-modernization-enabled] .middle-controls-buttons.ytmusic-player-bar, #like-button-renderer {
        display: ${
          likeButtonsOptions === 'hide' ? 'none' : 'inherit'
        } !important;
      }
      ytmusic-player-bar[is-mweb-player-bar-modernization-enabled] .middle-controls.ytmusic-player-bar {
        justify-content: ${
          likeButtonsOptions === 'hide' ? 'flex-start' : 'space-between'
        } !important;
      }`;

    document.head.appendChild(style);
  }

  // Swap like button order
  if (window.mainConfig.get('options.swapLikeButtonsOrder')) {
    const style = document.createElement('style');
    style.id = 'spear-like-order-style';
    style.textContent = `
      #like-button-renderer {
        display: inline-flex;
        flex-direction: row-reverse;
      }`;

    document.head.appendChild(style);
  }
}
window.ipcRenderer.on('classic:appearance', applyAppearanceOptions);

const definePearTransElements = () => {
  customElements.define(
    'pear-trans',
    class extends HTMLElement {
      connectedCallback() {
        const key = this.getAttribute('key');
        if (key) {
          const targetHtml = i18t(key);
          (this.innerHTML as string | TrustedHTML) = defaultTrustedTypePolicy
            ? defaultTrustedTypePolicy.createHTML(targetHtml)
            : targetHtml;
        }
      }
    },
  );
};

const preload = async () => {
  await loadI18n();
  await setLanguage(window.mainConfig.get('options.language') ?? 'en');
  window.i18n = {
    t: i18t.bind(i18next),
  };
  definePearTransElements();
  if (document.body?.dataset?.os) {
    document.body.dataset.os = navigator.userAgent;
  }
};

const main = async () => {
  await loadAllRendererPlugins();
  isPluginLoaded = true;

  window.ipcRenderer.on('plugin:unload', async (_event, id: string) => {
    await forceUnloadRendererPlugin(id);
  });
  window.ipcRenderer.on('plugin:enable', async (_event, id: string) => {
    await forceLoadRendererPlugin(id);
    if (api) {
      const plugin = getLoadedRendererPlugin(id);
      if (plugin && typeof plugin.renderer !== 'function') {
        await plugin.renderer?.onPlayerApiReady?.call(
          plugin.renderer,
          api,
          createContext(id),
        );
      }
    }
  });

  window.ipcRenderer.on(
    'config-changed',
    (_event, id: string, newConfig: PluginConfig) => {
      const plugin = getAllLoadedRendererPlugins()[id];
      if (plugin && typeof plugin.renderer !== 'function') {
        plugin.renderer?.onConfigChange?.call(plugin.renderer, newConfig);
      }
    },
  );

  // Wait for complete load of the api
  await listenForApiLoad();

  // Blocks the "Are You Still There?" popup by setting the last active time to Date.now every 15min
  setInterval(() => (window._lact = Date.now()), 900_000);

  // Setup back to front logger
  if (window.electronIs.dev()) {
    window.ipcRenderer.on('log', (_event, log: string) => {
      console.log(JSON.parse(log));
    });
  }
};

const initObserver = async () => {
  // check document.documentElement is ready
  await new Promise<void>((resolve) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => resolve(), {
        once: true,
      });
    } else {
      resolve();
    }
  });

  const observer = new MutationObserver(() => {
    const playerApi = document.querySelector<Element & MusicPlayer>(
      '#movie_player',
    );
    if (playerApi) {
      observer.disconnect();

      // Inject song-info provider
      setupSongInfo(playerApi);
      const dataLoadedListener = (name: string) => {
        if (!firstDataLoaded && name === 'dataloaded') {
          firstDataLoaded = true;
          playerApi.removeEventListener('videodatachange', dataLoadedListener);
        }
      };
      playerApi.addEventListener('videodatachange', dataLoadedListener);

      if (isPluginLoaded && !isApiLoaded) {
        api = playerApi;
        isApiLoaded = true;

        onApiLoaded();
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
};

initObserver().then(preload).then(main);
