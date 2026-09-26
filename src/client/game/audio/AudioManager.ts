import type { WeaponId } from '@shared/weapons';
import { MusicPlayer, type MusicKind } from './Music';
import * as S from './synth';

export interface PlayOpts {
  volume?: number;
  rate?: number;
  /** World position for spatialized playback. */
  x?: number;
  y?: number;
  z?: number;
  delay?: number;
}

/**
 * Owns the AudioContext, the master/music/sfx buses, the synthesized sound
 * bank, spatialization and the music player. Everything is created lazily on
 * the first user gesture because browsers require that.
 */
export class AudioManager {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private bank = new Map<string, AudioBuffer>();
  private music: MusicPlayer | null = null;
  private ambient: AudioBufferSourceNode | null = null;
  private ambientGain: GainNode | null = null;
  private volumes = { master: 0.8, music: 0.35, sfx: 0.9, muted: false };
  private lastPlay = new Map<string, number>();
  ready = false;

  /** Create the context. Safe to call repeatedly; must follow a user gesture the first time. */
  init(): boolean {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ready;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.sfx = ctx.createGain();
      this.musicBus = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 20;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      this.sfx.connect(this.master);
      this.musicBus.connect(this.master);
      this.master.connect(comp);
      comp.connect(ctx.destination);
      this.applyVolumes();
      this.buildBank(ctx);
      this.music = new MusicPlayer(ctx, this.musicBus);
      this.ready = true;
      if (ctx.state === 'suspended') void ctx.resume();
      return true;
    } catch {
      return false;
    }
  }

  private buildBank(ctx: AudioContext): void {
    const b = this.bank;
    for (const w of Object.keys(S.SHOT_PRESETS)) b.set(`shot_${w}`, S.gunshot(ctx, S.SHOT_PRESETS[w]));
    b.set('dry', S.clickSound(ctx, 1800, 0.04, 0.4));
    b.set('mag_out', S.clickSound(ctx, 500, 0.06, 0.8));
    b.set('mag_in', S.clickSound(ctx, 700, 0.07, 0.9));
    b.set('bolt', S.clickSound(ctx, 1100, 0.05, 0.7));
    b.set('equip', S.whoosh(ctx, 0.16, 400, 2400));
    b.set('step0', S.footstep(ctx, 0));
    b.set('step1', S.footstep(ctx, 1));
    b.set('step2', S.footstep(ctx, 2));
    b.set('jump', S.whoosh(ctx, 0.14, 250, 1600));
    b.set('land', S.thud(ctx, 70, 0.22));
    b.set('hurt', S.hurt(ctx));
    b.set('death', S.death(ctx));
    b.set('hit', S.toneSweep(ctx, 1900, 1500, 0.05, 0.02));
    b.set('headshot', S.chord(ctx, [1500, 2250], 0.09, 0.03));
    b.set('kill', S.render(ctx, 0.22, (t, i) => Math.sin(2 * Math.PI * (300 + 500 * Math.min(1, t / 0.1)) * t) * Math.exp(-t / 0.08) + S.white(i) * Math.exp(-t / 0.02) * 0.6));
    b.set('streak', S.chord(ctx, [440, 554, 659, 880], 0.5, 0.18, 'tri'));
    b.set('ui_hover', S.toneSweep(ctx, 900, 900, 0.03, 0.012));
    b.set('ui_click', S.clickSound(ctx, 900, 0.04, 0.3));
    b.set('ui_confirm', S.toneSweep(ctx, 520, 880, 0.14, 0.06));
    b.set('ui_error', S.toneSweep(ctx, 180, 140, 0.18, 0.09, 'square'));
    b.set('beep', S.toneSweep(ctx, 880, 880, 0.12, 0.05));
    b.set('go', S.chord(ctx, [1320, 1760], 0.35, 0.12));
    b.set('match_end', S.chord(ctx, [330, 415, 494, 660], 0.9, 0.35, 'tri'));
    b.set('spawn', S.toneSweep(ctx, 300, 700, 0.25, 0.1));
    b.set('impact', S.clickSound(ctx, 2600, 0.05, 1));
    b.set('ricochet', S.toneSweep(ctx, 2600, 600, 0.18, 0.05));
    b.set('ambient_dust', S.ambientLoop(ctx, 'dust'));
    b.set('ambient_rain', S.ambientLoop(ctx, 'rain'));
  }

  setVolumes(master: number, music: number, sfx: number, muted: boolean): void {
    this.volumes = { master, music, sfx, muted };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfx || !this.musicBus) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.muted ? 0 : this.volumes.master, t, 0.02);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.6, t, 0.02);
  }

  /** Update the listener from the camera. */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(x, t, 0.02);
      l.positionY.setTargetAtTime(y, t, 0.02);
      l.positionZ.setTargetAtTime(z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.02);
      l.upY.setTargetAtTime(uy, t, 0.02);
      l.upZ.setTargetAtTime(uz, t, 0.02);
    } else {
      const legacy = l as AudioListener & { setPosition?(x: number, y: number, z: number): void; setOrientation?(...a: number[]): void };
      legacy.setPosition?.(x, y, z);
      legacy.setOrientation?.(fx, fy, fz, ux, uy, uz);
    }
  }

  play(name: string, opts: PlayOpts = {}): void {
    const ctx = this.ctx;
    const buf = this.bank.get(name);
    if (!ctx || !buf || !this.sfx) return;
    // Cap identical sounds to avoid stacking (e.g. shotgun pellets).
    const now = performance.now();
    const last = this.lastPlay.get(name) ?? 0;
    if (now - last < 12) return;
    this.lastPlay.set(name, now);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    src.connect(g);
    if (opts.x !== undefined && opts.y !== undefined && opts.z !== undefined) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 4;
      p.maxDistance = 90;
      p.rolloffFactor = 1.1;
      if (p.positionX) {
        p.positionX.value = opts.x;
        p.positionY.value = opts.y;
        p.positionZ.value = opts.z;
      } else (p as PannerNode & { setPosition?(x: number, y: number, z: number): void }).setPosition?.(opts.x, opts.y, opts.z);
      g.connect(p);
      p.connect(this.sfx);
    } else {
      g.connect(this.sfx);
    }
    src.start(ctx.currentTime + (opts.delay ?? 0));
  }

  shot(weapon: WeaponId, local: boolean, x?: number, y?: number, z?: number): void {
    const rate = 0.94 + Math.random() * 0.12;
    if (local) this.play(`shot_${weapon}`, { volume: 0.9, rate });
    else this.play(`shot_${weapon}`, { volume: 0.8, rate, x, y, z });
  }

  reloadSequence(weapon: WeaponId, duration: number, x?: number, y?: number, z?: number): void {
    const spatial = x !== undefined ? { x, y, z } : {};
    const v = x !== undefined ? 0.45 : 0.7;
    this.play('mag_out', { ...spatial, volume: v, delay: duration * 0.18, rate: 0.9 + Math.random() * 0.1 });
    this.play('mag_in', { ...spatial, volume: v, delay: duration * 0.62, rate: 0.95 });
    this.play(weapon === 'shotgun' || weapon === 'sniper' ? 'bolt' : 'bolt', { ...spatial, volume: v * 0.8, delay: duration * 0.9, rate: 1.1 });
  }

  footstep(local: boolean, x?: number, y?: number, z?: number, volume = 1): void {
    const n = Math.floor(Math.random() * 3);
    const rate = 0.9 + Math.random() * 0.2;
    if (local) this.play(`step${n}`, { volume: 0.32 * volume, rate });
    else this.play(`step${n}`, { volume: 0.55 * volume, rate, x, y, z });
  }

  startAmbient(kind: 'dust' | 'rain' | 'none'): void {
    this.stopAmbient();
    const ctx = this.ctx;
    if (!ctx || kind === 'none' || !this.sfx) return;
    const buf = this.bank.get(`ambient_${kind}`);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(kind === 'rain' ? 0.16 : 0.12, ctx.currentTime + 2);
    src.connect(g);
    g.connect(this.sfx);
    src.start();
    this.ambient = src;
    this.ambientGain = g;
  }

  stopAmbient(): void {
    if (this.ambient && this.ambientGain && this.ctx) {
      const g = this.ambientGain;
      const src = this.ambient;
      g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.8);
      setTimeout(() => {
        try {
          src.stop();
        } catch {}
        g.disconnect();
      }, 900);
    }
    this.ambient = null;
    this.ambientGain = null;
  }

  startMusic(kind: MusicKind): void {
    this.music?.start(kind);
  }

  stopMusic(fade = 0.8): void {
    this.music?.stop(fade);
  }

  musicCadence(): void {
    this.music?.cadence();
  }

  get musicPlaying(): MusicKind | null {
    return this.music?.playing ?? null;
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }
}

export const audio = new AudioManager();
