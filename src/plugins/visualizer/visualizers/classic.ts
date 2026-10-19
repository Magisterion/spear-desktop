import { animateVisualizer } from '@/classic/activity';
import { Visualizer } from './visualizer';

import type { VisualizerPluginConfig } from '../index';

/** Original Canvas renderers; no third-party artwork, presets or trademarks. */
export class ClassicVisualizer extends Visualizer {
  private analyser: AnalyserNode;
  private stopAnimation: () => void;
  private samples: Uint8Array<ArrayBuffer>;
  private peaks = new Float32Array(48);
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
    this.stopAnimation = animateVisualizer(canvas, this.draw);
  }
  private draw = (now: number) => {
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
    const mode = this.config.type;
    const cover =
      this.config.coverBackground !== false &&
      [
        'spectrum',
        'oscilloscope',
        'radial',
        'mirror',
        'starfield',
        'bubbles',
      ].includes(mode);
    if (cover) ctx.clearRect(0, 0, w, h);
    if (['pipes', 'mystify', 'bubbles'].includes(mode)) {
      this.analyser.getByteFrequencyData(this.samples);
      const energy =
        this.samples.subarray(0, 96).reduce((a, b) => a + b, 0) / (96 * 255);
      const t = now / 1000;
      if (!cover) {
        ctx.fillStyle = mode === 'mystify' ? 'rgba(5,8,18,.12)' : '#050812';
        ctx.fillRect(0, 0, w, h);
      }
      if (mode === 'mystify') {
        for (let shape = 0; shape < 3; shape++) {
          ctx.strokeStyle = `hsl(${shape * 100 + t * 18} 85% 65%)`;
          ctx.lineWidth = 1 + energy * 2;
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const x =
              (0.5 +
                0.43 * Math.sin(t * (0.31 + i * 0.037) + i * 2.4 + shape)) *
              w;
            const y =
              (0.5 +
                0.43 * Math.cos(t * (0.27 + i * 0.051) + i * 1.7 + shape)) *
              h;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      } else if (mode === 'bubbles') {
        for (let i = 0; i < 18; i++) {
          const radius =
            Math.min(w, h) * (0.035 + (i % 4) * 0.015) * (1 + energy * 0.35);
          const x =
            (0.5 + 0.45 * Math.sin(t * (0.11 + i * 0.003) + i * 2.4)) * w;
          const y =
            (0.5 + 0.43 * Math.cos(t * (0.14 + i * 0.004) + i * 1.7)) * h;
          const g = ctx.createRadialGradient(
            x - radius * 0.3,
            y - radius * 0.3,
            1,
            x,
            y,
            radius,
          );
          g.addColorStop(0, '#ffffff50');
          g.addColorStop(0.6, '#ffffff05');
          g.addColorStop(1, `hsla(${i * 24 + t * 8} 85% 75% / .65)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Original rotating orthogonal pipe paths, projected from 3D.
        for (let pipe = 0; pipe < 4; pipe++) {
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = `hsl(${pipe * 85 + t * 14} 75% 55%)`;
          ctx.lineWidth =
            Math.max(3, Math.min(w, h) * 0.025) * (1 + energy * 0.3);
          ctx.beginPath();
          let x = 0,
            y = 0,
            z = 0;
          for (let i = 0; i < 28; i++) {
            const direction =
              Math.sin(i * 12.9898 + pipe * 78.233) > 0 ? 1 : -1;
            if (i % 3 === 0) x += direction * 0.5;
            else if (i % 3 === 1) y += direction * 0.5;
            else z += direction * 0.5;
            const a = t * 0.2 + pipe,
              rx = x * Math.cos(a) - z * Math.sin(a),
              rz = x * Math.sin(a) + z * Math.cos(a);
            const perspective = 1 / (4 + rz * 0.3);
            const px = w / 2 + rx * perspective * Math.min(w, h) * 0.6,
              py = h / 2 + y * perspective * Math.min(w, h) * 0.6;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }
      return;
    }
    if (['radial', 'mirror', 'starfield', 'ribbon'].includes(mode)) {
      this.analyser.getByteFrequencyData(this.samples);
      const energy =
        this.samples.subarray(0, 96).reduce((sum, value) => sum + value, 0) /
        (96 * 255);
      ctx.fillStyle = mode === 'ribbon' ? 'rgba(5,8,18,0.18)' : '#050812';
      if (!cover) ctx.fillRect(0, 0, w, h);
      const t = now / 1000;
      if (mode === 'radial') {
        const radius = Math.min(w, h) * 0.22;
        for (let i = 0; i < 96; i++) {
          const angle = (i / 96) * Math.PI * 2 + t * 0.1;
          const level = this.samples[i * 3] / 255;
          const outer = radius + level * Math.min(w, h) * 0.23;
          ctx.strokeStyle = `hsl(${i * 3.75 + t * 20} 85% 65%)`;
          ctx.lineWidth = Math.max(2, w / 350);
          ctx.beginPath();
          ctx.moveTo(
            w / 2 + Math.cos(angle) * radius,
            h / 2 + Math.sin(angle) * radius,
          );
          ctx.lineTo(
            w / 2 + Math.cos(angle) * outer,
            h / 2 + Math.sin(angle) * outer,
          );
          ctx.stroke();
        }
      } else if (mode === 'mirror') {
        for (let i = 0; i < 64; i++) {
          const level = this.samples[Math.floor((i / 64) ** 2 * 512)] / 255;
          const bar = level * h * 0.45;
          ctx.fillStyle = `hsl(${190 + i * 2 + t * 8} 85% 65%)`;
          ctx.fillRect(
            (i * w) / 64 + 1,
            h / 2 - bar,
            Math.max(1, w / 64 - 2),
            bar * 2,
          );
        }
      } else if (mode === 'starfield') {
        for (let i = 0; i < 160; i++) {
          const z = ((i * 0.618033 + t * 0.2) % 1) + 0.08;
          const angle = i * 2.39996;
          const distance = Math.sqrt((i * 0.754877) % 1) / z;
          const x = w / 2 + Math.cos(angle) * distance * w * 0.4;
          const y = h / 2 + Math.sin(angle) * distance * h * 0.4;
          const size = Math.min(6, (0.5 + energy * 2) / z);
          ctx.fillStyle = `hsl(${210 + energy * 110} 75% ${Math.min(95, 40 + 40 / z)}%)`;
          ctx.fillRect(x, y, size, size);
        }
      } else {
        this.analyser.getByteTimeDomainData(this.samples);
        for (let line = 0; line < 3; line++) {
          ctx.strokeStyle = `hsl(${t * 35 + line * 70} 90% 65%)`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = 0; i < 256; i++) {
            const x = (i / 255) * w;
            const y =
              h / 2 +
              ((this.samples[i * 4] - 128) / 128) * h * 0.3 +
              Math.sin(i * 0.025 + t + line) * h * 0.12;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
      return;
    }
    ctx.fillStyle = '#080d0a';
    if (!cover) ctx.fillRect(0, 0, w, h);
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
    this.stopAnimation();
    this.analyser.disconnect();
    this.audioNode.disconnect();
    try {
      this.audioSource.disconnect(this.audioNode);
    } catch {}
  }
}
