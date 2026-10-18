import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import { setEqualizer } from '@/classic/audio';
import { presetConfigs, presetNames, type Preset } from './presets';
export type EqualizerPluginConfig = {
  enabled: boolean;
  preset: Preset | 'custom';
  gains: number[];
};
function apply(config: EqualizerPluginConfig) {
  setEqualizer(
    config.preset === 'custom'
      ? config.gains
      : [...(presetConfigs[config.preset] ?? presetConfigs.flat)],
    config.enabled,
  );
}
export default createPlugin({
  name: () => t('plugins.equalizer.name'),
  description: () =>
    'Ten-band equalizer with live presets and automatic boost headroom.',
  restartNeeded: false,
  config: {
    enabled: true,
    preset: 'flat',
    gains: [...presetConfigs.flat],
  } as EqualizerPluginConfig,
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    return [
      {
        label: 'Preset',
        submenu: [
          ...(Object.keys(presetConfigs) as Preset[]).map((preset) => ({
            label: presetNames[preset],
            type: 'radio' as const,
            checked: (config.preset ?? 'flat') === preset,
            click: () =>
              setConfig({ preset, gains: [...presetConfigs[preset]] }),
          })),
          {
            label: 'Custom',
            type: 'radio' as const,
            checked: config.preset === 'custom',
            click: () => setConfig({ preset: 'custom' }),
          },
        ],
      },
    ];
  },
  renderer: {
    async start({ getConfig }) {
      apply(await getConfig());
    },
    onConfigChange(config) {
      apply(config);
    },
    stop() {
      setEqualizer([...presetConfigs.flat], false);
    },
  },
});
