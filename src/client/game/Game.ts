import * as THREE from 'three';
import { COMBAT, MATCH, MOVE, PLAYER, PROTOCOL_VERSION, SIM } from '@shared/config';
import { MAPS, getMap } from '@shared/maps';
import type { MapDef } from '@shared/maps/types';
import { dirFromYawPitch, v3 } from '@shared/math';
import { Keys, eyeHeight, horizontalSpeed, playerHeight } from '@shared/physics/movement';
import { CollisionWorld, newRayHit, rayAABB, raySphere } from '@shared/physics/world';
import type { GameEvent, InputTuple, MatchInfo, PlayerInfo, ServerMsg } from '@shared/protocol';
import { isReloading, type WeaponStepResult } from '@shared/sim/weapon-state';
import { WEAPONS, fireInterval, spreadDegrees, type WeaponId } from '@shared/weapons';
import { useStore } from '@client/app/store';
import type { Settings } from '@client/app/settings';
import { audio } from './audio/AudioManager';
import { CameraRig } from './camera/CameraRig';
import { CasingPool, FlashLight, SparkPool, TracerPool } from './effects/Effects';
import { InputManager } from './input/InputManager';
import { ServerClock } from './net/Clock';
import { WsTransport, type Transport } from './net/Transport';
import { LocalPlayer } from './player/LocalPlayer';
import { RemotePlayer } from './player/RemotePlayer';
import { ViewModel } from './weapons/ViewModel';
import { buildMap, type BuiltMap } from './world/MapBuilder';
import { AmbientParticles } from './world/Particles';
import { buildSky } from './world/Sky';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  transport: Transport;
  name: string;
  weapon: WeaponId;
  /** WebSocket URL for reconnects (online mode only). */
  serverUrl?: string;
  onLeave(reason?: string): void;
  onProgress(label: string, value: number): void;
}

const stepOut: WeaponStepResult = { fired: false, dryFire: false, reloadStarted: false, reloadDone: false, switched: false };
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpDir = v3();
const tmpRay = newRayHit();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The running match: rendering, input, prediction, networking and feedback.
 * React only reads a throttled HUD snapshot from the store.
 */
