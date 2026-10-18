import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

/** Original Canvas renderers; no third-party artwork, presets or trademarks. */
export class ClassicVisualizer extends Visualizer {
  private analyser: AnalyserNode;
  private frame = 0;
  private samples: Uint8Array<ArrayBuffer>;
  private peaks = new Float32Array(48);
  private lastTime = 0;
  constructor(
    context: AudioContext,
    source: MediaElementAudioSourceNode,
    private canvas: HTMLCanvasElement,
    gain: GainNode,
    _stream: MediaStream,
    private config: VisualizerPluginConfig,
  ) {
    super(source, gain);
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    gain.connect(this.analyser);
    this.samples = new Uint8Array(this.analyser.frequencyBinCount);
    this.frame = requestAnimationFrame(this.draw);
  }
  private draw = (now: number) => {
    this.frame = requestAnimationFrame(this.draw);
    if (document.hidden || now - this.lastTime < 1000 / 30) return;
    this.lastTime = now;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    if (this.config.type === 'spectrogram') {
      this.analyser.getByteFrequencyData(this.samples);
      ctx.drawImage(this.canvas, -2, 0);
      for (let y = 0; y < h; y += 2) {
        const index = Math.min(
          this.samples.length - 1,
          Math.floor(Math.pow(y / h, 2) * this.samples.length),
        );
        const v = this.samples[index] / 255;
        ctx.fillStyle = `hsl(${210 - v * 180} 90% ${v * 60}%)`;
        ctx.fillRect(w - 2, h - y - 2, 2, 2);
      }
      return;
    }
    ctx.fillStyle = '#080d0a';
    ctx.fillRect(0, 0, w, h);
    if (this.config.type === 'oscilloscope') {
      this.analyser.getByteTimeDomainData(this.samples);
      ctx.strokeStyle = '#152a1d';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = '#92f3a0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.samples.forEach((v, i) => {
        const x = (i / (this.samples.length - 1)) * w;
        const y = (v / 255) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      return;
    }
    this.analyser.getByteFrequencyData(this.samples);
    const bw = w / 48;
    for (let i = 0; i < 48; i++) {
      const from = Math.floor(Math.pow(i / 48, 2) * this.samples.length);
      const to = Math.max(
        from + 1,
        Math.floor(Math.pow((i + 1) / 48, 2) * this.samples.length),
      );
      let value = 0;
      for (let j = from; j < to; j++) value = Math.max(value, this.samples[j]);
      const level = (value / 255) * (h - 12);
      this.peaks[i] = Math.max(level, this.peaks[i] - 1.8);
      for (let y = 0; y < level; y += 5) {
        ctx.fillStyle =
          y > h * 0.75 ? '#ff795c' : y > h * 0.5 ? '#e5d46d' : '#81db82';
        ctx.fillRect(i * bw + 1, h - y - 4, Math.max(1, bw - 2), 3);
      }
      ctx.fillStyle = '#d6ebcc';
      ctx.fillRect(i * bw + 1, h - this.peaks[i] - 5, Math.max(1, bw - 2), 2);
    }
  };
  resize(width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    this.analyser.disconnect();
    this.audioNode.disconnect();
    try {
      this.audioSource.disconnect(this.audioNode);
    } catch {}
  }
}
