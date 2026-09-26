/**
 * Procedural sound generation. Every sound in the game is synthesized here at
 * startup (no audio files), which keeps the bundle tiny and the licensing clean.
 */

export type Gen = (t: number, i: number, sr: number) => number;

export function render(ctx: BaseAudioContext, seconds: number, gen: Gen): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.max(1, Math.floor(seconds * sr));
  const buf = ctx.createBuffer(1, n, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = gen(i / sr, i, sr);
  // Soft limiter + normalize.
  let peak = 0;
  for (let i = 0; i < n; i++) {
    data[i] = Math.tanh(data[i] * 1.2);
    peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak > 0) for (let i = 0; i < n; i++) data[i] /= peak;
  return buf;
}

// Deterministic-ish noise (stateless white noise via hashing).
export function white(i: number): number {
  let x = (i + 1) * 374761393;
  x = (x ^ (x >>> 13)) * 1274126177;
  x = x ^ (x >>> 16);
  return ((x >>> 0) / 4294967296) * 2 - 1;
}

/** One-pole lowpass over the noise stream, stateful helper factory. */
export function lowpassNoise(cutoffHz: number, sr: number): (i: number) => number {
  const a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sr);
  let y = 0;
  return (i) => (y += a * (white(i) - y));
}

export function bandNoise(lowHz: number, highHz: number, sr: number): (i: number) => number {
  const lp = lowpassNoise(highHz, sr);
  const a = 1 - Math.exp((-2 * Math.PI * lowHz) / sr);
  let low = 0;
  return (i) => {
    const v = lp(i);
    low += a * (v - low);
    return v - low;
  };
}

export const env = (t: number, attack: number, decay: number): number => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

export interface ShotParams {
  length: number;
  boomHz: number;
  boomDecay: number;
  boomAmt: number;
  crackDecay: number;
  crackAmt: number;
  noiseHigh: number;
  noiseLow: number;
  tailDecay: number;
  tailAmt: number;
  clickAmt: number;
}

export const SHOT_PRESETS: Record<string, ShotParams> = {
  rifle: { length: 0.55, boomHz: 150, boomDecay: 0.05, boomAmt: 0.9, crackDecay: 0.018, crackAmt: 1.2, noiseHigh: 5000, noiseLow: 250, tailDecay: 0.16, tailAmt: 0.35, clickAmt: 0.5 },
  smg: { length: 0.35, boomHz: 200, boomDecay: 0.035, boomAmt: 0.7, crackDecay: 0.012, crackAmt: 1.1, noiseHigh: 6500, noiseLow: 400, tailDecay: 0.09, tailAmt: 0.25, clickAmt: 0.6 },
  shotgun: { length: 0.9, boomHz: 95, boomDecay: 0.09, boomAmt: 1.3, crackDecay: 0.03, crackAmt: 1.0, noiseHigh: 3200, noiseLow: 120, tailDecay: 0.3, tailAmt: 0.5, clickAmt: 0.3 },
  sniper: { length: 1.2, boomHz: 120, boomDecay: 0.07, boomAmt: 1.1, crackDecay: 0.025, crackAmt: 1.5, noiseHigh: 7000, noiseLow: 200, tailDecay: 0.45, tailAmt: 0.55, clickAmt: 0.4 },
  pistol: { length: 0.4, boomHz: 210, boomDecay: 0.03, boomAmt: 0.8, crackDecay: 0.014, crackAmt: 1.2, noiseHigh: 6000, noiseLow: 350, tailDecay: 0.1, tailAmt: 0.3, clickAmt: 0.7 },
};

export function gunshot(ctx: BaseAudioContext, p: ShotParams): AudioBuffer {
  const sr = ctx.sampleRate;
  const crack = bandNoise(p.noiseLow, p.noiseHigh, sr);
  const tail = lowpassNoise(900, sr);
  return render(ctx, p.length, (t, i) => {
    const boomF = p.boomHz * (1 + 2.5 * Math.exp(-t / 0.012));
    const boom = Math.sin(2 * Math.PI * boomF * t) * Math.exp(-t / p.boomDecay) * p.boomAmt;
    const c = crack(i) * Math.exp(-t / p.crackDecay) * p.crackAmt;
    const tl = tail(i) * Math.exp(-t / p.tailDecay) * p.tailAmt;
    const click = t < 0.002 ? white(i) * p.clickAmt : 0;
    return boom + c + tl + click;
  });
}

