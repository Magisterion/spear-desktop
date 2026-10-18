import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { ClassicVisualizer } from './visualizers/classic';

import emptyStyle from './empty-player.css?inline';
import {
  ButterchurnVisualizer as butterchurn,
  VudioVisualizer as vudio,
  WaveVisualizer as wave,
} from './visualizers';
import { type Visualizer } from './visualizers/visualizer';

type WaveColor = {
  gradient: string[];
  rotate?: number;
};

export type VisualizerPluginConfig = {
  enabled: boolean;
  type:
    | 'butterchurn'
    | 'vudio'
    | 'wave'
    | 'spectrum'
    | 'oscilloscope'
    | 'spectrogram'
    | 'radial'
    | 'mirror'
    | 'starfield'
    | 'ribbon';
  butterchurn: {
    preset: string;
    blendTimeInSeconds: number;
  };
  vudio: {
    effect: string;
    accuracy: number;
    lighting: {
      maxHeight: number;
      maxSize: number;
      lineWidth: number;
      color: string;
      shadowBlur: number;
      shadowColor: string;
      fadeSide: boolean;
      prettify: boolean;
      horizontalAlign: string;
      verticalAlign: string;
      dottify: boolean;
    };
  };
  wave: {
    animations: {
      type: string;
      config: {
        bottom?: boolean;
        top?: boolean;
        count?: number;
        cubeHeight?: number;
        lineWidth?: number;
        diameter?: number;
        fillColor?: string | WaveColor;
        lineColor?: string | WaveColor;
        radius?: number;
        frequencyBand?: string;
      };
    }[];
  };
};

type RenderProps = {
  visualizerInstance: Visualizer | null;
  audioContext: AudioContext | null;
  audioSource: MediaElementAudioSourceNode | null;
  observer: ResizeObserver | null;
  audioListener: ((e: DocumentEventMap['peard:audio-can-play']) => void) | null;
};

