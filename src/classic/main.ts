import { readFile } from 'node:fs/promises';
import { deepmerge } from 'deepmerge-ts';
import { app, BrowserWindow, ipcMain, Menu, screen, shell } from 'electron';
import { languageResources } from 'virtual:i18n';
import { allPlugins } from 'virtual:plugins';

import * as config from '@/config';
import { setLanguage } from '@/i18n';
import { restart } from '@/providers/app-controls';
import { getSongControls } from '@/providers/song-controls';
import { registerCallback, type SongInfo } from '@/providers/song-info';

import { presetConfigs, type Preset } from '@/plugins/equalizer/presets';
import { milkdropPresets } from '@/plugins/visualizer/preset-catalog';
import { skins } from './skins';
import compactCss from './compact.css?inline';
import localPreload from './preload.cjs?asset';
import settingsPage from './settings.html?asset';
import trayPage from './tray.html?asset';
import { checkPortableUpdate } from './updater';

import type { PluginConfig } from '@/types/plugins';

let settings: BrowserWindow | null = null;
let popup: BrowserWindow | null = null;
let song: Partial<SongInfo> = {};
let artwork = '';
let audioLevel = 0;
let gamePreviousFullscreen: boolean | null = null;
let gameEnteringFullscreen = false;
let gamePendingRestore: boolean | null = null;
let audioLevelAt = 0;
let artworkImage: SongInfo['image'];
let player: BrowserWindow;
function activitySnapshot() {
  return {
    visible:
      !!player &&
      !player.isDestroyed() &&
      player.isVisible() &&
      !player.isMinimized(),
    speakers:
      !!popup &&
      !popup.isDestroyed() &&
      popup.isVisible() &&
      config.get('options.animatedSpeakers') !== false,
  };
}
function publishActivity() {
  if (player && !player.isDestroyed())
    player.webContents.send('classic:activity', activitySnapshot());
}
const pendingRestart = new Set<string>();
const actions = new Map<string, () => unknown>();
export const markRestartNeeded = (reason: string) => pendingRestart.add(reason);

/** Close entertainment before ordinary close-to-tray handling can hide the player. */
export function closeClassicGame(win: BrowserWindow, restore = true) {
  if (gamePreviousFullscreen === null) return false;
  const fullscreen = gamePreviousFullscreen;
  gamePreviousFullscreen = null;
  if (gameEnteringFullscreen) gamePendingRestore = fullscreen;
  win.webContents.send('classic:game-close');
  win.setFullScreen(fullscreen);
  if (restore) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  return true;
}

