import { deepmerge } from 'deepmerge-ts';
import { app, BrowserWindow, ipcMain, Menu, screen, shell } from 'electron';
import { languageResources } from 'virtual:i18n';
import { allPlugins } from 'virtual:plugins';

import * as config from '@/config';
import { setLanguage } from '@/i18n';
import { restart } from '@/providers/app-controls';
import { getSongControls } from '@/providers/song-controls';
import { registerCallback, type SongInfo } from '@/providers/song-info';

import compactCss from './compact.css?inline';
import localPreload from './preload.cjs?asset';
import settingsPage from './settings.html?asset';
import trayPage from './tray.html?asset';
import { checkPortableUpdate } from './updater';

import type { PluginConfig } from '@/types/plugins';

let settings: BrowserWindow | null = null;
let popup: BrowserWindow | null = null;
let song: Partial<SongInfo> = {};
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

export function openSettings(win: BrowserWindow) {
  player = win;
  if (settings && !settings.isDestroyed()) {
    settings.show();
    settings.focus();
    return;
  }
  settings = localWindow(940, 720);
  settings.on('closed', () => {
    settings = null;
  });
  settings.once('ready-to-show', () => settings?.show());
  settings.loadFile(settingsPage);
}

export function showTrayPopup(win: BrowserWindow) {
  player = win;
  if (!popup || popup.isDestroyed()) {
    popup = localWindow(380, 210, false);
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
    Math.max(area.x, Math.min(cursor.x - 190, area.x + area.width - 380)),
    Math.max(area.y, Math.min(cursor.y - 220, area.y + area.height - 210)),
  );
  popup.show();
  popup.focus();
}

function category(id: string) {
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
      ['classic-proxy', 'classic-auto-updates'].includes(item.id ?? '')
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
    general: controls(
      options.filter((item) => !item.label?.includes('(Language)')),
      'general',
    ),
    plugins: cards.sort((a, b) => a.name.localeCompare(b.name)),
    languages: Object.entries(resources).map(([id, value]) => ({
      id,
      name: value.translation.language?.['local-name'] ?? id,
    })),
    language: config.get('options.language'),
    skin: config.get('options.classicSkin'),
    restart: [...pendingRestart],
  };
}

export function setupClassic(win: BrowserWindow) {
  player = win;
  registerCallback((info) => {
    song = info;
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
    const accent =
      skin === 'amber' ? '#ffbb54' : skin === 'green' ? '#8fe388' : '#a9bdd4';
    cssKey = await win.webContents.insertCSS(
      compactCss +
        `:root { --classic-accent: ${accent}; } ytmusic-player-bar { border-top: 1px solid ${accent} !important; }`,
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
    };
    Menu.buildFromTemplate(
      Object.entries(names).map(([type, label]) => ({
        label,
        type: 'radio' as const,
        checked:
          (config.get('plugins.visualizer') as { type?: string })?.type ===
          type,
        click: () => config.setPartial('plugins.visualizer', { type }),
      })),
    ).popup({ window: win });
  });
  ipcMain.handle('classic:navigate', (event, action: string) => {
    if (event.sender !== win.webContents) return;
    const history = win.webContents.navigationHistory;
    if (action === 'back' && history.canGoBack()) history.goBack();
    if (action === 'forward' && history.canGoForward()) history.goForward();
    if (action === 'home') win.loadURL('https://music.youtube.com/');
    if (action === 'library') win.loadURL('https://music.youtube.com/library');
    if (action === 'settings') openSettings(win);
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
          artist: song.artist ?? 'Spear',
          paused: song.isPaused ?? true,
        };
      if (action === 'playPause') return getSongControls(win).playPause();
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
        action === 'skin' &&
        ['graphite', 'green', 'amber'].includes(String(value))
      ) {
        config.set('options.classicSkin', value);
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
      }
      return snapshot();
    },
  );
}