export default createPlugin({
  name: () => t('plugins.visualizer.name'),
  description: () => t('plugins.visualizer.description'),
  restartNeeded: false,
  config: {
    enabled: true,
    type: 'spectrum',
    // Config per visualizer
    butterchurn: {
      preset: 'martin [shadow harlequins shape code] - fata morgana',
      blendTimeInSeconds: 2.7,
    },
    vudio: {
      effect: 'lighting',
      accuracy: 128,
      lighting: {
        maxHeight: 160,
        maxSize: 12,
        lineWidth: 1,
        color: '#49f3f7',
        shadowBlur: 2,
        shadowColor: 'rgba(244,244,244,.5)',
        fadeSide: true,
        prettify: false,
        horizontalAlign: 'center',
        verticalAlign: 'middle',
        dottify: true,
      },
    },
    wave: {
      animations: [
        {
          type: 'Cubes',
          config: {
            bottom: true,
            count: 30,
            cubeHeight: 5,
            fillColor: { gradient: ['#FAD961', '#F76B1C'] },
            lineColor: 'rgba(0,0,0,0)',
            radius: 20,
          },
        },
        {
          type: 'Cubes',
          config: {
            top: true,
            count: 12,
            cubeHeight: 5,
            fillColor: { gradient: ['#FAD961', '#F76B1C'] },
            lineColor: 'rgba(0,0,0,0)',
            radius: 10,
          },
        },
        {
          type: 'Circles',
          config: {
            lineColor: {
              gradient: ['#FAD961', '#FAD961', '#F76B1C'],
              rotate: 90,
            },
            lineWidth: 4,
            diameter: 20,
            count: 10,
            frequencyBand: 'base',
          },
        },
      ],
    },
  } as VisualizerPluginConfig,
  stylesheets: [emptyStyle],
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    const visualizerTypes = [
      'butterchurn',
      'vudio',
      'wave',
      'spectrum',
      'oscilloscope',
      'spectrogram',
      'radial',
      'mirror',
      'starfield',
      'ribbon',
    ] as const; // For bundling

    return [
      {
        label: t('plugins.visualizer.menu.visualizer-type'),
        submenu: visualizerTypes.map((visualizerType) => ({
          label: visualizerType,
          type: 'radio',
          checked: config.type === visualizerType,
          click() {
            setConfig({ type: visualizerType });
          },
        })),
      },
    ];
  },

  renderer: {
    props: {
      visualizerInstance: null,
      audioContext: null,
      audioSource: null,
      observer: null,
      audioListener: null,
    } as RenderProps,

    createVisualizer(
      this: { props: RenderProps },
      config: VisualizerPluginConfig,
    ) {
      this.props.visualizerInstance?.destroy();
      this.props.visualizerInstance = null;

      if (!this.props.audioContext || !this.props.audioSource) return;
      if (!config.enabled) return;

      const video = document.querySelector<
        HTMLVideoElement & { captureStream(): MediaStream }
      >('video');
      if (!video) {
        return;
      }

      const visualizerContainer =
        document.querySelector<HTMLElement>('#player');
      if (!visualizerContainer) {
        return;
      }

      // WebGL and 2D contexts cannot be switched on the same canvas.
      document.querySelector('#visualizer')?.remove();
      document.querySelector('#spear-visualizer-tools')?.remove();
      let canvas = document.querySelector<HTMLCanvasElement>('#visualizer');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'visualizer';
        canvas.tabIndex = 0;
        canvas.setAttribute('role', 'button');
        canvas.setAttribute(
          'aria-label',
          'Open visualizer fullscreen. Right-click to change visualizer.',
        );
        canvas.title =
          'Click for fullscreen · Right-click to change visualizer';
        const fullscreen = () => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void canvas!.requestFullscreen().catch(() => {});
        };
        canvas.onclick = fullscreen;
        canvas.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fullscreen();
          }
        };
        canvas.oncontextmenu = (e) => {
          e.preventDefault();
          window.ipcRenderer.invoke('classic:visualizer-menu');
        };
        visualizerContainer?.prepend(canvas);
        const toolbar = document.createElement('div');
        toolbar.id = 'spear-visualizer-tools';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'Visualizer controls');
        const makeButton = (label: string, action: () => void) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = label;
          button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            action();
          };
          toolbar.append(button);
        };
        makeButton('Visualizer', () => {
          void window.ipcRenderer.invoke('classic:visualizer-menu');
        });
        makeButton('Equalizer', () => {
          void window.ipcRenderer.invoke('classic:navigate', 'equalizer');
        });
        makeButton('Fullscreen', fullscreen);
        (
          visualizerContainer.closest('#player-container') ??
          visualizerContainer
        ).after(toolbar);
      }

      const gainNode = this.props.audioContext.createGain();
      gainNode.gain.value = 1.25;
      this.props.audioSource.connect(gainNode);

      let visualizerType: {
        new (...args: ConstructorParameters<typeof vudio>): Visualizer;
      } = vudio;
      if (config.type === 'wave') {
        visualizerType = wave;
      } else if (config.type === 'butterchurn') {
        visualizerType = butterchurn;
      }
      if (
        [
          'spectrum',
          'oscilloscope',
          'spectrogram',
          'radial',
          'mirror',
          'starfield',
          'ribbon',
        ].includes(config.type)
      )
        visualizerType = ClassicVisualizer;
      this.props.visualizerInstance = new visualizerType(
        this.props.audioContext,
        this.props.audioSource,
        canvas,
        gainNode,
        config.type === 'vudio' && typeof video.captureStream === 'function'
          ? video.captureStream()
          : new MediaStream(),
        config,
      );

      const resizeVisualizer = () => {
        if (canvas && visualizerContainer) {
          const { width, height } =
            document.fullscreenElement === canvas
              ? {
                  width: String(window.innerWidth),
                  height: String(window.innerHeight),
                }
              : window.getComputedStyle(visualizerContainer);
          canvas.width = Math.ceil(parseFloat(width));
          canvas.height = Math.ceil(parseFloat(height));
        }
        this.props.visualizerInstance?.resize(canvas.width, canvas.height);
      };
      resizeVisualizer();

      this.props.observer?.disconnect();
      this.props.observer = new ResizeObserver(resizeVisualizer);
      this.props.observer.observe(visualizerContainer);
      this.props.observer.observe(canvas);
    },

    stop() {
      this.props.visualizerInstance?.destroy();
      this.props.visualizerInstance = null;
      this.props.observer?.disconnect();
      if (this.props.audioListener)
        document.removeEventListener(
          'peard:audio-can-play',
          this.props.audioListener,
        );
      this.props.audioListener = null;
      document.querySelector('#visualizer')?.remove();
      document.querySelector('#spear-visualizer-tools')?.remove();
    },

    onConfigChange(newConfig) {
      this.createVisualizer(newConfig);
    },

    async onPlayerApiReady(_, { getConfig }) {
      if (this.props.audioListener)
        document.removeEventListener(
          'peard:audio-can-play',
          this.props.audioListener,
        );
      this.props.audioListener = async (e) => {
        this.props.audioContext = e.detail.audioContext;
        this.props.audioSource = e.detail.audioSource;
        this.createVisualizer(await getConfig());
      };
      document.addEventListener(
        'peard:audio-can-play',
        this.props.audioListener,
        { passive: true },
      );
      if (this.props.audioContext && this.props.audioSource)
        this.createVisualizer(await getConfig());
    },
  },
});
