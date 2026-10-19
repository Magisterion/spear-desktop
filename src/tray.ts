import { createHash } from 'node:crypto';
import PausedTrayIconWhite from '@assets/tray-paused-white.png?asset&asarUnpack';
import PausedTrayIcon from '@assets/tray-paused.png?asset&asarUnpack';
import TrayIconWhite from '@assets/tray-white.png?asset&asarUnpack';
import TrayIcon from '@assets/tray.png?asset&asarUnpack';
import { Menu, nativeImage, screen, Tray } from 'electron';
import is from 'electron-is';

import { APPLICATION_NAME, t } from '@/i18n';

import * as config from './config';
import { restart } from './providers/app-controls';
import { getSongControls } from './providers/song-controls';
import { registerCallback, SongInfoEvent } from './providers/song-info';

import { showTrayPopup } from './classic/main';

import type { MenuTemplate } from './menu';

// Prevent tray being garbage collected
let tray: Electron.Tray | undefined;

type TrayEvent = (
  event: Electron.KeyboardEvent,
  bounds: Electron.Rectangle,
) => void;

export const setTrayOnClick = (fn: TrayEvent) => {
  if (!tray) {
    return;
  }

  tray.removeAllListeners('click');
  tray.on('click', fn);
};

// Won't do anything on macOS since its disabled
export const setTrayOnDoubleClick = (fn: TrayEvent) => {
  if (!tray) {
    return;
  }

  tray.removeAllListeners('double-click');
  tray.on('double-click', fn);
};

export const setUpTray = (app: Electron.App, win: Electron.BrowserWindow) => {
  if (!config.get('options.tray')) {
    tray = undefined;
    return;
  }

  const { playPause, next, previous } = getSongControls(win);

  const pixelRatio = is.windows()
    ? screen.getPrimaryDisplay().scaleFactor || 1
    : 1;

  const defaultTrayIcon = nativeImage
    .createFromPath(is.macOS() ? TrayIconWhite : TrayIcon)
    .resize({
      width: 16 * pixelRatio,
      height: 16 * pixelRatio,
    });
  const pausedTrayIcon = nativeImage
    .createFromPath(is.macOS() ? PausedTrayIconWhite : PausedTrayIcon)
    .resize({
      width: 16 * pixelRatio,
      height: 16 * pixelRatio,
    });

  // Unsigned Windows tray identities are tied to the actual executable path.
  // The portable runtime path is stable across releases; distinguish other paths.
  const identity = createHash('sha256')
    .update(process.execPath.toLowerCase())
    .digest('hex');
  const guid = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-4${identity.slice(13, 16)}-a${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
  tray = new Tray(defaultTrayIcon, is.windows() ? guid : undefined);

  tray.setToolTip(
    t('main.tray.tooltip.default', {
      applicationName: APPLICATION_NAME,
    }),
  );

  // MacOS only
  tray.setIgnoreDoubleClickEvents(false);

  // Delay the single action so a double-click cannot also pause playback.
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  const clearClick = () => {
    clearTimeout(clickTimer);
    clickTimer = undefined;
  };
  const showWindow = () => {
    win.show();
    win.focus();
    app.dock?.show();
  };
  const togglePlayback = () => win.webContents.send('classic:tray-play');
  tray.on('click', () => {
    clearClick();
    if (win.isDestroyed()) return;
    clickTimer = setTimeout(() => {
      clickTimer = undefined;
      if (win.isDestroyed()) return;
      if (config.get('options.trayClickPlayPause')) togglePlayback();
      else showWindow();
    }, 350);
  });
  tray.on('double-click', () => {
    clearClick();
    if (win.isDestroyed()) return;
    if (config.get('options.trayClickPlayPause')) showWindow();
    else togglePlayback();
  });
  tray.on('right-click', clearClick);
  win.once('closed', clearClick);
  app.once('before-quit', clearClick);

  const template: MenuTemplate = [
    {
      label: t('main.tray.play-pause'),
      click() {
        playPause();
      },
    },
    {
      label: t('main.tray.next'),
      click() {
        next();
      },
    },
    {
      label: t('main.tray.previous'),
      click() {
        previous();
      },
    },
    {
      label: t('main.tray.show'),
      click() {
        win.show();
        app.dock?.show();
      },
    },
    { type: 'separator' },
    {
      label: t('main.tray.restart'),
      click: restart,
    },
    { type: 'separator' },
    {
      label: t('main.tray.quit'),
      role: 'quit',
    },
  ];

  const trayMenu = Menu.buildFromTemplate(template);
  if (is.windows()) tray.on('right-click', () => showTrayPopup(win));
  else tray.setContextMenu(trayMenu);

  registerCallback((songInfo, event) => {
    if (event === SongInfoEvent.TimeChanged) return;

    if (tray) {
      if (typeof songInfo.isPaused === 'undefined') {
        tray.setImage(defaultTrayIcon);
        return;
      }

      tray.setToolTip(
        `${APPLICATION_NAME}\n${[songInfo.artist, songInfo.title].filter(Boolean).join(' — ')}`,
      );

      tray.setImage(songInfo.isPaused ? pausedTrayIcon : defaultTrayIcon);
    }
  });
};