export class Game {
  private opts: GameOptions;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private rig: CameraRig;
  private viewModel = new ViewModel();
  private input: InputManager;
  private transport: Transport;
  private clock = new ServerClock();
  private local: LocalPlayer;
  private remotes = new Map<number, RemotePlayer>();
  private players = new Map<number, PlayerInfo>();
  private map: MapDef = MAPS[0];
  private world: CollisionWorld;
  private built: BuiltMap | null = null;
  private sky: ReturnType<typeof buildSky> | null = null;
  private particles: AmbientParticles | null = null;
  private tracers = new TracerPool(64);
  private sparks = new SparkPool(512);
  private casings = new CasingPool(40);
  private remoteFlash = new FlashLight();
  private localFlash = new FlashLight();
  private match: MatchInfo = { phase: 'waiting', phaseEndsAt: 0, map: 'warehouse', round: 0 };
  private raf = 0;
  private running = false;
  private lastFrame = 0;
  private accumulator = 0;
  private inputBatch: InputTuple[] = [];
  private lastPing = 0;
  private hudTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private adsAmount = 0;
  private stepAccum = 0;
  private lastCountdown = -1;
  private settings: Settings;
  private unsubscribe: () => void;
  private myInfo: PlayerInfo | null = null;
  private welcomed = false;
  private welcomeResolve: (() => void) | null = null;
  private welcomeReject: ((e: Error) => void) | null = null;
  private reconnecting = false;
  private wasLive = false;
  private disposed = false;
  private lowHealthPulse = 0;
  private mouse = { dx: 0, dy: 0 };
  private rejoinToken = '';
  private joinSentAt = 0;
  private lastYou: number[] | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: GameOptions) {
    this.opts = opts;
    this.transport = opts.transport;
    this.settings = useStore.getState().settings;
    const s = this.settings;
    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: s.quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.autoClear = false;
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.rig.hFov = s.fov;
    this.applyQuality();
    this.world = CollisionWorld.fromMap(this.map);
    this.local = new LocalPlayer(this.world);
    this.input = new InputManager(opts.canvas);
    this.input.onLockChange = (locked) => {
      const st = useStore.getState();
      useStore.setState({ pointerLocked: locked, paused: !locked && st.screen === 'game' && !st.results && !st.reconnecting });
      if (locked) useStore.setState({ overlay: 'none' });
    };
    this.input.onScoreboard = (open) => useStore.setState({ scoreboardOpen: open });
    this.scene.add(this.tracers.object, this.sparks.object, this.casings.mesh, this.remoteFlash.light, this.localFlash.light);
    this.unsubscribe = useStore.subscribe((state, prev) => {
      if (state.settings !== prev.settings) this.onSettingsChanged(state.settings, prev.settings);
    });
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.transport.onMessage = (m) => this.onMessage(m);
    this.transport.onClose = (reason) => this.onTransportClosed(reason);
    if (import.meta.env.DEV) {
      (window as unknown as { __game?: Game }).__game = this;
      if (location.search.includes('debug')) this.input.forceLock();
    }
  }

  /** Debug accessors (development only). */
  get debug() {
    return { local: this.local, remotes: this.remotes, players: this.players, match: this.match, clock: this.clock, fps: this.fps, renderer: this.renderer, rig: this.rig };
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  async start(): Promise<void> {
    const p = this.opts.onProgress;
    p('Initializing audio', 0.1);
    audio.init();
    const s = this.settings;
    audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume, s.muted);
    p('Joining match', 0.25);
    this.local.resetForJoin();
    this.joinSentAt = performance.now();
    this.transport.send({ t: 'join', name: this.opts.name, weapon: this.opts.weapon, v: PROTOCOL_VERSION });
    await this.waitForWelcome();
    p(`Building ${this.map.name.toLowerCase()}`, 0.55);
    await nextFrame();
    this.loadMapVisuals(this.map);
    p('Compiling shaders', 0.85);
    await nextFrame();
    this.viewModel.setWeapon(this.local.currentWeapon);
    this.viewModel.resize(window.innerWidth / window.innerHeight);
    this.renderer.compile(this.scene, this.rig.camera);
    this.onResize();
    p('Ready', 1);
    audio.startAmbient(this.map.particles);
    audio.startMusic('match');
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private waitForWelcome(): Promise<void> {
    if (this.welcomed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.welcomeResolve = null;
        this.welcomeReject = null;
        reject(new Error('The server did not respond'));
      }, 10000);
      this.welcomeResolve = () => {
        clearTimeout(timer);
        this.welcomeResolve = null;
        this.welcomeReject = null;
        resolve();
      };
      this.welcomeReject = (e) => {
        clearTimeout(timer);
        this.welcomeResolve = null;
        this.welcomeReject = null;
        reject(e);
      };
    });
  }

  private swapTransport(t: Transport): void {
    this.transport.onMessage = null;
    this.transport.onClose = null;
    this.transport.close();
    this.transport = t;
    t.onMessage = (m) => this.onMessage(m);
    t.onClose = (reason) => this.onTransportClosed(reason);
  }

  /** Try to get back into a room after the socket dropped. */
  private async reconnect(reason: string): Promise<void> {
    if (this.reconnecting || this.disposed || !this.opts.serverUrl) {
      if (!this.reconnecting) this.opts.onLeave(`Disconnected: ${reason}`);
      return;
    }
    this.reconnecting = true;
    useStore.setState({ reconnecting: true, death: null, results: null });
    this.input.releaseLock();
    for (let attempt = 1; attempt <= 4; attempt++) {
      await delay(attempt === 1 ? 400 : 1200 * attempt);
      if (this.disposed) return;
      useStore.setState({ connectStatus: `Attempt ${attempt} of 4` });
      const ws = new WsTransport();
      try {
        await ws.connect(this.opts.serverUrl);
      } catch {
        continue;
      }
      if (this.disposed) {
        ws.close();
        return;
      }
      this.swapTransport(ws);
      this.welcomed = false;
      this.local.resetForJoin();
      for (const id of [...this.players.keys()]) this.removePlayer(id);
      this.myInfo = null;
      this.inputBatch = [];
      this.joinSentAt = performance.now();
      ws.send({ t: 'join', name: this.opts.name, weapon: useStore.getState().settings.weapon, v: PROTOCOL_VERSION, token: this.rejoinToken || undefined });
      try {
        await this.waitForWelcome();
        this.reconnecting = false;
        useStore.setState({ reconnecting: false });
        useStore.getState().setToast('Reconnected');
        return;
      } catch {
        ws.close();
      }
    }
    this.reconnecting = false;
    useStore.setState({ reconnecting: false });
    this.opts.onLeave('Lost the connection to the game server.');
  }

  stop(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.transport.onMessage = null;
    this.transport.onClose = null;
    this.transport.close();
    this.input.dispose();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.built?.dispose();
    this.sky?.dispose();
    this.particles?.dispose();
    this.tracers.dispose();
    this.sparks.dispose();
    this.casings.dispose();
    this.viewModel.dispose();
    audio.stopAmbient();
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  requestPointerLock(): void {
    audio.init();
    this.input.requestLock();
  }

  releasePointerLock(): void {
    this.input.releaseLock();
  }

  private onVisibility = (): void => {
    if (document.hidden) this.input.clear();
  };

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.viewModel.resize(w / h);
    this.sparks.setScale(h * this.renderer.getPixelRatio());
  };

  private applyQuality(): void {
    const s = this.settings;
    const dpr = Math.min(window.devicePixelRatio || 1, s.quality === 'high' ? 2 : 1.5) * s.resolutionScale;
    this.renderer.setPixelRatio(dpr);
    const shadows = s.shadows && s.quality !== 'low';
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = s.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.onResize();
  }

  private onSettingsChanged(next: Settings, prev: Settings): void {
    this.settings = next;
    if (next.resolutionScale !== prev.resolutionScale) this.applyQuality();
    if (next.quality !== prev.quality || next.shadows !== prev.shadows || next.effects !== prev.effects) {
      // Sliders and toggles can fire rapidly; rebuild the arena once things settle.
      if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(() => {
        this.rebuildTimer = null;
        if (this.disposed) return;
        this.applyQuality();
        this.loadMapVisuals(this.map);
      }, 250);
    }
    if (next.fov !== prev.fov) this.rig.hFov = next.fov;
    if (next.masterVolume !== prev.masterVolume || next.musicVolume !== prev.musicVolume || next.sfxVolume !== prev.sfxVolume || next.muted !== prev.muted) {
      audio.setVolumes(next.masterVolume, next.musicVolume, next.sfxVolume, next.muted);
    }
    if (next.weapon !== prev.weapon) this.transport.send({ t: 'loadout', weapon: next.weapon });
  }

  /* ------------------------------------------------------------------ */
  /* Map                                                                 */
  /* ------------------------------------------------------------------ */

  private loadMapVisuals(map: MapDef): void {
    const s = this.settings;
    this.built?.dispose();
    this.sky?.dispose();
    this.particles?.dispose();
    if (this.built) this.scene.remove(this.built.group);
    if (this.sky) {
      this.scene.remove(this.sky.mesh);
      if (this.sky.points) this.scene.remove(this.sky.points);
    }
    if (this.particles) this.scene.remove(this.particles.points);
    this.map = map;
    this.world = CollisionWorld.fromMap(map);
    this.local.setWorld(this.world);
    const shadows = s.shadows && s.quality !== 'low';
    this.built = buildMap(map, s.quality, shadows);
    this.scene.add(this.built.group);
    this.sky = buildSky(map, map.id === 'neon');
    this.scene.add(this.sky.mesh);
    if (this.sky.points) this.scene.add(this.sky.points);
    this.scene.fog = new THREE.Fog(map.sky.fog, map.sky.fogNear, map.sky.fogFar);
    this.scene.background = new THREE.Color(map.sky.fog);
    this.viewModel.setLighting(map.ambient.sky, map.ambient.ground, map.sun.color, Math.min(1.4, map.ambient.intensity * 0.75));
    if (s.effects && s.quality !== 'low' && map.particles !== 'none') {
      this.particles = new AmbientParticles(map, map.particles, s.quality === 'high' ? 600 : 300);
      this.scene.add(this.particles.points);
    } else this.particles = null;
    for (const r of this.remotes.values()) r.model.setShadows(shadows);
    // Pending inputs may have been replayed against the old collision world; redo it against the new one.
    if (this.lastYou) this.local.reconcile(this.lastYou, this.local.lastAck);
    useStore.getState().setHud({ mapName: map.name });
  }

  /* ------------------------------------------------------------------ */
  /* Networking                                                          */
  /* ------------------------------------------------------------------ */

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.onWelcome(m);
        break;
      case 'snap':
        this.onSnapshot(m);
        break;
      case 'ev':
        for (const e of m.e) this.onEvent(e);
        break;
      case 'pong':
        this.clock.onPong(m.c, m.st, performance.now());
        break;
      case 'scores':
        this.onScores(m.p);
        break;
      case 'err':
        if (m.code === 'version') this.opts.onLeave(m.msg);
        else useStore.getState().setToast(m.msg);
        break;
    }
  }

  private onWelcome(m: Extract<ServerMsg, { t: 'welcome' }>): void {
    this.local.id = m.id;
    this.rejoinToken = m.token ?? '';
    const now = performance.now();
    this.clock.seed(m.st, now, this.joinSentAt > 0 ? Math.max(0, now - this.joinSentAt) : 0);
    this.match = m.match;
    this.wasLive = m.match.phase === 'live';
    useStore.setState({ myId: m.id });
    for (const p of m.players) this.addPlayer(p);
    this.lastYou = m.you;
    this.local.reconcile(m.you, -1);
    const map = getMap(m.match.map);
    if (this.running && map !== this.map) this.loadMapVisuals(map);
    else this.map = map;
    this.welcomed = true;
    this.welcomeResolve?.();
    this.applyMatchInfo(m.match, undefined);
  }

  private onSnapshot(m: Extract<ServerMsg, { t: 'snap' }>): void {
    if (m.you) {
      const wasAlive = this.local.alive;
      this.lastYou = m.you;
      this.local.reconcile(m.you, m.ack);
      if (wasAlive !== this.local.alive) this.onAliveChanged(this.local.alive);
    }
    for (const r of m.p) {
      const rp = this.remotes.get(r[0]);
      if (rp) rp.push(m.st, r);
    }
  }

  private onScores(rows: PlayerInfo[]): void {
    for (const p of rows) {
      this.players.set(p.id, p);
      const r = this.remotes.get(p.id);
      if (r) r.info = p;
      if (p.id === this.local.id) this.myInfo = p;
    }
    useStore.getState().setScoreboard(rows);
  }

  private addPlayer(p: PlayerInfo): void {
    this.players.set(p.id, p);
    if (p.id === this.local.id) {
      this.myInfo = p;
      return;
    }
    if (this.remotes.has(p.id)) return;
    const shadows = this.settings.shadows && this.settings.quality !== 'low';
    const r = new RemotePlayer(p, shadows);
    this.remotes.set(p.id, r);
    this.scene.add(r.model.group);
  }

  private removePlayer(id: number): void {
    this.players.delete(id);
    const r = this.remotes.get(id);
    if (r) {
      this.scene.remove(r.model.group);
      r.dispose();
      this.remotes.delete(id);
    }
  }

  private onTransportClosed(reason: string): void {
    if (this.disposed) return;
    if (this.transport.kind === 'practice') return;
    if (this.welcomeReject) {
      // A join is in flight (initial load or a reconnect attempt): fail it so the caller moves on immediately.
      this.welcomeReject(new Error(`Disconnected: ${reason}`));
      if (!this.running) return;
      if (this.reconnecting) return;
    }
    if (/out of date|Version|Rate limit|too slow/i.test(reason)) {
      this.opts.onLeave(`Disconnected: ${reason}`);
      return;
    }
    void this.reconnect(reason);
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  private nameOf(id: number): string {
    return this.players.get(id)?.name ?? (id === this.local.id ? this.opts.name : 'Unknown');
  }

  private colorOf(id: number): number {
    return this.players.get(id)?.color ?? 0xffffff;
  }

  private onEvent(e: GameEvent): void {
    const store = useStore.getState();
    switch (e.e) {
      case 'shot': {
        if (e.id === this.local.id) return;
        const r = this.remotes.get(e.id);
        const def = WEAPONS[e.w];
        const ox = e.o[0];
        const oy = e.o[1];
        const oz = e.o[2];
        // Muzzle roughly in front of the shooter's eye.
        let mx = ox;
        let my = oy;
        let mz = oz;
        if (r) {
          dirFromYawPitch(r.yaw, r.pitch, tmpDir);
          mx = r.pos.x + tmpDir.x * 0.5;
          my = r.pos.y + eyeHeight(r.crouch) - 0.12 + tmpDir.y * 0.5;
          mz = r.pos.z + tmpDir.z * 0.5;
        }
        tmpV.set(mx, my, mz);
        for (const end of e.ends) {
          tmpV2.set(end[0], end[1], end[2]);
          this.tracers.spawn(tmpV, tmpV2, def.tracerColor, 0.1);
          if (this.settings.effects) this.sparks.burst(end[0], end[1], end[2], 0, 1, 0, 3, 0xffc27a, 3, 0.25, 0.04);
        }
        this.remoteFlash.flash(mx, my, mz, 10);
        audio.shot(e.w, false, mx, my, mz);
        break;
      }
      case 'hit': {
        if (e.d <= 0) {
          // Spawn protection absorbed the shot.
          store.pushHitMarker(false, false, true);
          audio.play('ricochet', { volume: 0.35, rate: 1.4 });
          break;
        }
        store.pushHitMarker(e.hs, e.k);
        audio.play(e.hs ? 'headshot' : 'hit', { volume: e.hs ? 0.8 : 0.6 });
        const r = this.remotes.get(e.v);
        if (r) {
          r.model.hitFlash(performance.now());
          if (this.settings.damageNumbers) {
            tmpV.set(r.pos.x, r.pos.y + playerHeight(r.crouch) + 0.1, r.pos.z).project(this.rig.camera);
            if (tmpV.z < 1) store.pushDamageNumber((tmpV.x + 1) * 50, (1 - tmpV.y) * 50, e.d, e.hs);
          }
          this.sparks.burst(r.pos.x, r.pos.y + 1.1, r.pos.z, 0, 0.5, 0, e.hs ? 12 : 7, e.hs ? 0xff5a8a : 0xffe6b0, 3, 0.3, 0.05);
        }
        if (e.k) {
          audio.play('kill', { volume: 0.9 });
          store.pushBanner('ELIMINATED', 'kill', e.hs ? 'HEADSHOT' : undefined);
        }
        break;
      }
      case 'dmg': {
        this.local.hp = e.hp;
        this.local.armor = e.ar;
        const dx = e.ax - this.local.move.pos.x;
        const dz = e.az - this.local.move.pos.z;
        // Angle of the attacker relative to where we look (0 = ahead, clockwise positive).
        const worldAngle = Math.atan2(-dx, -dz);
        let rel = worldAngle - this.rig.yaw;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        store.pushDamage(-rel);
        store.flashDamage();
        this.rig.shake(Math.min(0.6, 0.15 + e.d / 120));
        audio.play('hurt', { volume: 0.7, rate: 0.9 + Math.random() * 0.2 });
        break;
      }
      case 'kill': {
        const mine = e.k === this.local.id;
        const died = e.v === this.local.id;
        store.pushKill({
          killer: e.k >= 0 ? this.nameOf(e.k) : '',
          killerColor: e.k >= 0 ? this.colorOf(e.k) : 0xffffff,
          victim: this.nameOf(e.v),
          victimColor: this.colorOf(e.v),
          weapon: e.w,
          headshot: e.hs,
          mine,
          died,
        });
        if (died) {
          store.setDeath({
            killer: e.k >= 0 ? this.nameOf(e.k) : '',
            killerColor: e.k >= 0 ? this.colorOf(e.k) : 0xffffff,
            weapon: e.w,
            headshot: e.hs,
            respawnAt: this.clock.serverNow(performance.now()) + COMBAT.RESPAWN_DELAY * 1000,
          });
          audio.play('death', { volume: 0.8 });
        }
        if (mine && e.milestone > 0) {
          store.pushBanner(`${e.milestone} KILL STREAK`, 'streak', e.milestone >= 10 ? 'UNSTOPPABLE' : e.milestone >= 7 ? 'DOMINATING' : e.milestone >= 5 ? 'RAMPAGE' : 'ON FIRE');
          audio.play('streak', { volume: 0.7, delay: 0.15 });
        }
        break;
      }
      case 'spawn': {
        if (e.id === this.local.id) {
          store.setDeath(null);
          audio.play('spawn', { volume: 0.5 });
          this.rig.setAim(e.yaw, 0);
        } else {
          const r = this.remotes.get(e.id);
          if (r) r.teleport(e.x, e.y, e.z, e.yaw);
        }
        break;
      }
      case 'join':
        this.addPlayer(e.p);
        break;
      case 'leave':
        this.removePlayer(e.id);
        break;
      case 'reload': {
        const r = this.remotes.get(e.id);
        if (r) audio.reloadSequence(r.weapon, WEAPONS[r.weapon].reloadTime, r.pos.x, r.pos.y + 1.2, r.pos.z);
        break;
      }
      case 'switch': {
        const r = this.remotes.get(e.id);
        if (r) audio.play('equip', { volume: 0.3, x: r.pos.x, y: r.pos.y + 1.2, z: r.pos.z });
        break;
      }
      case 'match':
        this.applyMatchInfo(e.m, e.results);
        break;
      case 'streak':
        break;
    }
  }

  private applyMatchInfo(m: MatchInfo, results?: PlayerInfo[]): void {
    const store = useStore.getState();
    const prevPhase = this.match.phase;
    this.match = m;
    this.local.live = m.phase === 'live';
    if (m.map !== this.map.id && this.running) {
      this.loadMapVisuals(getMap(m.map));
      audio.startAmbient(this.map.particles);
    }
    store.setHud({ phase: m.phase, phaseEndsAt: m.phaseEndsAt });
    if (m.phase === 'ended') {
      const rows = results ?? [...this.players.values()].sort((a, b) => b.score - a.score);
      const me = rows.find((r) => r.id === this.local.id) ?? this.myInfo;
      store.setResults({
        rows,
        me: me ?? null,
        accuracy: me && me.shots > 0 ? me.hits / me.shots : 0,
        bestStreak: me?.bestStreak ?? 0,
        nextAt: m.phaseEndsAt,
      });
      store.setDeath(null);
      audio.play('match_end', { volume: 0.8 });
      audio.musicCadence();
      audio.stopMusic(1.2);
      this.input.releaseLock();
    } else if (m.phase === 'countdown') {
      if (prevPhase === 'ended' || prevPhase === 'waiting') {
        store.setResults(null);
        store.setDeath(null);
      }
      this.lastCountdown = -1;
      if (audio.musicPlaying !== 'match') audio.startMusic('match');
    } else if (m.phase === 'live') {
      if (prevPhase === 'countdown') {
        store.setCountdown(0);
        audio.play('go', { volume: 0.8 });
        setTimeout(() => useStore.getState().setCountdown(null), 900);
      }
    }
  }

  private onAliveChanged(alive: boolean): void {
    if (alive) {
      this.viewModel.setWeapon(this.local.currentWeapon);
      useStore.getState().setDeath(null);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Frame                                                               */
  /* ------------------------------------------------------------------ */

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.25) dt = 0.25;
    this.transport.tick(now);

    // Mouse look (applied at frame rate for lowest latency).
    const m = this.input.consumeMouse();
    this.mouse = m;
    {
      const def = WEAPONS[this.local.currentWeapon];
      const adsScale = 1 + (def.adsFov - 1) * this.adsAmount;
      const sens = this.settings.sensitivity * 0.0004 * adsScale;
      this.rig.look(m.dx, m.dy, sens);
    }

    // Fixed-step simulation.
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= SIM.DT && steps < 5) {
      this.fixedStep(now);
      this.accumulator -= SIM.DT;
      steps++;
    }
    if (steps === 5) this.accumulator = 0;
    const alpha = this.accumulator / SIM.DT;

    this.local.updateSmoothing(dt);
    const lp = this.local;
    const mv = lp.move;
    const px = lp.prevPos.x + (mv.pos.x - lp.prevPos.x) * alpha + lp.visualOffset.x;
    const py = lp.prevPos.y + (mv.pos.y - lp.prevPos.y) * alpha + lp.visualOffset.y;
    const pz = lp.prevPos.z + (mv.pos.z - lp.prevPos.z) * alpha + lp.visualOffset.z;
    const speed = horizontalSpeed(mv);
    const keys = this.input.peekKeys();
    const adsHeld = (keys & Keys.ADS) !== 0 && lp.canAct && !mv.sprint;
    const def = WEAPONS[lp.currentWeapon];
    const adsTarget = adsHeld ? 1 : 0;
    this.adsAmount += (adsTarget - this.adsAmount) * Math.min(1, dt / def.adsTime);
    const rm = this.settings.reducedMotion;
    const aspect = window.innerWidth / window.innerHeight;
    this.rig.update(
      dt,
      {
        x: px,
        y: py,
        z: pz,
        crouch: mv.crouch,
        speed,
        onGround: mv.onGround,
        landedSpeed: mv.landedSpeed,
        sprint: mv.sprint && speed > 3,
        adsAmount: this.adsAmount,
        adsFov: def.adsFov,
        alive: lp.alive,
        reducedMotion: rm,
      },
      aspect,
    );

    // Remote players
    const serverNow = this.clock.serverNow(now);
    const renderTime = serverNow - SIM.INTERP_DELAY_MS;
    for (const r of this.remotes.values()) r.update(renderTime, dt, now, this.rig.camera);

    // Effects
    this.tracers.update(dt);
    this.sparks.update(dt);
    this.casings.update(dt);
    this.remoteFlash.update();
    this.localFlash.update();
    this.particles?.update(dt);
    if (this.sky) this.sky.mesh.position.copy(this.rig.camera.position);

    // Weapon
    const w = lp.weapon;
    const reloading = isReloading(w);
    const reloadProgress = reloading ? 1 - (w.reloadEndsAt - w.simTime) / def.reloadTime : 0;
    const equipProgress = w.simTime >= w.equipEndsAt ? 1 : 1 - (w.equipEndsAt - w.simTime) / def.equipTime;
    this.viewModel.setWeapon(lp.currentWeapon);
    this.viewModel.update(dt, {
      mouseDx: m.dx,
      mouseDy: m.dy,
      speed,
      onGround: mv.onGround,
      sprint: mv.sprint && speed > 3,
      adsAmount: this.adsAmount,
      crouch: mv.crouch,
      reloading,
      reloadProgress,
      equipProgress,
      alive: lp.alive,
      reducedMotion: rm,
    });

    // Audio listener
    const cam = this.rig.camera;
    tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion);
    tmpV2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    audio.setListener(cam.position.x, cam.position.y, cam.position.z, tmpV.x, tmpV.y, tmpV.z, tmpV2.x, tmpV2.y, tmpV2.z);

    // Countdown beeps
    this.updateCountdown(serverNow);

    // Render
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    this.viewModel.render(this.renderer);

    // Stats & HUD
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.hudTimer += dt;
    if (this.hudTimer >= 1 / 15) {
      this.hudTimer = 0;
      this.pushHud(adsHeld, speed);
      useStore.getState().prune(now);
    }
  };

  private updateCountdown(serverNow: number): void {
    if (this.match.phase !== 'countdown') return;
    const remain = this.match.phaseEndsAt - serverNow;
    const n = Math.ceil(remain / 1000);
    if (n !== this.lastCountdown && n >= 1 && n <= 3) {
      this.lastCountdown = n;
      useStore.getState().setCountdown(n);
      audio.play('beep', { volume: 0.6, rate: 1 });
    }
  }

  private pushHud(ads: boolean, speed: number): void {
    const lp = this.local;
    const w = lp.weapon;
    const def = WEAPONS[lp.currentWeapon];
    const spread = spreadDegrees(def, { ads, moveFrac: speed / MOVE.WALK_SPEED, airborne: !lp.move.onGround, crouch: lp.move.crouch, bloom: w.bloom });
    const reloading = isReloading(w);
    const me = this.myInfo;
    let rank = 0;
    if (me) {
      const rows = useStore.getState().scoreboard;
      rank = rows.findIndex((r) => r.id === me.id) + 1;
    }
    useStore.getState().setHud({
      hp: lp.hp,
      armor: lp.armor,
      mag: w.ammo[w.slot].mag,
      reserve: w.ammo[w.slot].reserve,
      weapon: lp.currentWeapon,
      slot: w.slot,
      weapons: [w.ids[0], w.ids[1]],
      reloading,
      reloadProgress: reloading ? 1 - (w.reloadEndsAt - w.simTime) / def.reloadTime : 0,
      spread,
      ads,
      scoped: ads && lp.currentWeapon === 'sniper' && this.adsAmount > 0.9,
      alive: lp.alive,
      serverOffset: this.clock.offset,
      score: me?.score ?? 0,
      kills: me?.kills ?? 0,
      deaths: me?.deaths ?? 0,
      streak: me?.streak ?? 0,
      rank,
      ping: Math.round(this.clock.rtt),
      fps: this.fps,
      lowHealth: lp.alive && lp.hp <= 30,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Fixed step                                                          */
  /* ------------------------------------------------------------------ */

  private fixedStep(now: number): void {
    const lp = this.local;
    let keys = this.input.consumeKeys();
    const wheel = this.input.consumeWheel();
    if (wheel !== 0) keys |= Keys.SWAP;
    if (!this.input.locked) keys = 0;
    const wasOnGround = lp.move.onGround;
    const renderTime = this.clock.serverNow(now) - SIM.INTERP_DELAY_MS;
    const input = lp.step(keys, this.rig.yaw, this.rig.pitch, SIM.DT, renderTime, stepOut);
    if (lp.alive) {
      if (stepOut.fired) this.onLocalFire();
      if (stepOut.dryFire) audio.play('dry', { volume: 0.5 });
      if (stepOut.reloadStarted) audio.reloadSequence(lp.currentWeapon, WEAPONS[lp.currentWeapon].reloadTime);
      if (stepOut.switched) {
        audio.play('equip', { volume: 0.5 });
        this.viewModel.setWeapon(lp.currentWeapon);
      }
      const mv = lp.move;
      if (mv.jumped) audio.play('jump', { volume: 0.35 });
      if (!wasOnGround && mv.onGround && mv.landedSpeed > 2) audio.play('land', { volume: Math.min(0.8, 0.25 + mv.landedSpeed * 0.04) });
      const speed = horizontalSpeed(mv);
      if (mv.onGround && speed > 1.2) {
        this.stepAccum += speed * SIM.DT;
        const stride = mv.crouch ? 1.4 : mv.sprint ? 2.3 : 1.9;
        if (this.stepAccum >= stride) {
          this.stepAccum = 0;
          audio.footstep(true, undefined, undefined, undefined, mv.crouch ? 0.4 : mv.sprint ? 1.1 : 0.8);
        }
      }
    }
    this.inputBatch.push(input);
    if (this.inputBatch.length >= SIM.INPUT_BATCH) {
      if (this.welcomed && !this.reconnecting) this.transport.send({ t: 'in', f: this.inputBatch });
      this.inputBatch = [];
    }
    if (this.welcomed && !this.reconnecting && now - this.lastPing > 2000) {
      this.lastPing = now;
      this.transport.send({ t: 'ping', c: now, rtt: this.clock.rtt });
    }
    if (this.match.phase === 'live' !== this.wasLive) this.wasLive = this.match.phase === 'live';
  }

  private onLocalFire(): void {
    const lp = this.local;
    const def = WEAPONS[lp.currentWeapon];
    const rm = this.settings.reducedMotion;
    const strength = def.recoil.viewKick;
    this.rig.recoil(def.recoil.kick, def.recoil.horiz, def.recoil.recovery, def.recoil.viewKick, rm);
    this.viewModel.fire(strength, rm);
    audio.shot(lp.currentWeapon, true);
    const cam = this.rig.camera;
    // Flash light in the world so walls light up.
    tmpV.set(0, -0.1, -0.6).applyQuaternion(cam.quaternion).add(cam.position);
    this.localFlash.flash(tmpV.x, tmpV.y, tmpV.z, 12);
    // Tracers and impacts (visual only; the server decides hits).
    const muzzle = this.viewModel.muzzleWorld(cam, new THREE.Vector3());
    const ox = lp.move.pos.x;
    const oy = lp.move.pos.y + eyeHeight(lp.move.crouch);
    const oz = lp.move.pos.z;
    const spread = spreadDegrees(def, {
      ads: this.adsAmount > 0.5,
      moveFrac: horizontalSpeed(lp.move) / MOVE.WALK_SPEED,
      airborne: !lp.move.onGround,
      crouch: lp.move.crouch,
      bloom: Math.max(0, lp.weapon.bloom - def.bloom.perShot),
    });
    const spreadRad = (spread * Math.PI) / 180;
    const base = dirFromYawPitch(this.rig.yaw, this.rig.pitch, tmpDir);
    const right = tmpV2.set(base.x, base.y, base.z).cross(UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, new THREE.Vector3(base.x, base.y, base.z));
    for (let i = 0; i < def.pellets; i++) {
      let dx = base.x;
      let dy = base.y;
      let dz = base.z;
      if (spreadRad > 0) {
        const r = spreadRad * Math.sqrt(Math.random());
        const th = Math.random() * Math.PI * 2;
        const cx = Math.cos(th) * r;
        const cy = Math.sin(th) * r;
        dx += right.x * cx + up.x * cy;
        dy += right.y * cx + up.y * cy;
        dz += right.z * cx + up.z * cy;
        const l = Math.hypot(dx, dy, dz);
        dx /= l;
        dy /= l;
        dz /= l;
      }
      this.world.raycast(ox, oy, oz, dx, dy, dz, def.range, tmpRay);
      let t = tmpRay.hit ? tmpRay.dist : def.range;
      let hitPlayer = false;
      for (const r of this.remotes.values()) {
        if (!r.alive) continue;
        const h = playerHeight(r.crouch);
        const hw = PLAYER.HALF_WIDTH;
        const th = raySphere(ox, oy, oz, dx, dy, dz, r.pos.x, r.pos.y + h - PLAYER.HEAD_RADIUS - 0.02, r.pos.z, PLAYER.HEAD_RADIUS);
        if (th > 0 && th < t) {
          t = th;
          hitPlayer = true;
        }
        const tb = rayAABB(ox, oy, oz, dx, dy, dz, { minX: r.pos.x - hw, maxX: r.pos.x + hw, minY: r.pos.y, maxY: r.pos.y + h - PLAYER.HEAD_RADIUS * 2 + 0.05, minZ: r.pos.z - hw, maxZ: r.pos.z + hw });
        if (tb > 0 && tb < t) {
          t = tb;
          hitPlayer = true;
        }
      }
      const end = new THREE.Vector3(ox + dx * t, oy + dy * t, oz + dz * t);
      this.tracers.spawn(muzzle, end, def.tracerColor, 0.08);
      if (this.settings.effects) {
        if (!hitPlayer && tmpRay.hit && t >= tmpRay.dist - 1e-3) {
          this.sparks.burst(end.x, end.y, end.z, tmpRay.nx, tmpRay.ny, tmpRay.nz, def.pellets > 1 ? 3 : 8, 0xffc27a, 4, 0.35, 0.045);
          if (i === 0) audio.play(Math.random() < 0.3 ? 'ricochet' : 'impact', { volume: 0.35, x: end.x, y: end.y, z: end.z, rate: 0.9 + Math.random() * 0.3 });
        }
      }
    }
    if (this.settings.effects && !rm) {
      // Eject a casing to the right of the weapon.
      tmpV.set(0.25, -0.15, -0.35).applyQuaternion(cam.quaternion).add(cam.position);
      tmpV2.set(1.8, 1.2, 0.3).applyQuaternion(cam.quaternion);
      this.casings.spawn(tmpV.x, tmpV.y, tmpV.z, tmpV2.x, tmpV2.y, tmpV2.z, lp.move.pos.y);
    }
    void fireInterval;
    void MATCH;
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
