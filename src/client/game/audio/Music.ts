/**
 * Tiny step sequencer driven by oscillators. Two moods: a slow ambient bed for
 * the menu and a driving track for matches. Scheduling uses the standard
 * look-ahead pattern so timing is sample accurate regardless of frame rate.
 */
export type MusicKind = 'menu' | 'match';

const A = 110;
const note = (semi: number, octave = 0): number => A * Math.pow(2, semi / 12 + octave);

interface Track {
  bpm: number;
  stepsPerBar: number;
  bars: number;
  chords: number[][]; // per bar, semitone offsets from A
  bassPattern: (step: number, bar: number) => number | null;
  arpPattern: (step: number, bar: number) => number | null;
  kick: (step: number) => boolean;
  hat: (step: number) => boolean;
  padCutoff: number;
  padLevel: number;
  arpLevel: number;
  bassLevel: number;
}

const MENU: Track = {
  bpm: 76,
  stepsPerBar: 8,
  bars: 4,
  chords: [
    [0, 3, 7, 10],
    [-4, 0, 3, 7],
    [-7, -4, 0, 3],
    [-2, 2, 5, 9],
  ],
  bassPattern: () => null,
  arpPattern: (step, bar) => (step % 2 === 0 && (step + bar) % 3 !== 0 ? [0, 7, 10, 14, 19][((step / 2) | 0) % 5] : null),
  kick: () => false,
  hat: () => false,
  padCutoff: 520,
  padLevel: 0.5,
  arpLevel: 0.18,
  bassLevel: 0,
};

const MATCH: Track = {
  bpm: 128,
  stepsPerBar: 16,
  bars: 4,
  chords: [
    [0, 3, 7],
    [0, 3, 7],
    [-4, 0, 3],
    [-2, 2, 5],
  ],
  bassPattern: (step, bar) => {
    const root = MATCH.chords[bar][0] - 12;
    const pat = [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0];
    if (!pat[step]) return null;
    return step % 8 === 6 ? root + 7 : root;
  },
  arpPattern: (step, bar) => {
    const c = MATCH.chords[bar];
    const seq = [c[0] + 12, c[1] + 12, c[2] + 12, c[1] + 24, c[0] + 12, c[2] + 12, c[1] + 12, c[2] + 24];
    return step % 2 === 0 ? seq[(step / 2) % seq.length] : null;
  },
  kick: (step) => step % 4 === 0 || step === 14,
  hat: (step) => step % 2 === 1,
  padCutoff: 900,
  padLevel: 0.22,
  arpLevel: 0.12,
  bassLevel: 0.28,
};

export class MusicPlayer {
  private ctx: AudioContext;
  private out: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private track: Track | null = null;
  private trackGain: GainNode | null = null;
  private noiseBuf: AudioBuffer;

  constructor(ctx: AudioContext, out: GainNode) {
    this.ctx = ctx;
    this.out = out;
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  get playing(): MusicKind | null {
    return this.track === MENU ? 'menu' : this.track === MATCH ? 'match' : null;
  }

  start(kind: MusicKind): void {
    if (this.playing === kind) return;
    this.stop(0.6);
    this.track = kind === 'menu' ? MENU : MATCH;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 1.5);
    g.connect(this.out);
    this.trackGain = g;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 60);
  }

  stop(fade = 0.8): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.track = null;
    const g = this.trackGain;
    if (g) {
      const t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + fade);
      setTimeout(() => g.disconnect(), fade * 1000 + 100);
    }
    this.trackGain = null;
  }

  /** A short closing cadence for match end. */
  cadence(): void {
    const g = this.trackGain ?? this.out;
    const t = this.ctx.currentTime + 0.05;
    const seq = [
      [0, 3, 7],
      [-2, 2, 5],
      [-4, 0, 3],
    ];
    seq.forEach((c, i) => {
      for (const s of c) this.osc('triangle', note(s, 1), t + i * 0.42, 0.9, 0.12, g);
      this.osc('sine', note(c[0], 0), t + i * 0.42, 0.9, 0.16, g);
    });
  }

  private schedule(): void {
    const tr = this.track;
    const g = this.trackGain;
    if (!tr || !g) return;
    const stepDur = 60 / tr.bpm / (tr.stepsPerBar / 4);
    while (this.nextTime < this.ctx.currentTime + 0.25) {
      const bar = Math.floor(this.step / tr.stepsPerBar) % tr.bars;
      const s = this.step % tr.stepsPerBar;
      const t = this.nextTime;
      if (s === 0) {
        const barDur = stepDur * tr.stepsPerBar;
        for (const semi of tr.chords[bar]) {
          this.pad(note(semi, 1), t, barDur * 1.05, tr.padLevel / tr.chords[bar].length, tr.padCutoff, g);
        }
      }
      const b = tr.bassPattern(s, bar);
      if (b !== null) this.osc('sawtooth', note(b, 0), t, stepDur * 0.9, tr.bassLevel, g, 380);
      const a = tr.arpPattern(s, bar);
      if (a !== null) this.osc(tr === MENU ? 'sine' : 'square', note(a, 1), t, stepDur * 1.6, tr.arpLevel, g, 2200);
      if (tr.kick(s)) this.kick(t, g);
      if (tr.hat(s)) this.hat(t, g, s % 4 === 3 ? 0.08 : 0.05);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, level: number, out: AudioNode, cutoff = 0): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (cutoff > 0) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      f.Q.value = 1.2;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private pad(freq: number, t: number, dur: number, level: number, cutoff: number, out: AudioNode): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff * 0.6, t);
    f.frequency.linearRampToValueAtTime(cutoff * 1.4, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(cutoff * 0.6, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + dur * 0.25);
    g.gain.setValueAtTime(level, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    f.connect(g);
    g.connect(out);
    for (const det of [-6, 5]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private kick(t: number, out: AudioNode): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.3);
  }

  private hat(t: number, out: AudioNode, level: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + 0.06);
  }
}
