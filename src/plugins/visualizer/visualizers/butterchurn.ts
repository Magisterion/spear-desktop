import { animateVisualizer } from '@/classic/activity';
import { milkdropPresets } from '../preset-catalog';
import Butterchurn from 'butterchurn';
import ButterchurnPresets from 'butterchurn-presets';

import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

class ButterchurnVisualizer extends Visualizer {
  private readonly visualizer: ReturnType<typeof Butterchurn.createVisualizer>;
  private destroyed: boolean = false;
  private stopAnimation: () => void;

  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream,
    config: VisualizerPluginConfig,
  ) {
    super(audioSource, audioNode);

    const presets = (ButterchurnPresets.default ??
      ButterchurnPresets) as Record<string, unknown>;
    const preset =
      presets[
        config.butterchurn.preset ===
        'cope + flexi - colorful marble (ghost mix)'
          ? 'Geiss - Spiral Artifact'
          : config.butterchurn.preset
      ] ??
      presets['Geiss - Spiral Artifact'] ??
      Object.values(presets)[0];
    let nextPreset = performance.now() + 45000;
    let presetIndex = Math.max(
      0,
      milkdropPresets.indexOf(
        config.butterchurn.preset as (typeof milkdropPresets)[number],
      ),
    );
    const renderVisualizer = () => {
      if (this.destroyed) return;
      if (
        config.butterchurn.cycle &&
        performance.now() >= nextPreset &&
        !document.querySelector('video')?.paused
      ) {
        presetIndex =
          (presetIndex +
            1 +
            Math.floor(Math.random() * (milkdropPresets.length - 1))) %
          milkdropPresets.length;
        this.visualizer.loadPreset(
          presets[milkdropPresets[presetIndex]],
          config.butterchurn.blendTimeInSeconds,
        );
        nextPreset = performance.now() + 45000;
      }
      this.visualizer.render();
    };

    this.visualizer = Butterchurn.createVisualizer(audioContext, canvas, {
      width: canvas.width,
      height: canvas.height,
    });
    this.visualizer.loadPreset(preset, config.butterchurn.blendTimeInSeconds);
    this.visualizer.connectAudio(audioNode);

    // Start animation request loop. Do not use setInterval!
    this.stopAnimation = animateVisualizer(canvas, renderVisualizer);
  }

  resize(width: number, height: number) {
    this.visualizer.setRendererSize(width, height);
  }

  destroy() {
    this.stopAnimation();
    this.visualizer.disconnectAudio(this.audioNode);
    this.audioNode.disconnect();
    this.destroyed = true;
    try {
      this.audioSource.disconnect(this.audioNode);
    } catch {}
  }
}

export default ButterchurnVisualizer;
