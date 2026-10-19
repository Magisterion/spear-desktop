import { animateVisualizer } from '@/classic/activity';
import { Wave } from '@foobar404/wave';

import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

class WaveVisualizer extends Visualizer {
  private readonly visualizer: Wave;
  private readonly analyser: AnalyserNode;
  private readonly stopAnimation: () => void;

  constructor(
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
    canvas: HTMLCanvasElement,
    audioNode: GainNode,
    _stream: MediaStream,
    config: VisualizerPluginConfig,
  ) {
    super(audioSource, audioNode);

    // Wave 2.0.5 has no stop API and connects its source to the destination.
    // Use its animation catalogue without starting its unmanaged audio/RAF loop.
    this.visualizer = new Wave(
      null as unknown as ConstructorParameters<typeof Wave>[0],
      canvas,
      true,
    );
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    audioNode.connect(this.analyser);
    const samples = new Uint8Array(this.analyser.frequencyBinCount);
    const animations: {
      draw(data: Uint8Array, context: CanvasRenderingContext2D): void;
    }[] = [];
    for (const animation of config.wave.animations) {
      const TargetVisualizer =
        this.visualizer.animations[
          animation.type as keyof typeof this.visualizer.animations
        ];

      animations.push(
        new TargetVisualizer(animation.config as never), // Magic of Typescript
      );
    }
    this.stopAnimation = animateVisualizer(canvas, () => {
      const context = canvas.getContext('2d');
      if (!context) return;
      this.analyser.getByteFrequencyData(samples);
      context.clearRect(0, 0, canvas.width, canvas.height);
      animations.forEach((animation) => animation.draw(samples, context));
    });
  }

  resize(_: number, __: number) {}

  destroy() {
    this.stopAnimation();
    this.analyser.disconnect();
    this.audioNode.disconnect();
    try {
      this.audioSource.disconnect(this.audioNode);
    } catch {}
  }
}

export default WaveVisualizer;
