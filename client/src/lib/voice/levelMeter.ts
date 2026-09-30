/**
 * Voice-activity detector: samples a stream's loudness and reports
 * speaking / not speaking, with a short hangover so it doesn't flicker
 * between words. Uses a timer rather than rAF so it keeps working in a
 * background tab.
 */
export class LevelMeter {
  private source: MediaStreamAudioSourceNode;
  private analyser: AnalyserNode;
  private buf: Float32Array<ArrayBuffer>;
  private timer: number;
  private speaking = false;
  private lastLoudAt = 0;

  constructor(
    ctx: AudioContext,
    stream: MediaStream,
    private readonly onChange: (speaking: boolean) => void,
    private readonly threshold = 0.018,
    private readonly hangoverMs = 450,
  ) {
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.buf = new Float32Array(this.analyser.fftSize);
    // Analyse only: never connected to the destination, so it doesn't play anything.
    this.source.connect(this.analyser);
    this.timer = window.setInterval(() => this.sample(), 90);
  }

  private sample() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    const now = performance.now();
    if (rms > this.threshold) this.lastLoudAt = now;
    const speaking = now - this.lastLoudAt < this.hangoverMs;
    if (speaking !== this.speaking) {
      this.speaking = speaking;
      this.onChange(speaking);
    }
  }

  dispose() {
    window.clearInterval(this.timer);
    try {
      this.source.disconnect();
    } catch {
      /* already disconnected */
    }
    if (this.speaking) this.onChange(false);
  }
}