export function clickSound(ctx: BaseAudioContext, hz: number, len = 0.03, noiseAmt = 0.6): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = lowpassNoise(hz * 2, sr);
  return render(ctx, len, (t, i) => (Math.sin(2 * Math.PI * hz * t) * 0.6 + n(i) * noiseAmt) * Math.exp(-t / (len * 0.25)));
}

export function toneSweep(ctx: BaseAudioContext, f0: number, f1: number, len: number, decay = len * 0.5, shape: 'sine' | 'square' | 'tri' = 'sine', attack = 0.004): AudioBuffer {
  return render(ctx, len, (t) => {
    const f = f0 + (f1 - f0) * (t / len);
    const ph = 2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * len));
    void f;
    let v = Math.sin(ph);
    if (shape === 'square') v = Math.sign(v) * 0.6;
    else if (shape === 'tri') v = (2 / Math.PI) * Math.asin(v);
    return v * env(t, attack, decay);
  });
}

export function chord(ctx: BaseAudioContext, freqs: number[], len: number, decay = len * 0.4, shape: 'sine' | 'tri' = 'sine'): AudioBuffer {
  return render(ctx, len, (t) => {
    let v = 0;
    for (const f of freqs) {
      const s = Math.sin(2 * Math.PI * f * t);
      v += shape === 'tri' ? (2 / Math.PI) * Math.asin(s) : s;
    }
    return (v / freqs.length) * env(t, 0.01, decay);
  });
}

export function footstep(ctx: BaseAudioContext, variant: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = lowpassNoise(700 + variant * 150, sr);
  return render(ctx, 0.12, (t, i) => n(i) * Math.exp(-t / 0.03) * 1.2 + Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t / 0.02) * 0.4);
}

export function thud(ctx: BaseAudioContext, hz = 70, len = 0.25): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = lowpassNoise(400, sr);
  return render(ctx, len, (t, i) => Math.sin(2 * Math.PI * hz * (1 + 1.5 * Math.exp(-t / 0.02)) * t) * Math.exp(-t / (len * 0.35)) + n(i) * Math.exp(-t / 0.04) * 0.5);
}

export function whoosh(ctx: BaseAudioContext, len = 0.18, from = 300, to = 1400): AudioBuffer {
  const sr = ctx.sampleRate;
  const lp = lowpassNoise(to, sr);
  const a = 1 - Math.exp((-2 * Math.PI * from) / sr);
  let low = 0;
  return render(ctx, len, (t, i) => {
    const v = lp(i);
    low += a * (v - low);
    return (v - low) * Math.sin((Math.PI * t) / len);
  });
}

export function hurt(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = lowpassNoise(1200, sr);
  return render(ctx, 0.22, (t, i) => Math.sin(2 * Math.PI * (180 - 80 * t) * t) * Math.exp(-t / 0.08) + n(i) * Math.exp(-t / 0.05) * 0.7);
}

export function death(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = lowpassNoise(600, sr);
  return render(ctx, 0.7, (t, i) => Math.sin(2 * Math.PI * (260 * Math.exp(-t * 2.2)) * t) * Math.exp(-t / 0.35) * 0.9 + n(i) * Math.exp(-t / 0.12) * 0.6);
}

export function ambientLoop(ctx: BaseAudioContext, kind: 'dust' | 'rain'): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = 6;
  const lp = lowpassNoise(kind === 'rain' ? 5000 : 220, sr);
  const hp = kind === 'rain' ? bandNoise(1200, 6000, sr) : null;
  const buf = render(ctx, len, (t, i) => {
    const lfo = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.21 * t) * Math.sin(2 * Math.PI * 0.07 * t + 1);
    if (kind === 'rain') return hp!(i) * 0.5 * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.9 * t)) + lp(i) * 0.1;
    return lp(i) * lfo + Math.sin(2 * Math.PI * 55 * t) * 0.08;
  });
  // Crossfade the loop ends.
  const d = buf.getChannelData(0);
  const fade = Math.floor(sr * 0.5);
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    const j = d.length - fade + i;
    const mixed = d[j] * (1 - a) + d[i] * a;
    d[j] = mixed;
  }
  return buf;
}
