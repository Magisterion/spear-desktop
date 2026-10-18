/** Original bundled palettes; no external theme assets or network requests. */
export const skins: Record<
  string,
  {
    name: string;
    accent: string;
    top: string;
    bottom: string;
    surface: string;
    pixel?: boolean;
    text?: string;
    muted?: string;
    accentText?: string;
  }
> = {
  'pixel-night': {
    name: 'Pixel night',
    accent: '#ffcc66',
    top: '#39346a',
    bottom: '#1d1b36',
    surface: '#121325',
    text: '#e8e4ff',
    muted: '#aba6d4',
    pixel: true,
  },
  'pocket-lcd': {
    name: 'Pocket LCD',
    accent: '#364a2b',
    top: '#c2cba1',
    bottom: '#9eaf7c',
    surface: '#b4c491',
    text: '#26391f',
    muted: '#46583c',
    accentText: '#edf2d5',
    pixel: true,
  },
  silver: {
    name: 'Silver deck',
    accent: '#315b82',
    top: '#e2e6ed',
    bottom: '#aab6c7',
    surface: '#d0d8e3',
    text: '#142b41',
    muted: '#405b72',
    accentText: '#ffffff',
  },
  steel: {
    name: 'Steel blue',
    accent: '#c1d6ee',
    top: '#536981',
    bottom: '#25374e',
    surface: '#1b2c42',
  },
  retro: {
    name: 'Classic midnight',
    accent: '#8eff37',
    top: '#34374b',
    bottom: '#181a29',
    surface: '#0a0d12',
    text: '#d6dfc9',
    muted: '#9eae8f',
  },
  graphite: {
    name: 'Graphite',
    accent: '#a9bdd4',
    top: '#30343c',
    bottom: '#1b1e24',
    surface: '#17191d',
  },
  green: {
    name: 'Green phosphor',
    accent: '#8fe388',
    top: '#263e30',
    bottom: '#111f18',
    surface: '#101a14',
  },
  amber: {
    name: 'Amber display',
    accent: '#ffbb54',
    top: '#493c25',
    bottom: '#231b10',
    surface: '#211b13',
  },
  midnight: {
    name: 'Midnight blue',
    accent: '#83bcff',
    top: '#223d60',
    bottom: '#101d33',
    surface: '#101925',
  },
  plum: {
    name: 'Plum',
    accent: '#dfacf4',
    top: '#49324f',
    bottom: '#25192d',
    surface: '#201824',
  },
  burgundy: {
    name: 'Burgundy',
    accent: '#ffaba7',
    top: '#523137',
    bottom: '#29181d',
    surface: '#23171a',
  },
};
