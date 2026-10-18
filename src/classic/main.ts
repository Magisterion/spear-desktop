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
let artworkImage: SongInfo['image'];
let player: BrowserWindow;
const pendingRestart = new Set<string>();
const actions = new Map<string, () => unknown>();
export const markRestartNeeded = (reason: string) => pendingRestart.add(reason);

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
    alwaysOnTop: !frame,
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
    popup = localWindow(400, 236, false);
    popup.on('blur', () => popup?.hide());
    popup.on('closed', () => {
      popup = null;
    });
    popup.once('ready-to-show', () => showTrayPopup(win));
    popup.loadFile(trayPage);
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  popup.setPosition(
    Math.max(area.x, Math.min(cursor.x - 200, area.x + area.width - 400)),
    Math.max(area.y, Math.min(cursor.y - 246, area.y + area.height - 236)),
  );
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
    version: app.getVersion(),
    autoUpdates: config.get('options.autoUpdates'),
    proxy: config.get('options.proxy'),
    minimizeOnAutoStart: config.get('options.minimizeOnAutoStart') ?? true,
    tray: config.get('options.tray'),
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

export function setupClassic(win: BrowserWindow) {
  player = win;
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
      skins[config.get('options.classicPlayerTheme')] ?? skins.graphite;
    const custom = await Promise.all(
      (config.get('options.themes') ?? []).map((file) =>
        readFile(file, 'utf8').catch(() => ''),
      ),
    );
    cssKey = await win.webContents.insertCSS(
      compactCss +
        `:root { --classic-accent: ${accent}; --classic-top: ${top}; --classic-bottom: ${bottom}; --classic-surface: ${surface}; --shell-radius: ${palette.pixel ? '0px' : '6px'}; --shell-font: ${palette.pixel ? 'monospace' : 'inherit'}; --player-radius: ${contentPalette.pixel ? '0px' : '8px'}; --player-font: ${contentPalette.pixel ? 'monospace' : 'inherit'}; --classic-text: ${palette.text ?? '#edf1f7'}; --player-accent: ${contentPalette.accent}; --player-surface: ${contentPalette.surface}; --player-top: ${contentPalette.top}; --player-bottom: ${contentPalette.bottom}; --player-text: ${contentPalette.text ?? '#edf1f7'}; --player-muted: ${contentPalette.muted ?? '#a9b1bf'}; } ytmusic-player-bar { border-top: 1px solid ${accent} !important; }` +
        custom.join('\n'),
    );
  };
  win.webContents.on('did-finish-load', () => {
    applyStyle();
  });
  applyStyle();
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
    };
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
      { label: 'Equalizer…', click: () => openSettings(win, 'Equalizer') },
    ]).popup({ window: win });
  });
  ipcMain.handle('classic:navigate', (event, action: string) => {
    if (event.sender !== win.webContents) return;
    const history = win.webContents.navigationHistory;
    if (action === 'back' && history.canGoBack()) history.goBack();
    if (action === 'forward' && history.canGoForward()) history.goForward();
    if (action === 'home') win.loadURL('https://music.youtube.com/');
    if (action === 'library') win.loadURL('https://music.youtube.com/library');
    if (action === 'settings') openSettings(win);
    if (action === 'equalizer') openSettings(win, 'Equalizer');
    if (action === 'show') {
      win.show();
      win.focus();
    }
  });
  ipcMain.handle(
    'classic:local',
    async (event, action: string, value: unknown) => {
      const fromSettings = settings && event.sender === settings.webContents;
      const fromTray = popup && event.sender === popup.webContents;
      if (!fromSettings && !fromTray) throw new Error('Untrusted window');
      if (action === 'song')
        return {
          title: song.title ?? 'Nothing playing',
          artist: song.artist ?? 'Start your music',
          artwork,
          elapsed: song.elapsedSeconds ?? 0,
          duration: song.songDuration ?? 0,
          paused: song.isPaused ?? true,
          palette: skins[config.get('options.classicSkin')] ?? skins.graphite,
        };
      if (action === 'playPause')
        return win.webContents.send('classic:tray-play');
      if (action === 'next') return getSongControls(win).next();
      if (action === 'previous') return getSongControls(win).previous();
      if (action === 'show') {
        win.show();
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
      if (action === 'project')
        return shell.openExternal(
          'https://github.com/Magisterion/spear-desktop',
        );
      if (action === 'upstream')
        return shell.openExternal('https://github.com/pear-devs/pear-desktop');
      if (action === 'restart') return restart();
      if (action === 'update') return checkPortableUpdate(true);
      if (action === 'minimizeOnAutoStart' && typeof value === 'boolean')
        config.set('options.minimizeOnAutoStart', value);
      if (action === 'tray' && typeof value === 'boolean') {
        config.set('options.tray', value);
        pendingRestart.add('Tray visibility');
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
      if (action === 'skin' && Object.hasOwn(skins, String(value))) {
        config.set('options.classicSkin', value);
        await applyStyle();
      }
      if (action === 'playerTheme' && Object.hasOwn(skins, String(value))) {
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
