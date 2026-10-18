export const presetConfigs = {
  'flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'warm': [3, 3, 2, 1, 0, 0, -1, -1, -2, -2],
  'bass-boost': [5, 4, 3, 1, 0, 0, 0, 0, 0, 0],
  'vocal': [-2, -2, -1, 0, 2, 3, 3, 2, 0, -1],
  'rock': [3, 2, 1, -1, -2, 0, 2, 3, 3, 2],
  'electronic': [4, 3, 1, 0, -1, 1, 0, 2, 3, 3],
  'acoustic': [1, 1, 2, 1, 0, 1, 2, 2, 1, 1],
  'soft': [-1, 0, 1, 1, 1, 0, -1, -2, -3, -4],
} as const;
export type Preset = keyof typeof presetConfigs;
export const presetNames: Record<Preset, string> = {
  flat: 'Flat (default)',
  warm: 'Warm',
  'bass-boost': 'Bass boost',
  vocal: 'Vocal clarity',
  rock: 'Rock',
  electronic: 'Electronic',
  acoustic: 'Acoustic',
  soft: 'Soft listening',
};
