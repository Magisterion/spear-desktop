/** One audible path; analysers never add a second copy of the music. */
export const frequencies = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];
export const audioMotion = {
  bass: 0,
  energy: 0,
  high: 0,
  beat: 0,
  active: false,
  time: 0,
  bpm: 120,
  band: 0,
};
let context: AudioContext | null = null;
let currentSource: MediaElementAudioSourceNode | null = null;
export const getAudioGraph = () =>
  context && currentSource
    ? { audioContext: context, audioSource: currentSource }
    : null;
let filters: BiquadFilterNode[] = [];
let input: GainNode | null = null;
let delay: DelayNode | null = null;
let gameDelay = 0;
export function setGameAudioDelay(seconds: number) {
  gameDelay = Math.max(0, Math.min(2, seconds));
  if (context && delay)
    delay.delayTime.setValueAtTime(gameDelay, context.currentTime);
}
let gains = frequencies.map(() => 0);
let enabled = true;
let sampleTimer: ReturnType<typeof setInterval> | undefined;
let lastBeat = 0;
let baseline = 0;
export function setEqualizer(values: number[], on = true) {
  gains = frequencies.map((_, i) =>
    Math.max(-12, Math.min(12, Number(values[i]) || 0)),
  );
  enabled = on;
  if (!context || !input) return;
  // Leave headroom for positive boosts instead of clipping the output.
  input.gain.setTargetAtTime(
    on ? 10 ** (-Math.max(0, ...gains) / 20) : 1,
    context.currentTime,
    0.03,
  );
  filters.forEach((filter, i) =>
    filter.gain.setTargetAtTime(on ? gains[i] : 0, context!.currentTime, 0.03),
  );
}
export function initializeAudio(
  ctx: AudioContext,
  source: MediaElementAudioSourceNode,
  video: HTMLVideoElement,
) {
  input?.disconnect();
  filters.forEach((f) => f.disconnect());
  delay?.disconnect();
  context = ctx;
  currentSource = source;
  input = ctx.createGain();
  filters = frequencies.map((frequency) => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = frequency;
    filter.Q.value = 1.1;
    return filter;
  });
  const output = ctx.createGain();
  source.connect(input);
  let tail: AudioNode = input;
  for (const filter of filters) {
    tail.connect(filter);
    tail = filter;
  }
  delay = ctx.createDelay(2);
  delay.delayTime.value = gameDelay;
  tail.connect(delay);
  delay.connect(output);
  output.connect(ctx.destination);
  setEqualizer(gains, enabled);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.35;
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(analyser);
  analyser.connect(silent);
  silent.connect(ctx.destination);
  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  const waveform = new Uint8Array(analyser.fftSize);
  const resume = () => {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  };
  video.addEventListener('playing', resume);
  document.addEventListener('pointerdown', resume, { passive: true });
  resume();
  if (sampleTimer) clearInterval(sampleTimer);
  sampleTimer = setInterval(() => {
    const active = !video.paused && !video.ended && ctx.state === 'running';
    audioMotion.active = active;
    audioMotion.time = ctx.currentTime;
    if (active) {
      analyser.getByteFrequencyData(spectrum);
      analyser.getByteTimeDomainData(waveform);
      const rms = Math.sqrt(
        waveform.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) /
          waveform.length,
      );
      const lowBins = Math.max(
        2,
        Math.floor((220 * analyser.fftSize) / ctx.sampleRate),
      );
      const low =
        spectrum.slice(1, lowBins).reduce((sum, v) => sum + v, 0) /
        ((lowBins - 1) * 255);
      audioMotion.bass = Math.min(1, low ** 1.5);
      audioMotion.energy = Math.min(1, Math.sqrt(rms) * 1.7);
      audioMotion.high =
        spectrum.slice(100, 300).reduce((sum, v) => sum + v, 0) / (200 * 255);
      const bandMeans = [
        spectrum.slice(1, 6),
        spectrum.slice(6, 20),
        spectrum.slice(20, 70),
        spectrum.slice(70, 250),
      ].map((b) => b.reduce((sum, v) => sum + v, 0) / b.length);
      audioMotion.band = bandMeans.indexOf(Math.max(...bandMeans));
      baseline = baseline * 0.94 + audioMotion.bass * 0.06;
      if (
        audioMotion.bass > baseline * 1.14 + 0.035 &&
        performance.now() - lastBeat > 190
      ) {
        audioMotion.beat++;
        const interval = performance.now() - lastBeat;
        if (interval > 300 && interval < 1000)
          audioMotion.bpm = audioMotion.bpm * 0.8 + (60000 / interval) * 0.2;
        lastBeat = performance.now();
      }
    } else {
      audioMotion.bass = audioMotion.energy = audioMotion.high = baseline = 0;
    }
    window.ipcRenderer.send(
      'classic:audio-level',
      Math.min(
        1,
        Math.max(0, audioMotion.bass - baseline * 0.7) * 3 +
          audioMotion.energy * 0.15,
      ),
    );
  }, 40);
  return output;
}