function localWindow(width: number, height: number, frame = true) {
  const win = new BrowserWindow({
    width,
    height,
    minWidth: frame ? 650 : 360,
    minHeight: frame ? 480 : 180,
    show: false,
    frame,
    backgroundColor: '#17191d',
    title: 'YouTube Music Spear',
    autoHideMenuBar: true,
    resizable: frame,
    alwaysOnTop: false,
    skipTaskbar: !frame,
    webPreferences: {
      preload: localPreload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  return win;
}

export function openSettings(win: BrowserWindow, tab?: string) {
  player = win;
  if (settings && !settings.isDestroyed()) {
    if (tab) settings.webContents.send('classic:settings-tab', tab);
    settings.setAlwaysOnTop(win.isAlwaysOnTop(), 'pop-up-menu');
    settings.show();
    settings.focus();
    return;
  }
  settings = localWindow(940, 720);
  settings.setParentWindow(win);
  settings.setAlwaysOnTop(win.isAlwaysOnTop(), 'pop-up-menu');
  settings.on('closed', () => {
    settings = null;
  });
  settings.once('ready-to-show', () => {
    settings?.show();
    settings?.focus();
  });
  settings.loadFile(settingsPage, { hash: tab });
}

export function showTrayPopup(win: BrowserWindow) {
  player = win;
  if (!popup || popup.isDestroyed()) {
    popup = localWindow(480, 320, false);
    popup.on('show', publishActivity);
    popup.on('hide', publishActivity);
    popup.on('blur', () => {
      if (!config.get('options.trayPinned')) popup?.hide();
    });
    popup.on('closed', () => {
      popup = null;
      publishActivity();
    });
    popup.once('ready-to-show', () => showTrayPopup(win));
    popup.webContents.on('did-finish-load', () =>
      popup?.webContents.setZoomFactor(1),
    );
    popup.loadFile(trayPage);
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  // Use absolute DIP bounds on every opening. Never reuse DPI-adjusted sizes.
  popup.setBounds({
    x: Math.max(area.x, Math.min(cursor.x - 240, area.x + area.width - 504)),
    y: Math.max(area.y, Math.min(cursor.y - 344, area.y + area.height - 344)),
    width: 480,
    height: 320,
  });
  popup.webContents.setZoomFactor(1);
  popup.setAlwaysOnTop(config.get('options.trayPinned'));
  popup.webContents.send('classic:refresh');
  popup.show();
  popup.focus();
}

function category(id: string) {
  if (id === 'album-color-theme') return 'Album colors';
  if (id === 'visualizer') return 'Visualizers';
  if (id === 'equalizer') return 'Equalizer';
  if (id === 'keep-listening') return 'Playback & tools';
  if (
    /visual|ambient|theme|blur|transparent|album-color|video|compact|in-app/.test(
      id,
    )
  )
    return 'Appearance';
  if (/audio|equalizer|crossfade|volume|silence|speed|normalize/.test(id))
    return 'Audio';
  if (/discord|scrobbl|last|api|amuse|listen|obs|tuna/.test(id))
    return 'Integrations';
  if (/download/.test(id)) return 'Downloads';
  if (/block|privacy|track|proxy|age/.test(id)) return 'Privacy & network';
  if (/lyric|caption|roman/.test(id)) return 'Lyrics';
  return 'Playback & tools';
}

type Control = {
  id: string;
  label: string;
  menuId?: string;
  type: string;
  checked?: boolean;
  enabled: boolean;
  children?: Control[];
};
function controls(
  items: Electron.MenuItemConstructorOptions[],
  prefix: string,
): Control[] {
  return items.flatMap((item, index) => {
    if (
      item.type === 'separator' ||
      item.visible === false ||
      ['classic-proxy', 'classic-auto-updates', 'classic-tray'].includes(
        item.id ?? '',
      )
    )
      return [];
    const id = `${prefix}:${index}`;
    if (item.click)
      actions.set(id, () =>
        item.click!(
          {
            checked: item.type === 'radio' || !item.checked,
          } as Electron.MenuItem,
          player,
          {} as Electron.KeyboardEvent,
        ),
      );
    return [
      {
        id,
        label: item.label ?? '',
        menuId: item.id,
        type: item.type ?? 'normal',
        checked: item.checked,
        enabled: item.enabled !== false,
        children: Array.isArray(item.submenu)
          ? controls(item.submenu, id)
          : undefined,
      },
    ];
  });
}

async function refreshMenu(win: BrowserWindow) {
  return (await import('@/menu')).refreshMenu(win);
}

async function snapshot() {
  const { mainMenuTemplate } = await import('@/menu');
  actions.clear();
  const menu = await mainMenuTemplate(player);
  const options = Array.isArray(menu[1]?.submenu) ? menu[1].submenu : [];
  const plugins = await allPlugins();
  const cards = await Promise.all(
    Object.entries(plugins).map(async ([id, plugin]) => {
      const enabled = await config.plugins.isEnabled(id);
      const submenu = await plugin.menu?.({
        window: player,
        getConfig: () =>
          deepmerge(
            plugin.config ?? { enabled: false },
            config.get(`plugins.${id}`) ?? {},
          ) as PluginConfig,
        setConfig: (value) =>
          config.setPartial(`plugins.${id}`, value, plugin.config),
        refresh: () => refreshMenu(player),
      });
      return {
        id,
        name: plugin.name?.() ?? id,
        description: plugin.description?.() ?? '',
        category: category(id),
        enabled,
        restart: !!plugin.restartNeeded,
        controls: controls(submenu ?? [], `plugin:${id}`),
      };
    }),
  );
  const resources = await languageResources();
  return {
    equalizer: (() => {
      const eq = config.get('plugins.equalizer') as
        | { preset?: string; gains?: number[] }
        | undefined;
      const preset = eq?.preset ?? 'flat';
      return {
        preset,
        gains:
          preset === 'custom'
            ? (eq?.gains ?? [...presetConfigs.flat])
            : [...(presetConfigs[preset as Preset] ?? presetConfigs.flat)],
      };
    })(),
    version: app.getVersion(),
    autoUpdates: config.get('options.autoUpdates'),
    proxy: config.get('options.proxy'),
    minimizeOnAutoStart: config.get('options.minimizeOnAutoStart') ?? true,
    tray: config.get('options.tray'),
    trayClickOpensWindow: !config.get('options.trayClickPlayPause'),
    animatedSpeakers: config.get('options.animatedSpeakers') ?? true,
    trayPinned: config.get('options.trayPinned') ?? false,
    appearance: controls(
      options.filter((item) => item.id === 'classic-appearance'),
      'appearance',
    ),
    general: controls(
      options.filter(
        (item) =>
          item.id !== 'classic-appearance' &&
          !item.label?.includes('(Language)'),
      ),
      'general',
    ),
    plugins: cards.sort((a, b) => a.name.localeCompare(b.name)),
    languages: Object.entries(resources).map(([id, value]) => ({
      id,
      name: value.translation.language?.['local-name'] ?? id,
    })),
    language: config.get('options.language'),
    skin: config.get('options.classicSkin') ?? 'graphite',
    playerTheme: config.get('options.classicPlayerTheme') ?? 'graphite',
    skins: Object.entries(skins).map(([id, palette]) => ({ id, ...palette })),
    restart: [...pendingRestart],
  };
}

export function migrateClassicPreferences() {
  const version = config.get('options.classicExperienceVersion');
  if (version >= 2) return;
  if (version >= 1) {
    const current = config.get('plugins.visualizer') as {
      type?: string;
      butterchurn?: { preset?: string };
    };
    if (
      current?.type === 'butterchurn' &&
      current.butterchurn?.preset ===
        'cope + flexi - colorful marble (ghost mix)'
    )
      config.setPartial('plugins.visualizer', {
        type: 'spectrum',
        coverBackground: true,
      });
    config.set('options.classicExperienceVersion', 2);
    return;
  }
  config.set(
    'options.classicSkin',
    config.get('options.classicPlayerTheme') ?? 'graphite',
  );
  config.setPartial('plugins.equalizer', { enabled: true, preset: 'flat' });
  const visualizer = config.get('plugins.visualizer') as
    | { type?: string; butterchurn?: { preset?: string } }
    | undefined;
  if (!visualizer?.type || visualizer.type === 'spectrum')
    config.setPartial('plugins.visualizer', {
      type: 'spectrum',
      coverBackground: true,
      butterchurn: { preset: 'cope + flexi - colorful marble (ghost mix)' },
    });
  if (
    !visualizer?.butterchurn?.preset ||
    visualizer.butterchurn.preset ===
      'martin [shadow harlequins shape code] - fata morgana'
  )
    config.setPartial('plugins.visualizer', {
      butterchurn: { preset: 'cope + flexi - colorful marble (ghost mix)' },
    });
  config.set('options.classicExperienceVersion', 2);
}

export function setupClassic(win: BrowserWindow) {
  player = win;
  ipcMain.handle('classic:activity', (event) =>
    event.sender === win.webContents ? activitySnapshot() : null,
  );
  win.on('show', publishActivity);
  win.on('hide', publishActivity);
  win.on('minimize', publishActivity);
  win.on('restore', publishActivity);
  win.webContents.on('did-finish-load', publishActivity);
  win.on('always-on-top-changed', (_event, pinned) => {
    win.webContents.send('classic:pin-state', pinned);
    settings?.setAlwaysOnTop(pinned, 'pop-up-menu');
    settings?.webContents.send('classic:refresh');
  });
  registerCallback((info) => {
    song = info;
    if (info.image !== artworkImage) {
      artworkImage = info.image;
      artwork =
        info.image?.resize({ width: 108, height: 108 }).toDataURL() ?? '';
    }
  });
  let cssKey: string | undefined;
  const applyStyle = async () => {
    if (
      win.isDestroyed() ||
      new URL(win.webContents.getURL() || 'about:blank').origin !==
        'https://music.youtube.com'
    )
      return;
    if (cssKey) await win.webContents.removeInsertedCSS(cssKey).catch(() => {});
    const skin = config.get('options.classicSkin');
    const palette = skins[skin] ?? skins.graphite;
    const { accent, top, bottom, surface } = palette;
    if (
      process.platform === 'win32' &&
      (await config.plugins.isEnabled('in-app-menu'))
    )
      win.setTitleBarOverlay({
        color: '#00000000',
        symbolColor: palette.text ?? '#edf1f7',
      });
    const contentPalette =
      skins[config.get('options.classicSkin')] ?? skins.graphite;
    const custom = await Promise.all(
      (config.get('options.themes') ?? []).map((file) =>
        readFile(file, 'utf8').catch(() => ''),
      ),
    );
    cssKey = await win.webContents.insertCSS(
      compactCss +
        `:root { --classic-accent: ${accent}; --classic-top: ${top}; --classic-bottom: ${bottom}; --classic-surface: ${surface}; --shell-radius: ${palette.pixel ? '0px' : '6px'}; --shell-font: ${palette.pixel ? 'monospace' : 'inherit'}; --player-radius: ${contentPalette.pixel ? '0px' : '8px'}; --player-font: ${contentPalette.pixel ? 'monospace' : 'inherit'}; --classic-text: ${palette.text ?? '#edf1f7'}; --player-accent: ${contentPalette.accent}; --player-accent-text: ${contentPalette.accentText ?? '#101820'}; --player-surface: color-mix(in srgb, ${contentPalette.surface}, var(--spear-album-color, ${contentPalette.surface}) var(--spear-album-ratio, 0%)); --player-top: color-mix(in srgb, ${contentPalette.top}, var(--spear-album-color, ${contentPalette.top}) var(--spear-album-ratio, 0%)); --player-bottom: color-mix(in srgb, ${contentPalette.bottom}, var(--spear-album-color, ${contentPalette.bottom}) var(--spear-album-ratio, 0%)); --player-text: ${contentPalette.text ?? '#edf1f7'}; --player-muted: ${contentPalette.muted ?? '#a9b1bf'}; } ytmusic-player-bar { border-top: 1px solid ${accent} !important; }` +
        custom.join('\n'),
    );
  };
  win.webContents.on('did-finish-load', () => {
    applyStyle();
  });
  applyStyle();
  ipcMain.on('classic:audio-level', (event, level: unknown) => {
    if (
      event.sender !== win.webContents ||
      typeof level !== 'number' ||
      !Number.isFinite(level)
    )
      return;
    audioLevel = Math.max(0, Math.min(1, level));
    audioLevelAt = Date.now();
    if (popup?.isVisible())
      popup.webContents.send('classic:audio-level', audioLevel);
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      (input.key === 'Escape' ||
        input.key === 'Esc' ||
        input.code === 'Escape') &&
      gamePreviousFullscreen !== null
    ) {
      event.preventDefault();
      closeClassicGame(win);
    }
  });
  win.on('enter-full-screen', () => {
    gameEnteringFullscreen = false;
    if (gamePendingRestore !== null) {
      const restore = gamePendingRestore;
      gamePendingRestore = null;
      win.setFullScreen(restore);
    }
  });
  win.on('hide', () => closeClassicGame(win, false));
  win.on('minimize', () => closeClassicGame(win, false));
  const openEntertainment = (action: string) => {
    settings?.hide();
    win.show();
    win.focus();
    popup?.hide();
    if (action === 'game') {
      gamePreviousFullscreen ??= win.isFullScreen();
      gamePendingRestore = null;
      gameEnteringFullscreen = !win.isFullScreen();
      win.setFullScreen(true);
      win.webContents.send('classic:game');
    } else {
      config.setPartial('plugins.visualizer', { enabled: true });
      void win.webContents
        .executeJavaScript(
          `window.dispatchEvent(new Event('spear:fullscreen-visualizer'))`,
          true,
        )
        .catch(() => {});
    }
  };
  ipcMain.handle('classic:visualizer-menu', (event) => {
    if (event.sender !== win.webContents) return;
    const names = {
      butterchurn: 'MilkDrop-style (Butterchurn)',
      vudio: 'Vudio',
      wave: 'Wave',
      spectrum: 'Classic spectrum',
      oscilloscope: 'Oscilloscope',
      spectrogram: 'Spectrum history',
      radial: 'Radial spectrum',
      mirror: 'Mirrored spectrum',
      starfield: 'Starfield',
      ribbon: 'Neon ribbon',
      pipes: 'Prismatic pipes',
      mystify: 'Mystify trails',
      bubbles: 'Glass bubbles',
    };
    return new Promise<void>((resolve) => {
      Menu.buildFromTemplate([
        ...Object.entries(names).map(([type, label]) => ({
          label,
          type: 'radio' as const,
          checked:
            (config.get('plugins.visualizer') as { type?: string })?.type ===
            type,
          click: () => config.setPartial('plugins.visualizer', { type }),
        })),
        { type: 'separator' },
        {
          label: 'MilkDrop presets',
          submenu: milkdropPresets.map((preset) => ({
            label: preset,
            type: 'radio' as const,
            checked:
              (
                config.get('plugins.visualizer') as {
                  butterchurn?: { preset?: string };
                }
              )?.butterchurn?.preset === preset,
            click: () =>
              config.setPartial('plugins.visualizer', {
                type: 'butterchurn',
                butterchurn: { preset },
              }),
          })),
        },
        { label: 'Equalizer…', click: () => openSettings(win, 'Equalizer') },
      ]).popup({ window: win, callback: () => resolve() });
    });
  });
  ipcMain.handle('classic:navigate', (event, action: string) => {
    if (event.sender !== win.webContents) return;
    const history = win.webContents.navigationHistory;
    if (action === 'back' && history.canGoBack()) history.goBack();
    if (action === 'forward' && history.canGoForward()) history.goForward();
    if (action === 'home' || action === 'library')
      win.webContents.send('classic:browse', action);
    if (action === 'game' || action === 'visualizer') openEntertainment(action);
    if (action === 'game-exit') closeClassicGame(win);
    if (action === 'pin-state') return win.isAlwaysOnTop();
    if (action === 'pin') {
      const pinned = !win.isAlwaysOnTop();
      config.set('options.alwaysOnTop', pinned);
      win.setAlwaysOnTop(pinned);
      return pinned;
    }
    if (action === 'settings') openSettings(win);
    if (action === 'equalizer') openSettings(win, 'Equalizer');
    if (action === 'show') {
      closeClassicGame(win);
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    return undefined;
  });
  ipcMain.handle(
    'classic:local',
    async (event, action: string, value: unknown) => {
      const fromSettings = settings && event.sender === settings.webContents;
      const fromTray = popup && event.sender === popup.webContents;
      if (!fromSettings && !fromTray) throw new Error('Untrusted window');
      if (action === 'pin' || action === 'trayPinned') {
        const pinned =
          typeof value === 'boolean'
            ? value
            : !config.get('options.trayPinned');
        config.set('options.trayPinned', pinned);
        popup?.setAlwaysOnTop(pinned);
        settings?.webContents.send('classic:refresh');
        popup?.webContents.send('classic:refresh');
        return pinned;
      }
      if (action === 'song') {
        // Read the actual media clock; provider time events depend on optional plugins.
        const clock = (await win.webContents
          .executeJavaScript(`(() => {
          const v = document.querySelector('video');
          return v ? { elapsed: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : 0, paused: v.paused } : null;
        })()`)
          .catch(() => null)) as {
          elapsed: number;
          duration: number;
          paused: boolean;
        } | null;
        return {
          title: song.title ?? 'Nothing playing',
          artist: song.artist ?? 'Start your music',
          artwork,
          elapsed: clock?.elapsed ?? song.elapsedSeconds ?? 0,
          duration: clock?.duration || song.songDuration || 0,
          paused: clock?.paused ?? song.isPaused ?? true,
          animatedSpeakers: config.get('options.animatedSpeakers') ?? true,
          trayPinned: config.get('options.trayPinned') ?? false,
          bass: Date.now() - audioLevelAt < 500 ? audioLevel : 0,
          palette: skins[config.get('options.classicSkin')] ?? skins.graphite,
        };
      }
      if (action === 'game' || action === 'visualizer')
        return openEntertainment(action);
      if (
        action === 'seek' &&
        typeof value === 'number' &&
        Number.isFinite(value)
      )
        return getSongControls(win).seekTo(
          Math.max(0, Math.min(value, song.songDuration ?? 0)),
        );
      if (action === 'playPause')
        return win.webContents.send('classic:tray-play');
      if (action === 'next') return getSongControls(win).next();
      if (action === 'previous') return getSongControls(win).previous();
      if (action === 'show') {
        closeClassicGame(win);
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        popup?.hide();
        return;
      }
      if (action === 'settings') {
        openSettings(win);
        popup?.hide();
        return;
      }
      if (action === 'quit') return app.quit();
      if (!fromSettings) throw new Error('Settings window required');
      if (action === 'snapshot') return snapshot();
      if (action === 'equalizer') {
        if (
          !Array.isArray(value) ||
          value.length !== 10 ||
          !value.every(
            (v) =>
              typeof v === 'number' &&
              Number.isFinite(v) &&
              v >= -12 &&
              v <= 12,
          )
        )
          throw new Error('Invalid equalizer gains');
        config.setPartial('plugins.equalizer', {
          preset: 'custom',
          gains: value,
        });
        return { ok: true };
      }
      if (action === 'project')
        return shell.openExternal(
          'https://github.com/Magisterion/spear-desktop',
        );
      if (action === 'upstream')
        return shell.openExternal('https://github.com/pear-devs/pear-desktop');
      if (action === 'restart') return restart();
      if (action === 'update') {
        settings?.hide();
        return checkPortableUpdate(true);
      }
      if (action === 'minimizeOnAutoStart' && typeof value === 'boolean')
        config.set('options.minimizeOnAutoStart', value);
      if (action === 'tray' && typeof value === 'boolean') {
        config.set('options.tray', value);
        pendingRestart.add('Tray visibility');
      }
      if (action === 'trayClickOpensWindow' && typeof value === 'boolean')
        config.set('options.trayClickPlayPause', !value);
      if (action === 'animatedSpeakers' && typeof value === 'boolean') {
        config.set('options.animatedSpeakers', value);
        publishActivity();
      }
      if (action === 'autoUpdates' && typeof value === 'boolean')
        config.set('options.autoUpdates', value);
      if (
        action === 'proxy' &&
        typeof value === 'string' &&
        value.length <= 2048
      ) {
        const proxy = value.trim();
        if (proxy !== config.get('options.proxy')) {
          config.set('options.proxy', proxy);
          pendingRestart.add('Connection proxy');
        }
      }
      if (
        action === 'language' &&
        typeof value === 'string' &&
        Object.hasOwn(await languageResources(), value)
      ) {
        config.set('options.language', value);
        await setLanguage(value);
        win.webContents.send('classic:language', value);
        await refreshMenu(win);
      }
      if (
        ['skin', 'playerTheme', 'theme'].includes(action) &&
        Object.hasOwn(skins, String(value))
      ) {
        config.set('options.classicSkin', value);
        config.set('options.classicPlayerTheme', value);
        await applyStyle();
      }
      if (action === 'plugin' && typeof value === 'object' && value) {
        const { id, enabled } = value as { id: string; enabled: boolean };
        if (
          !Object.hasOwn(await allPlugins(), id) ||
          typeof enabled !== 'boolean'
        )
          throw new Error('Invalid plugin');
        config.setPartial(`plugins.${id}`, { enabled });
      }
      if (action === 'control' && typeof value === 'string') {
        const restartKeys = [
          'disableHardwareAcceleration',
          'proxy',
          'overrideUserAgent',
          'tray',
        ] as const;
        const before = restartKeys.map((key) => config.get(`options.${key}`));
        await actions.get(value)?.();
        restartKeys.forEach((key, index) => {
          if (before[index] !== config.get(`options.${key}`))
            pendingRestart.add(key);
        });
        win.setAlwaysOnTop(config.get('options.alwaysOnTop'));
        settings?.setAlwaysOnTop(win.isAlwaysOnTop(), 'pop-up-menu');
        if (value.startsWith('appearance:')) {
          await applyStyle();
          win.webContents.send('classic:appearance');
          win.setTitle(
            config.get('options.customWindowTitle') || 'YouTube Music Spear',
          );
        }
      }
      return snapshot();
    },
  );
}
