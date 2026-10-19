import { milkdropPresets } from './preset-catalog';
import { getAudioGraph } from '@/classic/audio';
import { createVisualizerStage } from './stage';
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
    | 'ribbon'
    | 'pipes'
    | 'mystify'
    | 'bubbles';
  coverBackground: boolean;
  butterchurn: {
    preset: string;
    blendTimeInSeconds: number;
    cycle: boolean;
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
  stage: ReturnType<typeof createVisualizerStage> | null;
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
    coverBackground: true,
    // Config per visualizer
    butterchurn: {
      preset: 'Geiss - Spiral Artifact',
      blendTimeInSeconds: 2.7,
      cycle: true,
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
      'pipes',
      'mystify',
      'bubbles',
    ] as const; // For bundling

    return [
      {
        label: 'MilkDrop preset',
        submenu: milkdropPresets.map((preset) => ({
          label: preset,
          type: 'radio' as const,
          checked:
            (config.butterchurn.preset ===
            'cope + flexi - colorful marble (ghost mix)'
              ? 'Geiss - Spiral Artifact'
              : config.butterchurn.preset) === preset,
          click() {
            setConfig({
              type: 'butterchurn',
              butterchurn: { ...config.butterchurn, preset },
            });
          },
        })),
      },
      {
        label: 'Randomize MilkDrop presets every 45 seconds',
        type: 'checkbox',
        checked: !!config.butterchurn.cycle,
        click(item) {
          setConfig({
            butterchurn: { ...config.butterchurn, cycle: item.checked },
          });
        },
      },
      {
        label: 'Album cover background (compatible visualizers)',
        type: 'checkbox',
        checked: config.coverBackground !== false,
        click(item) {
          setConfig({ coverBackground: item.checked });
        },
      },
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
      stage: null,
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

      this.props.stage ??= createVisualizerStage();
      const visualizerContainer = this.props.stage.container;
      visualizerContainer.classList.toggle(
        'cover-background',
        config.coverBackground !== false &&
          [
            'spectrum',
            'oscilloscope',
            'radial',
            'mirror',
            'starfield',
            'bubbles',
          ].includes(config.type),
      );
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
        let menuOpen = false;
        let menuClosedAt = -Infinity;
        const fullscreen = () => {
          if (menuOpen || performance.now() - menuClosedAt < 200) return;
          if (document.fullscreenElement) void document.exitFullscreen();
          else {
            this.props.stage?.showVisualizer();
            void visualizerContainer.requestFullscreen().catch(() => {});
          }
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
          menuOpen = true;
          void window.ipcRenderer
            .invoke('classic:visualizer-menu')
            .finally(() => {
              menuOpen = false;
              menuClosedAt = performance.now();
            });
        };
        visualizerContainer?.prepend(canvas);
        const toolbar = document.createElement('div');
        toolbar.id = 'spear-visualizer-tools';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'Visualizer controls');
        const makeButton = (
          label: string,
          icon: string,
          action: () => void,
        ) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.title = label;
          button.setAttribute('aria-label', label);
          const svg = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'svg',
          );
          svg.setAttribute('viewBox', '0 0 24 24');
          const path = document.createElementNS(svg.namespaceURI, 'path');
          path.setAttribute('d', icon);
          svg.append(path);
          button.append(svg);
          button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            action();
          };
          toolbar.append(button);
          return button;
        };
        const toggle = makeButton(
          'Visualizer / cover or video',
          'M3 12h3l3-8 4 16 3-8h5',
          () => {
            toggle.setAttribute(
              'aria-pressed',
              String(this.props.stage?.toggleMedia()),
            );
          },
        );
        toggle.setAttribute(
          'aria-pressed',
          String(!visualizerContainer.classList.contains('media')),
        );
        makeButton(
          'Equalizer',
          'M5 3v7m0 4v7M12 3v12m0 4v2M19 3v3m0 4v11M2 10h6v4H2zM9 15h6v4H9zM16 6h6v4h-6z',
          () => {
            void window.ipcRenderer.invoke('classic:navigate', 'equalizer');
          },
        );
        makeButton(
          'Fullscreen',
          'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6',
          fullscreen,
        );
        const nativeAction = (selector: string) => {
          document
            .querySelector<HTMLElement>(`ytmusic-player ${selector}`)
            ?.click();
        };
        const open = makeButton(
          'Expand or minimize player',
          'M4 9l8 7 8-7',
          () => {
            nativeAction(
              visualizerContainer.classList.contains('mini')
                ? '.player-maximize-button'
                : '.player-minimize-button',
            );
          },
        );
        open.className = 'player-action';
        const dismiss = makeButton(
          'Close mini player',
          'M6 6l12 12M6 18L18 6',
          () => {
            this.props.stage?.dismissMini();
          },
        );
        dismiss.className = 'mini-action';
        visualizerContainer.append(toolbar);
      }

      canvas.width = Math.max(
        1,
        Math.round(visualizerContainer.getBoundingClientRect().width),
      );
      canvas.height = 180;
      const gainNode = this.props.audioContext.createGain();
      gainNode.gain.value = 1;
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
          'pipes',
          'mystify',
          'bubbles',
        ].includes(config.type)
      )
        visualizerType = ClassicVisualizer;
      try {
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
      } catch (error) {
        // A disabled/unavailable WebGL backend must not leave a black panel.
        console.warn(
          'Visualizer unavailable; using the Canvas spectrum.',
          error,
        );
        gainNode.disconnect();
        const fallback = canvas.cloneNode(false) as HTMLCanvasElement;
        fallback.onclick = canvas.onclick;
        fallback.onkeydown = canvas.onkeydown;
        fallback.oncontextmenu = canvas.oncontextmenu;
        canvas.replaceWith(fallback);
        canvas = fallback;
        canvas.title =
          'Canvas spectrum fallback. Right-click to select another visualizer.';
        this.props.visualizerInstance = new ClassicVisualizer(
          this.props.audioContext,
          this.props.audioSource,
          canvas,
          gainNode,
          new MediaStream(),
          { ...config, type: 'spectrum' },
        );
      }

      const resizeVisualizer = () => {
        const rect = visualizerContainer.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          this.props.visualizerInstance?.resize(width, height);
        }
      };
      resizeVisualizer();

      this.props.observer?.disconnect();
      this.props.observer = new ResizeObserver(resizeVisualizer);
      this.props.observer.observe(visualizerContainer);
      this.props.observer.observe(canvas);
    },

    stop() {
      this.props.stage?.dispose();
      this.props.stage = null;
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
      const graph = getAudioGraph();
      if (graph) {
        this.props.audioContext = graph.audioContext;
        this.props.audioSource = graph.audioSource;
      }
      if (this.props.audioListener)
        document.removeEventListener(
          'peard:audio-can-play',
          this.props.audioListener,
        );
      this.props.audioListener = async (e) => {
        if (
          this.props.audioSource === e.detail.audioSource &&
          this.props.visualizerInstance
        )
          return;
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
