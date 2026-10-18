/** Original bundled palettes; no external theme assets or network requests. */
export const skins: Record<
  string,
  { name: string; accent: string; top: string; bottom: string; surface: string }
> = {
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
