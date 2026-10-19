import { watchVisualizer } from '@/classic/activity';
import Vudio from 'vudio/umd/vudio';

import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

class VudioVisualizer extends Visualizer {
  private readonly visualizer: Vudio;
  private readonly stopAnimation: () => void;
  private readonly stream: MediaStream;

  constructor(
    _audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    stream: MediaStream,
    config: VisualizerPluginConfig,
  ) {
    super(audioSource, audioNode);
    this.stream = stream;

    this.visualizer = new Vudio(stream, canvas, {
      width: canvas.width,
      height: canvas.height,
      // Visualizer config
      ...config,
    });

    this.stopAnimation = watchVisualizer(canvas, (active) => {
      if (active) {
        void this.visualizer.analyser.context.resume();
        this.visualizer.dance();
      } else {
        this.visualizer.pause();
        void this.visualizer.analyser.context.suspend();
      }
    });
  }

  resize(width: number, height: number) {
    this.visualizer.setOption({
      width,
      height,
    });
  }

  destroy() {
    this.stopAnimation();
    this.visualizer.analyser.disconnect();
    void this.visualizer.analyser.context.close();
    this.stream.getTracks().forEach((track) => track.stop());
    this.audioNode.disconnect();
    try {
      this.audioSource.disconnect(this.audioNode);
    } catch {}
  }
}

export default VudioVisualizer;
