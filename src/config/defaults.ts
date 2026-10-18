export interface WindowSizeConfig {
  width: number;
  height: number;
}

export interface WindowPositionConfig {
  x: number;
  y: number;
}

export interface DefaultConfig {
  'window-size': WindowSizeConfig;
  'window-maximized': boolean;
  'window-position': WindowPositionConfig;
  'url': string;
  'options': {
    language?: string;
    classicSkin: string;
    classicPlayerTheme: string;
    animatedSpeakers: boolean;
    tray: boolean;
    appVisible: boolean;
    firstRunComplete: boolean;
    minimizeOnAutoStart: boolean;
    autoUpdates: boolean;
    alwaysOnTop: boolean;
    hideMenu: boolean;
    hideMenuWarned: boolean;
    startAtLogin: boolean;
    disableHardwareAcceleration: boolean;
    removeUpgradeButton: boolean;
    restartOnConfigChanges: boolean;
    trayClickPlayPause: boolean;
    autoResetAppCache: boolean;
    resumeOnStart: boolean;
    likeButtons: string;
    swapLikeButtonsOrder: boolean;
    proxy: string;
    startingPage: string;
    overrideUserAgent: boolean;
    usePodcastParticipantAsArtist: boolean;
    themes: string[];
    customWindowTitle?: string;
  };
  'plugins': Record<string, unknown>;
}

export const defaultConfig: DefaultConfig = {
  'window-size': {
    width: 840,
    height: 1100,
  },
  'window-maximized': false,
  'window-position': {
    x: -1,
    y: -1,
  },
  'url': 'https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com',
  'options': {
    language: 'en',
    classicSkin: 'graphite',
    classicPlayerTheme: 'graphite',
    animatedSpeakers: true,
    tray: true,
    appVisible: false,
    firstRunComplete: false,
    minimizeOnAutoStart: true,
    autoUpdates: true,
    alwaysOnTop: false,
    hideMenu: false,
    hideMenuWarned: false,
    startAtLogin: false,
    disableHardwareAcceleration: false,
    removeUpgradeButton: false,
    restartOnConfigChanges: false,
    trayClickPlayPause: true,
    autoResetAppCache: false,
    resumeOnStart: true,
    likeButtons: '',
    swapLikeButtonsOrder: false,
    proxy: '',
    startingPage: '',
    overrideUserAgent: false,
    usePodcastParticipantAsArtist: false,
    themes: [],
  },
  'plugins': {},
};
